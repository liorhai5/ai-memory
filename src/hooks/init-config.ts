import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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
    data.hooks.sessionStart ??= [];
    data.hooks.stop ??= [];
    data.hooks.sessionEnd ??= [];
    const cursorCmd = (name: string) => `ai-memory hook ${name} --ide cursor`;
    if (!data.hooks.sessionStart.some((e: any) => e.command === cursorCmd('session-start'))) {
      data.hooks.sessionStart.push({ command: cursorCmd('session-start') });
    }
    if (!data.hooks.stop.some((e: any) => e.command === cursorCmd('stop'))) {
      data.hooks.stop.push({ command: cursorCmd('stop') });
    }
    if (!data.hooks.sessionEnd.some((e: any) => e.command === cursorCmd('session-end'))) {
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
    // D25: Claude Code format — { hooks: { SessionStart: [{ type: "command", command: "..." }], ... } }
    data.hooks ??= {};
    data.hooks.SessionStart ??= [];
    data.hooks.Stop ??= [];
    data.hooks.SessionEnd ??= [];
    const ccCmd = (name: string) => `ai-memory hook ${name} --ide claude-code`;
    if (!data.hooks.SessionStart.some((e: any) => e.command === ccCmd('session-start'))) {
      data.hooks.SessionStart.push({ type: 'command', command: ccCmd('session-start') });
    }
    if (!data.hooks.Stop.some((e: any) => e.command === ccCmd('stop'))) {
      data.hooks.Stop.push({ type: 'command', command: ccCmd('stop') });
    }
    if (!data.hooks.SessionEnd.some((e: any) => e.command === ccCmd('session-end'))) {
      data.hooks.SessionEnd.push({ type: 'command', command: ccCmd('session-end') });
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
