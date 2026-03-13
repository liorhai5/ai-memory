import { describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateInitConfig, generateCodexConfig, writeSkills, SKILL_DEFINITIONS } from '../../src/hooks/init-config.js';

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

describe('generateCodexConfig', () => {
  const NOTIFY_LINE = 'notify = ["ai-memory", "hook", "turn-complete", "--ide", "codex"]';
  const MCP_HEADER = '[mcp_servers.ai-memory]';

  test('creates config.toml with notify line and MCP section when file does not exist', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-codex-init-'));
    const configPath = join(home, '.codex', 'config.toml');
    const result = generateCodexConfig(configPath);

    expect(result.status).toBe('created');
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain(NOTIFY_LINE);
    expect(content).toContain(MCP_HEADER);
    expect(content).toContain('command = "ai-memory"');
    expect(content).toContain('args = ["mcp"]');
  });

  test('is idempotent — returns exists when both notify and MCP are set', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-codex-idempotent-'));
    const configPath = join(home, '.codex', 'config.toml');
    generateCodexConfig(configPath);
    const result = generateCodexConfig(configPath);

    expect(result.status).toBe('exists');
  });

  test('replaces existing notify line with different value', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-codex-replace-'));
    const dir = join(home, '.codex');
    const configPath = join(dir, 'config.toml');
    const { mkdirSync: mk, writeFileSync: wf } = require('node:fs');
    mk(dir, { recursive: true });
    wf(configPath, 'model = "gpt-5.3"\nnotify = ["some-other-tool"]\n');

    const result = generateCodexConfig(configPath);
    expect(result.status).toBe('created');
    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain(NOTIFY_LINE);
    expect(content).not.toContain('some-other-tool');
    expect(content).toContain('model = "gpt-5.3"');
    expect(content).toContain(MCP_HEADER);
  });

  test('preserves existing config and inserts before section headers', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-codex-preserve-'));
    const dir = join(home, '.codex');
    const configPath = join(dir, 'config.toml');
    const { mkdirSync: mk, writeFileSync: wf } = require('node:fs');
    mk(dir, { recursive: true });
    wf(configPath, 'model = "gpt-5.3"\n\n[features]\ncodex_hooks = true\n');

    const result = generateCodexConfig(configPath);
    expect(result.status).toBe('created');
    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain(NOTIFY_LINE);
    expect(content).toContain('[features]');
    expect(content).toContain('model = "gpt-5.3"');
    expect(content).toContain(MCP_HEADER);
    const notifyIdx = content.indexOf(NOTIFY_LINE);
    const featuresIdx = content.indexOf('[features]');
    expect(notifyIdx).toBeLessThan(featuresIdx);
  });

  test('adds MCP section to existing file that already has notify (D042 upgrade path)', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-codex-mcp-upgrade-'));
    const dir = join(home, '.codex');
    const configPath = join(dir, 'config.toml');
    const { mkdirSync: mk, writeFileSync: wf } = require('node:fs');
    mk(dir, { recursive: true });
    // Simulate pre-D042 config: notify present, no MCP
    wf(configPath, `model = "gpt-5.3"\n${NOTIFY_LINE}\n\n[features]\ncodex_hooks = true\n`);

    const result = generateCodexConfig(configPath);
    expect(result.status).toBe('updated');
    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain(NOTIFY_LINE);
    expect(content).toContain(MCP_HEADER);
    expect(content).toContain('[features]');
  });

  test('skips MCP section if already present', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-codex-mcp-exists-'));
    const dir = join(home, '.codex');
    const configPath = join(dir, 'config.toml');
    const { mkdirSync: mk, writeFileSync: wf } = require('node:fs');
    mk(dir, { recursive: true });
    const existing = `${NOTIFY_LINE}\n\n${MCP_HEADER}\ncommand = "ai-memory"\nargs = ["mcp"]\n`;
    wf(configPath, existing);

    const result = generateCodexConfig(configPath);
    expect(result.status).toBe('exists');
    // Content unchanged
    expect(readFileSync(configPath, 'utf8')).toBe(existing);
  });
});

describe('writeSkills (D040)', () => {
  const SKILL_NAMES = ['ai-memory-status', 'ai-memory-search', 'ai-memory-recent', 'ai-memory-summarize'];

  test('creates 4 SKILL.md files for cursor', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-skills-cursor-'));
    const result = writeSkills('cursor', home);

    expect(result.written.sort()).toEqual(SKILL_NAMES.sort());
    expect(result.skipped).toEqual([]);
    for (const name of SKILL_NAMES) {
      const file = join(home, '.cursor', 'skills', name, 'SKILL.md');
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe(SKILL_DEFINITIONS[name]);
    }
  });

  test('creates 4 SKILL.md files for claude-code', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-skills-claude-'));
    const result = writeSkills('claude-code', home);

    expect(result.written.sort()).toEqual(SKILL_NAMES.sort());
    for (const name of SKILL_NAMES) {
      const file = join(home, '.claude', 'skills', name, 'SKILL.md');
      expect(existsSync(file)).toBe(true);
    }
  });

  test('creates 4 SKILL.md files for codex in ~/.agents/skills/', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-skills-codex-'));
    const result = writeSkills('codex', home);

    expect(result.written.sort()).toEqual(SKILL_NAMES.sort());
    for (const name of SKILL_NAMES) {
      const file = join(home, '.agents', 'skills', name, 'SKILL.md');
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe(SKILL_DEFINITIONS[name]);
    }
  });

  test('is idempotent — skips identical files', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-skills-idempotent-'));
    writeSkills('cursor', home);
    const result = writeSkills('cursor', home);

    expect(result.written).toEqual([]);
    expect(result.skipped.sort()).toEqual(SKILL_NAMES.sort());
  });

  test('overwrites changed files', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-skills-overwrite-'));
    writeSkills('cursor', home);

    const file = join(home, '.cursor', 'skills', 'ai-memory-status', 'SKILL.md');
    writeFileSync(file, 'modified content');

    const result = writeSkills('cursor', home);
    expect(result.written).toContain('ai-memory-status');
    expect(readFileSync(file, 'utf8')).toBe(SKILL_DEFINITIONS['ai-memory-status']);
  });

  test('each SKILL.md has valid frontmatter with required fields', () => {
    for (const [name, content] of Object.entries(SKILL_DEFINITIONS)) {
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch, `${name} should have frontmatter`).not.toBeNull();
      const fm = fmMatch![1];
      expect(fm).toContain(`name: ${name}`);
      expect(fm).toContain('description:');
      expect(fm).toContain('disable-model-invocation: true');
    }
  });

  test('search skill contains $ARGUMENTS placeholder', () => {
    const content = SKILL_DEFINITIONS['ai-memory-search'];
    expect(content).toContain('$ARGUMENTS');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch![1]).toContain('argument-hint:');
  });
});
