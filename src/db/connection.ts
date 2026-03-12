import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

export function getDbPath(): string {
  return process.env.AI_MEMORY_DB_PATH || ':memory:';
}

export function createDb(dbPath = getDbPath()): Database.Database {
  const db = new Database(dbPath);
  const hasConversations = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'`).get();
  if (hasConversations) {
    const hasProjectKey = !!db
      .prepare(`SELECT name FROM pragma_table_info('conversations') WHERE name = 'project_key'`)
      .get();
    if (!hasProjectKey) {
      db.exec(`ALTER TABLE conversations ADD COLUMN project_key TEXT;`);
    }
    const hasModel = !!db
      .prepare(`SELECT name FROM pragma_table_info('conversations') WHERE name = 'model'`)
      .get();
    if (hasModel) {
      db.exec(`ALTER TABLE conversations DROP COLUMN model;`);
    }
  }
  db.exec(SCHEMA_SQL);
  return db;
}
