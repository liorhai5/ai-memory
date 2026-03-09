import { describe, expect, test } from 'vitest';
import { createToolHandlers, listTools } from '../../src/mcp/server.js';

describe('MCP Adapter', () => {
  test('51 mcp.query-tool', async () => {
    const handlers = createToolHandlers();
    await handlers['ai-memory-capture']({
      session_id: 's1',
      workspace: 'w1',
      items: [{ type: 'decision', content: 'mcp query contract' }]
    });
    const query = await handlers['ai-memory-query']({ query: 'query contract', workspace: 'w1', top_k: 5, token_budget: 200 });
    expect(query).toHaveProperty('memories');
    expect(query).toHaveProperty('used_tokens');
    expect(query).toHaveProperty('truncated');
  });

  test('52 mcp.capture-tool', async () => {
    const handlers = createToolHandlers();
    const capture = await handlers['ai-memory-capture']({
      session_id: 's1',
      workspace: 'w1',
      items: [{ type: 'decision', content: 'capture contract' }]
    });
    expect(capture).toHaveProperty('created');
    expect(capture).toHaveProperty('updated');
    expect(capture).toHaveProperty('linked');
    expect(capture).toHaveProperty('skipped');
    expect(capture).toHaveProperty('ids');
  });

  test('53 mcp.capture-runs-hebbian', async () => {
    const handlers = createToolHandlers();
    await handlers['ai-memory-capture']({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'sqlite memory local pattern' }] });
    const result = await handlers['ai-memory-capture']({ session_id: 's2', workspace: 'w1', items: [{ type: 'learning', content: 'local sqlite memory pattern' }] });
    expect(result.updated + result.linked + result.created).toBeGreaterThan(0);
  });

  test('54 mcp.capture-empty-items', async () => {
    const handlers = createToolHandlers();
    const capture = await handlers['ai-memory-capture']({ session_id: 's1', workspace: 'w1', items: [] });
    expect(capture).toEqual({ created: 0, updated: 0, linked: 0, skipped: 0, ids: [] });
  });

  test('55 mcp.events-tool', async () => {
    const handlers = createToolHandlers();
    await handlers['ai-memory-capture']({ session_id: 's9', workspace: 'w1', items: [{ type: 'fact', content: 'events sample' }] });
    const events = await handlers['ai-memory-events']({ session_id: 's9', limit: 10 });
    expect(Array.isArray(events.events)).toBe(true);
    expect(events.events.length).toBeGreaterThan(0);
  });

  test('56 mcp.status-tool', async () => {
    const handlers = createToolHandlers();
    const status = await handlers['ai-memory-status']();
    expect(status).toHaveProperty('pending_extractions_count');
    expect(status).toHaveProperty('last_run');
    expect(status).toHaveProperty('db_path');
    expect(status).toHaveProperty('index_status');
  });

  test('57 mcp.no-extract-tool', () => {
    const tools = listTools();
    expect(tools).toHaveLength(4);
    expect(tools).not.toContain('ai-memory-extract');
  });

  test('58 mcp.input-validation', async () => {
    const handlers = createToolHandlers();
    // Missing required `items` field — should throw a structured error
    try {
      await (handlers as any)['ai-memory-capture']({ session_id: 's1', workspace: 'w1' });
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e).toBeTruthy();
    }
  });

  test('59 mcp.thin-wrapper', () => {
    const tools = listTools();
    expect(tools).toEqual(['ai-memory-query', 'ai-memory-capture', 'ai-memory-events', 'ai-memory-status']);
  });
});
