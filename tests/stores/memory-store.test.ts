import { describe, expect, test } from 'vitest';
import { createTempApp, seedMemory } from '../test-helpers.js';

describe('MemoryStore', () => {
  test('10 memory-store.insert-and-retrieve', () => {
    const { app } = createTempApp();
    seedMemory(app, { id: 'm1', content: 'searchable memory' });
    expect(app.memoryStore.byId('m1')?.content).toContain('searchable');
  });

  test('11 memory-store.state-transitions', () => {
    const { app } = createTempApp();
    seedMemory(app, { id: 'm1', content: 'stateful memory' });
    expect(app.memoryStore.updateState('m1', 'superseded')).toBe(true);
    expect(app.memoryStore.updateState('m1', 'active')).toBe(false);
    expect(app.memoryStore.updateState('m1', 'archived')).toBe(true);
  });

  test('14 memory-store.fts5-index-synced', () => {
    const { app } = createTempApp();
    seedMemory(app, { id: 'm1', content: 'fts searchable text' });
    expect(app.memoryStore.searchFts('searchable', 5).length).toBeGreaterThan(0);
    app.memoryStore.delete('m1');
    expect(app.memoryStore.searchFts('searchable', 5)).toHaveLength(0);
  });
});
