export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace TEXT,
  ide TEXT,                     -- cursor|claude-code|cli
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','crashed')),
  turn_count INTEGER NOT NULL DEFAULT 0,
  last_extraction_turn INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('decision','correction','pattern','learning','preference','fact')),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  workspace TEXT,
  session_id TEXT REFERENCES sessions(id),
  score REAL NOT NULL DEFAULT 1.0,
  repetition_count INTEGER NOT NULL DEFAULT 1,
  source TEXT,                  -- hook|cli|migration|mcp
  source_event_id TEXT,
  extraction_confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  last_accessed_at TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','superseded','archived')),
  embedding BLOB
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_hash_workspace
ON memory_entries(content_hash, COALESCE(workspace, '__NULL__'));

CREATE TABLE IF NOT EXISTS captured_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  workspace TEXT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source TEXT,                  -- hook|cli|manual
  created_at TEXT NOT NULL,
  extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK(extraction_status IN ('pending','extracted','failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_captured_events_hash_session
ON captured_events(content_hash, session_id);

CREATE TABLE IF NOT EXISTS memory_links (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('supersedes','contradicts','supports','refines','related')),
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES memory_entries(id) ON DELETE CASCADE,
  FOREIGN KEY(target_id) REFERENCES memory_entries(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
  id UNINDEXED,
  content,
  type,
  workspace,
  tokenize='unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS captured_events_fts USING fts5(
  id UNINDEXED,
  content,
  workspace,
  tokenize='unicode61'
);
`;
