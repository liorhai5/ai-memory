import { describe, expect, test } from 'vitest';
import { createTempApp, ensureSession, seedMemory } from './test-helpers.js';
import { nowIso } from '../src/utils/time.js';
import { hashContent } from '../src/utils/hash.js';

describe('Schema', () => {
  test('1 schema.creates-all-tables', () => {
    const { app } = createTempApp();
    const rows = app.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    expect(names).toContain('memory_entries');
    expect(names).toContain('memory_links');
    expect(names).toContain('captured_events');
    expect(names).toContain('sessions');
    expect(names).toContain('memory_entries_fts');
    expect(names).toContain('captured_events_fts');
  });

  test('2 schema.memory-entry-types', () => {
    const { app } = createTempApp();
    expect(() =>
      app.db
        .prepare(`INSERT INTO memory_entries (id,type,content,content_hash,created_at) VALUES ('1','invalid','x','h','${nowIso()}')`)
        .run()
    ).toThrow();
  });

  test('3 schema.workspace-nullable', () => {
    const { app } = createTempApp();
    const ok = app.memoryStore.insert({
      id: 'm1',
      type: 'decision',
      content: 'x',
      content_hash: hashContent('x'),
      workspace: null,
      session_id: null,
      score: 0.5,
      repetition_count: 1,
      source: 'test',
      source_event_id: null,
      extraction_confidence: 1.0,
      created_at: nowIso(),
      last_accessed_at: null,
      state: 'active',
      embedding: null
    });
    expect(ok).toBe(true);
  });

  test('4 schema.embedding-nullable', () => {
    const { app } = createTempApp();
    app.memoryStore.insert({
      id: 'm2',
      type: 'fact',
      content: 'embedding placeholder',
      content_hash: hashContent('embedding placeholder'),
      workspace: 'w1',
      session_id: null,
      score: 0.3,
      repetition_count: 1,
      source: 'test',
      source_event_id: null,
      extraction_confidence: 1.0,
      created_at: nowIso(),
      last_accessed_at: null,
      state: 'active',
      embedding: null
    });
    const row = app.memoryStore.byId('m2');
    expect(row?.embedding).toBeNull();
  });

  test('5 schema.content-hash-required', () => {
    const { app } = createTempApp();
    expect(() => app.db.prepare(`INSERT INTO memory_entries (id,type,content,created_at) VALUES ('2','decision','x','${nowIso()}')`).run()).toThrow();
    ensureSession(app, 's0');
    expect(() => app.db.prepare(`INSERT INTO captured_events (id,session_id,content,created_at) VALUES ('e0','s0','x','${nowIso()}')`).run()).toThrow();
  });

  test('19 schema.no-explicit-tiers', () => {
    const { app } = createTempApp();
    const cols = app.db.prepare(`PRAGMA table_info(memory_entries)`).all() as Array<{ name: string }>;
    expect(cols.find((c) => c.name === 'tier')).toBeUndefined();
  });

  test('98 schema.captured-events-fts', () => {
    const { app } = createTempApp();
    const rows = app.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    // 6 core objects: sessions, memory_entries, captured_events, memory_links, memory_entries_fts, captured_events_fts
    expect(names).toContain('sessions');
    expect(names).toContain('memory_entries');
    expect(names).toContain('captured_events');
    expect(names).toContain('memory_links');
    expect(names).toContain('memory_entries_fts');
    expect(names).toContain('captured_events_fts');
  });

  test('99 schema.extraction-confidence', () => {
    const { app } = createTempApp();
    const cols = app.db.prepare(`PRAGMA table_info(memory_entries)`).all() as Array<{ name: string; dflt_value: string | null }>;

    const col = cols.find((c) => c.name === 'extraction_confidence');
    expect(col).toBeDefined();
    expect(col!.dflt_value).toBe('1.0');
  });

  test('100 schema.no-access-count', () => {
    const { app } = createTempApp();
    const cols = app.db.prepare(`PRAGMA table_info(memory_entries)`).all() as Array<{ name: string }>;
    expect(cols.find((c) => c.name === 'access_count')).toBeUndefined();
  });

  test('101 schema.no-superseded-by', () => {
    const { app } = createTempApp();
    const cols = app.db.prepare(`PRAGMA table_info(memory_entries)`).all() as Array<{ name: string }>;
    expect(cols.find((c) => c.name === 'superseded_by')).toBeUndefined();
  });

  test('102 schema.link-confidence', () => {
    const { app } = createTempApp();
    const cols = app.db.prepare(`PRAGMA table_info(memory_links)`).all() as Array<{ name: string; dflt_value: string | null }>;
    const col = cols.find((c) => c.name === 'confidence');
    expect(col).toBeDefined();
    expect(col!.dflt_value).toBe('1.0');
  });

  test('103 schema.link-type-related', () => {
    const { app } = createTempApp();
    seedMemory(app, { id: 'm1', content: 'source entry' });
    seedMemory(app, { id: 'm2', content: 'target entry' });
    // 'related' should be accepted by the CHECK constraint
    expect(() =>
      app.db.prepare(`INSERT INTO memory_links (id, source_id, target_id, type, confidence, created_at) VALUES ('l1','m1','m2','related',0.5,?)`)
        .run(nowIso())
    ).not.toThrow();
    // Verify it was inserted
    const link = app.db.prepare(`SELECT * FROM memory_links WHERE id = 'l1'`).get() as any;
    expect(link.type).toBe('related');
    expect(link.confidence).toBe(0.5);
  });
});
