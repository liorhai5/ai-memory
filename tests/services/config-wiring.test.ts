import { describe, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { getDefaults, loadConfig, saveConfig, getConfigValue, setConfigValue } from '../../src/services/config-service.js';
import { createConversation } from '../test-helpers.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'ai-memory-cfg-'));
}

describe('Config service', () => {
  test('defaults match D16 approved values', () => {
    const d = getDefaults();
    expect(d.injection_max_conversations).toBe(5);
    expect(d.injection_max_title_chars).toBe(80);
    expect(d.injection_max_summary_chars).toBe(150);
    expect(d.injection_max_total_chars).toBe(1800);
    expect(d.search_default_limit).toBe(20);
  });

  test('loadConfig returns defaults when file missing', () => {
    const config = loadConfig('/tmp/nonexistent-config-path.json');
    expect(config).toEqual(getDefaults());
  });

  test('saveConfig + loadConfig round-trips', () => {
    const dir = tempDir();
    const path = join(dir, 'config.json');
    const custom = { ...getDefaults(), injection_max_conversations: 10 };
    saveConfig(custom, path);
    const loaded = loadConfig(path);
    expect(loaded.injection_max_conversations).toBe(10);
  });

  test('getConfigValue rejects unknown keys', () => {
    const result = getConfigValue('bogus_key');
    expect('error' in result).toBe(true);
  });

  test('setConfigValue validates numeric input', () => {
    const result = setConfigValue('injection_max_conversations', 'not-a-number');
    expect('error' in result).toBe(true);
  });

  test('setConfigValue persists to disk', () => {
    const dir = tempDir();
    const path = join(dir, 'config.json');
    saveConfig(getDefaults(), path);
    const result = setConfigValue('search_default_limit', '50', path);
    expect('value' in result && result.value).toBe(50);
    const reloaded = loadConfig(path);
    expect(reloaded.search_default_limit).toBe(50);
  });
});

describe('Config wiring — injection respects config values', () => {
  test('custom injection_max_conversations limits output', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'memory.db');
    const configPath = join(dir, 'config.json');
    saveConfig({ ...getDefaults(), injection_max_conversations: 2 }, configPath);

    const app = createApp(dbPath, configPath);
    for (let i = 0; i < 5; i++) {
      const c = createConversation(app, { external_id: `cfg-${i}`, workspace: 'ws' });
      app.conversationStore.setTitleIfEmpty(c.id, `conv ${i}`);
    }
    const output = app.injectionService.buildForWorkspace('ws');
    const titleLines = output.split('\n').filter((l) => l.startsWith('- "'));
    expect(titleLines.length).toBeLessThanOrEqual(2);
  });

  test('custom injection_max_total_chars caps output length', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'memory.db');
    const configPath = join(dir, 'config.json');
    saveConfig({ ...getDefaults(), injection_max_total_chars: 500 }, configPath);

    const app = createApp(dbPath, configPath);
    for (let i = 0; i < 5; i++) {
      const c = createConversation(app, { external_id: `cap-${i}`, workspace: 'ws' });
      app.conversationStore.setTitleIfEmpty(c.id, `Conversation ${i} with a longer title`);
      app.conversationStore.upsertSummary(c.id, `Summary text for conversation ${i} with details`);
    }
    const output = app.injectionService.buildForWorkspace('ws');
    expect(output.length).toBeLessThanOrEqual(500);
  });
});

describe('Config wiring — search respects config values', () => {
  test('search_default_limit controls default result count', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'memory.db');
    const configPath = join(dir, 'config.json');
    saveConfig({ ...getDefaults(), search_default_limit: 3 }, configPath);

    const app = createApp(dbPath, configPath);
    for (let i = 0; i < 10; i++) {
      const c = createConversation(app, { external_id: `srch-${i}`, workspace: 'ws' });
      app.conversationStore.addTurn({ conversation_id: c.id, role: 'user', content: `searchable keyword alpha ${i}` });
    }
    const result = app.searchService.search({ query: 'alpha' });
    expect(result.conversations.length).toBeLessThanOrEqual(3);
  });

  test('explicit limit overrides config default', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'memory.db');
    const configPath = join(dir, 'config.json');
    saveConfig({ ...getDefaults(), search_default_limit: 2 }, configPath);

    const app = createApp(dbPath, configPath);
    for (let i = 0; i < 10; i++) {
      const c = createConversation(app, { external_id: `over-${i}`, workspace: 'ws' });
      app.conversationStore.addTurn({ conversation_id: c.id, role: 'user', content: `searchable keyword beta ${i}` });
    }
    const result = app.searchService.search({ query: 'beta', limit: 7 });
    expect(result.conversations.length).toBeLessThanOrEqual(7);
    expect(result.conversations.length).toBeGreaterThan(2);
  });
});
