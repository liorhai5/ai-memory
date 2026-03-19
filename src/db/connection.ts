import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

export function getDbPath(): string {
  return process.env.AI_MEMORY_DB_PATH || ':memory:';
}

export function createDb(dbPath = getDbPath()): Database.Database {
  const db = new Database(dbPath);
  const hasConversations = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'`).get();
  if (hasConversations) {
    const hasWorkspacePath = !!db
      .prepare(`SELECT name FROM pragma_table_info('conversations') WHERE name = 'workspace_path'`)
      .get();
    if (!hasWorkspacePath) {
      db.exec(`ALTER TABLE conversations ADD COLUMN workspace_path TEXT;`);
    }
    const hasModel = !!db
      .prepare(`SELECT name FROM pragma_table_info('conversations') WHERE name = 'model'`)
      .get();
    if (hasModel) {
      db.exec(`ALTER TABLE conversations DROP COLUMN model;`);
    }
    // D047: Add project_slug column for per-project configuration
    const hasProjectSlug = !!db
      .prepare(`SELECT name FROM pragma_table_info('conversations') WHERE name = 'project_slug'`)
      .get();
    if (!hasProjectSlug) {
      db.exec(`ALTER TABLE conversations ADD COLUMN project_slug TEXT;`);
    }
  }
  // D044: WAL mode for concurrent reads during file-watch imports
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA_SQL);
  return db;
}
