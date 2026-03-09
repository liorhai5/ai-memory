import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { nowIso } from '../src/utils/time.js';
import { hashContent } from '../src/utils/hash.js';

export function createTempApp() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-memory-'));
  const dbPath = join(dir, 'memory.db');
  const app = createApp(dbPath);
  return { app, dbPath, dir };
}

/** Seed a session so FK constraints are satisfied when inserting memory entries / events. */
export function ensureSession(app: ReturnType<typeof createApp>, sessionId = 's1', workspace: string | null = 'w1') {
  try {
    app.sessionStore.create({
      id: sessionId,
      workspace,
      ide: 'cli',
      status: 'active',
      turn_count: 0,
      last_extraction_turn: 0,
      started_at: nowIso(),
      ended_at: null
    });
  } catch {
    // already exists
  }
}

export function seedMemory(app: ReturnType<typeof createApp>, input: { id: string; content: string; type?: any; workspace?: string | null; score?: number; session_id?: string; extraction_confidence?: number }) {
  const sessionId = input.session_id ?? 's1';
  ensureSession(app, sessionId, input.workspace ?? 'w1');
  app.memoryStore.insert({
    id: input.id,
    type: input.type ?? 'decision',
    content: input.content,
    content_hash: hashContent(input.content),
    workspace: input.workspace ?? 'w1',
    session_id: sessionId,
    score: input.score ?? 0.8,
    repetition_count: 1,
    source: 'test',
    source_event_id: null,
    extraction_confidence: input.extraction_confidence ?? 1.0,
    created_at: nowIso(),
    last_accessed_at: null,
    state: 'active',
    embedding: null
  });
}

export function writeMemoryMd(path: string) {
  writeFileSync(
    path,
    `# Project Memory\n\n## Decisions\n- use sqlite\n## Patterns\n- keep hooks thin\n## Learnings\n- tests prevent regressions\n## Context\n- local machine memory\n`
  );
}
