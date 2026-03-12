import { describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function runCli(args: string[], env: Record<string, string>, stdin?: string) {
  return spawnSync('npx', ['tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    input: stdin
  });
}

describe('CLI commands', () => {
  test('init + hook + conversations + search flow', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-new-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    expect(runCli(['init', '--json'], env).status).toBe(0);
    const startStdin = JSON.stringify({ conversation_id: 'conv-cli-1', workspace_roots: ['/tmp/my-workspace'] });
    expect(runCli(['hook', 'session-start', '--ide', 'cursor'], env, startStdin).status).toBe(0);
    const promptStdin = JSON.stringify({ conversation_id: 'conv-cli-1', workspace_roots: ['/tmp/my-workspace'], prompt: 'Build search API' });
    expect(runCli(['hook', 'prompt-submit', '--ide', 'cursor'], env, promptStdin).status).toBe(0);
    // D038: Cursor uses afterAgentResponse for assistant content
    const afterStdin = JSON.stringify({ conversation_id: 'conv-cli-1', workspace_roots: ['/tmp/my-workspace'], text: 'Implemented search' });
    expect(runCli(['hook', 'afterAgentResponse', '--ide', 'cursor'], env, afterStdin).status).toBe(0);

    const conversations = runCli(['conversations', '--json'], env);
    expect(conversations.status).toBe(0);
    const parsedConversations = JSON.parse(conversations.stdout);
    expect(parsedConversations.conversations.length).toBeGreaterThan(0);

    const search = runCli(['search', 'search', '--json'], env);
    expect(search.status).toBe(0);
    const parsedSearch = JSON.parse(search.stdout);
    expect(parsedSearch.conversations.length).toBeGreaterThan(0);
  });

  // D038 D1: Cursor uses afterAgentResponse for assistant content, not stop hook
  test('afterAgentResponse hook captures assistant content via stdin.text (Cursor)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-after-agent-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    expect(runCli(['init', '--json'], env).status).toBe(0);
    const startStdin = JSON.stringify({ conversation_id: 'conv-cli-after', workspace_roots: ['/tmp/ws'] });
    expect(runCli(['hook', 'session-start', '--ide', 'cursor'], env, startStdin).status).toBe(0);
    const promptStdin = JSON.stringify({ conversation_id: 'conv-cli-after', workspace_roots: ['/tmp/ws'], prompt: 'User asks question' });
    expect(runCli(['hook', 'prompt-submit', '--ide', 'cursor'], env, promptStdin).status).toBe(0);
    const afterStdin = JSON.stringify({ conversation_id: 'conv-cli-after', workspace_roots: ['/tmp/ws'], text: 'Assistant via afterAgentResponse' });
    expect(runCli(['hook', 'afterAgentResponse', '--ide', 'cursor'], env, afterStdin).status).toBe(0);

    const conv = JSON.parse(runCli(['conversations', '--json'], env).stdout).conversations[0];
    const details = JSON.parse(runCli(['conversation', conv.id, '--json'], env).stdout);
    expect(details.turns.map((t: { role: string }) => t.role)).toEqual(['user', 'assistant']);
    expect(details.turns[1].content).toBe('Assistant via afterAgentResponse');
  });

  // D038 D2: Cursor stop hook is metadata-only — no assistant content capture
  test('cursor stop hook does not capture assistant content (metadata only)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-cursor-stop-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    expect(runCli(['init', '--json'], env).status).toBe(0);
    const startStdin = JSON.stringify({ conversation_id: 'conv-cursor-stop', workspace_roots: ['/tmp/ws'] });
    expect(runCli(['hook', 'session-start', '--ide', 'cursor'], env, startStdin).status).toBe(0);
    const promptStdin = JSON.stringify({ conversation_id: 'conv-cursor-stop', workspace_roots: ['/tmp/ws'], prompt: 'User question' });
    expect(runCli(['hook', 'prompt-submit', '--ide', 'cursor'], env, promptStdin).status).toBe(0);
    const stopStdin = JSON.stringify({ conversation_id: 'conv-cursor-stop', workspace_roots: ['/tmp/ws'], status: 'completed' });
    expect(runCli(['hook', 'stop', '--ide', 'cursor'], env, stopStdin).status).toBe(0);

    const conv = JSON.parse(runCli(['conversations', '--json'], env).stdout).conversations[0];
    const details = JSON.parse(runCli(['conversation', conv.id, '--json'], env).stdout);
    expect(details.turns.map((t: { role: string }) => t.role)).toEqual(['user']);
  });

  test('title command updates title and returns errors for invalid input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-title-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    expect(runCli(['init', '--json'], env).status).toBe(0);
    const startStdin = JSON.stringify({ conversation_id: 'conv-cli-title', workspace_roots: ['/tmp/ws'] });
    expect(runCli(['hook', 'session-start', '--ide', 'cursor'], env, startStdin).status).toBe(0);
    const promptStdin = JSON.stringify({ conversation_id: 'conv-cli-title', workspace_roots: ['/tmp/ws'], prompt: 'Initial prompt' });
    expect(runCli(['hook', 'prompt-submit', '--ide', 'cursor'], env, promptStdin).status).toBe(0);

    const conv = JSON.parse(runCli(['conversations', '--json'], env).stdout).conversations[0];
    const ok = runCli(['title', conv.id, '  Better title   ', '--json'], env);
    expect(ok.status).toBe(0);
    const okParsed = JSON.parse(ok.stdout);
    expect(okParsed.conversation.title).toBe('Better title');

    const bad = runCli(['title', conv.id, '   ', '--json'], env);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('Invalid title');

    const missing = runCli(['title', 'missing-id', 'Some title', '--json'], env);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('Conversation not found');
  });

  test('summarize command returns error for missing conversation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-summarize-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    expect(runCli(['init', '--json'], env).status).toBe(0);

    const missing = runCli(['summarize', 'missing-id', 'Some summary', '--json'], env);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('Conversation not found');
  });

  test('usage command returns shared usage data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-usage-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    expect(runCli(['init', '--json'], env).status).toBe(0);
    const startStdin = JSON.stringify({ conversation_id: 'conv-cli-usage', workspace_roots: ['/tmp/ws'] });
    expect(runCli(['hook', 'session-start', '--ide', 'cursor'], env, startStdin).status).toBe(0);

    const usage = runCli(['usage', '--range', '7d', '--json'], env);
    expect(usage.status).toBe(0);
    const parsed = JSON.parse(usage.stdout);
    expect(parsed.summary.range).toBe('7d');
    expect(parsed).toHaveProperty('by_tool');
    expect(parsed).toHaveProperty('time_series');
  });

  test('hooks do not create .ai-memory marker in workspace root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-no-marker-'));
    const workspaceDir = mkdtempSync(join(tmpdir(), 'ai-memory-workspace-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    expect(runCli(['init', '--json'], env).status).toBe(0);
    const startStdin = JSON.stringify({ conversation_id: 'conv-no-marker', workspace_roots: [workspaceDir] });
    expect(runCli(['hook', 'session-start', '--ide', 'cursor'], env, startStdin).status).toBe(0);
    const promptStdin = JSON.stringify({
      conversation_id: 'conv-no-marker',
      workspace_roots: [workspaceDir],
      prompt: 'No marker side effects'
    });
    expect(runCli(['hook', 'prompt-submit', '--ide', 'cursor'], env, promptStdin).status).toBe(0);
    // D038: Cursor uses afterAgentResponse for assistant content
    const afterStdin = JSON.stringify({
      conversation_id: 'conv-no-marker',
      workspace_roots: [workspaceDir],
      text: 'Acknowledged'
    });
    expect(runCli(['hook', 'afterAgentResponse', '--ide', 'cursor'], env, afterStdin).status).toBe(0);

    expect(existsSync(join(workspaceDir, '.ai-memory'))).toBe(false);
  });

  test('init --ide claude-code syncs runtime MCP registry in ~/.claude.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-claude-registry-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    const init = runCli(['init', '--ide', 'claude-code', '--json'], env);
    expect(init.status).toBe(0);

    const settingsPath = join(dir, '.claude', 'settings.json');
    const registryPath = join(dir, '.claude.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

    expect(settings.mcpServers?.['ai-memory']).toEqual({ command: 'ai-memory', args: ['mcp'] });
    expect(registry.mcpServers?.['ai-memory']?.command).toBe('ai-memory');
    expect(registry.mcpServers?.['ai-memory']?.args).toEqual(['mcp']);
  });

});
