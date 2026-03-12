export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  project_key TEXT,
  workspace TEXT,
  ide TEXT,                     -- cursor|claude-code|cli
  source_path TEXT,
  source_mtime TEXT,
  title TEXT,
  summary TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  turn_number INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_hash_conversation
ON turns(content_hash, conversation_id);

CREATE INDEX IF NOT EXISTS idx_turns_conversation
ON turns(conversation_id, turn_number);

CREATE INDEX IF NOT EXISTS idx_conversations_project_key
ON conversations(project_key);

CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
  id UNINDEXED,
  content,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS tool_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  called_at TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  workspace TEXT,
  param_keys TEXT,
  result_count INTEGER,
  success INTEGER NOT NULL DEFAULT 1,
  error_type TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_usage_tool_called
ON tool_usage(tool_name, called_at);

CREATE TABLE IF NOT EXISTS health_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE(category, message)
);
`;
