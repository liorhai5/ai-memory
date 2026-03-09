import { describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { sessionEndHook, sessionStartHook, stopHook, beforeSubmitPromptHook } from '../../src/hooks/handlers.js';
import { createTempApp, ensureSession } from '../test-helpers.js';
import { nowIso } from '../../src/utils/time.js';
import { hashContent } from '../../src/utils/hash.js';

function makeDbPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return join(dir, 'm.db');
}

describe('Hooks — Session Start', () => {
  test('60 hook.session-start-injects', () => {
    const dbPath = makeDbPath('ai-memory-hook-60-');
    const out = sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    expect(out.additional_context).toContain('p1:injected:begin');
  });

  test('61 hook.session-start-markers', () => {
    const dbPath = makeDbPath('ai-memory-hook-61-');
    const out = sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    expect(out.additional_context).toContain('p1:injected:begin');
    expect(out.additional_context).toContain('p1:injected:end');
  });

  test('62 hook.session-start-includes-tools', () => {
    const dbPath = makeDbPath('ai-memory-hook-62-');
    const out = sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    expect(out.additional_context).toContain('ai-memory-query / ai-memory-capture');
  });

  test('63 hook.session-start-creates-session', () => {
    const dbPath = makeDbPath('ai-memory-hook-63-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    const app = createApp(dbPath);
    const session = app.sessionStore.byId('s1');
    expect(session?.status).toBe('active');
    expect(session?.ide).toBe('cursor');
  });

  test('64 hook.session-start-cursor-format', () => {
    const dbPath = makeDbPath('ai-memory-hook-64-');
    const out = sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    expect(out).toHaveProperty('additional_context');
  });

  test('65 hook.session-start-claude-format', () => {
    const dbPath = makeDbPath('ai-memory-hook-65-');
    const out = sessionStartHook({ ide: 'claude-code', workspace: 'w1', session_id: 's1', dbPath });
    expect(out).toHaveProperty('additional_context');
  });
});

describe('Hooks — Stop', () => {
  test('66 hook.stop-captures-turn', () => {
    const dbPath = makeDbPath('ai-memory-hook-66-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn one', extraction_interval: 10, dbPath });
    const app = createApp(dbPath);
    expect(app.captureStore.bySession('s1').length).toBe(1);
  });

  test('67 hook.stop-increments-turn', () => {
    const dbPath = makeDbPath('ai-memory-hook-67-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn one', extraction_interval: 10, dbPath });
    const app = createApp(dbPath);
    expect(app.sessionStore.byId('s1')?.turn_count).toBe(1);
  });

  test('68 hook.stop-dedup', () => {
    const dbPath = makeDbPath('ai-memory-hook-68-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'same turn', extraction_interval: 10, dbPath });
    stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'same turn', extraction_interval: 10, dbPath });
    const app = createApp(dbPath);
    expect(app.captureStore.bySession('s1').length).toBe(1);
  });

  test('69 hook.stop-silent-under-threshold', () => {
    const dbPath = makeDbPath('ai-memory-hook-69-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    const out = stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn one', extraction_interval: 10, dbPath });
    expect(out).toEqual({});
  });

  test('70 hook.stop-reads-stdin', () => {
    // D30: stop hook reads {status, loop_count} from stdin JSON and processes without error
    const dbPath = makeDbPath('ai-memory-hook-70-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    const out = stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn one', extraction_interval: 10, dbPath, stdin: { status: 'ok', loop_count: 2 } });
    // stdin is accepted and doesn't cause errors — capture still works
    expect(out).toEqual({});
    const app = createApp(dbPath);
    expect(app.captureStore.bySession('s1').length).toBe(1);
  });

  test('71 hook.stop-triggers-at-threshold', () => {
    const dbPath = makeDbPath('ai-memory-hook-71-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn one', extraction_interval: 2, dbPath });
    const out = stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn two', extraction_interval: 2, dbPath });
    expect((out as any).followup_message).toBeTruthy();
  });

  test('72 hook.stop-extraction-prompt-content', () => {
    const dbPath = makeDbPath('ai-memory-hook-72-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn one', extraction_interval: 2, dbPath });
    const out = stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn two', extraction_interval: 2, dbPath });
    expect((out as any).followup_message).toContain('ai-memory-capture');
  });

  test('73 hook.stop-resets-count', () => {
    const dbPath = makeDbPath('ai-memory-hook-73-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn one', extraction_interval: 2, dbPath });
    stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn two', extraction_interval: 2, dbPath });
    const app = createApp(dbPath);
    expect((app.sessionStore.byId('s1')?.last_extraction_turn ?? 0) >= 2).toBe(true);
  });

  test('74 hook.stop-cursor-followup', () => {
    const dbPath = makeDbPath('ai-memory-hook-74-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn one', extraction_interval: 2, dbPath });
    const out = stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn two', extraction_interval: 2, dbPath });
    expect(out).toHaveProperty('followup_message');
  });

  test('75 hook.stop-claude-agent-type', () => {
    const dbPath = makeDbPath('ai-memory-hook-75-');
    sessionStartHook({ ide: 'claude-code', workspace: 'w1', session_id: 's1', dbPath });
    const out = stopHook({ ide: 'claude-code', session_id: 's1', workspace: 'w1', content: 'turn one', extraction_interval: 1, dbPath });
    expect((out as any).type).toBe('agent');
  });

  test('76 hook.stop-configurable-interval', () => {
    const dbPath = makeDbPath('ai-memory-hook-76-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    const out = stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn one', extraction_interval: 1, dbPath });
    expect((out as any).followup_message).toBeTruthy();
  });
});

describe('Hooks — Session End', () => {
  test('77 hook.session-end-stores-transcript', () => {
    const dbPath = makeDbPath('ai-memory-hook-77-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    sessionEndHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'final transcript', dbPath });
    const app = createApp(dbPath);
    expect(app.captureStore.bySession('s1').length).toBeGreaterThan(0);
  });

  test('78 hook.session-end-marks-complete', () => {
    const dbPath = makeDbPath('ai-memory-hook-78-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    sessionEndHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'done', dbPath });
    const app = createApp(dbPath);
    const session = app.sessionStore.byId('s1');
    expect(session?.status).toBe('completed');
    expect(session?.ended_at).toBeTruthy();
  });

  test('79 hook.session-end-runs-maintenance', () => {
    const dbPath = makeDbPath('ai-memory-hook-79-');
    const app = createApp(dbPath);
    ensureSession(app, 's1', 'w1');
    app.memoryStore.insert({ id: 'm1', type: 'decision', content: 'old', content_hash: 'h-old', workspace: 'w1', session_id: 's1', score: 0.9, repetition_count: 1, source: 'test', source_event_id: null, extraction_confidence: 1.0, created_at: new Date().toISOString(), last_accessed_at: new Date(Date.now() - 40 * 86400000).toISOString(), state: 'active', embedding: null });
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1-new', dbPath });
    sessionEndHook({ ide: 'cursor', session_id: 's1-new', workspace: 'w1', content: 'done', dbPath });
    const after = createApp(dbPath);
    expect((after.memoryStore.byId('m1')?.score ?? 0) < 0.9).toBe(true);
  });

  test('80 hook.session-end-workspace-scoped', () => {
    const dbPath = makeDbPath('ai-memory-hook-80-');
    const app = createApp(dbPath);
    ensureSession(app, 'seed-s1', 'w1');
    ensureSession(app, 'seed-s2', 'w2');
    app.memoryStore.insert({ id: 'w1', type: 'decision', content: 'w1', content_hash: 'h-w1', workspace: 'w1', session_id: 'seed-s1', score: 0.9, repetition_count: 1, source: 'test', source_event_id: null, extraction_confidence: 1.0, created_at: new Date().toISOString(), last_accessed_at: new Date(Date.now() - 40 * 86400000).toISOString(), state: 'active', embedding: null });
    app.memoryStore.insert({ id: 'w2', type: 'decision', content: 'w2', content_hash: 'h-w2', workspace: 'w2', session_id: 'seed-s2', score: 0.9, repetition_count: 1, source: 'test', source_event_id: null, extraction_confidence: 1.0, created_at: new Date().toISOString(), last_accessed_at: new Date(Date.now() - 40 * 86400000).toISOString(), state: 'active', embedding: null });
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    sessionEndHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'done', dbPath });
    const after = createApp(dbPath);
    expect((after.memoryStore.byId('w1')?.score ?? 0) < 0.9).toBe(true);
    expect(after.memoryStore.byId('w2')?.score).toBe(0.9);
  });

  test('81 hook.session-end-preserves-pending', () => {
    const dbPath = makeDbPath('ai-memory-hook-81-');
    const app = createApp(dbPath);
    ensureSession(app, 's1', 'w1');
    app.captureStore.insert({ id: 'ce1', session_id: 's1', workspace: 'w1', content: 'pending', content_hash: 'cp', source: 'hook', created_at: new Date().toISOString(), extraction_status: 'pending' });
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's2', dbPath });
    sessionEndHook({ ide: 'cursor', session_id: 's2', workspace: 'w1', content: 'done', dbPath });
    const after = createApp(dbPath);
    expect(after.captureStore.byId('ce1')?.extraction_status).toBe('pending');
  });

  test('82 hook.session-end-fire-and-forget', () => {
    const out = sessionEndHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'done', dbPath: '/root/forbidden/m.db' });
    expect(out.ok).toBe(false);
  });

  test('97 hook.fail-open', () => {
    const out = sessionEndHook({ ide: 'cursor', session_id: 'x', workspace: 'w1', content: 'end', dbPath: '/root/forbidden/m.db' });
    expect(out.ok).toBe(false);
  });

  test('147b lifecycle.session-end-runs-maintenance-and-tune-check', () => {
    const { app, dbPath } = createTempApp();
    const sid = 's-end';
    ensureSession(app, sid, 'w1');

    const out = sessionEndHook({
      ide: 'cursor',
      session_id: sid,
      workspace: 'w1',
      content: 'session final transcript',
      dbPath
    }) as any;

    expect(out.ok).toBe(true);
    expect(out.maintenance).toBeDefined();
    expect(typeof out.tune_suggested).toBe('boolean');
  });
});

describe('Hooks — Fallback & Recovery', () => {
  test('93 fallback.crash-recovery', () => {
    const dbPath = makeDbPath('ai-memory-hook-93-');
    const app = createApp(dbPath);
    ensureSession(app, 'old', 'w1');
    app.captureStore.insert({ id: 'ce1', session_id: 'old', workspace: 'w1', content: 'pending old', content_hash: 'h-old', source: 'hook', created_at: new Date().toISOString(), extraction_status: 'pending' });
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 'new', dbPath });
    stopHook({ ide: 'cursor', session_id: 'new', workspace: 'w1', content: 'new turn', extraction_interval: 10, dbPath });
    const after = createApp(dbPath);
    expect(after.captureStore.countPending()).toBeGreaterThanOrEqual(1);
  });

  test('94 fallback.short-session', () => {
    const dbPath = makeDbPath('ai-memory-hook-94-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'one', extraction_interval: 10, dbPath });
    const app = createApp(dbPath);
    expect(app.captureStore.bySession('s1').every((e) => e.extraction_status === 'pending')).toBe(true);
  });

  test('95 fallback.manual-extract', () => {
    const manual = beforeSubmitPromptHook({ prompt: '/memory extract' });
    const dbPath = makeDbPath('ai-memory-hook-95-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'one', extraction_interval: 1, dbPath });
    const auto = stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'two', extraction_interval: 1, dbPath }) as any;
    expect((manual as any).user_message).toContain('Extract key memories');
    expect(auto.followup_message).toContain('Extract key memories');
  });
});

describe('Hooks — L1 Lifecycle (Stop Classification)', () => {
  test('138 lifecycle.stop-classifies', () => {
    // R6: stopHook with classifiable message → memory_entry created with correct type + confidence
    const { app, dbPath } = createTempApp();
    const sid = 's-classify';
    ensureSession(app, sid, 'w1');

    // "no, use PostgreSQL instead" matches C1 (^no) → type=correction
    stopHook({
      ide: 'cursor',
      session_id: sid,
      workspace: 'w1',
      content: 'no, use PostgreSQL instead of MySQL for this project',
      dbPath
    });

    // Should have created a memory_entry of type=correction
    const memories = app.memoryStore.list(10);
    expect(memories.length).toBe(1);
    expect(memories[0].type).toBe('correction');
    expect(memories[0].extraction_confidence).toBeGreaterThan(0);
    expect(memories[0].extraction_confidence).toBeLessThanOrEqual(1);
  });

  test('139 lifecycle.stop-unclassified', () => {
    // R6: stopHook with non-classifiable message → stays in captured_events only, no memory_entry
    const { app, dbPath } = createTempApp();
    const sid = 's-unclass';
    ensureSession(app, sid, 'w1');

    stopHook({
      ide: 'cursor',
      session_id: sid,
      workspace: 'w1',
      content: 'please refactor the utils module to use async functions',
      dbPath
    });

    // Should NOT create a memory_entry (no classifier pattern matches)
    const memories = app.memoryStore.list(10);
    expect(memories.length).toBe(0);

    // But captured_event should exist
    const events = app.captureStore.query(sid, undefined, undefined, 10);
    expect(events.length).toBe(1);
    expect(events[0].content).toContain('refactor the utils module');
  });

  test('140 lifecycle.stop-l2-still-works', () => {
    // R6: At extraction interval → followup_message still emitted (L2 trigger unchanged)
    const { app, dbPath } = createTempApp();
    const sid = 's-l2';
    ensureSession(app, sid, 'w1');

    // Use extraction_interval: 1 so it triggers on first turn
    const result = stopHook({
      ide: 'cursor',
      session_id: sid,
      workspace: 'w1',
      content: 'please refactor the utils module',
      extraction_interval: 1,
      dbPath
    });

    expect(result).toHaveProperty('followup_message');
    expect((result as any).followup_message).toContain('Extract key memories');
  });

  test('141 lifecycle.stop-l1-then-l2', () => {
    // R6: L1 classifies on every turn AND L2 triggers at interval — both fire
    const { app, dbPath } = createTempApp();
    const sid = 's-both';
    ensureSession(app, sid, 'w1');

    // "no, revert that change" is classifiable (C1: ^no) AND we set interval=1 for L2
    const result = stopHook({
      ide: 'cursor',
      session_id: sid,
      workspace: 'w1',
      content: 'no, revert that change immediately',
      extraction_interval: 1,
      dbPath
    });

    // L1: memory_entry should be created
    const memories = app.memoryStore.list(10);
    expect(memories.length).toBe(1);
    expect(memories[0].type).toBe('correction');

    // L2: followup_message should be emitted
    expect(result).toHaveProperty('followup_message');
    expect((result as any).followup_message).toContain('Extract key memories');
  });

  test('168 lifecycle.extraction-interval-zero-disables-L2', () => {
    // extraction_interval = 0 should disable L2 entirely — no followup_message
    const dbPath = makeDbPath('ai-memory-hook-168-');
    sessionStartHook({ ide: 'cursor', workspace: 'w1', session_id: 's1', dbPath });
    // With interval=1, first turn would normally trigger L2
    const out = stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn one', extraction_interval: 0, dbPath });
    expect(out).toEqual({});

    // Second turn — still no L2
    const out2 = stopHook({ ide: 'cursor', session_id: 's1', workspace: 'w1', content: 'turn two', extraction_interval: 0, dbPath });
    expect(out2).toEqual({});
  });
});
