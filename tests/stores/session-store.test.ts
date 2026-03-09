import { describe, expect, test } from 'vitest';
import { createTempApp } from '../test-helpers.js';
import { nowIso } from '../../src/utils/time.js';

describe('SessionStore', () => {
  test('13 session-store.lifecycle', () => {
    const { app } = createTempApp();
    app.sessionStore.create({ id: 's1', workspace: 'w1', ide: 'cli', status: 'active', turn_count: 0, last_extraction_turn: 0, started_at: nowIso(), ended_at: null });
    app.sessionStore.incrementTurn('s1');
    expect(app.sessionStore.byId('s1')?.turn_count).toBe(1);
    expect(app.sessionStore.setStatus('s1', 'completed')).toBe(true);
    expect(app.sessionStore.byId('s1')?.ended_at).toBeTruthy();
    expect(app.sessionStore.setStatus('s1', 'active')).toBe(false);
  });
});
