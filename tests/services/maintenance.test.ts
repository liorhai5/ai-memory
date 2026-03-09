import { describe, expect, test } from 'vitest';
import { createTempApp, ensureSession, seedMemory } from '../test-helpers.js';
import { nowIso } from '../../src/utils/time.js';
import { hashContent } from '../../src/utils/hash.js';
import { newId } from '../../src/utils/id.js';

describe('MaintenanceService', () => {
  test('32 maintenance.score-decay', () => {
    const { app } = createTempApp();
    seedMemory(app, { id: 'm1', content: 'old entry for decay', workspace: 'w1', score: 0.9 });
    app.db.prepare(`UPDATE memory_entries SET last_accessed_at = ? WHERE id = 'm1'`).run(new Date(Date.now() - 40 * 86400000).toISOString());
    const res = app.maintenanceService.run('w1');
    expect(res.decayed).toBeGreaterThanOrEqual(1);
  });

  test('33 maintenance.content-dedup', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    app.memoryStore.insert({ id: 'm1', type: 'decision', content: 'dup1', content_hash: 'dup-hash', workspace: 'w1', session_id: 's1', score: 0.9, repetition_count: 1, source: 'test', source_event_id: null, extraction_confidence: 1.0, created_at: nowIso(), last_accessed_at: null, state: 'active', embedding: null });
    app.memoryStore.insert({ id: 'm2', type: 'decision', content: 'dup2', content_hash: 'dup-hash', workspace: 'w1', session_id: 's1', score: 0.9, repetition_count: 1, source: 'test', source_event_id: null, extraction_confidence: 1.0, created_at: nowIso(), last_accessed_at: null, state: 'active', embedding: null });
    const res = app.maintenanceService.run('w1');
    expect(res.deduped).toBeGreaterThanOrEqual(1);
  });

  test('34 maintenance.orphan-links', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    app.memoryStore.insert({ id: 'm1', type: 'decision', content: 'a', content_hash: 'h1', workspace: 'w1', session_id: 's1', score: 0.9, repetition_count: 1, source: 'test', source_event_id: null, extraction_confidence: 1.0, created_at: nowIso(), last_accessed_at: null, state: 'active', embedding: null });
    app.db.exec('PRAGMA foreign_keys = OFF');
    app.db.prepare(`INSERT INTO memory_links (id, source_id, target_id, type, confidence, created_at) VALUES ('l1','m1','missing','supports',1.0,?)`).run(nowIso());
    app.db.exec('PRAGMA foreign_keys = ON');
    const res = app.maintenanceService.run('w1');
    expect(res.linksCleaned).toBeGreaterThanOrEqual(1);
  });

  test('35 maintenance.skips-pending', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    app.captureStore.insert({ id: 'ce1', session_id: 's1', workspace: 'w1', content: 'pending', content_hash: 'cp', source: 'hook', created_at: nowIso(), extraction_status: 'pending' });
    app.maintenanceService.run('w1');
    expect(app.captureStore.byId('ce1')?.extraction_status).toBe('pending');
  });

  test('36 maintenance.workspace-scoped', () => {
    const { app } = createTempApp();
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    seedMemory(app, { id: 'w1-old', content: 'w1 old entry for scoping', workspace: 'w1', score: 0.9 });
    app.db.prepare(`UPDATE memory_entries SET last_accessed_at = ? WHERE id = 'w1-old'`).run(old);
    seedMemory(app, { id: 'w2-old', content: 'w2 old entry for scoping', workspace: 'w2', score: 0.9 });
    app.db.prepare(`UPDATE memory_entries SET last_accessed_at = ? WHERE id = 'w2-old'`).run(old);
    app.maintenanceService.run('w1');
    const w1 = app.memoryStore.byId('w1-old');
    const w2 = app.memoryStore.byId('w2-old');
    expect((w1?.score ?? 0) < 0.9).toBe(true);
    expect(w2?.score).toBe(0.9);
  });
});

describe('MaintenanceService — Policy Gates', () => {
  test('142 gate.promotion-3-sessions', () => {
    // R11: Captured event appearing in 3+ sessions → auto-promoted to memory_entries as type=pattern
    const { app } = createTempApp();
    const content = 'always run tests before committing changes';
    const hash = hashContent(content);

    // Create captured events with same content_hash in 3 different sessions
    for (let i = 1; i <= 3; i++) {
      const sid = `s-promo-${i}`;
      ensureSession(app, sid, 'w1');
      app.captureStore.insert({
        id: newId(),
        session_id: sid,
        workspace: 'w1',
        content,
        content_hash: hash,
        source: 'hook',
        created_at: nowIso(),
        extraction_status: 'pending'
      });
    }

    const promoted = app.maintenanceService.runPromotionGate('w1');

    expect(promoted).toBe(1);
    const memories = app.memoryStore.list(10);
    expect(memories.length).toBe(1);
    expect(memories[0].type).toBe('pattern');
    expect(memories[0].content).toBe(content);
  });

  test('143 gate.promotion-2-sessions', () => {
    // R11: Captured event in only 2 sessions → NOT promoted
    const { app } = createTempApp();
    const content = 'event only in two sessions not enough';
    const hash = hashContent(content);

    for (let i = 1; i <= 2; i++) {
      const sid = `s-no-promo-${i}`;
      ensureSession(app, sid, 'w1');
      app.captureStore.insert({
        id: newId(),
        session_id: sid,
        workspace: 'w1',
        content,
        content_hash: hash,
        source: 'hook',
        created_at: nowIso(),
        extraction_status: 'pending'
      });
    }

    const promoted = app.maintenanceService.runPromotionGate('w1');

    expect(promoted).toBe(0);
    const memories = app.memoryStore.list(10);
    expect(memories.length).toBe(0);
  });

  test('144 gate.promotion-confidence', () => {
    // R11: Auto-promoted entry has extraction_confidence = 1.0
    const { app } = createTempApp();
    const content = 'promoted entry confidence check default value';
    const hash = hashContent(content);

    for (let i = 1; i <= 3; i++) {
      const sid = `s-conf-${i}`;
      ensureSession(app, sid, 'w1');
      app.captureStore.insert({
        id: newId(),
        session_id: sid,
        workspace: 'w1',
        content,
        content_hash: hash,
        source: 'hook',
        created_at: nowIso(),
        extraction_status: 'pending'
      });
    }

    app.maintenanceService.runPromotionGate('w1');

    const memories = app.memoryStore.list(10);
    expect(memories.length).toBe(1);
    expect(memories[0].extraction_confidence).toBe(1.0);
  });

  test('145 gate.staleness-archived', () => {
    // R11: Entry 30+ days old + score < 0.3 → state = 'archived'
    const { app } = createTempApp();
    const oldDate = new Date(Date.now() - 35 * 86400000).toISOString();

    ensureSession(app, 's-stale', 'w1');
    app.memoryStore.insert({
      id: 'stale-entry',
      type: 'fact',
      content: 'old low score entry should be archived',
      content_hash: hashContent('old low score entry should be archived'),
      workspace: 'w1',
      session_id: 's-stale',
      score: 0.2,
      repetition_count: 1,
      source: 'hook',
      source_event_id: null,
      extraction_confidence: 1.0,
      created_at: oldDate,
      last_accessed_at: oldDate,
      state: 'active',
      embedding: null
    });

    const archived = app.maintenanceService.runStalenessGate('w1');

    expect(archived).toBe(1);
    const entry = app.memoryStore.byId('stale-entry');
    expect(entry!.state).toBe('archived');
  });

  test('146 gate.staleness-high-score', () => {
    // R11: Entry 30+ days old but score ≥ 0.3 → NOT archived
    const { app } = createTempApp();
    const oldDate = new Date(Date.now() - 35 * 86400000).toISOString();

    ensureSession(app, 's-high', 'w1');
    app.memoryStore.insert({
      id: 'high-score-old',
      type: 'decision',
      content: 'old high score decision entry stays active',
      content_hash: hashContent('old high score decision entry stays active'),
      workspace: 'w1',
      session_id: 's-high',
      score: 0.7,
      repetition_count: 3,
      source: 'hook',
      source_event_id: null,
      extraction_confidence: 1.0,
      created_at: oldDate,
      last_accessed_at: oldDate,
      state: 'active',
      embedding: null
    });

    const archived = app.maintenanceService.runStalenessGate('w1');

    expect(archived).toBe(0);
    const entry = app.memoryStore.byId('high-score-old');
    expect(entry!.state).toBe('active');
  });

  test('169 gate.tune-threshold-zero-disables', () => {
    // threshold = 0 should disable auto-tune regardless of corpus size
    const { app } = createTempApp();
    // Even with events, threshold=0 → never trigger
    for (let i = 0; i < 10; i++) {
      ensureSession(app, `s-dis-${i}`, 'w1');
      app.captureStore.insert({
        id: newId(),
        session_id: `s-dis-${i}`,
        workspace: 'w1',
        content: `disable tune test ${i}`,
        content_hash: hashContent(`disable tune test ${i}`),
        source: 'hook',
        created_at: nowIso(),
        extraction_status: 'pending'
      });
    }
    expect(app.maintenanceService.shouldTriggerTune(0, 0)).toBe(false);
  });

  test('170 gate.tune-threshold-custom', () => {
    // Custom threshold = 5 should trigger when delta >= 5
    const { app } = createTempApp();
    for (let i = 0; i < 5; i++) {
      ensureSession(app, `s-cust-${i}`, 'w1');
      app.captureStore.insert({
        id: newId(),
        session_id: `s-cust-${i}`,
        workspace: 'w1',
        content: `custom threshold test ${i}`,
        content_hash: hashContent(`custom threshold test ${i}`),
        source: 'hook',
        created_at: nowIso(),
        extraction_status: 'pending'
      });
    }
    expect(app.maintenanceService.shouldTriggerTune(0, 5)).toBe(true);
    expect(app.maintenanceService.shouldTriggerTune(0, 6)).toBe(false);
  });

  test('147 gate.staleness-recent', () => {
    // R11: Recent entry with score < 0.3 → NOT archived (not old enough)
    const { app } = createTempApp();

    ensureSession(app, 's-recent', 'w1');
    app.memoryStore.insert({
      id: 'recent-low',
      type: 'fact',
      content: 'recent low score entry stays active because fresh',
      content_hash: hashContent('recent low score entry stays active because fresh'),
      workspace: 'w1',
      session_id: 's-recent',
      score: 0.1,
      repetition_count: 1,
      source: 'hook',
      source_event_id: null,
      extraction_confidence: 1.0,
      created_at: nowIso(),
      last_accessed_at: nowIso(),
      state: 'active',
      embedding: null
    });

    const archived = app.maintenanceService.runStalenessGate('w1');

    expect(archived).toBe(0);
    const entry = app.memoryStore.byId('recent-low');
    expect(entry!.state).toBe('active');
  });
});
