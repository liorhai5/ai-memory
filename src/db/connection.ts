import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

export function getDbPath(): string {
  return process.env.AI_MEMORY_DB_PATH || ':memory:';
}

export function createDb(dbPath = getDbPath()): Database.Database {
  const db = new Database(dbPath);
  db.exec(SCHEMA_SQL);
  return db;
}
