import { describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
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

function freshEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-memory-phantom-'));
  const dbPath = join(dir, '.ai-memory/services/memory.db');
  const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };
  expect(runCli(['init', '--json'], env).status).toBe(0);
  return env;
}

function getConversations(env: Record<string, string>) {
  const result = runCli(['conversations', '--json'], env);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout).conversations as Array<{ id: string; ide: string | null }>;
}

// Cursor-style payloads (camelCase events)
const cursorSessionStart = {
  hook_event_name: 'sessionStart',
  conversation_id: 'cursor-conv-1',
  workspace_roots: ['/tmp/phantom-ws'],
  cursor_version: '0.50.0'
};

const cursorPromptSubmit = {
  hook_event_name: 'beforeSubmitPrompt',
  conversation_id: 'cursor-conv-1',
  workspace_roots: ['/tmp/phantom-ws'],
  prompt: 'Build search API'
};

// Claude Code-style payloads (PascalCase events)
const claudeSessionStart = {
  hook_event_name: 'SessionStart',
  session_id: 'claude-session-1',
  cwd: '/tmp/phantom-claude-ws'
};

const claudePromptSubmit = {
  hook_event_name: 'UserPromptSubmit',
  session_id: 'claude-session-1',
  cwd: '/tmp/phantom-claude-ws',
  prompt: 'Investigate drift'
};

describe('Phantom hook detection', () => {
  test('--ide claude-code with Cursor payload (camelCase event) is silently dropped', () => {
    const env = freshEnv();

    // Fire Cursor-style payloads but with --ide claude-code (phantom scenario)
    const start = runCli(['hook', 'session-start', '--ide', 'claude-code'], env, JSON.stringify(cursorSessionStart));
    expect(start.status).toBe(0);

    const prompt = runCli(['hook', 'prompt-submit', '--ide', 'claude-code'], env, JSON.stringify(cursorPromptSubmit));
    expect(prompt.status).toBe(0);

    // No conversation should be created — the phantom hooks were skipped
    const conversations = getConversations(env);
    expect(conversations).toHaveLength(0);
  });

  test('--ide cursor with Claude Code payload (PascalCase event) is silently dropped', () => {
    const env = freshEnv();

    // Fire Claude Code-style payloads but with --ide cursor (phantom scenario)
    const start = runCli(['hook', 'session-start', '--ide', 'cursor'], env, JSON.stringify(claudeSessionStart));
    expect(start.status).toBe(0);

    const prompt = runCli(['hook', 'prompt-submit', '--ide', 'cursor'], env, JSON.stringify(claudePromptSubmit));
    expect(prompt.status).toBe(0);

    // No conversation should be created — the phantom hooks were skipped
    const conversations = getConversations(env);
    expect(conversations).toHaveLength(0);
  });

  test('--ide cursor with Cursor payload works normally', () => {
    const env = freshEnv();

    const start = runCli(['hook', 'session-start', '--ide', 'cursor'], env, JSON.stringify(cursorSessionStart));
    expect(start.status).toBe(0);

    const prompt = runCli(['hook', 'prompt-submit', '--ide', 'cursor'], env, JSON.stringify(cursorPromptSubmit));
    expect(prompt.status).toBe(0);

    const conversations = getConversations(env);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].ide).toBe('cursor');
  });

  test('--ide claude-code with Claude Code payload works normally', () => {
    const env = freshEnv();

    const start = runCli(['hook', 'session-start', '--ide', 'claude-code'], env, JSON.stringify(claudeSessionStart));
    expect(start.status).toBe(0);

    const prompt = runCli(['hook', 'prompt-submit', '--ide', 'claude-code'], env, JSON.stringify(claudePromptSubmit));
    expect(prompt.status).toBe(0);

    const conversations = getConversations(env);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].ide).toBe('claude-code');
  });

  test('dual-fire: same Cursor payload via both --ide cursor and --ide claude-code creates only one conversation', () => {
    const env = freshEnv();

    // Fire 1: legitimate Cursor invocation
    runCli(['hook', 'session-start', '--ide', 'cursor'], env, JSON.stringify(cursorSessionStart));
    runCli(['hook', 'prompt-submit', '--ide', 'cursor'], env, JSON.stringify(cursorPromptSubmit));

    // Fire 2: phantom Claude Code invocation with same Cursor payload
    runCli(['hook', 'session-start', '--ide', 'claude-code'], env, JSON.stringify(cursorSessionStart));
    runCli(['hook', 'prompt-submit', '--ide', 'claude-code'], env, JSON.stringify(cursorPromptSubmit));

    // Only one conversation should exist — the cursor one
    const conversations = getConversations(env);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].ide).toBe('cursor');
  });
});
