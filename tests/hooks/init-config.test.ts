import { describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateInitConfig } from '../../src/hooks/init-config.js';

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hasGroupedCommand(entries: any, command: string, matcher?: string): boolean {
  if (!Array.isArray(entries)) return false;
  return entries.some((group: any) => {
    if (!group || typeof group !== 'object') return false;
    if (typeof matcher !== 'undefined' && group.matcher !== matcher) return false;
    if (!Array.isArray(group.hooks)) return false;
    return group.hooks.some((hook: any) => hook?.type === 'command' && hook?.command === command);
  });
}

describe('generateInitConfig (Claude Code hooks schema)', () => {
  test('writes matcher-group hook format for Claude Code', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-init-config-claude-'));
    const settingsPath = join(home, '.claude', 'settings.json');
    generateInitConfig({ ide: 'claude-code', filePath: settingsPath });

    const json = readJson(settingsPath);
    expect(hasGroupedCommand(json.hooks?.SessionStart, 'ai-memory hook session-start --ide claude-code', 'startup|resume|clear|compact')).toBe(true);
    expect(hasGroupedCommand(json.hooks?.UserPromptSubmit, 'ai-memory hook prompt-submit --ide claude-code')).toBe(true);
    expect(hasGroupedCommand(json.hooks?.Stop, 'ai-memory hook stop --ide claude-code')).toBe(true);
    expect(hasGroupedCommand(json.hooks?.SessionEnd, 'ai-memory hook session-end --ide claude-code')).toBe(true);
    expect(json.mcpServers?.['ai-memory']).toEqual({ command: 'ai-memory', args: ['mcp'] });
  });

  test('is idempotent and does not duplicate Claude hook commands', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-init-config-claude-idempotent-'));
    const settingsPath = join(home, '.claude', 'settings.json');
    generateInitConfig({ ide: 'claude-code', filePath: settingsPath });
    generateInitConfig({ ide: 'claude-code', filePath: settingsPath });

    const json = readJson(settingsPath);
    const cmd = 'ai-memory hook prompt-submit --ide claude-code';
    const groups = (json.hooks?.UserPromptSubmit ?? []) as any[];
    let count = 0;
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) continue;
      count += group.hooks.filter((hook: any) => hook?.command === cmd).length;
    }
    expect(count).toBe(1);
  });
});
