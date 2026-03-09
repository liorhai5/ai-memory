import type Database from 'better-sqlite3';
import { MemoryStore } from '../stores/memory-store.js';
import { ScoringService } from './scoring-service.js';
import { hashContent } from '../utils/hash.js';
import { newId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';

export interface MaintenanceResult {
  decayed: number;
  deduped: number;
  linksCleaned: number;
  promoted: number;
  archived: number;
}

export class MaintenanceService {
  constructor(
    private readonly db: Database.Database,
    private readonly memoryStore: MemoryStore,
    private readonly scoringService: ScoringService
  ) {}

  run(workspace: string | null): MaintenanceResult {
    const scopeWhere = workspace === null ? 'workspace IS NULL' : 'workspace = ?';
    const params: unknown[] = workspace === null ? [] : [workspace];

    const rows = this.db
      .prepare(`SELECT * FROM memory_entries WHERE ${scopeWhere}`)
      .all(...params) as Array<{ id: string; type: string; last_accessed_at: string | null; repetition_count: number; score: number; content_hash: string }>;

    let decayed = 0;
    for (const row of rows) {
      const next = this.scoringService.computeScore({
        type: row.type as any,
        extractionConfidence: 1,
        lastAccessedAt: row.last_accessed_at,
        repetitionCount: row.repetition_count
      });
      if (next < row.score) {
        this.db.prepare(`UPDATE memory_entries SET score = ? WHERE id = ?`).run(next, row.id);
        decayed += 1;
      }
    }

    const duplicates = this.db
      .prepare(`
        SELECT content_hash, COUNT(*) AS c
        FROM memory_entries
        WHERE ${scopeWhere}
        GROUP BY content_hash
        HAVING COUNT(*) > 1
      `)
      .all(...params) as Array<{ content_hash: string; c: number }>;

    let deduped = 0;
    for (const dup of duplicates) {
      const ids = this.db
        .prepare(`SELECT id FROM memory_entries WHERE content_hash = ? AND ${scopeWhere} ORDER BY created_at ASC`)
        .all(dup.content_hash, ...params) as Array<{ id: string }>;
      for (const extra of ids.slice(1)) {
        this.memoryStore.delete(extra.id);
        deduped += 1;
      }
    }

    const orphanLinks = this.db
      .prepare(`
        SELECT l.id
        FROM memory_links l
        LEFT JOIN memory_entries s ON s.id = l.source_id
        LEFT JOIN memory_entries t ON t.id = l.target_id
        WHERE s.id IS NULL OR t.id IS NULL
      `)
      .all() as Array<{ id: string }>;

    for (const link of orphanLinks) {
      this.db.prepare(`DELETE FROM memory_links WHERE id = ?`).run(link.id);
    }

    // Gate 5: Promotion — captured events appearing in 3+ sessions → auto-promote
    const promoted = this.runPromotionGate(workspace);

    // Gate 4: Staleness — 30+ days old + score < 0.3 → archived
    const archived = this.runStalenessGate(workspace);

    return { decayed, deduped, linksCleaned: orphanLinks.length, promoted, archived };
  }

  /**
   * Gate 5: Promotion Gate (R11)
   * Captured events whose content_hash appears in 3+ different sessions
   * get auto-promoted to memory_entries as type='pattern'.
   */
  runPromotionGate(workspace: string | null): number {
    // Find content_hashes in captured_events that span 3+ sessions
    const scopeWhere = workspace === null ? 'workspace IS NULL' : 'workspace = ?';
    const params: unknown[] = workspace === null ? [] : [workspace];

    const candidates = this.db
      .prepare(`
        SELECT content_hash, content, MIN(workspace) as workspace, COUNT(DISTINCT session_id) as session_count
        FROM captured_events
        WHERE ${scopeWhere}
        GROUP BY content_hash
        HAVING COUNT(DISTINCT session_id) >= 3
      `)
      .all(...params) as Array<{ content_hash: string; content: string; workspace: string | null; session_count: number }>;

    let promoted = 0;
    for (const candidate of candidates) {
      // Skip if already a memory entry
      const existing = this.memoryStore.findByHashWorkspace(candidate.content_hash, workspace);
      if (existing) continue;

      const now = nowIso();
      const score = this.scoringService.computeScore({
        type: 'pattern',
        extractionConfidence: 1.0,
        lastAccessedAt: null,
        repetitionCount: candidate.session_count
      });

      this.memoryStore.insert({
        id: newId(),
        type: 'pattern',
        content: candidate.content,
        content_hash: candidate.content_hash,
        workspace,
        session_id: null,
        score,
        repetition_count: candidate.session_count,
        source: 'hook',
        source_event_id: null,
        extraction_confidence: 1.0,
        created_at: now,
        last_accessed_at: null,
        state: 'active',
        embedding: null
      });
      promoted += 1;
    }

    return promoted;
  }

  /**
   * Gate 4: Staleness Gate (R11)
   * Entries not accessed in 30+ days AND score < 0.3 → state='archived'.
   */
  runStalenessGate(workspace: string | null): number {
    const scopeWhere = workspace === null ? 'workspace IS NULL' : 'workspace = ?';
    const params: unknown[] = workspace === null ? [] : [workspace];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const stale = this.db
      .prepare(`
        SELECT id FROM memory_entries
        WHERE ${scopeWhere}
          AND state = 'active'
          AND score < 0.3
          AND (
            (last_accessed_at IS NOT NULL AND last_accessed_at < ?)
            OR (last_accessed_at IS NULL AND created_at < ?)
          )
      `)
      .all(...params, thirtyDaysAgo, thirtyDaysAgo) as Array<{ id: string }>;

    for (const entry of stale) {
      this.db.prepare(`UPDATE memory_entries SET state = 'archived' WHERE id = ?`).run(entry.id);
    }

    return stale.length;
  }

  /**
   * Check if pattern tuning should be triggered (R12).
   * Returns true if captured_events count exceeds last_tune_corpus_size + threshold.
   * threshold = 0 disables auto-tuning.
   */
  shouldTriggerTune(lastTuneCorpusSize: number, threshold = 500): boolean {
    if (threshold === 0) return false;
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM captured_events`).get() as { c: number };
    return row.c - lastTuneCorpusSize >= threshold;
  }
}
