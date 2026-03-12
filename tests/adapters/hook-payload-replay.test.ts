import { describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

function fixture(name: string): any {
  const path = join(process.cwd(), 'tests', 'fixtures', 'hooks', name);
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Hook payload replay fixtures', () => {
  // D038 D1: Cursor uses afterAgentResponse for assistant content
  test('replays cursor payload sequence with afterAgentResponse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-replay-cursor-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };
    expect(runCli(['init', '--json'], env).status).toBe(0);

    const start = fixture('cursor-session-start.json');
    const prompt = fixture('cursor-prompt-submit.json');
    const stop = fixture('cursor-stop.json');

    expect(runCli(['hook', 'session-start', '--ide', 'cursor'], env, JSON.stringify(start)).status).toBe(0);
    expect(runCli(['hook', 'prompt-submit', '--ide', 'cursor'], env, JSON.stringify(prompt)).status).toBe(0);

    // D038: afterAgentResponse sends text directly, no transcript parsing needed
    const afterAgentPayload = { ...start, text: 'Captured from cursor afterAgentResponse' };
    expect(runCli(['hook', 'afterAgentResponse', '--ide', 'cursor'], env, JSON.stringify(afterAgentPayload)).status).toBe(0);

    // stop is metadata-only for Cursor
    expect(runCli(['hook', 'stop', '--ide', 'cursor'], env, JSON.stringify(stop)).status).toBe(0);

    const conv = JSON.parse(runCli(['conversations', '--json'], env).stdout).conversations[0];
    const details = JSON.parse(runCli(['conversation', conv.id, '--json'], env).stdout);
    expect(details.turns.map((t: { role: string }) => t.role)).toEqual(['user', 'assistant']);
    expect(details.turns[1].content).toBe('Captured from cursor afterAgentResponse');
  });

  test('replays claude payload sequence with last_assistant_message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-replay-claude-'));
    const dbPath = join(dir, '.ai-memory/services/memory.db');
    const env = { AI_MEMORY_DB_PATH: dbPath, HOME: dir };
    expect(runCli(['init', '--json'], env).status).toBe(0);

    const start = fixture('claude-session-start.json');
    const prompt = fixture('claude-prompt-submit.json');
    const stop = fixture('claude-stop.json');

    const startRes = runCli(['hook', 'session-start', '--ide', 'claude-code'], env, JSON.stringify(start));
    expect(startRes.status).toBe(0);
    expect(startRes.stdout).toContain('Recent work');

    expect(runCli(['hook', 'prompt-submit', '--ide', 'claude-code'], env, JSON.stringify(prompt)).status).toBe(0);
    expect(runCli(['hook', 'stop', '--ide', 'claude-code'], env, JSON.stringify(stop)).status).toBe(0);

    const conv = JSON.parse(runCli(['conversations', '--json'], env).stdout).conversations[0];
    const details = JSON.parse(runCli(['conversation', conv.id, '--json'], env).stdout);
    expect(details.turns.map((t: { role: string }) => t.role)).toEqual(['user', 'assistant']);
    expect(details.turns[1].content).toBe('Captured from claude fixture payload');
  });
});
