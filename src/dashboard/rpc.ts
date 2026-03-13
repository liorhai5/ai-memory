import type { AppContext } from '../app.js';
import { saveConfig } from '../services/config-service.js';
import { SearchService } from '../services/search-service.js';
import { InjectionService } from '../services/injection-service.js';
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
      case 'simulateInjection':
        return { ok: true, result: simulateInjection(ctx, params) };
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

function simulateInjection(ctx: AppContext, params: Record<string, unknown>) {
  const workspace = (params.workspace as string | undefined) ?? undefined;
  const limits = {
    max_conversations: Number(params.max_conversations ?? ctx.config.injection_max_conversations),
    max_title_chars: Number(params.max_title_chars ?? ctx.config.injection_max_title_chars),
    max_summary_chars: Number(params.max_summary_chars ?? ctx.config.injection_max_summary_chars),
    max_total_chars: Number(params.max_total_chars ?? ctx.config.injection_max_total_chars),
  };
  const output = ctx.injectionService.buildForWorkspace(workspace ?? null, limits);
  return { output, limits, chars: output.length };
}

function parseNumberParam(params: Record<string, unknown>, key: string): number | undefined {
  if (typeof params[key] === 'undefined') return undefined;
  const value = Number(params[key]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${key}: expected non-negative number`);
  }
  return value;
}

function updateConfig(ctx: AppContext, params: Record<string, unknown>) {
  const nextConfig = {
    ...ctx.config,
    injection_max_conversations:
      parseNumberParam(params, 'injection_max_conversations') ?? ctx.config.injection_max_conversations,
    injection_max_title_chars:
      parseNumberParam(params, 'injection_max_title_chars') ?? ctx.config.injection_max_title_chars,
    injection_max_summary_chars:
      parseNumberParam(params, 'injection_max_summary_chars') ?? ctx.config.injection_max_summary_chars,
    injection_max_total_chars:
      parseNumberParam(params, 'injection_max_total_chars') ?? ctx.config.injection_max_total_chars
  };

  saveConfig(nextConfig);
  ctx.config = nextConfig;
  ctx.searchService = new SearchService(ctx.db, nextConfig);
  ctx.injectionService = new InjectionService(ctx.conversationStore, nextConfig);

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

function hasHookCommand(entries: any, cmd: string): boolean {
  if (!Array.isArray(entries)) return false;
  return entries.some((e: any) => e && typeof e.command === 'string' && e.command === cmd);
}

function hasGroupedHookCommand(entries: any, cmd: string, matcher?: string): boolean {
  if (!Array.isArray(entries)) return false;
  return entries.some((group: any) => {
    if (!group || typeof group !== 'object') return false;
    if (typeof matcher !== 'undefined' && group.matcher !== matcher) return false;
    if (!Array.isArray(group.hooks)) return false;
    return group.hooks.some((hook: any) => hook && typeof hook.command === 'string' && hook.command === cmd);
  });
}

function readRawFile(path: string): { exists: boolean; content: string | null; error: string | null } {
  if (!existsSync(path)) return { exists: false, content: null, error: null };
  try {
    return { exists: true, content: readFileSync(path, 'utf8'), error: null };
  } catch (err) {
    return { exists: true, content: null, error: String(err) };
  }
}

function buildIntegrationStatus() {
  const home = homedir();
  const cursorHooksPath = join(home, '.cursor', 'hooks.json');
  const cursorMcpPath = join(home, '.cursor', 'mcp.json');
  const claudeSettingsPath = join(home, '.claude', 'settings.json');
  const claudeRegistryPath = join(home, '.claude.json');

  const cursorHooks = safeJson(cursorHooksPath);
  const cursorMcp = safeJson(cursorMcpPath);
  const claudeSettings = safeJson(claudeSettingsPath);
  const claudeRegistry = safeJson(claudeRegistryPath);

  const cursorJson = cursorHooks.json ?? {};
  const cursorHookData = cursorJson.hooks ?? {};
  const cursorExpected = {
    beforeSubmitPrompt: 'ai-memory hook prompt-submit --ide cursor',
    sessionStart: 'ai-memory hook session-start --ide cursor',
    stop: 'ai-memory hook stop --ide cursor',
    sessionEnd: 'ai-memory hook session-end --ide cursor'
  };

  const claudeJson = claudeSettings.json ?? {};
  const claudeHookData = claudeJson.hooks ?? {};
  const claudeExpected = {
    UserPromptSubmit: 'ai-memory hook prompt-submit --ide claude-code',
    SessionStart: 'ai-memory hook session-start --ide claude-code',
    Stop: 'ai-memory hook stop --ide claude-code',
    SessionEnd: 'ai-memory hook session-end --ide claude-code'
  };

  // D041: Codex integration check
  const codexConfigPath = join(home, '.codex', 'config.toml');
  const codexConfig = readRawFile(codexConfigPath);
  const codexNotifyConfigured = Boolean(codexConfig.content && /^notify\s*=.*ai-memory/m.test(codexConfig.content));

  return {
    cursor: {
      hooks_file: cursorHooksPath,
      mcp_file: cursorMcpPath,
      hooks_file_exists: cursorHooks.exists,
      mcp_file_exists: cursorMcp.exists,
      hooks_parse_error: cursorHooks.error,
      mcp_parse_error: cursorMcp.error,
      hooks: {
        beforeSubmitPrompt: hasHookCommand(cursorHookData.beforeSubmitPrompt, cursorExpected.beforeSubmitPrompt),
        sessionStart: hasHookCommand(cursorHookData.sessionStart, cursorExpected.sessionStart),
        stop: hasHookCommand(cursorHookData.stop, cursorExpected.stop),
        sessionEnd: hasHookCommand(cursorHookData.sessionEnd, cursorExpected.sessionEnd)
      },
      mcp_configured: Boolean(cursorMcp.json?.mcpServers?.['ai-memory'])
    },
    claude_code: {
      settings_file: claudeSettingsPath,
      settings_exists: claudeSettings.exists,
      settings_parse_error: claudeSettings.error,
      hooks: {
        UserPromptSubmit: hasGroupedHookCommand(claudeHookData.UserPromptSubmit, claudeExpected.UserPromptSubmit),
        SessionStart: hasGroupedHookCommand(
          claudeHookData.SessionStart,
          claudeExpected.SessionStart,
          'startup|resume|clear|compact'
        ),
        Stop: hasGroupedHookCommand(claudeHookData.Stop, claudeExpected.Stop),
        SessionEnd: hasGroupedHookCommand(claudeHookData.SessionEnd, claudeExpected.SessionEnd)
      },
      settings_mcp_configured: Boolean(claudeSettings.json?.mcpServers?.['ai-memory']),
      registry_file: claudeRegistryPath,
      registry_exists: claudeRegistry.exists,
      registry_parse_error: claudeRegistry.error,
      registry_mcp_configured: Boolean(claudeRegistry.json?.mcpServers?.['ai-memory']),
      mcp_configured: Boolean(claudeSettings.json?.mcpServers?.['ai-memory']) && Boolean(claudeRegistry.json?.mcpServers?.['ai-memory'])
    },
    codex: {
      config_file: codexConfigPath,
      config_exists: codexConfig.exists,
      notify_configured: codexNotifyConfigured,
      mcp_configured: Boolean(codexConfig.content && codexConfig.content.includes('[mcp_servers.ai-memory]')),
      config_parse_error: codexConfig.error
    }
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
    integrations: buildIntegrationStatus(),
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
