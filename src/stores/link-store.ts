import type Database from 'better-sqlite3';
import type { LinkType, MemoryLink } from '../types.js';

export class LinkStore {
  constructor(private readonly db: Database.Database) {}

  insert(link: MemoryLink): boolean {
    const res = this.db
      .prepare(`INSERT OR IGNORE INTO memory_links (id, source_id, target_id, type, confidence, created_at) VALUES (@id, @source_id, @target_id, @type, @confidence, @created_at)`)
      .run(link as unknown as Record<string, unknown>);
    return res.changes > 0;
  }

  list(limit = 100): MemoryLink[] {
    return this.db.prepare(`SELECT * FROM memory_links ORDER BY created_at DESC LIMIT ?`).all(limit) as MemoryLink[];
  }

  findByEntryId(entryId: string): MemoryLink[] {
    return this.db
      .prepare(`SELECT * FROM memory_links WHERE source_id = ? OR target_id = ? ORDER BY created_at DESC`)
      .all(entryId, entryId) as MemoryLink[];
  }

  validateType(type: string): type is LinkType {
    return ['supersedes', 'contradicts', 'supports', 'refines', 'related'].includes(type);
  }
}
