import { describe, expect, test } from 'vitest';
import { classifyError, createToolHandlers, listTools } from '../../src/mcp/server.js';
import { createApp } from '../../src/app.js';
import { createTempApp } from '../test-helpers.js';

function getUsageRows(dbPath: string) {
  const app = createApp(dbPath);
  const rows = app.db.prepare('SELECT * FROM tool_usage ORDER BY id').all() as any[];
  app.db.close();
  return rows;
}

describe('MCP tools (D8)', () => {
  test('exposes exactly 5 approved tools', () => {
    const tools = listTools().sort();
    expect(tools).toEqual([
      'ai-memory-conversation',
      'ai-memory-conversations',
      'ai-memory-search',
      'ai-memory-status',
      'ai-memory-summarize'
    ]);
    expect(tools).toHaveLength(5);
  });

  test('ai-memory-conversations lists conversations', async () => {
    const { dbPath, app } = createTempApp();
    app.conversationStore.upsertConversationByExternalId({ external_id: 'mcp-c1', workspace: 'ws', ide: 'cli' });
    app.db.close();
    const handlers = createToolHandlers(dbPath);
    const result = await handlers['ai-memory-conversations']({ limit: 10, offset: 0 });
    expect(result.conversations.length).toBe(1);
  });

  test('ai-memory-conversation returns full transcript', async () => {
    const { dbPath, app } = createTempApp();
    const conv = app.conversationStore.upsertConversationByExternalId({ external_id: 'mcp-c2', workspace: 'ws', ide: 'cli' });
    app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: 'hello' });
    app.conversationStore.addTurn({ conversation_id: conv.id, role: 'assistant', content: 'hi back' });
    const handlers = createToolHandlers(dbPath);
    const result = await handlers['ai-memory-conversation']({ conversation_id: conv.id });
    expect(result.conversation).not.toBeNull();
    expect(result.turns).toHaveLength(2);
  });

  test('ai-memory-conversation returns null for missing id', async () => {
    const { dbPath } = createTempApp();
    const handlers = createToolHandlers(dbPath);
    const result = await handlers['ai-memory-conversation']({ conversation_id: 'nonexistent' });
    expect(result.conversation).toBeNull();
    expect(result.turns).toEqual([]);
  });

  test('ai-memory-summarize upserts summary and returns updated conversation', async () => {
    const { dbPath, app } = createTempApp();
    const conv = app.conversationStore.upsertConversationByExternalId({ external_id: 'mcp-s1', workspace: 'ws', ide: 'cli' });
    const handlers = createToolHandlers(dbPath);
    const result = await handlers['ai-memory-summarize']({ conversation_id: conv.id, summary: 'New summary text' });
    expect(result.ok).toBe(true);
    expect(result.conversation!.summary).toBe('New summary text');
  });

  test('ai-memory-summarize updates title when provided', async () => {
    const { dbPath, app } = createTempApp();
    const conv = app.conversationStore.upsertConversationByExternalId({ external_id: 'mcp-s2', workspace: 'ws', ide: 'cli' });
    const handlers = createToolHandlers(dbPath);
    const result = await handlers['ai-memory-summarize']({
      conversation_id: conv.id,
      summary: 'Summary text',
      title: 'Updated title'
    });
    expect(result.ok).toBe(true);
    expect(result.conversation!.summary).toBe('Summary text');
    expect(result.conversation!.title).toBe('Updated title');
  });

  test('ai-memory-summarize throws for blank title', async () => {
    const { dbPath, app } = createTempApp();
    const conv = app.conversationStore.upsertConversationByExternalId({ external_id: 'mcp-s3', workspace: 'ws', ide: 'cli' });
    const handlers = createToolHandlers(dbPath);
    await expect(
      handlers['ai-memory-summarize']({ conversation_id: conv.id, summary: 'Summary text', title: '   ' })
    ).rejects.toThrow('Invalid title: must contain non-whitespace characters');
  });

  test('ai-memory-summarize throws for unknown conversation', async () => {
    const { dbPath } = createTempApp();
    const handlers = createToolHandlers(dbPath);
    await expect(
      handlers['ai-memory-summarize']({ conversation_id: 'missing-id', summary: 'Summary text', title: 'Title' })
    ).rejects.toThrow('Conversation not found: missing-id');
  });

  test('ai-memory-search finds turn content', async () => {
    const { dbPath, app } = createTempApp();
    const conv = app.conversationStore.upsertConversationByExternalId({ external_id: 'mcp-q1', workspace: 'ws', ide: 'cli' });
    app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: 'implement websocket handler' });
    const handlers = createToolHandlers(dbPath);
    const result = await handlers['ai-memory-search']({ query: 'websocket' });
    expect(result.conversations.length).toBe(1);
    expect(result.conversations[0].match_source).toBe('turn');
  });

  test('ai-memory-status returns conversation and turn counts', async () => {
    const { dbPath, app } = createTempApp();
    const conv = app.conversationStore.upsertConversationByExternalId({ external_id: 'st-1', workspace: 'ws', ide: 'cli' });
    app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: 'test' });
    const handlers = createToolHandlers(dbPath);
    const result = await handlers['ai-memory-status']();
    expect(result.conversations_count).toBe(1);
    expect(result.turns_count).toBe(1);
    expect(result).toHaveProperty('db_path');
    expect(result).toHaveProperty('index_status');
  });
});

describe('tool usage tracking', () => {
  test('successful tool call writes a usage row', async () => {
    const { dbPath, app } = createTempApp();
    app.conversationStore.upsertConversationByExternalId({ external_id: 'u1', workspace: 'ws', ide: 'cli' });
    const handlers = createToolHandlers(dbPath);
    await handlers['ai-memory-conversations']({ limit: 10 });

    const rows = getUsageRows(dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].tool_name).toBe('ai-memory-conversations');
    expect(rows[0].success).toBe(1);
    expect(rows[0].error_type).toBeNull();
    expect(rows[0].latency_ms).toBeGreaterThanOrEqual(0);
  });

  test('records param_keys without values', async () => {
    const { dbPath } = createTempApp();
    const handlers = createToolHandlers(dbPath);
    await handlers['ai-memory-search']({ query: 'test', workspace: 'my-project' });

    const rows = getUsageRows(dbPath);
    const keys = JSON.parse(rows[0].param_keys);
    expect(keys).toContain('query');
    expect(keys).toContain('workspace');
    expect(rows[0].param_keys).not.toContain('test');
    expect(rows[0].param_keys).not.toContain('my-project');
  });

  test('captures workspace from input when available', async () => {
    const { dbPath } = createTempApp();
    const handlers = createToolHandlers(dbPath);
    await handlers['ai-memory-search']({ query: 'x', workspace: 'my-ws' });

    const rows = getUsageRows(dbPath);
    expect(rows[0].workspace).toBe('my-ws');
  });

  test('workspace is null when not in input', async () => {
    const { dbPath } = createTempApp();
    const handlers = createToolHandlers(dbPath);
    await handlers['ai-memory-status']();

    const rows = getUsageRows(dbPath);
    expect(rows[0].workspace).toBeNull();
  });

  test('result_count reflects search results', async () => {
    const { dbPath, app } = createTempApp();
    const conv = app.conversationStore.upsertConversationByExternalId({ external_id: 'rc1', workspace: 'ws', ide: 'cli' });
    app.conversationStore.addTurn({ conversation_id: conv.id, role: 'user', content: 'graphql resolvers' });
    const handlers = createToolHandlers(dbPath);

    await handlers['ai-memory-search']({ query: 'graphql' });
    await handlers['ai-memory-search']({ query: 'nonexistentxyzzy' });

    const rows = getUsageRows(dbPath);
    expect(rows[0].result_count).toBe(1);
    expect(rows[1].result_count).toBe(0);
  });

  test('failed tool call records success=0 and error_type', async () => {
    const { dbPath } = createTempApp();
    const handlers = createToolHandlers(dbPath);

    await expect(
      handlers['ai-memory-summarize']({ conversation_id: 'missing', summary: 'test', title: 'Title' })
    ).rejects.toThrow();

    const rows = getUsageRows(dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].success).toBe(0);
    expect(rows[0].error_type).toBe('NOT_FOUND');
    expect(rows[0].result_count).toBeNull();
  });

  test('validation error classified correctly', async () => {
    const { dbPath, app } = createTempApp();
    const conv = app.conversationStore.upsertConversationByExternalId({ external_id: 'v1', workspace: 'ws', ide: 'cli' });
    const handlers = createToolHandlers(dbPath);

    await expect(
      handlers['ai-memory-summarize']({ conversation_id: conv.id, summary: 'text', title: '   ' })
    ).rejects.toThrow();

    const rows = getUsageRows(dbPath);
    expect(rows[0].error_type).toBe('VALIDATION');
  });

  test('multiple tool calls produce multiple rows', async () => {
    const { dbPath } = createTempApp();
    const handlers = createToolHandlers(dbPath);

    await handlers['ai-memory-status']();
    await handlers['ai-memory-conversations']({});
    await handlers['ai-memory-search']({ query: 'test' });

    const rows = getUsageRows(dbPath);
    expect(rows).toHaveLength(3);
    expect(rows.map((r: any) => r.tool_name)).toEqual([
      'ai-memory-status',
      'ai-memory-conversations',
      'ai-memory-search'
    ]);
  });

  test('tracking failure does not break tool call', async () => {
    const { dbPath, app } = createTempApp();
    app.db.exec('DROP TABLE tool_usage');
    const handlers = createToolHandlers(dbPath);

    const result = await handlers['ai-memory-status']();
    expect(result).toHaveProperty('conversations_count');
  });
});

describe('classifyError', () => {
  test('Error with "not found" → NOT_FOUND', () => {
    expect(classifyError(new Error('Conversation not found: abc'))).toBe('NOT_FOUND');
  });

  test('Error with "invalid" → VALIDATION', () => {
    expect(classifyError(new Error('Invalid title: must contain non-whitespace'))).toBe('VALIDATION');
  });

  test('Error with "validation" → VALIDATION', () => {
    expect(classifyError(new Error('validation failed for field X'))).toBe('VALIDATION');
  });

  test('generic Error → INTERNAL', () => {
    expect(classifyError(new Error('SQLITE_ERROR: no such table'))).toBe('INTERNAL');
  });

  test('non-Error throw → INTERNAL', () => {
    expect(classifyError('raw string error')).toBe('INTERNAL');
    expect(classifyError(null)).toBe('INTERNAL');
    expect(classifyError(42)).toBe('INTERNAL');
  });
});
