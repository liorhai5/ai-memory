import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createTempApp } from '../test-helpers.js';
import { handleRpc } from '../../src/dashboard/rpc.js';
import { saveConfig } from '../../src/services/config-service.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../src/services/config-service.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/config-service.js')>(
    '../../src/services/config-service.js'
  );
  return { ...actual, saveConfig: vi.fn() };
});

type RpcOk<T> = { ok: true; result: T };
type RpcErr = { ok: false; error: string };

function expectOk<T>(result: RpcOk<T> | RpcErr): T {
  expect(result.ok).toBe(true);
  return (result as RpcOk<T>).result;
}

describe('dashboard RPC adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns error for unknown methods', () => {
    const { app } = createTempApp();
    const result = handleRpc('unknownMethod', {}, app);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unknown method');
    }
  });

  test('listConversations supports workspace filter', () => {
    const { app } = createTempApp();
    app.conversationStore.upsertConversationByExternalId({ external_id: 'c-a', workspace: 'alpha', ide: 'cli' });
    app.conversationStore.upsertConversationByExternalId({ external_id: 'c-b', workspace: 'beta', ide: 'cli' });

    const result = expectOk<{ conversations: Array<{ workspace: string | null }>; total: number }>(
      handleRpc('listConversations', { workspace: 'alpha' }, app)
    );

    expect(result.total).toBe(1);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].workspace).toBe('alpha');
  });

  test('getConversation validates required conversation_id', () => {
    const { app } = createTempApp();
    const result = handleRpc('getConversation', {}, app);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Missing param: conversation_id');
    }
  });

  test('getConversation returns conversation with turns', () => {
    const { app } = createTempApp();
    const conv = app.conversationStore.upsertConversationByExternalId({
      external_id: 'with-turns',
      workspace: 'alpha',
      ide: 'cli',
    });
    app.conversationStore.addTurn({
      conversation_id: conv.id,
      role: 'user',
      content: 'hello',
    });

    const result = expectOk<{ conversation: { id: string } | null; turns: Array<{ role: string }> }>(
      handleRpc('getConversation', { conversation_id: conv.id }, app)
    );
    expect(result.conversation?.id).toBe(conv.id);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].role).toBe('user');
  });

  test('listWorkspaces returns distinct non-null workspaces', () => {
    const { app } = createTempApp();
    app.conversationStore.upsertConversationByExternalId({ external_id: 'w1', workspace: 'alpha', ide: 'cli' });
    app.conversationStore.upsertConversationByExternalId({ external_id: 'w2', workspace: 'alpha', ide: 'cli' });
    app.conversationStore.upsertConversationByExternalId({ external_id: 'w3', workspace: 'beta', ide: 'cli' });
    app.conversationStore.upsertConversationByExternalId({ external_id: 'w4', workspace: null, ide: 'cli' });

    const result = expectOk<{ workspaces: string[] }>(handleRpc('listWorkspaces', {}, app));
    expect(result.workspaces).toEqual(['alpha', 'beta']);
  });

  // D044: simulateInjection removed
  test('simulateInjection returns unknown method error', () => {
    const { app } = createTempApp();
    const result = handleRpc('simulateInjection', { workspace: 'alpha' }, app);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unknown method');
  });

  test('updateConfig applies valid values and persists via saveConfig', () => {
    const { app } = createTempApp();
    const updated = expectOk<{ config: Record<string, unknown> }>(
      handleRpc('updateConfig', {}, app)
    );
    expect(updated.config).toHaveProperty('search_default_limit');
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });

  test('getUsageSummary returns aggregated usage data', () => {
    const { app } = createTempApp();
    const now = new Date().toISOString();
    app.db
      .prepare(
        `
        INSERT INTO tool_usage (tool_name, called_at, latency_ms, workspace, param_keys, result_count, success, error_type)
        VALUES (?, ?, ?, NULL, '[]', ?, ?, ?)
        `
      )
      .run('ai-memory-search', now, 22, 0, 1, null);

    const result = expectOk<{ total_calls: number; empty_search_rate: number }>(
      handleRpc('getUsageSummary', { range: '7d' }, app)
    );
    expect(result.total_calls).toBe(1);
    expect(result.empty_search_rate).toBe(1);
  });

  test('getUsageDashboard returns by_tool and time_series', () => {
    const { app } = createTempApp();
    const now = new Date().toISOString();
    app.db
      .prepare(
        `
        INSERT INTO tool_usage (tool_name, called_at, latency_ms, workspace, param_keys, result_count, success, error_type)
        VALUES (?, ?, ?, NULL, '[]', ?, ?, ?)
        `
      )
      .run('ai-memory-status', now, 11, 1, 1, null);

    const result = expectOk<{ by_tool: Array<{ tool_name: string; calls: number }>; time_series: unknown[] }>(
      handleRpc('getUsageDashboard', { range: '24h' }, app)
    );
    expect(result.by_tool[0].tool_name).toBe('ai-memory-status');
    expect(result.by_tool[0].calls).toBe(1);
    expect(result.time_series.length).toBeGreaterThan(0);
  });

  test('getDashboardStatus includes compact usage summary', () => {
    const { app } = createTempApp();
    const result = expectOk<{ usage_summary: { tool_calls_24h: number; tool_calls_7d: number } }>(
      handleRpc('getDashboardStatus', {}, app)
    );
    expect(result.usage_summary).toHaveProperty('tool_calls_24h');
    expect(result.usage_summary).toHaveProperty('tool_calls_7d');
  });

  // D044 D12: getDashboardStatus returns watcher status (not hook status)
  test('getDashboardStatus includes watcher status', () => {
    const { app } = createTempApp();
    const result = expectOk<{ watcher: { watched_dirs: Array<{ path: string; exists: boolean }>; last_import_at: string | null; import_error_count: number } }>(
      handleRpc('getDashboardStatus', {}, app)
    );
    expect(result.watcher).toBeDefined();
    expect(Array.isArray(result.watcher.watched_dirs)).toBe(true);
    expect(result.watcher.watched_dirs.length).toBe(3);
    expect(result.watcher).toHaveProperty('last_import_at');
    expect(result.watcher).toHaveProperty('import_error_count');
  });

  test('getDashboardStatus has no hook fields in integrations', () => {
    const { app } = createTempApp();
    const result = expectOk<{ integrations: { cursor: Record<string, unknown>; claude_code: Record<string, unknown> } }>(
      handleRpc('getDashboardStatus', {}, app)
    );
    // Hooks-related fields should not exist
    expect(result.integrations.cursor.hooks).toBeUndefined();
    expect(result.integrations.claude_code.hooks).toBeUndefined();
  });

  test('getDashboardStatus Claude MCP readiness is true when both registry and settings are configured', () => {
    const { app, dir } = createTempApp();
    const prevHome = process.env.HOME;
    process.env.HOME = dir;
    try {
      const claudeDir = join(dir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(
        join(claudeDir, 'settings.json'),
        JSON.stringify({ mcpServers: { 'ai-memory': { command: 'ai-memory', args: ['mcp'] } } }, null, 2)
      );
      writeFileSync(
        join(dir, '.claude.json'),
        JSON.stringify({ mcpServers: { 'ai-memory': { command: 'ai-memory', args: ['mcp'] } } }, null, 2)
      );

      const result = expectOk<{ integrations: { claude_code: { settings_mcp_configured: boolean; registry_mcp_configured: boolean; mcp_configured: boolean } } }>(
        handleRpc('getDashboardStatus', {}, app)
      );
      expect(result.integrations.claude_code.settings_mcp_configured).toBe(true);
      expect(result.integrations.claude_code.registry_mcp_configured).toBe(true);
      expect(result.integrations.claude_code.mcp_configured).toBe(true);
    } finally {
      if (typeof prevHome === 'undefined') delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });

  test('getDashboardStatus shows watcher dirs with correct existence for temp home', () => {
    const { app, dir } = createTempApp();
    const prevHome = process.env.HOME;
    process.env.HOME = dir;
    try {
      // Create .claude/projects dir (first watched dir)
      mkdirSync(join(dir, '.claude', 'projects'), { recursive: true });

      const result = expectOk<{ watcher: { watched_dirs: Array<{ path: string; exists: boolean }> } }>(
        handleRpc('getDashboardStatus', {}, app)
      );

      const claudeDir = result.watcher.watched_dirs.find((d) => d.path.includes('.claude/projects'));
      const cursorDir = result.watcher.watched_dirs.find((d) => d.path.includes('.cursor/projects'));
      expect(claudeDir?.exists).toBe(true);
      expect(cursorDir?.exists).toBe(false);
    } finally {
      if (typeof prevHome === 'undefined') delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });
});
