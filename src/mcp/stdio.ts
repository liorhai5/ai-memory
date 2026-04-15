import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createToolHandlers } from './server.js';
import { watch } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { createApp } from '../app.js';

// D044 D1: Watched transcript directories
const WATCHED_DIRS = [
  `${homedir()}/.claude/projects`,
  `${homedir()}/.cursor/projects`,
  `${homedir()}/.codex/sessions`,
];

export async function startStdioServer(dbPath: string) {
  const server = new McpServer({ name: 'ai-memory', version: '0.2.0' });
  const handlers = createToolHandlers(dbPath);

  server.tool(
    'ai-memory-search',
    'Search past conversations using SQLite FTS5. Supports BM25 ranking, quoted phrases for exact match. Cascades from AND to OR on low results. Paginated — check has_more and use offset.',
    {
      query: z.string().optional().describe('FTS5 query — use 1–3 keywords, not sentences. Supports "quoted phrases". Stop words are stripped automatically.'),
      workspace: z.string().nullable().optional().describe('Filter by workspace name'),
      date_from: z.string().optional().describe('ISO date lower bound (filters on updated_at)'),
      date_to: z.string().optional().describe('ISO date upper bound (filters on updated_at)'),
      role: z.enum(['user', 'assistant']).optional().describe('Filter by turn role'),
      limit: z.number().optional().describe('Max number of results (default 20)'),
      offset: z.number().optional().describe('Pagination offset')
    },
    async (input) => {
      try {
        const result = await handlers['ai-memory-search'](input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }) }], isError: true };
      }
    }
  );

  server.tool(
    'ai-memory-conversations',
    'List recent conversations with title and summary.',
    {
      workspace: z.string().nullable().optional().describe('Workspace name'),
      date_from: z.string().optional().describe('ISO date lower bound (filters on updated_at)'),
      date_to: z.string().optional().describe('ISO date upper bound (filters on updated_at)'),
      limit: z.number().optional().describe('Max results (default 20)'),
      offset: z.number().optional().describe('Pagination offset')
    },
    async (input) => {
      try {
        const result = await handlers['ai-memory-conversations'](input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }) }], isError: true };
      }
    }
  );

  server.tool(
    'ai-memory-conversation',
    'Get full transcript for a conversation.',
    {
      conversation_id: z.string().describe('Conversation ID')
    },
    async (input) => {
      try {
        const result = await handlers['ai-memory-conversation'](input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }) }], isError: true };
      }
    }
  );

  server.tool(
    'ai-memory-summarize',
    'Update the summary for the current conversation. Call after important progress — decisions made, direction changes, milestones reached, or when the user asks. Start with a one-line overview, then add key decisions and open items. Be specific — include names, choices, and reasoning. Optionally include title (~60 chars) when the topic is clear or changed.',
    {
      conversation_id: z.string().describe('Conversation ID'),
      summary: z.string().describe('Progressive summary text'),
      title: z.string().optional().describe('Optional concise title (~60 chars) when topic is clear or changed')
    },
    async (input) => {
      try {
        const result = await handlers['ai-memory-summarize'](input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }) }], isError: true };
      }
    }
  );

  server.tool(
    'ai-memory-status',
    'Health check — shows conversations count, turns count, DB path, and index status.',
    {
      workspace: z.string().nullable().optional().describe('Filter by workspace')
    },
    async (input) => {
      try {
        const result = await handlers['ai-memory-status'](input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }) }], isError: true };
      }
    }
  );

  // D044 D1: Create app for file watching and startup catch-up
  const app = createApp(dbPath);

  // D044 D1: Register file watchers first so no events are missed during catch-up
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  for (const dir of WATCHED_DIRS) {
    if (!existsSync(dir)) continue;
    try {
      watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return;
        const filePath = `${dir}/${filename}`;
        const existing = debounceTimers.get(filePath);
        if (existing) clearTimeout(existing);
        debounceTimers.set(filePath, setTimeout(() => {
          debounceTimers.delete(filePath);
          if (!existsSync(filePath)) return;
          try {
            app.importService.importFile(filePath);
            // D044 D6: Record watcher-triggered import usage
            app.db.prepare(
              `INSERT INTO tool_usage (tool_name, called_at, latency_ms, workspace, param_keys, result_count, success, error_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run('import:watch', new Date().toISOString(), 0, null, '[]', 1, 1, null);
          } catch {
            // Non-fatal — record watcher error in health_warnings
            try {
              app.db.prepare(
                `INSERT INTO health_warnings (category, message, first_seen_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now')) ON CONFLICT(category, message) DO UPDATE SET last_seen_at = datetime('now'), resolved_at = NULL`
              ).run('watcher_error', `import failed: ${filename}`);
            } catch { /* truly non-fatal */ }
          }
        }, 500));
      });
    } catch {
      // Non-fatal — record as health warning on next status check
    }
  }

  // D044 D4: Startup catch-up import — after watchers are registered so no events are missed
  try {
    app.importService.importTranscripts('all');
  } catch {
    // Non-fatal — never let catch-up break server startup
  }

  // Skills are deployed separately via `npx skills add` (AgentSkills format)

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
