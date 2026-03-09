import type Database from 'better-sqlite3';
import type { CapturedEvent, ExtractionStatus } from '../types.js';

export class CaptureStore {
  constructor(private readonly db: Database.Database) {}

  insert(event: CapturedEvent): boolean {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO captured_events
      (id, session_id, workspace, content, content_hash, source, created_at, extraction_status)
      VALUES (@id, @session_id, @workspace, @content, @content_hash, @source, @created_at, @extraction_status)
    `);
    const res = stmt.run(event as unknown as Record<string, unknown>);
    if (res.changes > 0) {
      this.db
        .prepare(`INSERT INTO captured_events_fts (id, content, workspace) VALUES (?, ?, ?)`)
        .run(event.id, event.content, event.workspace ?? '');
      return true;
    }
    return false;
  }

  byId(id: string): CapturedEvent | undefined {
    return this.db.prepare(`SELECT * FROM captured_events WHERE id = ?`).get(id) as CapturedEvent | undefined;
  }

  bySession(sessionId: string): CapturedEvent[] {
    return this.db
      .prepare(`SELECT * FROM captured_events WHERE session_id = ? ORDER BY created_at ASC`)
      .all(sessionId) as CapturedEvent[];
  }

  query(sessionId?: string, eventId?: string, workspace?: string | null, limit = 50): CapturedEvent[] {
    if (eventId) {
      const row = this.byId(eventId);
      return row ? [row] : [];
    }
    if (sessionId) {
      return this.db
        .prepare(`SELECT * FROM captured_events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`)
        .all(sessionId, limit) as CapturedEvent[];
    }
    if (workspace !== undefined) {
      if (workspace === null) {
        return this.db
          .prepare(`SELECT * FROM captured_events WHERE workspace IS NULL ORDER BY created_at DESC LIMIT ?`)
          .all(limit) as CapturedEvent[];
      }
      return this.db
        .prepare(`SELECT * FROM captured_events WHERE workspace = ? ORDER BY created_at DESC LIMIT ?`)
        .all(workspace, limit) as CapturedEvent[];
    }
    return this.db.prepare(`SELECT * FROM captured_events ORDER BY created_at DESC LIMIT ?`).all(limit) as CapturedEvent[];
  }

  listAll(): CapturedEvent[] {
    return this.db.prepare(`SELECT * FROM captured_events ORDER BY created_at ASC`).all() as CapturedEvent[];
  }

  updateExtractionStatus(id: string, status: ExtractionStatus): void {
    this.db.prepare(`UPDATE captured_events SET extraction_status = ? WHERE id = ?`).run(status, id);
  }

  countPending(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM captured_events WHERE extraction_status = 'pending'`).get() as { c: number };
    return row.c;
  }

  listPending(limit = 20): CapturedEvent[] {
    return this.db
      .prepare(`SELECT * FROM captured_events WHERE extraction_status = 'pending' ORDER BY created_at ASC LIMIT ?`)
      .all(limit) as CapturedEvent[];
  }

  searchFts(query: string, topK: number): Array<CapturedEvent & { bm25_score: number }> {
    return this.db
      .prepare(`
        SELECT e.*, bm25(captured_events_fts) AS bm25_score
        FROM captured_events_fts f
        JOIN captured_events e ON e.id = f.id
        WHERE captured_events_fts MATCH ?
        ORDER BY bm25(captured_events_fts)
        LIMIT ?
      `)
      .all(query, topK) as Array<CapturedEvent & { bm25_score: number }>;
  }
}
