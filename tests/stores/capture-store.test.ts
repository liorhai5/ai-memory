import { describe, expect, test } from 'vitest';
import { createTempApp, ensureSession } from '../test-helpers.js';
import { nowIso } from '../../src/utils/time.js';
import { hashContent } from '../../src/utils/hash.js';

describe('CaptureStore', () => {
  test('6 capture-store.insert-and-retrieve', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    const e = {
      id: 'e1',
      session_id: 's1',
      workspace: 'w1' as string | null,
      content: 'hello',
      content_hash: hashContent('hello'),
      source: 'hook' as string | null,
      created_at: nowIso(),
      extraction_status: 'pending' as const
    };
    expect(app.captureStore.insert(e)).toBe(true);
    expect(app.captureStore.byId('e1')?.session_id).toBe('s1');
  });

  test('7 capture-store.dedup-by-hash', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    const e = {
      id: 'e1',
      session_id: 's1',
      workspace: 'w1' as string | null,
      content: 'hello',
      content_hash: hashContent('hello'),
      source: 'hook' as string | null,
      created_at: nowIso(),
      extraction_status: 'pending' as const
    };
    expect(app.captureStore.insert(e)).toBe(true);
    expect(app.captureStore.insert({ ...e, id: 'e2' })).toBe(false);
  });

  test('8 capture-store.grouped-by-session', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    ensureSession(app, 's2');
    app.captureStore.insert({ id: 'a', session_id: 's1', workspace: 'w1', content: 'a', content_hash: hashContent('a'), source: 'hook', created_at: nowIso(), extraction_status: 'pending' });
    app.captureStore.insert({ id: 'b', session_id: 's2', workspace: 'w1', content: 'b', content_hash: hashContent('b'), source: 'hook', created_at: nowIso(), extraction_status: 'pending' });
    expect(app.captureStore.bySession('s1')).toHaveLength(1);
  });

  test('9 capture-store.extraction-status', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    app.captureStore.insert({ id: 'e1', session_id: 's1', workspace: 'w1', content: 'x', content_hash: 'h1', source: 'hook', created_at: nowIso(), extraction_status: 'pending' });
    app.captureStore.updateExtractionStatus('e1', 'failed');
    expect(app.captureStore.byId('e1')?.extraction_status).toBe('failed');
  });

  test('26 capture-store.queryable-events', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    app.captureStore.insert({ id: 'e1', session_id: 's1', workspace: 'w1', content: 'x', content_hash: 'h1', source: 'hook', created_at: nowIso(), extraction_status: 'pending' });
    const events = app.captureStore.query('s1', undefined, undefined, 10);
    expect(events).toHaveLength(1);
  });

  test('104 capture-store.fts-synced', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    app.captureStore.insert({
      id: 'e1',
      session_id: 's1',
      workspace: 'w1',
      content: 'searchable captured event content',
      content_hash: hashContent('searchable captured event content'),
      source: 'hook',
      created_at: nowIso(),
      extraction_status: 'pending'
    });
    // Verify FTS is populated
    const ftsRows = app.db.prepare(`SELECT * FROM captured_events_fts WHERE captured_events_fts MATCH 'searchable'`).all();
    expect(ftsRows.length).toBe(1);
  });

  test('105 capture-store.search-fts', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    app.captureStore.insert({
      id: 'e1',
      session_id: 's1',
      workspace: 'w1',
      content: 'unique keyword alpha bravo charlie',
      content_hash: hashContent('unique keyword alpha bravo charlie'),
      source: 'hook',
      created_at: nowIso(),
      extraction_status: 'pending'
    });
    app.captureStore.insert({
      id: 'e2',
      session_id: 's1',
      workspace: 'w1',
      content: 'different topic delta echo foxtrot',
      content_hash: hashContent('different topic delta echo foxtrot'),
      source: 'hook',
      created_at: nowIso(),
      extraction_status: 'pending'
    });
    const results = app.captureStore.searchFts('alpha', 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('e1');
    expect(results[0]).toHaveProperty('bm25_score');
  });
});
