import { describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';

function setupImportTest() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-memory-import-'));
  const dbPath = join(dir, 'memory.db');
  const app = createApp(dbPath);
  return { app, dir, dbPath };
}

function writeCursorTranscript(homeDir: string, project: string, convId: string, lines: object[]) {
  const convDir = join(homeDir, '.cursor/projects', project, 'agent-transcripts', convId);
  mkdirSync(convDir, { recursive: true });
  writeFileSync(join(convDir, `${convId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'));
}

function writeClaudeTranscript(homeDir: string, project: string, filename: string, lines: object[]) {
  const dir = join(homeDir, '.claude/projects', project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), lines.map((l) => JSON.stringify(l)).join('\n'));
}

describe('ImportService (D12, D14)', () => {
  test('parses Cursor JSONL and creates conversation with turns', () => {
    const { app, dir } = setupImportTest();
    writeCursorTranscript(dir, 'my-project', 'conv-abc', [
      { role: 'user', message: { content: 'Build search API' }, timestamp: '2026-03-09T10:00:00Z' },
      { role: 'assistant', message: { content: 'Implemented search' }, timestamp: '2026-03-09T10:01:00Z' }
    ]);

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const report = app.importService.importTranscripts('cursor');
      expect(report.created).toBe(1);
      expect(report.errors).toBe(0);

      const conv = app.conversationStore.byExternalId('conv-abc');
      expect(conv).not.toBeNull();
      expect(conv!.title).toBe('Build search API');
      expect(conv!.summary).toBe('Build search API');

      const turns = app.conversationStore.listTurns(conv!.id);
      expect(turns).toHaveLength(2);
      expect(turns[0].role).toBe('user');
      expect(turns[1].role).toBe('assistant');
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('parses Claude Code JSONL with array content', () => {
    const { app, dir } = setupImportTest();
    writeClaudeTranscript(dir, 'my-project', 'session-1.jsonl', [
      { type: 'user', message: { content: [{ type: 'text', text: 'Hello from Claude' }] }, timestamp: '2026-03-09T10:00:00Z' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi there!' }] }, timestamp: '2026-03-09T10:01:00Z' }
    ]);

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const report = app.importService.importTranscripts('claude-code');
      expect(report.created).toBe(1);

      const conv = app.conversationStore.byExternalId('session-1');
      expect(conv).not.toBeNull();
      expect(conv!.title).toBe('Hello from Claude');
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('idempotent rerun does not create duplicates (D14)', () => {
    const { app, dir } = setupImportTest();
    writeCursorTranscript(dir, 'proj', 'idem-1', [
      { role: 'user', message: { content: 'test message' }, timestamp: '2026-03-09T10:00:00Z' }
    ]);

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const first = app.importService.importTranscripts('cursor');
      expect(first.created).toBe(1);
      const second = app.importService.importTranscripts('cursor');
      expect(second.updated).toBe(1);
      expect(second.created).toBe(0);

      const rows = app.db.prepare(`SELECT COUNT(*) as c FROM conversations`).get() as { c: number };
      expect(rows.c).toBe(1);
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('report shape has created/updated/skipped/errors (D14)', () => {
    const { app, dir } = setupImportTest();
    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const report = app.importService.importTranscripts('all');
      expect(report).toHaveProperty('created');
      expect(report).toHaveProperty('updated');
      expect(report).toHaveProperty('skipped');
      expect(report).toHaveProperty('errors');
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('handles malformed JSONL lines gracefully', () => {
    const { app, dir } = setupImportTest();
    writeCursorTranscript(dir, 'proj', 'bad-1', [
      { role: 'user', message: { content: 'good line' }, timestamp: '2026-03-09T10:00:00Z' }
    ]);
    const filePath = join(dir, '.cursor/projects/proj/agent-transcripts/bad-1/bad-1.jsonl');
    const { readFileSync } = require('node:fs');
    const existing = readFileSync(filePath, 'utf8');
    writeFileSync(filePath, existing + '\n{invalid json here\n');

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const report = app.importService.importTranscripts('cursor');
      expect(report.created).toBe(1);
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('does not overwrite curated summary without --force-summary', () => {
    const { app, dir } = setupImportTest();
    writeCursorTranscript(dir, 'proj', 'summary-1', [
      { role: 'user', message: { content: 'initial prompt' }, timestamp: '2026-03-09T10:00:00Z' }
    ]);

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      app.importService.importTranscripts('cursor');
      const conv = app.conversationStore.byExternalId('summary-1')!;
      app.conversationStore.upsertSummary(conv.id, 'Curated by user');
      app.importService.importTranscripts('cursor', false);
      expect(app.conversationStore.byId(conv.id)!.summary).toBe('Curated by user');
      app.importService.importTranscripts('cursor', true);
      expect(app.conversationStore.byId(conv.id)!.summary).toBe('initial prompt');
    } finally {
      process.env.HOME = origHome;
    }
  });
});

// D044 D2: Codex JSONL parser tests
describe('ImportService — Codex JSONL parser', () => {
  function writeCodexTranscript(homeDir: string, date: string, filename: string, lines: object[]) {
    const [year, month, day] = date.split('-');
    const sessionDir = join(homeDir, '.codex', 'sessions', year, month, day);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, filename), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }

  test('parses Codex JSONL and creates conversation with turns', () => {
    const { app, dir } = setupImportTest();
    const threadId = 'codex-thread-abc';
    writeCodexTranscript(dir, '2026-03-09', `rollout-123-${threadId}.jsonl`, [
      { timestamp: '2026-03-09T10:00:00Z', type: 'session_meta', payload: { id: threadId, cwd: '/home/user/myproject' } },
      { timestamp: '2026-03-09T10:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the auth bug' }] } },
      { timestamp: '2026-03-09T10:02:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixed the bug in auth.ts' }] } }
    ]);

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const report = app.importService.importTranscripts('codex');
      expect(report.created).toBe(1);
      expect(report.errors).toBe(0);

      const conv = app.conversationStore.byExternalId(threadId);
      expect(conv).not.toBeNull();
      expect(conv!.ide).toBe('codex');
      expect(conv!.workspace).toBe('myproject');
      expect(conv!.title).toBe('fix the auth bug');

      const turns = app.conversationStore.listTurns(conv!.id);
      expect(turns).toHaveLength(2);
      expect(turns[0].role).toBe('user');
      expect(turns[0].content).toBe('fix the auth bug');
      expect(turns[1].role).toBe('assistant');
      expect(turns[1].content).toBe('Fixed the bug in auth.ts');
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('skips developer/system role turns', () => {
    const { app, dir } = setupImportTest();
    const threadId = 'codex-thread-dev';
    writeCodexTranscript(dir, '2026-03-09', `rollout-dev-${threadId}.jsonl`, [
      { timestamp: '2026-03-09T10:00:00Z', type: 'session_meta', payload: { id: threadId, cwd: '/home/user/proj' } },
      { timestamp: '2026-03-09T10:01:00Z', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'System instructions here' }] } },
      { timestamp: '2026-03-09T10:02:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'user question' }] } },
    ]);

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      app.importService.importTranscripts('codex');
      const conv = app.conversationStore.byExternalId(threadId)!;
      const turns = app.conversationStore.listTurns(conv.id);
      expect(turns).toHaveLength(1);
      expect(turns[0].role).toBe('user');
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('skips function_call and reasoning response_items', () => {
    const { app, dir } = setupImportTest();
    const threadId = 'codex-thread-skip';
    writeCodexTranscript(dir, '2026-03-09', `rollout-skip-${threadId}.jsonl`, [
      { timestamp: '2026-03-09T10:00:00Z', type: 'session_meta', payload: { id: threadId, cwd: '/home/user/proj' } },
      { timestamp: '2026-03-09T10:01:00Z', type: 'response_item', payload: { type: 'function_call', content: [] } },
      { timestamp: '2026-03-09T10:02:00Z', type: 'response_item', payload: { type: 'reasoning', content: [] } },
      { timestamp: '2026-03-09T10:03:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'real user message' }] } },
    ]);

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      app.importService.importTranscripts('codex');
      const conv = app.conversationStore.byExternalId(threadId)!;
      const turns = app.conversationStore.listTurns(conv.id);
      expect(turns).toHaveLength(1);
      expect(turns[0].content).toBe('real user message');
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('skips Codex files with no session_meta or no turns', () => {
    const { app, dir } = setupImportTest();
    writeCodexTranscript(dir, '2026-03-09', 'no-meta.jsonl', [
      { timestamp: '2026-03-09T10:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'orphan' }] } },
    ]);

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const report = app.importService.importTranscripts('codex');
      expect(report.skipped).toBeGreaterThan(0);
      expect(report.created).toBe(0);
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('is idempotent for Codex transcripts', () => {
    const { app, dir } = setupImportTest();
    const threadId = 'codex-idempotent-1';
    writeCodexTranscript(dir, '2026-03-09', `rollout-idem-${threadId}.jsonl`, [
      { timestamp: '2026-03-09T10:00:00Z', type: 'session_meta', payload: { id: threadId, cwd: '/home/user/proj' } },
      { timestamp: '2026-03-09T10:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'test' }] } },
    ]);

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const first = app.importService.importTranscripts('codex');
      expect(first.created).toBe(1);
      const second = app.importService.importTranscripts('codex');
      expect(second.updated).toBe(1);
      expect(second.created).toBe(0);
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('importTranscripts all includes codex', () => {
    const { app, dir } = setupImportTest();
    const threadId = 'codex-in-all';
    writeCodexTranscript(dir, '2026-03-09', `rollout-all-${threadId}.jsonl`, [
      { timestamp: '2026-03-09T10:00:00Z', type: 'session_meta', payload: { id: threadId, cwd: '/home/user/proj' } },
      { timestamp: '2026-03-09T10:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'from all' }] } },
    ]);

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const report = app.importService.importTranscripts('all');
      expect(report.created).toBe(1);
    } finally {
      process.env.HOME = origHome;
    }
  });
});

// D047: Per-project configuration tests
describe('ImportService — project config (D047)', () => {
  function writeProjectConfig(projectDir: string, config: Record<string, unknown>) {
    const configDir = join(projectDir, '.ai-memory');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify(config));
  }

  function writeCodexTranscript(homeDir: string, date: string, filename: string, lines: object[]) {
    const [year, month, day] = date.split('-');
    const sessionDir = join(homeDir, '.codex', 'sessions', year, month, day);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, filename), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }

  test('skip: true prevents Claude Code transcript import', () => {
    const { app, dir } = setupImportTest();
    // Create a project directory that the transcript cwd will point to
    const projectDir = join(dir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    writeProjectConfig(projectDir, { skip: true });

    // Write a Claude Code transcript with cwd pointing to the project
    const claudeDir = join(dir, '.claude/projects/my-project');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'session-skip.jsonl'), [
      JSON.stringify({ type: 'user', cwd: projectDir, message: { content: 'hello' }, timestamp: '2026-03-19T10:00:00Z' }),
      JSON.stringify({ type: 'assistant', message: { content: 'hi' }, timestamp: '2026-03-19T10:01:00Z' })
    ].join('\n'));

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const report = app.importService.importTranscripts('claude-code');
      expect(report.skipped).toBeGreaterThan(0);
      expect(report.created).toBe(0);
      expect(app.conversationStore.byExternalId('session-skip')).toBeNull();
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('project_slug is stored on conversation during import', () => {
    const { app, dir } = setupImportTest();
    const projectDir = join(dir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    writeProjectConfig(projectDir, { project_slug: 'my-platform' });

    const claudeDir = join(dir, '.claude/projects/my-project');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'session-slug.jsonl'), [
      JSON.stringify({ type: 'user', cwd: projectDir, message: { content: 'hello' }, timestamp: '2026-03-19T10:00:00Z' }),
      JSON.stringify({ type: 'assistant', message: { content: 'hi' }, timestamp: '2026-03-19T10:01:00Z' })
    ].join('\n'));

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const report = app.importService.importTranscripts('claude-code');
      expect(report.created).toBe(1);
      const conv = app.conversationStore.byExternalId('session-slug');
      expect(conv).not.toBeNull();
      expect(conv!.project_slug).toBe('my-platform');
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('no config file means normal import (no slug, not skipped)', () => {
    const { app, dir } = setupImportTest();
    const projectDir = join(dir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    // No .ai-memory/config.json

    const claudeDir = join(dir, '.claude/projects/my-project');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'session-noconfig.jsonl'), [
      JSON.stringify({ type: 'user', cwd: projectDir, message: { content: 'hello' }, timestamp: '2026-03-19T10:00:00Z' }),
      JSON.stringify({ type: 'assistant', message: { content: 'hi' }, timestamp: '2026-03-19T10:01:00Z' })
    ].join('\n'));

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const report = app.importService.importTranscripts('claude-code');
      expect(report.created).toBe(1);
      const conv = app.conversationStore.byExternalId('session-noconfig');
      expect(conv!.project_slug).toBeNull();
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('skip: true prevents Codex transcript import', () => {
    const { app, dir } = setupImportTest();
    const projectDir = join(dir, 'codex-proj');
    mkdirSync(projectDir, { recursive: true });
    writeProjectConfig(projectDir, { skip: true });

    const threadId = 'codex-skip-1';
    writeCodexTranscript(dir, '2026-03-19', `rollout-${threadId}.jsonl`, [
      { timestamp: '2026-03-19T10:00:00Z', type: 'session_meta', payload: { id: threadId, cwd: projectDir } },
      { timestamp: '2026-03-19T10:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'test' }] } },
    ]);

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const report = app.importService.importTranscripts('codex');
      expect(report.skipped).toBeGreaterThan(0);
      expect(report.created).toBe(0);
      expect(app.conversationStore.byExternalId(threadId)).toBeNull();
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('project_slug stored on Codex conversation', () => {
    const { app, dir } = setupImportTest();
    const projectDir = join(dir, 'codex-proj');
    mkdirSync(projectDir, { recursive: true });
    writeProjectConfig(projectDir, { project_slug: 'codex-platform' });

    const threadId = 'codex-slug-1';
    writeCodexTranscript(dir, '2026-03-19', `rollout-${threadId}.jsonl`, [
      { timestamp: '2026-03-19T10:00:00Z', type: 'session_meta', payload: { id: threadId, cwd: projectDir } },
      { timestamp: '2026-03-19T10:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'test' }] } },
    ]);

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const report = app.importService.importTranscripts('codex');
      expect(report.created).toBe(1);
      const conv = app.conversationStore.byExternalId(threadId);
      expect(conv!.project_slug).toBe('codex-platform');
    } finally {
      process.env.HOME = origHome;
    }
  });

  test('system never auto-creates .ai-memory folder', () => {
    const { app, dir } = setupImportTest();
    const projectDir = join(dir, 'clean-project');
    mkdirSync(projectDir, { recursive: true });

    const claudeDir = join(dir, '.claude/projects/clean-project');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'session-clean.jsonl'), [
      JSON.stringify({ type: 'user', cwd: projectDir, message: { content: 'hello' }, timestamp: '2026-03-19T10:00:00Z' }),
      JSON.stringify({ type: 'assistant', message: { content: 'hi' }, timestamp: '2026-03-19T10:01:00Z' })
    ].join('\n'));

    const origHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      app.importService.importTranscripts('claude-code');
      expect(existsSync(join(projectDir, '.ai-memory'))).toBe(false);
    } finally {
      process.env.HOME = origHome;
    }
  });
});
