#!/usr/bin/env node
import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import { getConfigValue, setConfigValue, loadConfig, saveConfig } from './services/config-service.js';
import { registerCursorMcp, registerCodexMcp, writeSkills } from './mcp/init-config.js';
import { stripPromptWrappers } from './utils/strip.js';
import type { IdeType } from './types.js';
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
  .option('--ide <ide>', 'Register MCP + skills for IDE: cursor | claude-code | codex | all')
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

    // Phase 4-5: MCP registration + skills
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
        const mcpPath = join(home, '.cursor/mcp.json');
        registerCursorMcp(mcpPath);
        phases.push({ phase: 'mcp', path: mcpPath, status: 'created' });
      } else if (ide === 'claude-code') {
        const runtimeMcp = syncClaudeRuntimeMcp(home);
        phases.push({ phase: 'mcp', path: runtimeMcp.path, status: runtimeMcp.status });
      } else if (ide === 'codex') {
        const configPath = join(home, '.codex/config.toml');
        const codexResult = registerCodexMcp(configPath);
        phases.push({ phase: 'mcp', path: configPath, status: codexResult.status });
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

    if (!opts.json) {
      console.log(`✓ Initialized ai-memory at ${aiMemoryDir}`);
      for (const p of phases) {
        if (p.phase === 'ide-detection') {
          console.log(`  ⚠ No supported IDEs detected`);
        } else {
          console.log(`  ${p.path}  ${p.status}`);
        }
      }
      console.log(`\nRun 'ai-memory status' to verify.`);
    } else {
      const result: any = { ok: true, path: aiMemoryDir, db: dbPath, phases };
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
  .option('--source <source>', 'cursor | claude-code | codex | all', 'all')
  .option('--force-summary', 'Overwrite existing summaries from first user message')
  .option('--json')
  .action((opts) => {
    const source = opts.source as 'cursor' | 'claude-code' | 'codex' | 'all';
    if (!['cursor', 'claude-code', 'codex', 'all'].includes(source)) {
      out({ error: 'Invalid source. Use cursor | claude-code | codex | all' }, true);
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
  .description('Start MCP stdio server for IDE integration (includes file watcher)')
  .action(async () => {
    const { startStdioServer } = await import('./mcp/stdio.js');
    await startStdioServer(dbPath);
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
