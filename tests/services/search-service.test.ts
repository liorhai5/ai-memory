import { describe, expect, test } from 'vitest';
import { createConversation, createTempApp } from '../test-helpers.js';

describe('SearchService', () => {
  test('turn matches report match_source=turn with BM25 ranking (D7, D15)', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 's1', workspace: 'ws-a' });
    app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: 'please use sqlite fts5' });
    const result = app.searchService.search({ query: 'fts5', workspace: 'ws-a' });
    expect(result.conversations.length).toBe(1);
    expect(result.conversations[0].match_source).toBe('turn');
    expect(result.conversations[0].matching_turns.length).toBeGreaterThan(0);
  });

  test('falls back to summary/title when no turn matches (D15)', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 's2', workspace: 'ws-a' });
    app.conversationStore.setTitleIfEmpty(conv.id, 'Conversation about indexing');
    app.conversationStore.upsertSummary(conv.id, 'Decided to use BM25 ranking only.');
    const result = app.searchService.search({ query: 'BM25', workspace: 'ws-a' });
    expect(result.conversations.length).toBe(1);
    expect(['summary', 'title']).toContain(result.conversations[0].match_source);
  });

  test('workspace filter restricts results (D7)', () => {
    const { app } = createTempApp();
    const c1 = createConversation(app, { external_id: 'ws-f1', workspace: 'alpha' });
    const c2 = createConversation(app, { external_id: 'ws-f2', workspace: 'beta' });
    app.conversationStore.addTurn({ conversation_id: c1.id, role: 'user', content: 'shared keyword tokio' });
    app.conversationStore.addTurn({ conversation_id: c2.id, role: 'user', content: 'shared keyword tokio' });

    const alphaOnly = app.searchService.search({ query: 'tokio', workspace: 'alpha' });
    expect(alphaOnly.conversations.length).toBe(1);
    expect(alphaOnly.conversations[0].workspace).toBe('alpha');
  });

  test('role filter restricts to user or assistant turns (D7)', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 'role-1', workspace: 'ws' });
    app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: 'user said deployment' });
    app.conversationStore.addTurn({ conversation_id: conv.id, role: 'assistant', content: 'assistant discussed caching' });

    const userOnly = app.searchService.search({ query: 'deployment', role: 'user' });
    expect(userOnly.conversations.length).toBe(1);
    const assistantOnly = app.searchService.search({ query: 'deployment', role: 'assistant' });
    expect(assistantOnly.conversations.length).toBe(0);
  });

  test('empty query returns empty results', () => {
    const { app } = createTempApp();
    createConversation(app, { external_id: 'empty-1' });
    const result = app.searchService.search({ query: '' });
    expect(result.conversations.length).toBe(0);
  });

  test('turn matches rank before summary-only matches (D7 BM25 primary)', () => {
    const { app } = createTempApp();
    const turnConv = createConversation(app, { external_id: 'rank-1', workspace: 'ws' });
    app.conversationStore.addTurn({ conversation_id: turnConv.id, role: 'user', content: 'we should use kubernetes' });
    const summaryConv = createConversation(app, { external_id: 'rank-2', workspace: 'ws' });
    app.conversationStore.upsertSummary(summaryConv.id, 'Discussed kubernetes deployment strategy');

    const result = app.searchService.search({ query: 'kubernetes' });
    expect(result.conversations.length).toBe(2);
    expect(result.conversations[0].match_source).toBe('turn');
    expect(result.conversations[1].match_source).toBe('summary');
  });

  test('date filters use updated_at not started_at', () => {
    const { app } = createTempApp();
    const old = app.conversationStore.upsertConversationByExternalId({
      external_id: 'date-old',
      workspace: 'ws',
      ide: 'cli',
      started_at: '2026-01-01T00:00:00Z'
    });
    app.conversationStore.addTurn({
      conversation_id: old.id,
      role: 'user',
      content: 'unique datefilter keyword',
      created_at: '2026-03-05T00:00:00Z'
    });

    const recent = app.conversationStore.upsertConversationByExternalId({
      external_id: 'date-recent',
      workspace: 'ws',
      ide: 'cli',
      started_at: '2026-03-01T00:00:00Z'
    });
    app.conversationStore.addTurn({
      conversation_id: recent.id,
      role: 'user',
      content: 'unique datefilter keyword',
      created_at: '2026-03-01T00:00:00Z'
    });

    const fromMarch = app.searchService.search({ query: 'datefilter', date_from: '2026-03-01' });
    expect(fromMarch.conversations.length).toBe(2);

    const fromFeb = app.searchService.search({ query: 'datefilter', date_from: '2026-02-01', date_to: '2026-03-02' });
    expect(fromFeb.conversations.length).toBe(1);
    expect(fromFeb.conversations[0].id).toBe(recent.id);
  });

  test('pagination with offset and limit', () => {
    const { app } = createTempApp();
    for (let i = 0; i < 5; i++) {
      const c = createConversation(app, { external_id: `page-${i}`, workspace: 'ws' });
      app.conversationStore.addTurn({ conversation_id: c.id, role: 'user', content: `unique paginator keyword ${i}` });
    }
    const page1 = app.searchService.search({ query: 'paginator', limit: 2, offset: 0 });
    const page2 = app.searchService.search({ query: 'paginator', limit: 2, offset: 2 });
    expect(page1.conversations.length).toBe(2);
    expect(page2.conversations.length).toBe(2);
    const ids1 = page1.conversations.map((c) => c.id);
    const ids2 = page2.conversations.map((c) => c.id);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });

  // D047: project_slug filter
  test('project_slug filter restricts results', () => {
    const { app } = createTempApp();
    const c1 = app.conversationStore.upsertConversationByExternalId({
      external_id: 'slug-1', workspace: 'ws', project_slug: 'platform', ide: 'cli'
    });
    const c2 = app.conversationStore.upsertConversationByExternalId({
      external_id: 'slug-2', workspace: 'ws', project_slug: 'other', ide: 'cli'
    });
    app.conversationStore.addTurn({ conversation_id: c1.id, role: 'user', content: 'shared slugtest keyword' });
    app.conversationStore.addTurn({ conversation_id: c2.id, role: 'user', content: 'shared slugtest keyword' });

    const result = app.searchService.search({ query: 'slugtest', project_slug: 'platform' });
    expect(result.conversations.length).toBe(1);
    expect(result.conversations[0].id).toBe(c1.id);
  });

  test('search without project_slug returns all conversations', () => {
    const { app } = createTempApp();
    const c1 = app.conversationStore.upsertConversationByExternalId({
      external_id: 'nofilter-1', workspace: 'ws', project_slug: 'a', ide: 'cli'
    });
    const c2 = app.conversationStore.upsertConversationByExternalId({
      external_id: 'nofilter-2', workspace: 'ws', project_slug: 'b', ide: 'cli'
    });
    app.conversationStore.addTurn({ conversation_id: c1.id, role: 'user', content: 'unique nofiltertest' });
    app.conversationStore.addTurn({ conversation_id: c2.id, role: 'user', content: 'unique nofiltertest' });

    const result = app.searchService.search({ query: 'nofiltertest' });
    expect(result.conversations.length).toBe(2);
  });

  test('project_slug filter works on summary/title fallback path', () => {
    const { app } = createTempApp();
    const c1 = app.conversationStore.upsertConversationByExternalId({
      external_id: 'slug-title-1', workspace: 'ws', project_slug: 'myslug', ide: 'cli'
    });
    const c2 = app.conversationStore.upsertConversationByExternalId({
      external_id: 'slug-title-2', workspace: 'ws', project_slug: 'otherslug', ide: 'cli'
    });
    app.conversationStore.upsertSummary(c1.id, 'summary about slugtitlekeyword');
    app.conversationStore.upsertSummary(c2.id, 'summary about slugtitlekeyword');

    const result = app.searchService.search({ query: 'slugtitlekeyword', project_slug: 'myslug' });
    expect(result.conversations.length).toBe(1);
    expect(result.conversations[0].id).toBe(c1.id);
  });

  describe('FTS query sanitization', () => {
    test('hyphenated query like "self-test" does not crash', () => {
      const { app } = createTempApp();
      const conv = createConversation(app, { external_id: 'fts-hyphen-1', workspace: 'ws' });
      app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: 'running a self test now' });

      expect(() => app.searchService.search({ query: 'self-test' })).not.toThrow();
      const result = app.searchService.search({ query: 'self-test' });
      expect(result.conversations.length).toBe(1);
    });

    test('hyphen treated as space — "hello-world" matches "hello world"', () => {
      const { app } = createTempApp();
      const conv = createConversation(app, { external_id: 'fts-hyphen-2', workspace: 'ws' });
      app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: 'hello world application' });

      const result = app.searchService.search({ query: 'hello-world' });
      expect(result.conversations.length).toBe(1);
      expect(result.conversations[0].id).toBe(conv.id);
    });

    test('special characters stripped — "foo!bar" matches content with foo and bar', () => {
      const { app } = createTempApp();
      const conv = createConversation(app, { external_id: 'fts-special-1', workspace: 'ws' });
      app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: 'foo bar baz' });

      expect(() => app.searchService.search({ query: 'foo!bar' })).not.toThrow();
      const result = app.searchService.search({ query: 'foo!bar' });
      expect(result.conversations.length).toBe(1);
    });
  });
});
