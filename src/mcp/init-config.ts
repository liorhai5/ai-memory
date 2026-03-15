import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IdeType } from '../types.js';
import { SKILL_DEFINITIONS } from '../skills/definitions.js';

const CODEX_MCP_SECTION_HEADER = '[mcp_servers.ai-memory]';
const CODEX_MCP_SECTION = `\n${CODEX_MCP_SECTION_HEADER}\ncommand = "ai-memory"\nargs = ["mcp"]\n`;

// Registers MCP server for Cursor (writes to mcp.json)
export function registerCursorMcp(mcpFilePath: string): { updated: boolean } {
  const dir = dirname(mcpFilePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let mcpData: any = {};
  if (existsSync(mcpFilePath)) {
    mcpData = JSON.parse(readFileSync(mcpFilePath, 'utf8'));
  }
  mcpData.mcpServers ??= {};
  if (mcpData.mcpServers['ai-memory']) return { updated: false };
  mcpData.mcpServers['ai-memory'] = { command: 'ai-memory', args: ['mcp'] };
  writeFileSync(mcpFilePath, JSON.stringify(mcpData, null, 2));
  return { updated: true };
}

// Registers MCP server for Codex (writes [mcp_servers.ai-memory] to config.toml)
export function registerCodexMcp(configPath: string): { status: 'created' | 'updated' | 'exists' } {
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let content = '';
  const fileExisted = existsSync(configPath);
  if (fileExisted) {
    content = readFileSync(configPath, 'utf8');
  }

  if (content.includes(CODEX_MCP_SECTION_HEADER)) {
    return { status: 'exists' };
  }

  content = content.trimEnd() + '\n' + CODEX_MCP_SECTION;
  writeFileSync(configPath, content);
  return { status: fileExisted ? 'updated' : 'created' };
}

// D046: SKILL_DEFINITIONS imported from ../skills/definitions.js
export { SKILL_DEFINITIONS } from '../skills/definitions.js';

function ideSkillsDir(ide: IdeType, home: string): string {
  // Codex reads user skills from ~/.agents/skills/ (Agent Skills standard), not ~/.codex/skills/
  if (ide === 'codex') return join(home, '.agents', 'skills');
  const ideDir = ide === 'claude-code' ? '.claude' : '.cursor';
  return join(home, ideDir, 'skills');
}

export function writeSkills(ide: IdeType, home: string): { written: string[]; skipped: string[] } {
  const baseDir = ideSkillsDir(ide, home);
  const written: string[] = [];
  const skipped: string[] = [];

  for (const [name, content] of Object.entries(SKILL_DEFINITIONS)) {
    const dir = join(baseDir, name);
    const file = join(dir, 'SKILL.md');
    mkdirSync(dir, { recursive: true });

    if (existsSync(file) && readFileSync(file, 'utf8') === content) {
      skipped.push(name);
    } else {
      writeFileSync(file, content);
      written.push(name);
    }
  }

  return { written, skipped };
}
