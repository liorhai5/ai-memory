import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IdeType } from '../types.js';

function hasCursorCommand(entries: any, cmd: string): boolean {
  return Array.isArray(entries) && entries.some((e: any) => e?.command === cmd);
}

function hasClaudeGroupedCommand(entries: any, cmd: string): boolean {
  if (!Array.isArray(entries)) return false;
  return entries.some((group: any) => {
    if (!group || typeof group !== 'object') return false;
    if (!Array.isArray(group.hooks)) return false;
    return group.hooks.some((hook: any) => hook?.command === cmd);
  });
}

export function generateInitConfig(input: { ide: 'cursor' | 'claude-code'; filePath: string; mcpFilePath?: string }): { updated: boolean } {
  const dir = dirname(input.filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let data: any = {};
  if (existsSync(input.filePath)) {
    data = JSON.parse(readFileSync(input.filePath, 'utf8'));
  }

  const mcpEntry = { command: 'ai-memory', args: ['mcp'] };

  if (input.ide === 'cursor') {
    // D25: Cursor format — { version: 1, hooks: { sessionStart: [{ command: "..." }], ... } }
    data.version ??= 1;
    data.hooks ??= {};
    data.hooks.beforeSubmitPrompt ??= [];
    data.hooks.sessionStart ??= [];
    data.hooks.stop ??= [];
    data.hooks.afterAgentResponse ??= [];
    data.hooks.sessionEnd ??= [];
    const cursorCmd = (name: string) => `ai-memory hook ${name} --ide cursor`;
    if (!hasCursorCommand(data.hooks.beforeSubmitPrompt, cursorCmd('prompt-submit'))) {
      data.hooks.beforeSubmitPrompt.push({ command: cursorCmd('prompt-submit') });
    }
    if (!hasCursorCommand(data.hooks.sessionStart, cursorCmd('session-start'))) {
      data.hooks.sessionStart.push({ command: cursorCmd('session-start') });
    }
    if (!hasCursorCommand(data.hooks.stop, cursorCmd('stop'))) {
      data.hooks.stop.push({ command: cursorCmd('stop') });
    }
    // D038 D1: afterAgentResponse captures assistant content (Cursor sends stdin.text)
    if (!hasCursorCommand(data.hooks.afterAgentResponse, cursorCmd('afterAgentResponse'))) {
      data.hooks.afterAgentResponse.push({ command: cursorCmd('afterAgentResponse') });
    }
    if (!hasCursorCommand(data.hooks.sessionEnd, cursorCmd('session-end'))) {
      data.hooks.sessionEnd.push({ command: cursorCmd('session-end') });
    }

    // D20/006: Cursor MCP config is a separate file (~/.cursor/mcp.json)
    if (input.mcpFilePath) {
      const mcpDir = dirname(input.mcpFilePath);
      if (!existsSync(mcpDir)) mkdirSync(mcpDir, { recursive: true });
      let mcpData: any = {};
      if (existsSync(input.mcpFilePath)) {
        mcpData = JSON.parse(readFileSync(input.mcpFilePath, 'utf8'));
      }
      mcpData.mcpServers ??= {};
      if (!mcpData.mcpServers['ai-memory']) {
        mcpData.mcpServers['ai-memory'] = mcpEntry;
      }
      writeFileSync(input.mcpFilePath, JSON.stringify(mcpData, null, 2));
    }
  } else {
    data.hooks ??= {};
    const sessionStartMatcher = 'startup|resume|clear|compact';
    const isOldFormatAiMemory = (e: any) =>
      e && typeof e.command === 'string' && e.command.startsWith('ai-memory') && !Array.isArray(e.hooks);
    for (const event of ['UserPromptSubmit', 'SessionStart', 'Stop', 'SessionEnd'] as const) {
      data.hooks[event] = (data.hooks[event] ?? []).filter((e: any) => !isOldFormatAiMemory(e));
    }
    const ccCmd = (name: string) => `ai-memory hook ${name} --ide claude-code`;
    if (!hasClaudeGroupedCommand(data.hooks.UserPromptSubmit, ccCmd('prompt-submit'))) {
      data.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: ccCmd('prompt-submit') }] });
    }
    if (!hasClaudeGroupedCommand(data.hooks.SessionStart, ccCmd('session-start'))) {
      data.hooks.SessionStart.push({
        matcher: sessionStartMatcher,
        hooks: [{ type: 'command', command: ccCmd('session-start') }]
      });
    } else {
      data.hooks.SessionStart = data.hooks.SessionStart.map((group: any) => {
        if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) return group;
        const hasOurCommand = group.hooks.some((hook: any) => hook?.command === ccCmd('session-start'));
        if (!hasOurCommand) return group;
        return { ...group, matcher: sessionStartMatcher };
      });
    }
    if (!hasClaudeGroupedCommand(data.hooks.Stop, ccCmd('stop'))) {
      data.hooks.Stop.push({ hooks: [{ type: 'command', command: ccCmd('stop') }] });
    }
    if (!hasClaudeGroupedCommand(data.hooks.SessionEnd, ccCmd('session-end'))) {
      data.hooks.SessionEnd.push({ hooks: [{ type: 'command', command: ccCmd('session-end') }] });
    }

    // D20/006: Claude Code MCP config is in same settings.json
    data.mcpServers ??= {};
    if (!data.mcpServers['ai-memory']) {
      data.mcpServers['ai-memory'] = mcpEntry;
    }
  }

  writeFileSync(input.filePath, JSON.stringify(data, null, 2));
  return { updated: true };
}

// D038 D14: Validate hooks are registered in config files
// D038 D16: Lightweight config presence check for session-start drift detection
export function checkHookPresence(ide: 'cursor' | 'claude-code', filePath: string): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!existsSync(filePath)) return { ok: false, missing: [`config file missing: ${filePath}`] };

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (ide === 'cursor') {
      const cursorCmd = (name: string) => `ai-memory hook ${name} --ide cursor`;
      const required: [string, string][] = [
        ['beforeSubmitPrompt', cursorCmd('prompt-submit')],
        ['sessionStart', cursorCmd('session-start')],
        ['stop', cursorCmd('stop')],
        ['afterAgentResponse', cursorCmd('afterAgentResponse')],
        ['sessionEnd', cursorCmd('session-end')]
      ];
      for (const [event, cmd] of required) {
        if (!hasCursorCommand(data?.hooks?.[event], cmd)) {
          missing.push(`cursor hooks.${event}: ${cmd}`);
        }
      }
    } else {
      const ccCmd = (name: string) => `ai-memory hook ${name} --ide claude-code`;
      const required: [string, string][] = [
        ['UserPromptSubmit', ccCmd('prompt-submit')],
        ['SessionStart', ccCmd('session-start')],
        ['Stop', ccCmd('stop')],
        ['SessionEnd', ccCmd('session-end')]
      ];
      for (const [event, cmd] of required) {
        if (!hasClaudeGroupedCommand(data?.hooks?.[event], cmd)) {
          missing.push(`claude-code hooks.${event}: ${cmd}`);
        }
      }
    }
  } catch {
    return { ok: false, missing: [`config file parse error: ${filePath}`] };
  }

  return { ok: missing.length === 0, missing };
}

// D040: Skill definitions — user-triggered slash commands generated by `ai-memory init`
export const SKILL_DEFINITIONS: Record<string, string> = {
  'ai-memory-status': `---
name: ai-memory-status
description: Quick health check — conversation count, turn count, tool usage stats
disable-model-invocation: true
---
Call the ai-memory-status tool and present the results as a brief, readable summary.
Show conversation count, turn count, DB path, and tool usage stats.
`,
  'ai-memory-search': `---
name: ai-memory-search
description: Search conversation history by keyword
argument-hint: "[query]"
disable-model-invocation: true
---
Search ai-memory for: $ARGUMENTS

Call ai-memory-search with the query and present results showing conversation titles, dates, and matching snippets.
`,
  'ai-memory-recent': `---
name: ai-memory-recent
description: Recent conversations — titles, summaries, dates
disable-model-invocation: true
---
Call ai-memory-conversations with limit 10 and present the results as a readable list.
Show title, date, and summary for each conversation.
`,
  'ai-memory-summarize': `---
name: ai-memory-summarize
description: Summarize this conversation and save it via ai-memory
disable-model-invocation: true
---
Summarize this conversation and save it to ai-memory:
1. Call ai-memory-conversations (limit 5) to find the current conversation by matching the title or most recent timestamp.
2. Write a progressive summary: start with a one-line overview, then key decisions and open items. Be specific — include names, choices, and reasoning.
3. Write a concise title (~60 chars) that reflects the current topic.
4. Call ai-memory-summarize with the conversation_id, your summary text, and the title.
`,
};

function ideSkillsDir(ide: IdeType, home: string): string {
  // Codex reads user skills from ~/.agents/skills/ (Agent Skills standard), not ~/.codex/skills/
  if (ide === 'codex') return join(home, '.agents', 'skills');
  const ideDir = ide === 'claude-code' ? '.claude' : '.cursor';
  return join(home, ideDir, 'skills');
}

const CODEX_NOTIFY_ARGS = '["ai-memory", "hook", "turn-complete", "--ide", "codex"]';
const CODEX_NOTIFY_LINE = `notify = ${CODEX_NOTIFY_ARGS}`;

const CODEX_MCP_SECTION_HEADER = '[mcp_servers.ai-memory]';
const CODEX_MCP_SECTION = `\n${CODEX_MCP_SECTION_HEADER}\ncommand = "ai-memory"\nargs = ["mcp"]\n`;

export function generateCodexConfig(configPath: string): { status: 'created' | 'updated' | 'exists' } {
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let content = '';
  const fileExisted = existsSync(configPath);
  if (fileExisted) {
    content = readFileSync(configPath, 'utf8');
  }

  const hasNotify = content.includes(CODEX_NOTIFY_LINE);
  const hasMcp = content.includes(CODEX_MCP_SECTION_HEADER);

  if (hasNotify && hasMcp) {
    return { status: 'exists' };
  }

  // Add notify line if missing
  if (!hasNotify) {
    const notifyRegex = /^notify\s*=.*$/m;
    if (notifyRegex.test(content)) {
      content = content.replace(notifyRegex, CODEX_NOTIFY_LINE);
    } else {
      const sectionIndex = content.indexOf('\n[');
      if (sectionIndex !== -1) {
        content = content.slice(0, sectionIndex) + '\n' + CODEX_NOTIFY_LINE + content.slice(sectionIndex);
      } else {
        content = (content.length > 0 ? content.trimEnd() + '\n' : '') + CODEX_NOTIFY_LINE + '\n';
      }
    }
  }

  // D042: Add MCP server section if missing
  if (!hasMcp) {
    content = content.trimEnd() + '\n' + CODEX_MCP_SECTION;
  }

  writeFileSync(configPath, content);
  return { status: fileExisted && hasNotify ? 'updated' : 'created' };
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
