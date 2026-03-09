import type Database from 'better-sqlite3';
import type { MemoryEntry, MemoryState, MemoryType } from '../types.js';

export class MemoryStore {
  constructor(private readonly db: Database.Database) {}

  insert(entry: MemoryEntry): boolean {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO memory_entries
      (id, type, content, content_hash, workspace, session_id, score, repetition_count, source, source_event_id, extraction_confidence, created_at, last_accessed_at, state, embedding)
      VALUES (@id, @type, @content, @content_hash, @workspace, @session_id, @score, @repetition_count, @source, @source_event_id, @extraction_confidence, @created_at, @last_accessed_at, @state, @embedding)
    `);
    const res = stmt.run(entry as unknown as Record<string, unknown>);
    if (res.changes > 0) {
      this.db
        .prepare(`INSERT INTO memory_entries_fts (id, content, type, workspace) VALUES (?, ?, ?, ?)`)
        .run(entry.id, entry.content, entry.type, entry.workspace ?? '');
      return true;
    }
    return false;
  }

  byId(id: string): MemoryEntry | undefined {
    return this.db.prepare(`SELECT * FROM memory_entries WHERE id = ?`).get(id) as MemoryEntry | undefined;
  }

  list(limit = 100): MemoryEntry[] {
    return this.db.prepare(`SELECT * FROM memory_entries ORDER BY created_at DESC LIMIT ?`).all(limit) as MemoryEntry[];
  }

  updateScoreAndRepetition(id: string, score: number, repetitionDelta = 1): void {
    this.db
      .prepare(`UPDATE memory_entries SET score = ?, repetition_count = repetition_count + ? WHERE id = ?`)
      .run(score, repetitionDelta, id);
  }

  updateState(id: string, state: MemoryState): boolean {
    const row = this.byId(id);
    if (!row) return false;
    if (row.state === 'superseded' && state === 'active') return false;
    const res = this.db.prepare(`UPDATE memory_entries SET state = ? WHERE id = ?`).run(state, id);
    return res.changes > 0;
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM memory_entries WHERE id = ?`).run(id);
    this.db.prepare(`DELETE FROM memory_entries_fts WHERE id = ?`).run(id);
  }

  findByHashWorkspace(contentHash: string, workspace: string | null): MemoryEntry | undefined {
    if (workspace === null) {
      return this.db
        .prepare(`SELECT * FROM memory_entries WHERE content_hash = ? AND workspace IS NULL LIMIT 1`)
        .get(contentHash) as MemoryEntry | undefined;
    }
    return this.db
      .prepare(`SELECT * FROM memory_entries WHERE content_hash = ? AND workspace = ? LIMIT 1`)
      .get(contentHash, workspace) as MemoryEntry | undefined;
  }

  searchFts(query: string, topK: number): Array<MemoryEntry & { bm25_score: number }> {
    return this.db
      .prepare(`
        SELECT m.*, bm25(memory_entries_fts) AS bm25_score
        FROM memory_entries_fts f
        JOIN memory_entries m ON m.id = f.id
        WHERE memory_entries_fts MATCH ?
        ORDER BY bm25(memory_entries_fts)
        LIMIT ?
      `)
      .all(query, topK) as Array<MemoryEntry & { bm25_score: number }>;
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM memory_entries`).get() as { c: number };
    return row.c;
  }

  typeExists(type: MemoryType): boolean {
    const row = this.db.prepare(`SELECT 1 as ok FROM memory_entries WHERE type = ? LIMIT 1`).get(type) as { ok: number } | undefined;
    return !!row;
  }
}
