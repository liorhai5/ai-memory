import { describe, expect, test } from 'vitest';
import { beforeSubmitPromptHook, sessionEndHook, sessionStartHook, stopHook, turnCompleteHook } from '../../src/hooks/handlers.js';
import { createApp } from '../../src/app.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-memory-hooks-'));
  return join(dir, 'memory.db');
}

describe('Hooks pipeline (D9)', () => {
  test('session-start creates conversation and returns injection with markers', () => {
    const dbPath = tempDbPath();
    const out = sessionStartHook({
      ide: 'claude-code',
      workspace: 'workspace-a',
      session_id: 'conv-100',
      dbPath
    });
    expect(out.session_id).toBe('conv-100');
    expect(out.additional_context).toContain('p1:injected:begin');
    expect(out.additional_context).toContain('p1:injected:end');
    expect(out.additional_context).toContain('ai-memory-search');
    expect(out.additional_context).toContain('ai-memory-summarize');

    const app = createApp(dbPath);
    expect(app.conversationStore.byExternalId('conv-100')).not.toBeNull();
  });

  test('session-start resumes existing conversation by external_id (D13)', () => {
    const dbPath = tempDbPath();
    sessionStartHook({ ide: 'cursor', workspace: 'ws', session_id: 'resume-1', dbPath });
    beforeSubmitPromptHook({ prompt: 'initial prompt', session_id: 'resume-1', workspace: 'ws', dbPath });
    sessionStartHook({ ide: 'cursor', workspace: 'ws', session_id: 'resume-1', dbPath });

    const app = createApp(dbPath);
    const rows = app.db.prepare(`SELECT COUNT(*) as c FROM conversations WHERE external_id = 'resume-1'`).get() as { c: number };
    expect(rows.c).toBe(1);
  });

  test('beforeSubmitPrompt first turn sets title and summary (D5)', () => {
    const dbPath = tempDbPath();
    sessionStartHook({ ide: 'cursor', workspace: 'ws', session_id: 'first-1', dbPath });
    beforeSubmitPromptHook({
      prompt: 'This is my first prompt about building an API gateway for microservices architecture',
      session_id: 'first-1',
      workspace: 'ws',
      dbPath
    });

    const app = createApp(dbPath);
    const conv = app.conversationStore.byExternalId('first-1')!;
    expect(conv.title!.length).toBeLessThanOrEqual(80);
    expect(conv.title).toBe('This is my first prompt about building an API gateway for microservices architec');
    expect(conv.summary).toBe('This is my first prompt about building an API gateway for microservices architecture');
  });

  test('beforeSubmitPrompt strips XML wrapper tags from title and summary', () => {
    const dbPath = tempDbPath();
    sessionStartHook({ ide: 'cursor', workspace: 'ws', session_id: 'xml-strip-1', dbPath });
    beforeSubmitPromptHook({
      prompt: '<user_query>\nFix the login bug in auth module\n</user_query>',
      session_id: 'xml-strip-1',
      workspace: 'ws',
      dbPath
    });

    const app = createApp(dbPath);
    const conv = app.conversationStore.byExternalId('xml-strip-1')!;
    expect(conv.title).toBe('Fix the login bug in auth module');
    expect(conv.summary).toBe('Fix the login bug in auth module');
    expect(conv.title).not.toContain('<user_query>');
    expect(conv.summary).not.toContain('</user_query>');
  });

  test('subsequent turns do NOT overwrite title or summary (D5)', () => {
    const dbPath = tempDbPath();
    sessionStartHook({ ide: 'cursor', workspace: 'ws', session_id: 'subseq-1', dbPath });
    beforeSubmitPromptHook({ prompt: 'first prompt', session_id: 'subseq-1', workspace: 'ws', dbPath });
    beforeSubmitPromptHook({ prompt: 'second prompt', session_id: 'subseq-1', workspace: 'ws', dbPath });

    const app = createApp(dbPath);
    const conv = app.conversationStore.byExternalId('subseq-1')!;
    expect(conv.title).toBe('first prompt');
    expect(conv.summary).toBe('first prompt');
  });

  test('prompt-submit + stop capture user and assistant turns in order', () => {
    const dbPath = tempDbPath();
    sessionStartHook({ ide: 'cursor', workspace: 'ws', session_id: 'flow-1', dbPath });
    beforeSubmitPromptHook({ prompt: 'user message', session_id: 'flow-1', workspace: 'ws', dbPath });
    stopHook({ ide: 'cursor', session_id: 'flow-1', workspace: 'ws', content: 'assistant response', dbPath });
    sessionEndHook({ ide: 'cursor', session_id: 'flow-1', workspace: 'ws', content: '', dbPath });

    const app = createApp(dbPath);
    const conv = app.conversationStore.byExternalId('flow-1')!;
    const turns = app.conversationStore.listTurns(conv.id);
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(turns[0].content).toBe('user message');
    expect(turns[1].content).toBe('assistant response');
  });

  test('stop returns empty object, no followup_message (D9 no LLM orchestration)', () => {
    const dbPath = tempDbPath();
    sessionStartHook({ ide: 'cursor', workspace: 'ws', session_id: 'nofollowup-1', dbPath });
    const result = stopHook({ ide: 'cursor', session_id: 'nofollowup-1', workspace: 'ws', content: 'response', dbPath });
    expect(result).toEqual({});
    expect(result).not.toHaveProperty('followup_message');
  });

  test('stop ignores empty assistant payloads', () => {
    const dbPath = tempDbPath();
    sessionStartHook({ ide: 'cursor', workspace: 'ws', session_id: 'empty-stop-1', dbPath });
    beforeSubmitPromptHook({ prompt: 'user message', session_id: 'empty-stop-1', workspace: 'ws', dbPath });
    stopHook({ ide: 'cursor', session_id: 'empty-stop-1', workspace: 'ws', content: '   ', dbPath });

    const app = createApp(dbPath);
    const conv = app.conversationStore.byExternalId('empty-stop-1')!;
    const turns = app.conversationStore.listTurns(conv.id);
    expect(turns.map((t) => t.role)).toEqual(['user']);
  });

  test('sessionEnd does not update updated_at (D17)', () => {
    const dbPath = tempDbPath();
    sessionStartHook({ ide: 'cursor', workspace: 'ws', session_id: 'end-1', dbPath });
    beforeSubmitPromptHook({ prompt: 'msg', session_id: 'end-1', workspace: 'ws', dbPath });

    const app1 = createApp(dbPath);
    const beforeEnd = app1.conversationStore.byExternalId('end-1')!.updated_at;

    sessionEndHook({ ide: 'cursor', session_id: 'end-1', workspace: 'ws', content: '', dbPath });

    const app2 = createApp(dbPath);
    const afterEnd = app2.conversationStore.byExternalId('end-1')!.updated_at;
    expect(afterEnd).toBe(beforeEnd);
  });
});

describe('turnCompleteHook (D039 Codex)', () => {
  test('captures both user and assistant turns in one call', () => {
    const dbPath = tempDbPath();
    turnCompleteHook({
      ide: 'codex',
      session_id: 'codex-tc-1',
      workspace: 'my-project',
      prompt: 'how do I fix the build?',
      content: 'Run npm install first.',
      dbPath
    });

    const app = createApp(dbPath);
    const conv = app.conversationStore.byExternalId('codex-tc-1')!;
    expect(conv.ide).toBe('codex');
    expect(conv.workspace).toBe('my-project');
    const turns = app.conversationStore.listTurns(conv.id);
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant']);
    expect(turns[0].content).toBe('how do I fix the build?');
    expect(turns[1].content).toBe('Run npm install first.');
  });

  test('first turn sets title and summary', () => {
    const dbPath = tempDbPath();
    turnCompleteHook({
      ide: 'codex',
      session_id: 'codex-tc-title',
      workspace: 'ws',
      prompt: 'Refactor the authentication module to use JWT tokens',
      content: 'Sure, here is the plan.',
      dbPath
    });

    const app = createApp(dbPath);
    const conv = app.conversationStore.byExternalId('codex-tc-title')!;
    expect(conv.title).toBe('Refactor the authentication module to use JWT tokens');
    expect(conv.summary).toBe('Refactor the authentication module to use JWT tokens');
  });

  test('multi-turn same thread appends turns via dedup', () => {
    const dbPath = tempDbPath();
    turnCompleteHook({
      ide: 'codex',
      session_id: 'codex-tc-multi',
      workspace: 'ws',
      prompt: 'first question',
      content: 'first answer',
      dbPath
    });
    turnCompleteHook({
      ide: 'codex',
      session_id: 'codex-tc-multi',
      workspace: 'ws',
      prompt: 'second question',
      content: 'second answer',
      dbPath
    });

    const app = createApp(dbPath);
    const conv = app.conversationStore.byExternalId('codex-tc-multi')!;
    const turns = app.conversationStore.listTurns(conv.id);
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(turns[0].content).toBe('first question');
    expect(turns[2].content).toBe('second question');
    // Title stays as first prompt
    expect(conv.title).toBe('first question');
  });

  test('skips empty prompt or content', () => {
    const dbPath = tempDbPath();
    turnCompleteHook({
      ide: 'codex',
      session_id: 'codex-tc-empty',
      workspace: 'ws',
      prompt: '',
      content: 'assistant only',
      dbPath
    });

    const app = createApp(dbPath);
    const conv = app.conversationStore.byExternalId('codex-tc-empty')!;
    const turns = app.conversationStore.listTurns(conv.id);
    expect(turns.map(t => t.role)).toEqual(['assistant']);
  });
});
