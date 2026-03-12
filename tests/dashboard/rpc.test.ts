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

  test('simulateInjection returns output and char count', () => {
    const { app } = createTempApp();
    app.conversationStore.upsertConversationByExternalId({ external_id: 'inj-1', workspace: 'alpha', ide: 'cli' });

    const result = expectOk<{ output: string; chars: number }>(
      handleRpc('simulateInjection', { workspace: 'alpha' }, app)
    );
    expect(result.output.length).toBe(result.chars);
    expect(result.output).toContain('p1:injected:begin');
  });

  test('updateConfig rejects invalid negative values', () => {
    const { app } = createTempApp();
    const result = handleRpc('updateConfig', { injection_max_total_chars: -1 }, app);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid injection_max_total_chars');
    }
  });

  test('updateConfig applies valid values and persists via saveConfig', () => {
    const { app } = createTempApp();
    const updated = expectOk<{ config: { injection_max_total_chars: number; injection_max_conversations: number } }>(
      handleRpc(
        'updateConfig',
        { injection_max_total_chars: 900, injection_max_conversations: 4 },
        app
      )
    );

    expect(updated.config.injection_max_total_chars).toBe(900);
    expect(updated.config.injection_max_conversations).toBe(4);
    expect(app.config.injection_max_total_chars).toBe(900);
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

  test('getDashboardStatus recognizes Claude matcher-group hooks format', () => {
    const { app, dir } = createTempApp();
    const prevHome = process.env.HOME;
    process.env.HOME = dir;
    try {
      const claudeDir = join(dir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(
        join(claudeDir, 'settings.json'),
        JSON.stringify(
          {
            mcpServers: {
              'ai-memory': { command: 'ai-memory', args: ['mcp'] }
            },
            hooks: {
              SessionStart: [
                {
                  matcher: 'startup|resume|clear|compact',
                  hooks: [{ type: 'command', command: 'ai-memory hook session-start --ide claude-code' }]
                }
              ],
              UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ai-memory hook prompt-submit --ide claude-code' }] }],
              Stop: [{ hooks: [{ type: 'command', command: 'ai-memory hook stop --ide claude-code' }] }],
              SessionEnd: [{ hooks: [{ type: 'command', command: 'ai-memory hook session-end --ide claude-code' }] }]
            }
          },
          null,
          2
        )
      );

      const result = expectOk<{ integrations: { claude_code: { hooks: Record<string, boolean>; settings_mcp_configured: boolean; registry_mcp_configured: boolean; mcp_configured: boolean } } }>(
        handleRpc('getDashboardStatus', {}, app)
      );
      expect(result.integrations.claude_code.hooks.SessionStart).toBe(true);
      expect(result.integrations.claude_code.hooks.UserPromptSubmit).toBe(true);
      expect(result.integrations.claude_code.hooks.Stop).toBe(true);
      expect(result.integrations.claude_code.hooks.SessionEnd).toBe(true);
      expect(result.integrations.claude_code.settings_mcp_configured).toBe(true);
      expect(result.integrations.claude_code.registry_mcp_configured).toBe(false);
      expect(result.integrations.claude_code.mcp_configured).toBe(false);
    } finally {
      if (typeof prevHome === 'undefined') delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
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
        JSON.stringify(
          {
            mcpServers: {
              'ai-memory': { command: 'ai-memory', args: ['mcp'] }
            },
            hooks: {
              SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: 'ai-memory hook session-start --ide claude-code' }] }],
              UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ai-memory hook prompt-submit --ide claude-code' }] }],
              Stop: [{ hooks: [{ type: 'command', command: 'ai-memory hook stop --ide claude-code' }] }],
              SessionEnd: [{ hooks: [{ type: 'command', command: 'ai-memory hook session-end --ide claude-code' }] }]
            }
          },
          null,
          2
        )
      );
      writeFileSync(
        join(dir, '.claude.json'),
        JSON.stringify(
          { mcpServers: { 'ai-memory': { command: 'ai-memory', args: ['mcp'] } } },
          null,
          2
        )
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
});
