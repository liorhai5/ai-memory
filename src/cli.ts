#!/usr/bin/env node
import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createApp } from './app.js';
import { getConfigValue, setConfigValue, loadConfig, saveConfig } from './services/config-service.js';
import { beforeSubmitPromptHook, sessionStartHook, stopHook, sessionEndHook, turnCompleteHook } from './hooks/handlers.js';
import { deriveProjectKey, normalizeWorkspaceLabel } from './utils/workspace-identity.js';
import { generateInitConfig, generateCodexConfig, checkHookPresence, writeSkills } from './hooks/init-config.js';
import { stripPromptWrappers } from './utils/strip.js';
import type { IdeType } from './types.js';
import { newId } from './utils/id.js';
import { parseUsageRange } from './services/usage-service.js';

function out(data: unknown, json = false): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

const dbPath = process.env.AI_MEMORY_DB_PATH || join(homedir(), '.ai-memory/services/memory.db');

// Lazy app creation — init must run before the DB directory exists
let _app: ReturnType<typeof createApp> | null = null;
function getApp(): ReturnType<typeof createApp> {
  if (!_app) _app = createApp(dbPath);
  return _app;
}

function ensureClaudeRegistryFile(home: string): 'created' | 'exists' {
  const registryPath = join(home, '.claude.json');
  let data: any = {};
  if (existsSync(registryPath)) {
    try {
      data = JSON.parse(readFileSync(registryPath, 'utf8'));
    } catch {
      data = {};
    }
  }
  data.mcpServers ??= {};
  if (data.mcpServers['ai-memory']) return 'exists';
  data.mcpServers['ai-memory'] = { command: 'ai-memory', args: ['mcp'] };
  writeFileSync(registryPath, JSON.stringify(data, null, 2));
  return 'created';
}

function syncClaudeRuntimeMcp(home: string): { path: string; status: 'created' | 'exists' } {
  const registryPath = join(home, '.claude.json');
  const env = { ...process.env, HOME: home };
  const claudeVersion = spawnSync('claude', ['--version'], { encoding: 'utf8', env });
  if (claudeVersion.status === 0) {
    const existsCheck = spawnSync('claude', ['mcp', 'get', 'ai-memory'], { encoding: 'utf8', env });
    if (existsCheck.status === 0) {
      return { path: registryPath, status: 'exists' };
    }
    const add = spawnSync('claude', ['mcp', 'add', '-s', 'user', 'ai-memory', '--', 'ai-memory', 'mcp'], {
      encoding: 'utf8',
      env
    });
    if (add.status === 0) {
      return { path: registryPath, status: 'created' };
    }
  }

  // Fallback path for environments where `claude mcp` is unavailable.
  return { path: registryPath, status: ensureClaudeRegistryFile(home) };
}


const program = new Command();
program.name('ai-memory').description('ai-memory conversation memory CLI').version('0.2.0');

program
  .command('init')
  .option('--ide <ide>', 'Generate IDE hook config: cursor | claude-code | codex | all')
  .option('--reset-db', 'Backup old DB and reset to new schema')
  .option('--json')
  .action((opts) => {
    const home = homedir();
    const aiMemoryDir = join(home, '.ai-memory');
    const servicesDir = join(aiMemoryDir, 'services');
    const phases: { phase: string; path: string; status: 'created' | 'updated' | 'exists' }[] = [];

    // Phase 1: Directory structure
    for (const dir of [aiMemoryDir, servicesDir]) {
      const existed = existsSync(dir);
      if (!existed) mkdirSync(dir, { recursive: true });
      phases.push({ phase: 'directory', path: dir, status: existed ? 'exists' : 'created' });
    }

    // Phase 2: Database (optional backup + reset)
    const dbExisted = existsSync(dbPath);
    if (opts.resetDb && dbExisted) {
      copyFileSync(dbPath, `${dbPath}.pre-011`);
      phases.push({ phase: 'backup', path: `${dbPath}.pre-011`, status: 'created' });
    }
    createApp(dbPath);
    phases.push({ phase: 'database', path: dbPath, status: dbExisted ? 'exists' : 'created' });

    // Phase 3: Config
    const configFile = join(aiMemoryDir, 'config.json');
    const configExisted = existsSync(configFile);
    if (!configExisted) {
      saveConfig(loadConfig());
    }
    phases.push({ phase: 'config', path: configFile, status: configExisted ? 'exists' : 'created' });

    // Phase 4-5: IDE hooks + MCP (resolve --ide all to detected IDEs)
    let ides: IdeType[] = [];
    if (opts.ide === 'all') {
      if (existsSync(join(home, '.cursor'))) ides.push('cursor');
      if (existsSync(join(home, '.claude'))) ides.push('claude-code');
      if (existsSync(join(home, '.codex'))) ides.push('codex');
      if (ides.length === 0) {
        phases.push({ phase: 'ide-detection', path: home, status: 'exists' });
      }
    } else if (opts.ide) {
      const validIdes = ['cursor', 'claude-code', 'codex'] as const;
      if (!validIdes.includes(opts.ide)) {
        console.error(`Error: unknown IDE "${opts.ide}". Valid options: ${validIdes.join(', ')}, all`);
        process.exit(1);
      }
      ides = [opts.ide as IdeType];
    }

    for (const ide of ides) {
      if (ide === 'cursor') {
        const hooksPath = join(home, '.cursor/hooks.json');
        const mcpPath = join(home, '.cursor/mcp.json');
        generateInitConfig({ ide: 'cursor', filePath: hooksPath, mcpFilePath: mcpPath });
        phases.push({ phase: 'hooks', path: hooksPath, status: 'created' });
        phases.push({ phase: 'mcp', path: mcpPath, status: 'created' });
      } else if (ide === 'claude-code') {
        const settingsPath = join(home, '.claude/settings.json');
        generateInitConfig({ ide: 'claude-code', filePath: settingsPath });
        phases.push({ phase: 'hooks+mcp', path: settingsPath, status: 'created' });
        const runtimeMcp = syncClaudeRuntimeMcp(home);
        phases.push({ phase: 'mcp-runtime', path: runtimeMcp.path, status: runtimeMcp.status });
      } else if (ide === 'codex') {
        const configPath = join(home, '.codex/config.toml');
        const codexResult = generateCodexConfig(configPath);
        phases.push({ phase: 'notify', path: configPath, status: codexResult.status });
      }

      // D040: Write skill files for slash command support
      const skills = writeSkills(ide, home);
      const skillBase = ide === 'codex' ? '~/.agents/skills' : `~/.${ide === 'claude-code' ? 'claude' : ide}/skills`;
      for (const name of skills.written) {
        phases.push({ phase: 'skill', path: `${skillBase}/${name}/SKILL.md`, status: 'created' });
      }
      for (const name of skills.skipped) {
        phases.push({ phase: 'skill', path: `${skillBase}/${name}/SKILL.md`, status: 'exists' });
      }
    }

    // D038 D14: Validate hooks after registration
    const validation: { ide: string; hook: string; status: 'pass' | 'missing' }[] = [];
    for (const ide of ides) {
      if (ide !== 'cursor' && ide !== 'claude-code') continue;
      const filePath = ide === 'cursor'
        ? join(home, '.cursor/hooks.json')
        : join(home, '.claude/settings.json');
      const check = checkHookPresence(ide, filePath);
      if (check.ok) {
        validation.push({ ide, hook: 'all', status: 'pass' });
      } else {
        for (const m of check.missing) {
          validation.push({ ide, hook: m, status: 'missing' });
          // D038 D15: Record drift warnings
          try {
            const app = createApp(dbPath);
            app.db.prepare(`
              INSERT INTO health_warnings (category, message, first_seen_at, last_seen_at)
              VALUES (?, ?, datetime('now'), datetime('now'))
              ON CONFLICT(category, message) DO UPDATE SET last_seen_at = datetime('now'), resolved_at = NULL
            `).run('init_drift', m);
          } catch { /* non-fatal */ }
        }
      }
    }

    if (!opts.json) {
      console.log(`✓ Initialized ai-memory at ${aiMemoryDir}`);
      for (const p of phases) {
        if (p.phase === 'ide-detection') {
          console.log(`  ⚠ No supported IDEs detected`);
        } else {
          console.log(`  ${p.path}  ${p.status}`);
        }
      }
      for (const v of validation) {
        if (v.status === 'pass') {
          console.log(`  ✓ ${v.ide} hooks validated`);
        } else {
          console.log(`  ⚠ ${v.ide} missing: ${v.hook}`);
        }
      }
      console.log(`\nRun 'ai-memory status' to verify.`);
    } else {
      const result: any = { ok: true, path: aiMemoryDir, db: dbPath, phases, validation };
      if (opts.ide) result.ide = opts.ide === 'all' ? ides : [opts.ide];
      out(result, true);
    }
    process.exit(0);
  });

const configCmd = program.command('config').description('Get or set configuration values');
configCmd
  .command('get')
  .argument('<key>')
  .action((key) => {
    const result = getConfigValue(key);
    if ('error' in result) {
      console.error(result.error);
      process.exit(2);
    }
    console.log(`${result.key} = ${result.value}`);
    process.exit(0);
  });
configCmd
  .command('set')
  .argument('<key>')
  .argument('<value>')
  .action((key, value) => {
    const result = setConfigValue(key, value);
    if ('error' in result) {
      console.error(result.error);
      process.exit(2);
    }
    console.log(`${result.key} = ${result.value}`);
    process.exit(0);
  });
configCmd
  .command('list')
  .action(() => {
    const config = loadConfig();
    for (const [key, value] of Object.entries(config)) {
      console.log(`${key} = ${value}`);
    }
    process.exit(0);
  });

program
  .command('search')
  .argument('<text>')
  .option('--workspace <workspace>')
  .option('--from <date>')
  .option('--to <date>')
  .option('--role <role>')
  .option('--limit <limit>', '', '20')
  .option('--offset <offset>', '', '0')
  .option('--json')
  .action((text, opts) => {
    const result = getApp().searchService.search({
      query: text,
      workspace: opts.workspace,
      date_from: opts.from,
      date_to: opts.to,
      role: opts.role,
      limit: Number(opts.limit),
      offset: Number(opts.offset)
    });
    out(result, !!opts.json);
    process.exit(0);
  });

program
  .command('conversations')
  .option('--workspace <workspace>')
  .option('--from <date>')
  .option('--to <date>')
  .option('--limit <limit>', '', '20')
  .option('--offset <offset>', '', '0')
  .option('--json')
  .action((opts) => {
    const conversations = getApp().conversationStore.listConversations({
      workspace: opts.workspace,
      date_from: opts.from,
      date_to: opts.to,
      limit: Number(opts.limit),
      offset: Number(opts.offset)
    });
    out({ conversations }, !!opts.json);
    process.exit(0);
  });

program
  .command('conversation')
  .argument('<id>')
  .option('--json')
  .action((id, opts) => {
    const conversation = getApp().conversationStore.byId(id);
    const turns = conversation ? getApp().conversationStore.listTurns(id) : [];
    out({ conversation, turns }, !!opts.json);
    process.exit(conversation ? 0 : 1);
  });

program
  .command('summarize')
  .argument('<id>')
  .argument('<summary>')
  .option('--json')
  .action((id, summary, opts) => {
    try {
      getApp().conversationStore.upsertSummary(id, summary);
      out({ ok: true, conversation: getApp().conversationStore.byId(id) }, !!opts.json);
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(message);
      process.exit(message.startsWith('Conversation not found:') ? 1 : 2);
    }
  });

program
  .command('title')
  .argument('<id>')
  .argument('<title>')
  .option('--json')
  .action((id, title, opts) => {
    try {
      getApp().conversationStore.updateTitle(id, title);
      out({ ok: true, conversation: getApp().conversationStore.byId(id) }, !!opts.json);
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(message);
      process.exit(message.startsWith('Conversation not found:') ? 1 : 2);
    }
  });

program
  .command('import-transcripts')
  .option('--source <source>', 'cursor | claude-code | all', 'all')
  .option('--force-summary', 'Overwrite existing summaries from first user message')
  .option('--json')
  .action((opts) => {
    const source = opts.source as 'cursor' | 'claude-code' | 'all';
    if (!['cursor', 'claude-code', 'all'].includes(source)) {
      out({ error: 'Invalid source. Use cursor | claude-code | all' }, true);
      process.exit(2);
    }
    const result = getApp().importService.importTranscripts(source, !!opts.forceSummary);
    out(result, !!opts.json);
    process.exit(0);
  });

program
  .command('status')
  .option('--json')
  .action((opts) => {
    const status = getApp().statusService.getStatus();
    out(status, !!opts.json);
    process.exit(0);
  });

program
  .command('usage')
  .option('--range <range>', '24h | 7d | 30d', '7d')
  .option('--json')
  .action((opts) => {
    const range = parseUsageRange(opts.range);
    const data = getApp().usageService.getUsageDashboard(range);
    if (opts.json) {
      out(data, true);
      process.exit(0);
    }
    console.log(`Usage (${range})`);
    console.log(`Total calls: ${data.summary.total_calls}`);
    console.log(`Error rate: ${(data.summary.error_rate * 100).toFixed(1)}%`);
    console.log(`Empty search rate: ${(data.summary.empty_search_rate * 100).toFixed(1)}%`);
    console.log(`Avg latency: ${data.summary.avg_latency_ms} ms`);
    console.log('');
    console.log('By tool:');
    for (const row of data.by_tool) {
      const errorRate = row.calls > 0 ? (row.errors / row.calls) * 100 : 0;
      const emptyRate =
        row.tool_name === 'ai-memory-search' && row.calls > 0 ? (row.empty_results / row.calls) * 100 : null;
      const emptyText = emptyRate == null ? '-' : `${emptyRate.toFixed(1)}%`;
      console.log(
        `- ${row.tool_name}: calls=${row.calls} avg_ms=${row.avg_latency_ms} error=${errorRate.toFixed(1)}% empty=${emptyText}`
      );
    }
    process.exit(0);
  });

// D009: MCP stdio server — starts JSON-RPC transport for IDE tool integration
program
  .command('mcp')
  .description('Start MCP stdio server for IDE integration')
  .action(async () => {
    const { startStdioServer } = await import('./mcp/stdio.js');
    await startStdioServer(dbPath);
  });

// D038: Parse stdin JSON from IDE hooks
function parseStdin(): Record<string, any> {
  try {
    const input = readFileSync(0, 'utf8');
    if (input.trim()) return JSON.parse(input);
  } catch {
    // No stdin or invalid JSON — that's fine
  }
  return {};
}

// D038 D5: Per-IDE typed adapter — resolves stdin fields with known contracts per IDE.
// Warnings are collected for missing expected fields (surfaced via health_warnings table).
interface HookPayload {
  sessionId: string;
  workspace: string;
  workspacePath: string | null;
  prompt: string;
  assistantContent: string;
  stdinKeys: string[];  // D17: track which stdin fields were present
  warnings: string[];   // D9: field mismatch warnings
  skip: boolean;        // D038: true when payload/IDE mismatch detected (phantom hook)
}

// D038: Detect phantom hooks — when a host IDE (Cursor, VSCode, Windsurf, etc.)
// also fires Claude Code extension hooks from ~/.claude/settings.json, we get
// duplicate invocations with mismatched payloads. Detect via hook_event_name convention:
// - Claude Code uses PascalCase: SessionStart, UserPromptSubmit, Stop
// - Cursor/VSCode hosts use camelCase: beforeSubmitPrompt, afterAgentResponse, stop (lowercase)
const CLAUDE_CODE_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']);
const HOST_IDE_EVENTS = new Set(['sessionStart', 'beforeSubmitPrompt', 'afterAgentResponse', 'stop', 'sessionEnd']);

function isPhantomHook(ide: IdeType, raw: Record<string, any>): boolean {
  const event = raw.hook_event_name;
  if (typeof event !== 'string') return false;
  // --ide claude-code but payload has host IDE event name → phantom
  if (ide === 'claude-code' && HOST_IDE_EVENTS.has(event)) return true;
  // --ide cursor but payload has Claude Code event name → phantom (reverse case)
  if (ide === 'cursor' && CLAUDE_CODE_EVENTS.has(event)) return true;
  return false;
}

function parseIdeStdin(ide: IdeType, raw: Record<string, any>, cliOpts: { sessionId?: string; workspace?: string; content?: string; prompt?: string }): HookPayload {
  if (isPhantomHook(ide, raw)) {
    return {
      sessionId: '', workspace: 'global', workspacePath: null,
      prompt: '', assistantContent: '', stdinKeys: Object.keys(raw),
      warnings: [], skip: true
    };
  }
  const warnings: string[] = [];
  const stdinKeys = Object.keys(raw);

  // Session ID: CC uses session_id, Cursor uses conversation_id, Codex uses thread-id
  let sessionId: string;
  if (ide === 'claude-code') {
    sessionId = cliOpts.sessionId ?? (typeof raw.session_id === 'string' ? raw.session_id : '');
    if (!sessionId) {
      if (stdinKeys.length > 0) warnings.push('claude-code: missing session_id in stdin');
      sessionId = newId();
    }
  } else if (ide === 'codex') {
    sessionId = cliOpts.sessionId ?? (typeof raw['thread-id'] === 'string' ? raw['thread-id'] : '');
    if (!sessionId) {
      if (stdinKeys.length > 0) warnings.push('codex: missing thread-id in payload');
      sessionId = newId();
    }
  } else {
    sessionId = cliOpts.sessionId ?? (typeof raw.conversation_id === 'string' ? raw.conversation_id : '');
    if (!sessionId) {
      if (stdinKeys.length > 0) warnings.push('cursor: missing conversation_id in stdin');
      sessionId = newId();
    }
  }

  // Workspace: CC uses cwd, Cursor uses workspace_roots[0]
  let workspacePath: string | null = null;
  let workspace: string;
  if (cliOpts.workspace && cliOpts.workspace.startsWith('/')) {
    workspacePath = cliOpts.workspace;
    workspace = normalizeWorkspaceLabel(basename(cliOpts.workspace)) ?? 'global';
  } else if (cliOpts.workspace) {
    workspace = normalizeWorkspaceLabel(cliOpts.workspace) ?? 'global';
  } else if (ide === 'claude-code' || ide === 'codex') {
    const cwd = raw.cwd;
    if (typeof cwd === 'string' && cwd.startsWith('/')) {
      workspacePath = cwd;
      workspace = normalizeWorkspaceLabel(basename(cwd)) ?? 'global';
    } else {
      if (stdinKeys.length > 0) warnings.push(`${ide}: missing cwd in payload`);
      workspace = normalizeWorkspaceLabel(basename(process.cwd())) ?? 'global';
    }
  } else {
    const wsRoot = raw.workspace_roots?.[0];
    if (typeof wsRoot === 'string' && wsRoot.startsWith('/')) {
      workspacePath = wsRoot;
      workspace = normalizeWorkspaceLabel(basename(wsRoot)) ?? 'global';
    } else {
      if (stdinKeys.length > 0) warnings.push('cursor: missing workspace_roots in stdin');
      workspace = normalizeWorkspaceLabel(basename(process.cwd())) ?? 'global';
    }
  }

  // D038 D3: Assistant content — one known field per IDE, no fallback chain
  // CC stop: last_assistant_message | Cursor afterAgentResponse: text | Codex notify: last-assistant-message
  let assistantContent = '';
  if (cliOpts.content) {
    assistantContent = cliOpts.content;
  } else if (ide === 'claude-code') {
    assistantContent = typeof raw.last_assistant_message === 'string' ? raw.last_assistant_message : '';
  } else if (ide === 'codex') {
    assistantContent = typeof raw['last-assistant-message'] === 'string' ? raw['last-assistant-message'] : '';
  } else {
    assistantContent = typeof raw.text === 'string' ? raw.text : '';
  }

  // Prompt: CC/Cursor use prompt, Codex uses input-messages[0]
  let prompt = '';
  if (cliOpts.prompt) {
    prompt = cliOpts.prompt;
  } else if (ide === 'codex') {
    const msgs = raw['input-messages'];
    prompt = Array.isArray(msgs) && typeof msgs[0] === 'string' ? msgs[0] : '';
  } else {
    prompt = typeof raw.prompt === 'string' ? raw.prompt : '';
  }

  return { sessionId, workspace, workspacePath, prompt, assistantContent, stdinKeys, warnings, skip: false };
}

// D038 D17: Record hook invocation in tool_usage table
function recordHookUsage(hookName: string, payload: HookPayload, ide: IdeType, start: number, success: boolean, errorType?: string, resultCount?: number): void {
  try {
    const app = getApp();
    app.db.prepare(`
      INSERT INTO tool_usage (tool_name, called_at, latency_ms, workspace, param_keys, result_count, success, error_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `hook:${hookName}`,
      new Date().toISOString(),
      Date.now() - start,
      payload.workspace,
      `ide=${ide},fields=${payload.stdinKeys.join(',')}`,
      resultCount ?? null,
      success ? 1 : 0,
      errorType ?? null
    );
  } catch {
    // Non-fatal — never let usage tracking break hooks
  }
}

// D038 D9: Persist hook warnings to health_warnings table
function persistHookWarnings(warnings: string[]): void {
  if (warnings.length === 0) return;
  try {
    const app = getApp();
    for (const message of warnings) {
      app.db.prepare(`
        INSERT INTO health_warnings (category, message, first_seen_at, last_seen_at)
        VALUES (?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(category, message) DO UPDATE SET last_seen_at = datetime('now'), resolved_at = NULL
      `).run('hook_field_missing', message);
    }
  } catch {
    // Non-fatal
  }
}

// Hook subcommand — ai-memory hook session-start|stop|afterAgentResponse|session-end --ide <cursor|claude-code>
const hookCmd = program.command('hook');
hookCmd
  .command('prompt-submit')
  .requiredOption('--ide <ide>')
  .option('--session-id <sessionId>')
  .option('--workspace <workspace>')
  .option('--prompt <prompt>')
  .action((opts) => {
    const start = Date.now();
    const ide = opts.ide as IdeType;
    let payload: HookPayload | null = null;
    try {
      const stdin = parseStdin();
      payload = parseIdeStdin(ide, stdin, opts);
      if (payload.skip) return;
      persistHookWarnings(payload.warnings);
      const result = beforeSubmitPromptHook({
        prompt: payload.prompt,
        ide,
        session_id: payload.sessionId,
        workspace: payload.workspace,
        project_key: deriveProjectKey({ workspace: payload.workspace, workspacePath: payload.workspacePath }),
        dbPath
      });
      recordHookUsage('prompt-submit', payload, ide, start, true, undefined, payload.prompt.length);
      if (ide === 'cursor') {
        console.log(JSON.stringify(result));
      }
    } catch (err) {
      if (payload) recordHookUsage('prompt-submit', payload, ide, start, false, err instanceof Error ? err.name : 'UNKNOWN');
      process.stderr.write(String(err));
      process.exit(0);
    }
  });

hookCmd
  .command('session-start')
  .requiredOption('--ide <ide>')
  .option('--workspace <workspace>')
  .option('--session-id <sessionId>')
  .action((opts) => {
    const start = Date.now();
    const ide = opts.ide as IdeType;
    let payload: HookPayload | null = null;
    try {
      const stdin = parseStdin();
      payload = parseIdeStdin(ide, stdin, opts);
      if (payload.skip) return;
      persistHookWarnings(payload.warnings);
      const result = sessionStartHook({
        ide,
        workspace: payload.workspace,
        project_key: deriveProjectKey({ workspace: payload.workspace, workspacePath: payload.workspacePath }),
        session_id: payload.sessionId,
        dbPath
      });
      recordHookUsage('session-start', payload, ide, start, true, undefined, result.additional_context.length);
      // D008: CC expects plain text, Cursor expects JSON
      if (ide === 'claude-code') {
        console.log(result.additional_context);
      } else {
        console.log(JSON.stringify(result));
      }
    } catch (err) {
      if (payload) recordHookUsage('session-start', payload, ide, start, false, err instanceof Error ? err.name : 'UNKNOWN');
      process.stderr.write(String(err));
      process.exit(0); // D008 D7: hooks must never crash the IDE
    }
  });

hookCmd
  .command('stop')
  .requiredOption('--ide <ide>')
  .option('--session-id <sessionId>')
  .option('--workspace <workspace>')
  .option('--content <content>')
  .action((opts) => {
    const start = Date.now();
    const ide = opts.ide as IdeType;
    let payload: HookPayload | null = null;
    try {
      const stdin = parseStdin();
      payload = parseIdeStdin(ide, stdin, opts);
      if (payload.skip) return;
      persistHookWarnings(payload.warnings);
      // D038 D2: For Cursor, stop is metadata-only (assistant content comes via afterAgentResponse).
      // For Claude Code, stop still captures last_assistant_message.
      const content = ide === 'claude-code' ? payload.assistantContent : '';
      if (ide === 'claude-code' && !content.trim() && payload.stdinKeys.length > 0) {
        persistHookWarnings(['claude-code stop: last_assistant_message was empty']);
      }
      const result = stopHook({
        ide,
        session_id: payload.sessionId,
        workspace: payload.workspace,
        project_key: deriveProjectKey({ workspace: payload.workspace, workspacePath: payload.workspacePath }),
        content,
        dbPath
      });
      recordHookUsage('stop', payload, ide, start, true, undefined, content.length);
      if (ide === 'cursor') console.log(JSON.stringify(result));
    } catch (err) {
      if (payload) recordHookUsage('stop', payload, ide, start, false, err instanceof Error ? err.name : 'UNKNOWN');
      process.stderr.write(String(err));
      process.exit(0);
    }
  });

// D038 D1: Cursor afterAgentResponse — captures assistant content directly via stdin.text
hookCmd
  .command('afterAgentResponse')
  .requiredOption('--ide <ide>')
  .option('--session-id <sessionId>')
  .option('--workspace <workspace>')
  .option('--content <content>')
  .action((opts) => {
    const start = Date.now();
    const ide = opts.ide as IdeType;
    let payload: HookPayload | null = null;
    try {
      const stdin = parseStdin();
      payload = parseIdeStdin(ide, stdin, opts);
      if (payload.skip) return;
      persistHookWarnings(payload.warnings);
      if (!payload.assistantContent.trim() && payload.stdinKeys.length > 0) {
        persistHookWarnings([`${ide} afterAgentResponse: text field was empty`]);
      }
      const result = stopHook({
        ide,
        session_id: payload.sessionId,
        workspace: payload.workspace,
        project_key: deriveProjectKey({ workspace: payload.workspace, workspacePath: payload.workspacePath }),
        content: payload.assistantContent,
        dbPath
      });
      recordHookUsage('afterAgentResponse', payload, ide, start, true, undefined, payload.assistantContent.length);
      console.log(JSON.stringify(result));
    } catch (err) {
      if (payload) recordHookUsage('afterAgentResponse', payload, ide, start, false, err instanceof Error ? err.name : 'UNKNOWN');
      process.stderr.write(String(err));
      process.exit(0);
    }
  });

hookCmd
  .command('session-end')
  .requiredOption('--ide <ide>')
  .option('--session-id <sessionId>')
  .option('--workspace <workspace>')
  .option('--content <content>')
  .action((opts) => {
    const start = Date.now();
    const ide = opts.ide as IdeType;
    let payload: HookPayload | null = null;
    try {
      const stdin = parseStdin();
      payload = parseIdeStdin(ide, stdin, opts);
      if (payload.skip) return;
      persistHookWarnings(payload.warnings);
      const result = sessionEndHook({
        ide,
        session_id: payload.sessionId,
        workspace: payload.workspace,
        content: opts.content ?? '',
        dbPath
      });
      recordHookUsage('session-end', payload, ide, start, true);
      console.log(JSON.stringify(result));
    } catch (err) {
      if (payload) recordHookUsage('session-end', payload, ide, start, false, err instanceof Error ? err.name : 'UNKNOWN');
      process.stderr.write(String(err));
      process.exit(0);
    }
  });

// D039: Codex turn-complete — single event captures both user prompt and assistant response.
// Codex notify passes JSON as argv (not stdin), so we parse from the positional argument.
const CODEX_SYSTEM_PROMPT_PATTERNS = [
  'Generate a concise UI title',
  'generate a clear, informative task title',
  'You are a helpful assistant. You will be presented with a user prompt, and your job is to provide a short title',
];

function isCodexSystemTurn(inputMessages: unknown): boolean {
  if (!Array.isArray(inputMessages) || typeof inputMessages[0] !== 'string') return false;
  const first = inputMessages[0] as string;
  return CODEX_SYSTEM_PROMPT_PATTERNS.some(p => first.includes(p));
}

hookCmd
  .command('turn-complete')
  .requiredOption('--ide <ide>')
  .argument('[payload]', 'JSON payload from Codex notify (argv)')
  .action((payloadArg: string | undefined, opts: { ide: string }) => {
    const start = Date.now();
    const ide = opts.ide as IdeType;
    let payload: HookPayload | null = null;
    try {
      // Codex notify passes JSON as argv[1]; fall back to stdin
      let raw: Record<string, any> = {};
      if (payloadArg) {
        try { raw = JSON.parse(payloadArg); } catch { /* ignore parse errors */ }
      }
      if (Object.keys(raw).length === 0) {
        raw = parseStdin();
      }

      // Filter out system/title-generation turns
      if (isCodexSystemTurn(raw['input-messages'])) return;

      payload = parseIdeStdin(ide, raw, {});
      if (payload.skip) return;
      persistHookWarnings(payload.warnings);

      turnCompleteHook({
        ide,
        session_id: payload.sessionId,
        workspace: payload.workspace,
        project_key: deriveProjectKey({ workspace: payload.workspace, workspacePath: payload.workspacePath }),
        prompt: payload.prompt,
        content: payload.assistantContent,
        dbPath
      });
      recordHookUsage('turn-complete', payload, ide, start, true, undefined, (payload.prompt.length + payload.assistantContent.length));
    } catch (err) {
      if (payload) recordHookUsage('turn-complete', payload, ide, start, false, err instanceof Error ? err.name : 'UNKNOWN');
      process.stderr.write(String(err));
      process.exit(0);
    }
  });

program
  .command('clean-data')
  .description('Strip XML wrapper tags from conversation titles and summaries')
  .option('--dry-run', 'Show what would be changed without modifying')
  .option('--json')
  .action((opts) => {
    const app = getApp();
    const rows = app.db
      .prepare(`SELECT id, title, summary FROM conversations WHERE title IS NOT NULL OR summary IS NOT NULL`)
      .all() as { id: string; title: string | null; summary: string | null }[];

    let cleaned = 0;
    for (const row of rows) {
      const newTitle = row.title != null ? (stripPromptWrappers(row.title) || null) : null;
      const newSummary = row.summary != null ? (stripPromptWrappers(row.summary) || null) : null;
      const titleChanged = newTitle !== row.title;
      const summaryChanged = newSummary !== row.summary;
      if (!titleChanged && !summaryChanged) continue;

      if (opts.dryRun) {
        if (titleChanged) console.log(`[${row.id}] title: "${row.title?.slice(0, 60)}..." → "${newTitle?.slice(0, 60)}..."`);
        if (summaryChanged) console.log(`[${row.id}] summary changed`);
      } else {
        if (titleChanged) app.db.prepare(`UPDATE conversations SET title = ? WHERE id = ?`).run(newTitle, row.id);
        if (summaryChanged) app.db.prepare(`UPDATE conversations SET summary = ? WHERE id = ?`).run(newSummary, row.id);
      }
      cleaned++;
    }

    const result = { total: rows.length, cleaned, dry_run: !!opts.dryRun };
    if (opts.json) {
      out(result, true);
    } else {
      console.log(`Scanned ${rows.length} conversations, ${opts.dryRun ? 'would clean' : 'cleaned'} ${cleaned}`);
    }
    process.exit(0);
  });

program
  .command('dashboard')
  .description('Start local dashboard UI')
  .option('--port <port>', 'Server port', '8485')
  .option('--no-open', "Don't open browser")
  .action(async (opts) => {
    const { startDashboard } = await import('./dashboard/server.js');
    const { dirname, join: joinPath } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    startDashboard({
      port: Number(opts.port),
      dbPath,
      open: opts.open !== false,
      staticDir: joinPath(__dirname, 'dashboard/client'),
    });
  });

program.parse(process.argv);
