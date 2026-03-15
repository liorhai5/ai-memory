import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  registerCursorMcp,
  registerCodexMcp,
  writeSkills,
  SKILL_DEFINITIONS
} from '../../src/mcp/init-config.js';

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// D044: MCP registration tests

describe('registerCursorMcp', () => {
  test('creates mcp.json with ai-memory MCP entry', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-cursor-mcp-'));
    const mcpPath = join(home, '.cursor', 'mcp.json');
    const result = registerCursorMcp(mcpPath);

    expect(result.updated).toBe(true);
    expect(existsSync(mcpPath)).toBe(true);
    const json = readJson(mcpPath);
    expect(json.mcpServers?.['ai-memory']).toEqual({ command: 'ai-memory', args: ['mcp'] });
  });

  test('is idempotent — does not duplicate if already present', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-cursor-mcp-idempotent-'));
    const mcpPath = join(home, '.cursor', 'mcp.json');
    registerCursorMcp(mcpPath);
    const result = registerCursorMcp(mcpPath);

    expect(result.updated).toBe(false);
    const json = readJson(mcpPath);
    expect(json.mcpServers?.['ai-memory']).toEqual({ command: 'ai-memory', args: ['mcp'] });
  });
});

describe('registerCodexMcp', () => {
  const MCP_HEADER = '[mcp_servers.ai-memory]';

  test('creates config.toml with MCP section when file does not exist', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-codex-mcp-'));
    const configPath = join(home, '.codex', 'config.toml');
    const result = registerCodexMcp(configPath);

    expect(result.status).toBe('created');
    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain(MCP_HEADER);
    expect(content).toContain('command = "ai-memory"');
    expect(content).toContain('args = ["mcp"]');
  });

  test('does not write notify line', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-codex-mcp-no-notify-'));
    const configPath = join(home, '.codex', 'config.toml');
    registerCodexMcp(configPath);
    const content = readFileSync(configPath, 'utf8');
    expect(content).not.toContain('notify');
  });

  test('is idempotent — returns exists when MCP section already present', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-codex-mcp-idempotent-'));
    const configPath = join(home, '.codex', 'config.toml');
    registerCodexMcp(configPath);
    const result = registerCodexMcp(configPath);
    expect(result.status).toBe('exists');
  });

  test('adds MCP section to existing config without clobbering existing content', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-memory-codex-mcp-preserve-'));
    const dir = join(home, '.codex');
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, 'config.toml');
    writeFileSync(configPath, 'model = "gpt-4o"\n');

    registerCodexMcp(configPath);

    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain('model = "gpt-4o"');
    expect(content).toContain(MCP_HEADER);
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
