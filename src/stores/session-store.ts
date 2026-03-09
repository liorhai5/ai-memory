import type Database from 'better-sqlite3';
import type { SessionRow, SessionStatus } from '../types.js';
import { nowIso } from '../utils/time.js';

export class SessionStore {
  constructor(private readonly db: Database.Database) {}

  create(session: SessionRow): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, workspace, ide, status, turn_count, last_extraction_turn, started_at, ended_at) VALUES (@id,@workspace,@ide,@status,@turn_count,@last_extraction_turn,@started_at,@ended_at)`
      )
      .run(session as unknown as Record<string, unknown>);
  }

  byId(id: string): SessionRow | undefined {
    return this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as SessionRow | undefined;
  }

  incrementTurn(id: string): void {
    this.db.prepare(`UPDATE sessions SET turn_count = turn_count + 1 WHERE id = ?`).run(id);
  }

  setStatus(id: string, status: SessionStatus): boolean {
    const row = this.byId(id);
    if (!row) return false;
    if (row.status === 'completed') return false;
    const endedAt = status === 'completed' || status === 'crashed' ? nowIso() : null;
    const res = this.db.prepare(`UPDATE sessions SET status = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`).run(status, endedAt, id);
    return res.changes > 0;
  }

  setLastExtractionTurn(id: string, turn: number): void {
    this.db.prepare(`UPDATE sessions SET last_extraction_turn = ? WHERE id = ?`).run(turn, id);
  }
}
