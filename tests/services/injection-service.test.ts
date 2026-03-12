import { describe, expect, test } from 'vitest';
import { createConversation, createTempApp } from '../test-helpers.js';
import { getDefaults } from '../../src/services/config-service.js';

describe('InjectionService (D6, D16)', () => {
  test('includes workspace-first conversations then other recent', () => {
    const { app } = createTempApp();
    const c1 = createConversation(app, { external_id: 'inj-1', workspace: 'target' });
    app.conversationStore.setTitleIfEmpty(c1.id, 'Target conversation');
    const c2 = createConversation(app, { external_id: 'inj-2', workspace: 'other-ws' });
    app.conversationStore.setTitleIfEmpty(c2.id, 'Other conversation');

    const output = app.injectionService.buildForWorkspace('target');
    const targetIdx = output.indexOf('"Target conversation"');
    const otherIdx = output.indexOf('"Other conversation"');
    expect(targetIdx).toBeGreaterThan(-1);
    expect(otherIdx).toBeGreaterThan(-1);
    expect(targetIdx).toBeLessThan(otherIdx);
    expect(output).toContain('Other recent:');
  });

  test('includes tool reminders (D5b)', () => {
    const { app } = createTempApp();
    const output = app.injectionService.buildForWorkspace('ws');
    expect(output).toContain('Use ai-memory-search to find past conversations.');
    expect(output).toContain('Use ai-memory-summarize after key progress.');
  });

  test('truncates titles to max_title_chars (D16)', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 'long-title', workspace: 'ws' });
    const longTitle = 'A'.repeat(200);
    app.conversationStore.setTitleIfEmpty(conv.id, longTitle);
    const output = app.injectionService.buildForWorkspace('ws');
    expect(output).not.toContain(longTitle);
    expect(output.length).toBeLessThan(longTitle.length + 500);
  });

  test('truncates summaries to max_summary_chars (D16)', () => {
    const { app } = createTempApp();
    const conv = createConversation(app, { external_id: 'long-summ', workspace: 'ws' });
    app.conversationStore.setTitleIfEmpty(conv.id, 'title');
    app.conversationStore.upsertSummary(conv.id, 'X'.repeat(500));
    const output = app.injectionService.buildForWorkspace('ws');
    const summaryLine = output.split('\n').find((l) => l.includes('  ->'));
    expect(summaryLine).toBeDefined();
    expect(summaryLine!.length).toBeLessThanOrEqual(getDefaults().injection_max_summary_chars + 10);
  });

  test('enforces max_total_chars hard limit (D16)', () => {
    const { app } = createTempApp();
    for (let i = 0; i < 10; i++) {
      const c = createConversation(app, { external_id: `cap-${i}`, workspace: i < 3 ? 'ws' : `other-${i}` });
      app.conversationStore.setTitleIfEmpty(c.id, `Conversation title number ${i} with extra text`);
      app.conversationStore.upsertSummary(c.id, `Summary for conversation ${i} that includes important details about decisions and progress made during the session`);
    }
    const output = app.injectionService.buildForWorkspace('ws');
    expect(output.length).toBeLessThanOrEqual(getDefaults().injection_max_total_chars);
  });

  test('limits to max_conversations (D16)', () => {
    const { app } = createTempApp();
    for (let i = 0; i < 10; i++) {
      const c = createConversation(app, { external_id: `limit-${i}`, workspace: 'ws' });
      app.conversationStore.setTitleIfEmpty(c.id, `conv ${i}`);
    }
    const output = app.injectionService.buildForWorkspace('ws');
    const titleLines = output.split('\n').filter((l) => l.startsWith('- "'));
    expect(titleLines.length).toBeLessThanOrEqual(getDefaults().injection_max_conversations);
  });

  test('handles empty state gracefully', () => {
    const { app } = createTempApp();
    const output = app.injectionService.buildForWorkspace('empty-ws');
    expect(output).toContain('p1:injected:begin');
    expect(output).toContain('[no recent conversations]');
  });
});
