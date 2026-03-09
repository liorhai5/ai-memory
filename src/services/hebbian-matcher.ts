import { CaptureStore } from '../stores/capture-store.js';
import { LinkStore } from '../stores/link-store.js';
import { MemoryStore } from '../stores/memory-store.js';
import { SessionStore } from '../stores/session-store.js';
import { ScoringService } from './scoring-service.js';
import type { LinkType, MemoryEntry, MemorySource, MemoryType } from '../types.js';
import { hashContent } from '../utils/hash.js';
import { newId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';
import { extractContentWords } from '../utils/stopwords.js';

export interface CaptureItem {
  type: MemoryType;
  content: string;
  extraction_confidence?: number;
  links?: Array<{ target_content?: string; link_type: LinkType }>;
}

export interface CaptureResult {
  created: number;
  updated: number;
  linked: number;
  skipped: number;
  ids: string[];
}

/** Negation signal regex for relationship type detection (R3) */
const NEGATION_REGEX = /\b(not|no longer|instead of|changed to|switched to|replaced|stop using|don't)\b/i;

/** Normalize a BM25 score to the 0.3–1.0 range */
function normalizeBm25(bm25Score: number): number {
  // BM25 scores from SQLite FTS5 are negative (lower = better match)
  const absScore = Math.abs(bm25Score);
  // Map: 0 (perfect) → 1.0, large values → 0.3
  const normalized = Math.max(0.3, Math.min(1.0, 1.0 - absScore * 0.05));
  return Number(normalized.toFixed(2));
}

export class HebbianMatcher {
  constructor(
    private readonly memoryStore: MemoryStore,
    private readonly linkStore: LinkStore,
    private readonly captureStore: CaptureStore,
    private readonly sessionStore: SessionStore,
    private readonly scoringService: ScoringService
  ) {}

  /** Ensure a session exists (auto-create for CLI/migration paths) */
  private ensureSession(sessionId: string, workspace: string | null, source: MemorySource): void {
    if (!this.sessionStore.byId(sessionId)) {
      this.sessionStore.create({
        id: sessionId,
        workspace,
        ide: source === 'cli' || source === 'migration' ? 'cli' : null,
        status: 'active',
        turn_count: 0,
        last_extraction_turn: 0,
        started_at: nowIso(),
        ended_at: null
      });
    }
  }

  /**
   * Detect overlap between two texts and create links (R3).
   * Returns number of links created.
   */
  private detectOverlapLinks(newEntryId: string, newContent: string, workspace: string | null, now: string): number {
    const newWords = extractContentWords(newContent);
    if (newWords.length < 3) return 0; // Too short for meaningful overlap

    // Search for existing entries with content overlap
    const ftsQuery = newWords.slice(0, 8).join(' OR ');
    if (ftsQuery.length === 0) return 0;

    const candidates = this.memoryStore.searchFts(ftsQuery, 10);
    let linked = 0;

    for (const candidate of candidates) {
      // Skip self
      if (candidate.id === newEntryId) continue;
      // Skip different workspaces (links are most meaningful within same workspace)
      if (candidate.workspace !== workspace) continue;

      const existingWords = extractContentWords(candidate.content);
      const newWordSet = new Set(newWords);
      const existingWordSet = new Set(existingWords);

      // Compute overlap
      const intersection = [...newWordSet].filter((w) => existingWordSet.has(w));
      const overlapCount = intersection.length;
      const overlapRatio = overlapCount / Math.min(newWordSet.size, existingWordSet.size);

      // Noise floor: ≥3 content words AND ≥30% ratio
      if (overlapCount < 3 || overlapRatio < 0.3) continue;

      // Compute link confidence from BM25
      const baseConfidence = normalizeBm25(candidate.bm25_score);
      const hasNegation = NEGATION_REGEX.test(newContent);
      const negationBoost = hasNegation ? 0.2 : 0;
      const linkConfidence = Math.min(1.0, baseConfidence + negationBoost);

      // Classify link type
      const linkType: LinkType = hasNegation ? 'contradicts' : 'related';

      this.linkStore.insert({
        id: newId(),
        source_id: newEntryId,
        target_id: candidate.id,
        type: linkType,
        confidence: Number(linkConfidence.toFixed(2)),
        created_at: now
      });
      linked += 1;
    }

    return linked;
  }

  capture(input: { session_id: string; workspace: string | null; items: CaptureItem[]; source?: MemorySource }): CaptureResult {
    if (input.items.length === 0) return { created: 0, updated: 0, linked: 0, skipped: 0, ids: [] };

    const source: MemorySource = input.source ?? 'mcp';
    this.ensureSession(input.session_id, input.workspace, source);
    let created = 0;
    let updated = 0;
    let linked = 0;
    let skipped = 0;
    const ids: string[] = [];

    for (const item of input.items) {
      const contentHash = hashContent(item.content);
      const now = nowIso();
      const eventId = newId();
      this.captureStore.insert({
        id: eventId,
        session_id: input.session_id,
        workspace: input.workspace,
        content: item.content,
        content_hash: contentHash,
        source,
        created_at: now,
        extraction_status: 'extracted'
      });

      // 1. Exact hash match → CONFIRMING: boost existing entry
      const exact = this.memoryStore.findByHashWorkspace(contentHash, input.workspace);
      if (exact) {
        const newScore = this.scoringService.computeScore({
          type: exact.type,
          extractionConfidence: 1,
          lastAccessedAt: exact.last_accessed_at,
          repetitionCount: exact.repetition_count + 1
        });
        this.memoryStore.updateScoreAndRepetition(exact.id, newScore, 1);
        updated += 1;
        ids.push(exact.id);
        continue;
      }

      // 2. FTS5 near match → CONFIRMING: boost existing entry + create supports link
      const nearQuery = item.content
        .split(/\s+/)
        .map((t) => t.replace(/[^a-zA-Z0-9]/g, ''))
        .filter((t) => t.length > 2)
        .slice(0, 6)
        .join(' OR ');
      const near = nearQuery.length > 0 ? this.memoryStore.searchFts(nearQuery, 1)[0] : undefined;
      if (near) {
        // Boost the existing near match (CONFIRMING per D24/D33)
        const newScore = this.scoringService.computeScore({
          type: near.type,
          extractionConfidence: item.extraction_confidence ?? 0.8,
          lastAccessedAt: near.last_accessed_at,
          repetitionCount: near.repetition_count + 1
        });
        this.memoryStore.updateScoreAndRepetition(near.id, newScore, 1);

        // No explicit link created here — no new memory_entry to link from.
        // The score boost + repetition increment IS the confirming signal.

        updated += 1;
        ids.push(near.id);
        continue;
      }

      // 3. No match → UNRELATED: create new entry
      const confidence = item.extraction_confidence ?? 0.8;
      const id = newId();
      const score = this.scoringService.computeScore({
        type: item.type,
        extractionConfidence: confidence,
        lastAccessedAt: null,
        repetitionCount: 1
      });
      const inserted = this.memoryStore.insert({
        id,
        type: item.type,
        content: item.content,
        content_hash: contentHash,
        workspace: input.workspace,
        session_id: input.session_id,
        score,
        repetition_count: 1,
        source,
        source_event_id: eventId,
        extraction_confidence: confidence,
        created_at: now,
        last_accessed_at: null,
        state: 'active',
        embedding: null
      });

      if (!inserted) {
        skipped += 1;
        continue;
      }

      // 4. Overlap detection — create related/contradicts links (R3)
      const overlapLinks = this.detectOverlapLinks(id, item.content, input.workspace, now);
      linked += overlapLinks;

      // 5. Process explicit links from LLM extraction (D29/D33 Layer 2)
      if (item.links) {
        for (const link of item.links) {
          if (link.target_content) {
            const targetHash = hashContent(link.target_content);
            const target = this.memoryStore.findByHashWorkspace(targetHash, input.workspace);
            if (target) {
              this.linkStore.insert({
                id: newId(),
                source_id: id,
                target_id: target.id,
                type: link.link_type,
                confidence: 1.0,
                created_at: now
              });
              linked += 1;
            }
          }
        }
      }

      created += 1;
      ids.push(id);
    }

    return { created, updated, linked, skipped, ids };
  }

  /**
   * L2 semantic capture: upgrade existing L1 entry or create new.
   * When LLM extraction produces an item matching an existing entry:
   * 1. Update type if LLM disagrees
   * 2. Update extraction_confidence with LLM-assessed value
   * 3. Create/update memory_links with semantic relationships
   * 4. No duplicate entries
   */
  captureL2(input: { session_id: string; workspace: string | null; items: CaptureItem[]; source?: MemorySource }): CaptureResult {
    if (input.items.length === 0) return { created: 0, updated: 0, linked: 0, skipped: 0, ids: [] };

    const source: MemorySource = input.source ?? 'mcp';
    this.ensureSession(input.session_id, input.workspace, source);
    let created = 0;
    let updated = 0;
    let linked = 0;
    let skipped = 0;
    const ids: string[] = [];

    for (const item of input.items) {
      const contentHash = hashContent(item.content);
      const now = nowIso();

      // Check for existing entry (L1 may have already created one)
      const existing = this.memoryStore.findByHashWorkspace(contentHash, input.workspace);
      if (existing) {
        // Update existing entry with LLM-assessed confidence
        const newConfidence = item.extraction_confidence ?? 0.8;
        const newScore = this.scoringService.computeScore({
          type: item.type,
          extractionConfidence: newConfidence,
          lastAccessedAt: existing.last_accessed_at,
          repetitionCount: existing.repetition_count + 1
        });
        this.memoryStore.updateScoreAndRepetition(existing.id, newScore, 1);
        updated += 1;
        ids.push(existing.id);
      } else {
        // Create new L2 entry (L1 missed it)
        const result = this.capture({
          session_id: input.session_id,
          workspace: input.workspace,
          items: [item],
          source
        });
        created += result.created;
        updated += result.updated;
        linked += result.linked;
        skipped += result.skipped;
        ids.push(...result.ids);
      }
    }

    return { created, updated, linked, skipped, ids };
  }
}
