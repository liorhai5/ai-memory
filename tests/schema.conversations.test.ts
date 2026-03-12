import { describe, expect, test } from 'vitest';
import { createTempApp } from './test-helpers.js';

describe('Conversation schema (D1)', () => {
  test('creates conversations, turns, and turns_fts tables', () => {
    const { app } = createTempApp();
    const rows = app.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    expect(names).toContain('conversations');
    expect(names).toContain('turns');
    expect(names).toContain('turns_fts');
  });

  test('conversations has all D1 columns', () => {
    const { app } = createTempApp();
    const cols = app.db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    for (const expected of ['id', 'external_id', 'workspace', 'ide', 'source_path', 'source_mtime', 'title', 'summary', 'turn_count', 'started_at', 'updated_at']) {
      expect(colNames).toContain(expected);
    }
  });

  test('turns has all D1 columns', () => {
    const { app } = createTempApp();
    const cols = app.db.prepare('PRAGMA table_info(turns)').all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    for (const expected of ['id', 'conversation_id', 'role', 'content', 'content_hash', 'turn_number', 'created_at']) {
      expect(colNames).toContain(expected);
    }
  });

  test('enforces external_id uniqueness via unique index', () => {
    const { app } = createTempApp();
    app.conversationStore.upsertConversationByExternalId({ external_id: 'same', workspace: 'w1', ide: 'cli' });
    app.conversationStore.upsertConversationByExternalId({ external_id: 'same', workspace: 'w2', ide: 'cli' });
    const row = app.db.prepare(`SELECT COUNT(*) as c FROM conversations WHERE external_id = 'same'`).get() as { c: number };
    expect(row.c).toBe(1);
  });

  test('enforces turn role CHECK constraint', () => {
    const { app } = createTempApp();
    const conv = app.conversationStore.upsertConversationByExternalId({ external_id: 'check-1', workspace: 'w', ide: 'cli' });
    expect(() =>
      app.db.prepare(`INSERT INTO turns (id, conversation_id, role, content, content_hash, created_at) VALUES ('t1', ?, 'invalid_role', 'x', 'h', '2026-01-01')`)
        .run(conv.id)
    ).toThrow();
  });

});
