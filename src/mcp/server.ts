import type Database from 'better-sqlite3';
import { createApp } from '../app.js';
import type { SearchParams } from '../types.js';

export type ToolName =
  | 'ai-memory-search'
  | 'ai-memory-conversations'
  | 'ai-memory-conversation'
  | 'ai-memory-summarize'
  | 'ai-memory-status';

const RESULT_COUNT_EXTRACTORS: Record<ToolName, (r: any) => number | null> = {
  'ai-memory-search': r => r?.conversations?.length ?? 0,
  'ai-memory-conversations': r => r?.conversations?.length ?? 0,
  'ai-memory-conversation': r => r?.turns?.length ?? 0,
  'ai-memory-summarize': r => (r?.ok ? 1 : 0),
  'ai-memory-status': () => 1,
};

export function classifyError(err: unknown): string {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  if (msg.includes('not found')) return 'NOT_FOUND';
  if (msg.includes('invalid') || msg.includes('validation')) return 'VALIDATION';
  return 'INTERNAL';
}

function recordUsage(db: Database.Database, row: {
  tool_name: string;
  called_at: string;
  latency_ms: number;
  workspace: string | null;
  param_keys: string;
  result_count: number | null;
  success: number;
  error_type: string | null;
}) {
  try {
    db.prepare(`
      INSERT INTO tool_usage (tool_name, called_at, latency_ms, workspace, param_keys, result_count, success, error_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.tool_name, row.called_at, row.latency_ms, row.workspace, row.param_keys, row.result_count, row.success, row.error_type);
  } catch (e) {
    process.stderr.write(`[ai-memory] usage tracking INSERT failed: ${e}\n`);
  }
}

function extractWorkspace(input: Record<string, unknown>): string | null {
  const w = input?.workspace;
  return typeof w === 'string' ? w : null;
}

function withTracking<I extends Record<string, any>, R>(
  db: Database.Database,
  toolName: ToolName,
  handler: (input: I) => R | Promise<R>
): (input: I) => Promise<R> {
  return async (input: I) => {
    const safeInput = (input ?? {}) as I;
    const start = Date.now();
    let result: R;
    try {
      result = await handler(safeInput);
    } catch (err) {
      recordUsage(db, {
        tool_name: toolName,
        called_at: new Date().toISOString(),
        latency_ms: Date.now() - start,
        workspace: extractWorkspace(safeInput),
        param_keys: JSON.stringify(Object.keys(safeInput)),
        result_count: null,
        success: 0,
        error_type: classifyError(err),
      });
      throw err;
    }
    const extractor = RESULT_COUNT_EXTRACTORS[toolName];
    recordUsage(db, {
      tool_name: toolName,
      called_at: new Date().toISOString(),
      latency_ms: Date.now() - start,
      workspace: extractWorkspace(safeInput),
      param_keys: JSON.stringify(Object.keys(safeInput)),
      result_count: extractor ? extractor(result) : null,
      success: 1,
      error_type: null,
    });
    return result;
  };
}

export function createToolHandlers(dbPath?: string) {
  const app = createApp(dbPath);

  const rawHandlers = {
    async ['ai-memory-search'](input: SearchParams) {
      return app.searchService.search(input);
    },
    async ['ai-memory-conversations'](input: {
      workspace?: string | null;
      date_from?: string;
      date_to?: string;
      limit?: number;
      offset?: number;
    }) {
      return {
        conversations: app.conversationStore.listConversations({
          workspace: input.workspace,
          date_from: input.date_from,
          date_to: input.date_to,
          limit: input.limit,
          offset: input.offset
        })
      };
    },
    async ['ai-memory-conversation'](input: { conversation_id: string }) {
      const conversation = app.conversationStore.byId(input.conversation_id);
      if (!conversation) return { conversation: null, turns: [] };
      return {
        conversation,
        turns: app.conversationStore.listTurns(input.conversation_id)
      };
    },
    async ['ai-memory-summarize'](input: { conversation_id: string; summary: string; title?: string }) {
      if (typeof input.title !== 'undefined') {
        app.conversationStore.updateTitle(input.conversation_id, input.title);
      }
      app.conversationStore.upsertSummary(input.conversation_id, input.summary);
      return {
        ok: true,
        conversation: app.conversationStore.byId(input.conversation_id)
      };
    },
    async ['ai-memory-status'](_input: Record<string, unknown>) {
      return app.statusService.getStatus();
    }
  };

  return {
    'ai-memory-search': withTracking(app.db, 'ai-memory-search', rawHandlers['ai-memory-search']),
    'ai-memory-conversations': withTracking(app.db, 'ai-memory-conversations', rawHandlers['ai-memory-conversations']),
    'ai-memory-conversation': withTracking(app.db, 'ai-memory-conversation', rawHandlers['ai-memory-conversation']),
    'ai-memory-summarize': withTracking(app.db, 'ai-memory-summarize', rawHandlers['ai-memory-summarize']),
    'ai-memory-status': withTracking(app.db, 'ai-memory-status', rawHandlers['ai-memory-status']),
  };
}

export function listTools(): ToolName[] {
  return ['ai-memory-search', 'ai-memory-conversations', 'ai-memory-conversation', 'ai-memory-summarize', 'ai-memory-status'];
}
