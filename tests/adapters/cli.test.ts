import { describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// Write a minimal Claude Code JSONL transcript to a temp dir
function writeClaudeTranscript(home: string, uuid: string, workspace: string, turns: Array<{ type: 'user' | 'assistant'; content: string }>) {
  const projectDir = join(home, '.claude', 'projects', `-Users-${workspace}`);
  mkdirSync(projectDir, { recursive: true });
  const lines = turns.map((t, i) => JSON.stringify({
    type: t.type,
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
    message: { content: [{ type: 'text', text: t.content }] }
  }));
  writeFileSync(join(projectDir, `${uuid}.jsonl`), lines.join('\n') + '\n');
}

describe('CLI commands', () => {
  test('init creates directory structure and db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-init-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    const result = runCli(['init', '--json'], env);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
  });

  test('import-transcripts + conversations + search flow', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-import-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    expect(runCli(['init', '--json'], env).status).toBe(0);

    writeClaudeTranscript(dir, 'conv-import-1', 'myproject', [
      { type: 'user', content: 'Build a search API endpoint' },
      { type: 'assistant', content: 'I implemented the search API' }
    ]);

    const importResult = runCli(['import-transcripts', '--source', 'claude-code', '--json'], env);
    expect(importResult.status).toBe(0);
    const importParsed = JSON.parse(importResult.stdout);
    expect(importParsed.created).toBeGreaterThan(0);

    const conversations = runCli(['conversations', '--json'], env);
    expect(conversations.status).toBe(0);
    const parsedConversations = JSON.parse(conversations.stdout);
    expect(parsedConversations.conversations.length).toBeGreaterThan(0);

    const search = runCli(['search', 'search', '--json'], env);
    expect(search.status).toBe(0);
    const parsedSearch = JSON.parse(search.stdout);
    expect(parsedSearch.conversations.length).toBeGreaterThan(0);
  });

  test('import-transcripts supports codex source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-codex-import-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    expect(runCli(['init', '--json'], env).status).toBe(0);

    // Write a Codex JSONL transcript
    const sessionDir = join(dir, '.codex', 'sessions', '2026', '03', '13');
    mkdirSync(sessionDir, { recursive: true });
    const threadId = 'codex-thread-test-1';
    const lines = [
      JSON.stringify({ timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: threadId, cwd: '/tmp/myproject' } }),
      JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the auth bug' }] } }),
      JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixed the bug in auth.ts' }] } }),
    ];
    writeFileSync(join(sessionDir, `rollout-123-${threadId}.jsonl`), lines.join('\n') + '\n');

    const importResult = runCli(['import-transcripts', '--source', 'codex', '--json'], env);
    expect(importResult.status).toBe(0);
    const importParsed = JSON.parse(importResult.stdout);
    expect(importParsed.created).toBe(1);

    const convs = JSON.parse(runCli(['conversations', '--json'], env).stdout).conversations;
    expect(convs.length).toBe(1);
    expect(convs[0].ide).toBe('codex');
    expect(convs[0].workspace).toBe('myproject');
  });

  test('title command updates title', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-title-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    expect(runCli(['init', '--json'], env).status).toBe(0);
    writeClaudeTranscript(dir, 'conv-title-1', 'ws', [
      { type: 'user', content: 'Initial prompt' }
    ]);
    expect(runCli(['import-transcripts', '--source', 'claude-code', '--json'], env).status).toBe(0);

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

    const usage = runCli(['usage', '--range', '7d', '--json'], env);
    expect(usage.status).toBe(0);
    const parsed = JSON.parse(usage.stdout);
    expect(parsed.summary.range).toBe('7d');
    expect(parsed).toHaveProperty('by_tool');
    expect(parsed).toHaveProperty('time_series');
  });

  test('hook command no longer exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-no-hook-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };
    const result = runCli(['hook', 'session-start', '--ide', 'cursor'], env);
    expect(result.status).not.toBe(0);
  });

  test('init --ide claude-code registers MCP in ~/.claude.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-claude-registry-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    const init = runCli(['init', '--ide', 'claude-code', '--json'], env);
    expect(init.status).toBe(0);

    const registryPath = join(dir, '.claude.json');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

    expect(registry.mcpServers?.['ai-memory']?.command).toBe('ai-memory');
    expect(registry.mcpServers?.['ai-memory']?.args).toEqual(['mcp']);
  });

  test('init --ide claude-code does not write settings.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-no-settings-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };

    runCli(['init', '--ide', 'claude-code', '--json'], env);

    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false);
  });

  test('init --ide cursor does not write hooks.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-cli-no-cursor-hooks-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };
    // Create .cursor dir so it's detected
    mkdirSync(join(dir, '.cursor'), { recursive: true });

    runCli(['init', '--ide', 'cursor', '--json'], env);

    expect(existsSync(join(dir, '.cursor', 'hooks.json'))).toBe(false);
    expect(existsSync(join(dir, '.cursor', 'mcp.json'))).toBe(true);
  });
});
