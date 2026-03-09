#!/usr/bin/env node
import { Command } from 'commander';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createApp } from './app.js';
import { StatusService } from './services/status-service.js';
import { getConfigValue, setConfigValue, loadConfig } from './services/config-service.js';
import { sessionStartHook, stopHook, sessionEndHook } from './hooks/handlers.js';
import { generateInitConfig } from './hooks/init-config.js';
import { runTunePatterns } from './services/tune-patterns.js';
import type { IdeType, MemoryType } from './types.js';

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
const app = createApp(dbPath);
const program = new Command();
program.name('ai-memory').description('ai-memory CLI').version('0.1.0');

program
  .command('init')
  .option('--ide <ide>', 'Generate IDE hook config: cursor | claude-code')
  .option('--json')
  .action((opts) => {
    // Ensure ~/.ai-memory/ directory structure exists
    const aiMemoryDir = join(homedir(), '.ai-memory');
    const servicesDir = join(aiMemoryDir, 'services');
    for (const dir of [aiMemoryDir, servicesDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // Touch the database (schema auto-creates on first connection)
    createApp(dbPath);

    // Create default config if not present
    loadConfig();

    // Generate IDE hook config if requested
    if (opts.ide) {
      const ide = opts.ide as IdeType;
      if (ide === 'cursor') {
        generateInitConfig({ ide: 'cursor', filePath: join(homedir(), '.cursor/hooks.json'), mcpFilePath: join(homedir(), '.cursor/mcp.json') });
      } else if (ide === 'claude-code') {
        generateInitConfig({ ide: 'claude-code', filePath: join(homedir(), '.claude/settings.json') });
      }
    }

    const result: any = { ok: true, path: aiMemoryDir, db: dbPath };
    if (opts.ide) result.ide = opts.ide;
    if (!opts.json) {
      console.log(`✓ Initialized ai-memory at ${aiMemoryDir}`);
      console.log(`  Database: ${dbPath}`);
      if (opts.ide) {
        console.log(`  Hooks: ${opts.ide} (global)`);
        console.log(`  MCP server: ${opts.ide} (global)`);
      }
      console.log(`\nRun 'ai-memory status' to verify.`);
    } else {
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
  .command('query')
  .argument('<text>')
  .option('--workspace <workspace>')
  .option('--top-k <topK>', '', '5')
  .option('--token-budget <budget>', '', '800')
  .option('--json')
  .action((text, opts) => {
    const result = app.retrievalService.query({
      query: text,
      workspace: opts.workspace ?? null,
      top_k: Number(opts.topK),
      token_budget: Number(opts.tokenBudget)
    });
    out(result, !!opts.json);
    process.exit(result.memories.length > 0 ? 0 : 1);
  });

program
  .command('capture')
  .argument('<text>')
  .requiredOption('--type <type>')
  .option('--session <sessionId>', '', 'cli')
  .option('--workspace <workspace>')
  .option('--json')
  .action((text, opts) => {
    const type = opts.type as MemoryType;
    if (!['decision', 'correction', 'pattern', 'learning', 'preference', 'fact'].includes(type)) {
      out({ error: 'Invalid type' }, true);
      process.exit(2);
    }
    const result = app.hebbianMatcher.capture({
      session_id: opts.session,
      workspace: opts.workspace ?? null,
      items: [{ type, content: text, extraction_confidence: 1 }],
      source: 'cli'
    });
    out(result, !!opts.json);
    process.exit(0);
  });

program
  .command('events')
  .option('--session <sessionId>')
  .option('--event-id <eventId>')
  .option('--workspace <workspace>')
  .option('--limit <limit>', '', '50')
  .option('--json')
  .action((opts) => {
    const events = app.captureStore.query(opts.session, opts.eventId, opts.workspace ?? undefined, Number(opts.limit));
    out({ events }, !!opts.json);
    process.exit(events.length > 0 ? 0 : 1);
  });

program
  .command('status')
  .option('--include-pending-ids')
  .option('--json')
  .action((opts) => {
    const status = new StatusService(app.captureStore, app.memoryStore, dbPath).getStatus({
      include_pending_ids: !!opts.includePendingIds
    });
    out(status, !!opts.json);
    process.exit(0);
  });

program
  .command('sweep')
  .option('--workspace <workspace>')
  .option('--extract-pending')
  .option('--json')
  .action((opts) => {
    const result = app.maintenanceService.run(opts.workspace ?? null);
    out(result, !!opts.json);
    process.exit(0);
  });

program
  .command('migrate')
  .argument('<what>')
  .requiredOption('--scope <scope>')
  .option('--project-memory-path <path>')
  .option('--machine-memory-path <path>')
  .option('--workspace <workspace>', '', 'project')
  .option('--session <sessionId>', '', 'cli-migration')
  .option('--json')
  .action((what, opts) => {
    if (what !== 'memory-md') {
      out({ error: 'Unsupported migration target' }, true);
      process.exit(2);
    }
    const scope = opts.scope as 'machine' | 'project';
    if (!['machine', 'project'].includes(scope)) {
      out({ error: 'Invalid scope' }, true);
      process.exit(2);
    }

    const filePath =
      scope === 'machine'
        ? opts.machineMemoryPath ?? join(homedir(), '.ai-memory/MEMORY.md')
        : opts.projectMemoryPath ?? 'ai-memory/MEMORY.md';

    const result = app.migrationService.migrateMemoryMd({
      filePath,
      scope,
      workspace: scope === 'machine' ? null : opts.workspace,
      session_id: opts.session
    });
    out(result, !!opts.json);
    process.exit(0);
  });

program
  .command('tune-patterns')
  .option('--db <db>', 'Database path')
  .option('--threshold <threshold>', 'Minimum precision threshold')
  .option('--auto', 'Auto mode — update config silently, no stdout report')
  .option('--config <config>', 'Path to classifier-patterns.json')
  .action((opts) => {
    const tuneDbPath = opts.db ?? dbPath;
    const tuneApp = createApp(tuneDbPath);
    const allEvents = tuneApp.captureStore.listAll();
    const corpus = allEvents.map((e) => ({ text: e.content, session_id: e.session_id }));
    const result = runTunePatterns({
      corpus,
      configPath: opts.config,
      threshold: opts.threshold ? Number(opts.threshold) : undefined,
      auto: !!opts.auto
    });
    if (!opts.auto) {
      out(result, true);
    }
    process.exit(0);
  });

// Hook subcommand (D31) — ai-memory hook session-start|stop|session-end --ide <cursor|claude-code>
const hookCmd = program.command('hook');
hookCmd
  .command('session-start')
  .requiredOption('--ide <ide>')
  .option('--workspace <workspace>')
  .option('--session-id <sessionId>')
  .action((opts) => {
    const result = sessionStartHook({
      ide: opts.ide as IdeType,
      workspace: opts.workspace ?? basename(process.cwd()),
      session_id: opts.sessionId,
      dbPath
    });
    console.log(JSON.stringify(result));
  });

hookCmd
  .command('stop')
  .requiredOption('--ide <ide>')
  .requiredOption('--session-id <sessionId>')
  .option('--workspace <workspace>')
  .option('--content <content>')
  .option('--extraction-interval <interval>')
  .action((opts) => {
    let stdin = {};
    try {
      const input = require('node:fs').readFileSync(0, 'utf8');
      if (input.trim()) stdin = JSON.parse(input);
    } catch {
      // No stdin or invalid JSON — that's fine
    }
    const result = stopHook({
      ide: opts.ide as IdeType,
      session_id: opts.sessionId,
      workspace: opts.workspace ?? basename(process.cwd()),
      content: opts.content ?? '',
      extraction_interval: opts.extractionInterval ? Number(opts.extractionInterval) : undefined,
      dbPath,
      stdin: stdin as any
    });
    console.log(JSON.stringify(result));
  });

hookCmd
  .command('session-end')
  .requiredOption('--ide <ide>')
  .requiredOption('--session-id <sessionId>')
  .option('--workspace <workspace>')
  .option('--content <content>')
  .action((opts) => {
    const result = sessionEndHook({
      ide: opts.ide as IdeType,
      session_id: opts.sessionId,
      workspace: opts.workspace ?? basename(process.cwd()),
      content: opts.content ?? '',
      dbPath
    });
    console.log(JSON.stringify(result));
  });

program.parse(process.argv);
