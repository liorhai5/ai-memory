import { describe, expect, test } from 'vitest';
import { createConversation, createTempApp } from '../test-helpers.js';

describe('ConversationStore', () => {
  test('updated_at changes only on addTurn, not setTitle/updateTitle/upsertSummary (D17)', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 'c1' });
    const before = app.conversationStore.byId(conv.id)!;

    app.conversationStore.setTitleIfEmpty(conv.id, 'title');
    expect(app.conversationStore.byId(conv.id)!.updated_at).toBe(before.updated_at);

    app.conversationStore.updateTitle(conv.id, 'new title');
    expect(app.conversationStore.byId(conv.id)!.updated_at).toBe(before.updated_at);

    app.conversationStore.upsertSummary(conv.id, 'summary text');
    expect(app.conversationStore.byId(conv.id)!.updated_at).toBe(before.updated_at);

    app.conversationStore.addTurn({
      conversation_id: conv.id,
      role: 'user',
      content: 'hello world'
    });
    const afterTurn = app.conversationStore.byId(conv.id)!;
    expect(afterTurn.updated_at >= before.updated_at).toBe(true);
    expect(afterTurn.turn_count).toBe(1);
  });

  test('deduplicates same turn content per conversation (D14)', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 'c2' });
    app.conversationStore.addTurn({
      conversation_id: conv.id,
      role: 'user',
      content: 'same content'
    });
    const dup = app.conversationStore.addTurn({
      conversation_id: conv.id,
      role: 'user',
      content: 'same content'
    });
    expect(dup).toBeNull();
    expect(app.conversationStore.listTurns(conv.id)).toHaveLength(1);
    expect(app.conversationStore.byId(conv.id)!.turn_count).toBe(1);
  });

  test('setTitleIfEmpty does not overwrite existing title (D5)', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 'c3' });
    app.conversationStore.setTitleIfEmpty(conv.id, 'first title');
    expect(app.conversationStore.byId(conv.id)!.title).toBe('first title');
    app.conversationStore.setTitleIfEmpty(conv.id, 'second title');
    expect(app.conversationStore.byId(conv.id)!.title).toBe('first title');
  });

  test('upsertSummary overwrites existing summary (D5 progressive)', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 'c4' });
    app.conversationStore.upsertSummary(conv.id, 'initial summary');
    expect(app.conversationStore.byId(conv.id)!.summary).toBe('initial summary');
    app.conversationStore.upsertSummary(conv.id, 'updated summary');
    expect(app.conversationStore.byId(conv.id)!.summary).toBe('updated summary');
  });

  test('updateTitle overwrites existing title', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 'c5' });
    app.conversationStore.setTitleIfEmpty(conv.id, 'initial title');
    app.conversationStore.updateTitle(conv.id, 'updated title');
    expect(app.conversationStore.byId(conv.id)!.title).toBe('updated title');
  });

  test('title normalization trims and caps length', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 'c6' });
    app.conversationStore.updateTitle(conv.id, `   ${'a'.repeat(100)}   `);
    expect(app.conversationStore.byId(conv.id)!.title).toBe('a'.repeat(app.config.injection_max_title_chars));
  });

  test('updateTitle rejects blank title', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 'c7' });
    expect(() => app.conversationStore.updateTitle(conv.id, '   ')).toThrow('Invalid title: must contain non-whitespace characters');
  });

  test('updateTitle throws for unknown conversation', () => {
    const { app } = createTempApp();
    expect(() => app.conversationStore.updateTitle('missing-id', 'title')).toThrow('Conversation not found: missing-id');
  });

  test('upsertConversationByExternalId reuses existing (D13 identity resume)', () => {
    const { app } = createTempApp();
    const first = app.conversationStore.upsertConversationByExternalId({
      external_id: 'resume-1',
      workspace: 'ws-a',
      ide: 'cursor'
    });
    const second = app.conversationStore.upsertConversationByExternalId({
      external_id: 'resume-1',
      workspace: 'ws-b',
      ide: 'claude-code'
    });
    expect(second.id).toBe(first.id);
    expect(second.workspace).toBe('ws-b');
    expect(second.ide).toBe('claude-code');
  });

  test('listRecentByWorkspace returns workspace-first then other (D6)', () => {
    const { app } = createTempApp();
    createConversation(app, { external_id: 'other-1', workspace: 'ws-other' });
    createConversation(app, { external_id: 'same-1', workspace: 'ws-target' });
    createConversation(app, { external_id: 'other-2', workspace: 'ws-other2' });

    const results = app.conversationStore.listRecentByWorkspace({
      workspace: 'ws-target',
      limit: 5,
      include_other: true
    });
    expect(results[0].workspace).toBe('ws-target');
    expect(results.length).toBe(3);
  });

  test('byId and byExternalId return null for missing', () => {
    const { app } = createTempApp();
    expect(app.conversationStore.byId('nonexistent')).toBeNull();
    expect(app.conversationStore.byExternalId('nonexistent')).toBeNull();
  });

  test('listConversations filters by date_from and date_to on updated_at', () => {
    const { app } = createTempApp();
    const old = app.conversationStore.upsertConversationByExternalId({
      external_id: 'lc-old',
      workspace: 'ws',
      ide: 'cli',
      started_at: '2026-01-01T00:00:00Z'
    });
    app.conversationStore.addTurn({
      conversation_id: old.id,
      role: 'user',
      content: 'old turn',
      created_at: '2026-01-02T00:00:00Z'
    });

    const recent = app.conversationStore.upsertConversationByExternalId({
      external_id: 'lc-recent',
      workspace: 'ws',
      ide: 'cli',
      started_at: '2026-03-01T00:00:00Z'
    });
    app.conversationStore.addTurn({
      conversation_id: recent.id,
      role: 'user',
      content: 'recent turn',
      created_at: '2026-03-05T00:00:00Z'
    });

    const all = app.conversationStore.listConversations({});
    expect(all.length).toBe(2);

    const marchOnly = app.conversationStore.listConversations({ date_from: '2026-03-01' });
    expect(marchOnly.length).toBe(1);
    expect(marchOnly[0].id).toBe(recent.id);

    const janOnly = app.conversationStore.listConversations({ date_to: '2026-02-01' });
    expect(janOnly.length).toBe(1);
    expect(janOnly[0].id).toBe(old.id);

    const range = app.conversationStore.listConversations({ date_from: '2026-01-01', date_to: '2026-01-10' });
    expect(range.length).toBe(1);
    expect(range[0].id).toBe(old.id);
  });

  test('pruneEmptyConversations deletes only stale empties', () => {
    const { app } = createTempApp();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const stale = app.conversationStore.upsertConversationByExternalId({
      external_id: 'prune-stale',
      workspace: 'ws',
      ide: 'claude-code',
      started_at: twoHoursAgo
    });
    const fresh = app.conversationStore.upsertConversationByExternalId({
      external_id: 'prune-fresh',
      workspace: 'ws',
      ide: 'claude-code',
      started_at: thirtyMinAgo
    });

    const pruned = app.conversationStore.pruneEmptyConversations();
    expect(pruned).toBe(1);
    expect(app.conversationStore.byId(stale.id)).toBeNull();
    expect(app.conversationStore.byId(fresh.id)).not.toBeNull();
  });

  test('pruneEmptyConversations keeps titled empty conversations', () => {
    const { app } = createTempApp();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const titled = app.conversationStore.upsertConversationByExternalId({
      external_id: 'prune-titled',
      workspace: 'ws',
      ide: 'claude-code',
      started_at: twoHoursAgo
    });
    app.conversationStore.updateTitle(titled.id, 'manually titled');

    const pruned = app.conversationStore.pruneEmptyConversations();
    expect(pruned).toBe(0);
    expect(app.conversationStore.byId(titled.id)).not.toBeNull();
  });

  test('pruneEmptyConversations keeps conversations with turns', () => {
    const { app } = createTempApp();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const withTurns = app.conversationStore.upsertConversationByExternalId({
      external_id: 'prune-has-turns',
      workspace: 'ws',
      ide: 'claude-code',
      started_at: twoHoursAgo
    });
    app.conversationStore.addTurn({
      conversation_id: withTurns.id,
      role: 'user',
      content: 'hello',
      created_at: twoHoursAgo
    });

    const pruned = app.conversationStore.pruneEmptyConversations();
    expect(pruned).toBe(0);
    expect(app.conversationStore.byId(withTurns.id)).not.toBeNull();
  });

  test('addTurn increments turn_number sequentially', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 'seq-1' });
    app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: 'msg 1' });
    app.conversationStore.addTurn({ conversation_id: conv.id, role: 'assistant', content: 'msg 2' });
    app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: 'msg 3' });
    const turns = app.conversationStore.listTurns(conv.id);
    expect(turns.map((t) => t.turn_number)).toEqual([1, 2, 3]);
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user']);
  });
});
