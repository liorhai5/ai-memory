import { describe, expect, test } from 'vitest';
import { createConversation, createTempApp } from '../test-helpers.js';
import benchmarkFixtures from '../fixtures/search-benchmark.json';

interface BenchmarkEntry {
  query: string;
  description: string;
  setup_content: string;
  expect_match: boolean;
}

describe('Search benchmark (D043)', () => {
  const fixtures = benchmarkFixtures as BenchmarkEntry[];

  for (const fixture of fixtures) {
    test(fixture.description, () => {
      const { app } = createTempApp();
      const conv = createConversation(app, { external_id: `bench-${fixture.query}`, workspace: 'ws' });
      app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: fixture.setup_content });

      const result = app.searchService.search({ query: fixture.query });

      if (fixture.expect_match) {
        expect(result.conversations.length).toBeGreaterThan(0);
      } else {
        expect(result.conversations.length).toBe(0);
      }
    });
  }

  test('benchmark empty rate < 15%', () => {
    const { app } = createTempApp();
    const matchFixtures = fixtures.filter(f => f.expect_match);

    for (const fixture of matchFixtures) {
      const conv = createConversation(app, { external_id: `rate-${fixture.query}`, workspace: 'ws' });
      app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: fixture.setup_content });
    }

    let emptyCount = 0;
    for (const fixture of matchFixtures) {
      const result = app.searchService.search({ query: fixture.query });
      if (result.conversations.length === 0) emptyCount++;
    }

    const emptyRate = emptyCount / matchFixtures.length;
    expect(emptyRate).toBeLessThan(0.15);
  });
});
