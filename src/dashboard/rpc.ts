import type { AppContext } from '../app.js';
import { saveConfig } from '../services/config-service.js';
import { SearchService } from '../services/search-service.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalizeWorkspaceLabel } from '../utils/workspace-identity.js';
import { parseUsageRange } from '../services/usage-service.js';

type RpcResult = { ok: true; result: unknown } | { ok: false; error: string };

export function handleRpc(
  method: string,
  params: Record<string, unknown>,
  ctx: AppContext
): RpcResult {
  try {
    switch (method) {
      case 'listConversations':
        return { ok: true, result: listConversations(ctx, params) };
      case 'getConversation':
        return { ok: true, result: getConversation(ctx, params) };
      case 'searchConversations':
        return { ok: true, result: searchConversations(ctx, params) };
      case 'listWorkspaces':
        return { ok: true, result: listWorkspaces(ctx) };
      case 'listIdes':
        return { ok: true, result: listIdes(ctx) };
      case 'setSummary':
        return { ok: true, result: setSummary(ctx, params) };
      case 'getConfig':
        return { ok: true, result: { config: ctx.config } };
      case 'updateConfig':
        return { ok: true, result: updateConfig(ctx, params) };
      case 'getStatus':
        return { ok: true, result: ctx.statusService.getStatus() };
      case 'getDashboardStatus':
        return { ok: true, result: getDashboardStatus(ctx) };
      case 'getUsageDashboard':
        return { ok: true, result: getUsageDashboard(ctx, params) };
      case 'getUsageSummary':
        return { ok: true, result: getUsageSummary(ctx, params) };
      default:
        return { ok: false, error: `Unknown method: ${method}` };
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function listConversations(ctx: AppContext, params: Record<string, unknown>) {
  const limit = Number(params.limit ?? 50);
  const offset = Number(params.offset ?? 0);
  const workspace = (params.workspace as string | undefined) ?? undefined;
  const dateFrom = (params.date_from as string | undefined) ?? undefined;
  const ide = (params.ide as string | undefined) ?? undefined;

  const where: string[] = [];
  const args: unknown[] = [];
  if (typeof workspace !== 'undefined') {
    const normalizedWorkspace = normalizeWorkspaceLabel(workspace);
    where.push('workspace IS ?');
    args.push(normalizedWorkspace);
  }
  if (dateFrom) {
    where.push('updated_at >= ?');
    args.push(dateFrom);
  }
  if (typeof ide !== 'undefined') {
    where.push('ide IS ?');
    args.push(ide);
  }
  const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

  const total = (
    ctx.db.prepare(`SELECT COUNT(*) AS total FROM conversations${clause}`).get(...args) as { total: number }
  ).total;

  const conversations = ctx.db
    .prepare(`SELECT * FROM conversations${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as unknown[];

  return { conversations, total, limit, offset };
}

function getConversation(ctx: AppContext, params: Record<string, unknown>) {
  const conversationId = String(params.conversation_id ?? '');
  if (!conversationId) {
    throw new Error('Missing param: conversation_id');
  }
  const conversation = ctx.conversationStore.byId(conversationId);
  return { conversation, turns: conversation ? ctx.conversationStore.listTurns(conversationId) : [] };
}

function searchConversations(ctx: AppContext, params: Record<string, unknown>) {
  const query = String(params.query ?? '');
  const workspace = (params.workspace as string | undefined) ?? undefined;
  return ctx.searchService.search({
    query,
    workspace,
    date_from: params.date_from as string | undefined,
    date_to: params.date_to as string | undefined,
    role: params.role as 'user' | 'assistant' | undefined,
    limit: Number(params.limit ?? 20),
    offset: Number(params.offset ?? 0)
  });
}

function listWorkspaces(ctx: AppContext) {
  const rows = ctx.db
    .prepare(`SELECT DISTINCT workspace FROM conversations WHERE workspace IS NOT NULL ORDER BY workspace`)
    .all() as Array<{ workspace: string }>;
  return { workspaces: rows.map((r) => r.workspace) };
}

function listIdes(ctx: AppContext) {
  const rows = ctx.db
    .prepare(`SELECT DISTINCT ide FROM conversations WHERE ide IS NOT NULL ORDER BY ide`)
    .all() as Array<{ ide: string }>;
  return { ides: rows.map((r) => r.ide) };
}

function updateConfig(ctx: AppContext, params: Record<string, unknown>) {
  const nextConfig = { ...ctx.config };

  saveConfig(nextConfig);
  ctx.config = nextConfig;
  ctx.searchService = new SearchService(ctx.db, nextConfig);

  return { config: nextConfig };
}

function safeJson(path: string): { exists: boolean; json: any | null; error: string | null } {
  if (!existsSync(path)) return { exists: false, json: null, error: null };
  try {
    return { exists: true, json: JSON.parse(readFileSync(path, 'utf8')), error: null };
  } catch (err) {
    return { exists: true, json: null, error: String(err) };
  }
}

function readRawFile(path: string): { exists: boolean; content: string | null; error: string | null } {
  if (!existsSync(path)) return { exists: false, content: null, error: null };
  try {
    return { exists: true, content: readFileSync(path, 'utf8'), error: null };
  } catch (err) {
    return { exists: true, content: null, error: String(err) };
  }
}

// D044 D12: Watcher status replaces hook validation
function buildWatcherStatus(ctx: AppContext) {
  const home = homedir();
  const watchedDirs = [
    `${home}/.claude/projects`,
    `${home}/.cursor/projects`,
    `${home}/.codex/sessions`,
  ].map((path) => ({ path, exists: existsSync(path) }));

  const lastImport = ctx.db.prepare(
    `SELECT MAX(source_mtime) AS last_import_at FROM conversations WHERE source_mtime IS NOT NULL`
  ).get() as { last_import_at: string | null };

  const importErrorCount = (() => {
    try {
      return (ctx.db.prepare(
        `SELECT COUNT(*) AS c FROM health_warnings WHERE category IN ('import_parse_error', 'watcher_error') AND resolved_at IS NULL`
      ).get() as { c: number }).c;
    } catch { return 0; }
  })();

  return {
    watched_dirs: watchedDirs,
    last_import_at: lastImport.last_import_at,
    import_error_count: importErrorCount,
  };
}

// D044 D8: MCP integration status (without hooks)
function buildIntegrationStatus(ctx: AppContext) {
  const home = homedir();
  const cursorMcpPath = join(home, '.cursor', 'mcp.json');
  const claudeSettingsPath = join(home, '.claude', 'settings.json');
  const claudeRegistryPath = join(home, '.claude.json');
  const codexConfigPath = join(home, '.codex', 'config.toml');

  const cursorMcp = safeJson(cursorMcpPath);
  const claudeSettings = safeJson(claudeSettingsPath);
  const claudeRegistry = safeJson(claudeRegistryPath);
  const codexConfig = readRawFile(codexConfigPath);

  return {
    cursor: {
      mcp_file: cursorMcpPath,
      mcp_file_exists: cursorMcp.exists,
      mcp_configured: Boolean(cursorMcp.json?.mcpServers?.['ai-memory']),
      mcp_parse_error: cursorMcp.error,
    },
    claude_code: {
      settings_file: claudeSettingsPath,
      settings_exists: claudeSettings.exists,
      settings_mcp_configured: Boolean(claudeSettings.json?.mcpServers?.['ai-memory']),
      registry_file: claudeRegistryPath,
      registry_exists: claudeRegistry.exists,
      registry_mcp_configured: Boolean(claudeRegistry.json?.mcpServers?.['ai-memory']),
      mcp_configured: Boolean(claudeSettings.json?.mcpServers?.['ai-memory']) && Boolean(claudeRegistry.json?.mcpServers?.['ai-memory']),
      settings_parse_error: claudeSettings.error,
      registry_parse_error: claudeRegistry.error,
    },
    codex: {
      config_file: codexConfigPath,
      config_exists: codexConfig.exists,
      mcp_configured: Boolean(codexConfig.content && codexConfig.content.includes('[mcp_servers.ai-memory]')),
      config_parse_error: codexConfig.error,
    },
  };
}

const EXPECTED_SKILLS = ['ai-memory-status', 'ai-memory-search', 'ai-memory-recent', 'ai-memory-summarize'];

function buildSkillsStatus() {
  const home = homedir();
  const ideDirs: Array<{ ide: string; dir: string }> = [
    { ide: 'claude_code', dir: join(home, '.claude', 'skills') },
    { ide: 'cursor', dir: join(home, '.cursor', 'skills') },
    { ide: 'codex', dir: join(home, '.agents', 'skills') },
  ];

  const byIde: Record<string, { installed: number; total: number; missing: string[] }> = {};
  for (const { ide, dir } of ideDirs) {
    const missing: string[] = [];
    for (const skill of EXPECTED_SKILLS) {
      if (!existsSync(join(dir, skill, 'SKILL.md'))) {
        missing.push(skill);
      }
    }
    byIde[ide] = { installed: EXPECTED_SKILLS.length - missing.length, total: EXPECTED_SKILLS.length, missing };
  }

  return { expected: EXPECTED_SKILLS, by_ide: byIde };
}

function getDashboardStatus(ctx: AppContext) {
  const status = ctx.statusService.getStatus();
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const byIdeRows = ctx.db.prepare(
    `SELECT COALESCE(ide, 'unknown') AS ide, COUNT(*) AS count FROM conversations GROUP BY COALESCE(ide, 'unknown') ORDER BY count DESC`
  ).all() as Array<{ ide: string; count: number }>;

  const byWorkspaceRows = ctx.db.prepare(
    `
    SELECT
      COALESCE(workspace, 'global') AS workspace,
      COUNT(*) AS count
    FROM conversations
    GROUP BY COALESCE(workspace, 'global')
    ORDER BY count DESC
    LIMIT 10
    `
  ).all() as Array<{ workspace: string; count: number }>;

  const range = ctx.db.prepare(
    `SELECT MIN(started_at) AS oldest_started_at, MAX(updated_at) AS latest_updated_at FROM conversations`
  ).get() as { oldest_started_at: string | null; latest_updated_at: string | null };

  const c24 = ctx.db
    .prepare(`SELECT COUNT(*) AS c FROM conversations WHERE updated_at >= ?`)
    .get(last24h) as { c: number };
  const c7 = ctx.db
    .prepare(`SELECT COUNT(*) AS c FROM conversations WHERE updated_at >= ?`)
    .get(last7d) as { c: number };

  const configPath = join(homedir(), '.ai-memory', 'config.json');
  const configExists = existsSync(configPath);
  const configMtime = configExists ? statSync(configPath).mtime.toISOString() : null;
  const usage24h = ctx.usageService.getUsageSummary('24h');
  const usage7d = ctx.usageService.getUsageSummary('7d');

  return {
    generated_at: now.toISOString(),
    system_health: {
      db_path: status.db_path,
      db_exists: existsSync(status.db_path),
      db_readable: existsSync(status.db_path),
      conversation_count: status.conversations_count,
      turn_count: status.turns_count,
      latest_updated_at: range.latest_updated_at
    },
    data_coverage: {
      by_ide: byIdeRows,
      by_workspace_top: byWorkspaceRows,
      oldest_started_at: range.oldest_started_at,
      latest_updated_at: range.latest_updated_at,
      last_24h_conversations: c24.c,
      last_7d_conversations: c7.c
    },
    integrations: buildIntegrationStatus(ctx),
    watcher: buildWatcherStatus(ctx),
    skills: buildSkillsStatus(),
    config_snapshot: {
      ...ctx.config,
      config_path: configPath,
      config_exists: configExists,
      config_mtime: configMtime
    },
    // D038 D10: Active health warnings for dashboard banner
    warnings: status.warnings,
    runtime: {
      last_ingest_at: range.latest_updated_at,
      last_error: null,
    },
    usage_summary: {
      tool_calls_24h: usage24h.total_calls,
      tool_calls_7d: usage7d.total_calls,
      error_rate_7d: usage7d.error_rate,
      empty_search_rate_7d: usage7d.empty_search_rate,
      avg_latency_ms_7d: usage7d.avg_latency_ms
    }
  };
}

function getUsageDashboard(ctx: AppContext, params: Record<string, unknown>) {
  const range = parseUsageRange(params.range);
  return ctx.usageService.getUsageDashboard(range);
}

function getUsageSummary(ctx: AppContext, params: Record<string, unknown>) {
  const range = parseUsageRange(params.range);
  return ctx.usageService.getUsageSummary(range);
}

function setSummary(ctx: AppContext, params: Record<string, unknown>) {
  const conversationId = String(params.conversation_id ?? '');
  const summary = String(params.summary ?? '');
  const title = typeof params.title === 'undefined' ? undefined : String(params.title);
  if (!conversationId) throw new Error('Missing param: conversation_id');
  if (typeof title !== 'undefined') {
    ctx.conversationStore.updateTitle(conversationId, title);
  }
  ctx.conversationStore.upsertSummary(conversationId, summary);
  return {
    ok: true,
    conversation: ctx.conversationStore.byId(conversationId)
  };
}
