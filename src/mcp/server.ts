import { createApp } from '../app.js';
import { StatusService } from '../services/status-service.js';
import type { LinkType } from '../types.js';

export type ToolName = 'ai-memory-query' | 'ai-memory-capture' | 'ai-memory-events' | 'ai-memory-status';

export function createToolHandlers(dbPath?: string) {
  const app = createApp(dbPath);
  const statusService = new StatusService(app.captureStore, app.memoryStore, dbPath ?? process.env.AI_MEMORY_DB_PATH ?? ':memory:');

  return {
    async ['ai-memory-query'](input: { query: string; workspace?: string | null; token_budget?: number; top_k?: number }) {
      return app.retrievalService.query({
        query: input.query,
        workspace: input.workspace ?? null,
        token_budget: input.token_budget,
        top_k: input.top_k
      });
    },
    async ['ai-memory-capture'](input: {
      session_id: string;
      workspace?: string | null;
      items: Array<{
        type: 'decision' | 'correction' | 'pattern' | 'learning' | 'preference' | 'fact';
        content: string;
        extraction_confidence?: number;
        links?: Array<{ target_content?: string; link_type: LinkType }>;
      }>;
    }) {
      // MCP capture is called by LLM during L2 enrichment — use captureL2 to upgrade existing L1 entries
      return app.hebbianMatcher.captureL2({ session_id: input.session_id, workspace: input.workspace ?? null, items: input.items, source: 'mcp' });
    },
    async ['ai-memory-events'](input: { session_id?: string; event_id?: string; workspace?: string | null; limit?: number }) {
      return { events: app.captureStore.query(input.session_id, input.event_id, input.workspace, input.limit ?? 50) };
    },
    async ['ai-memory-status'](input?: { workspace?: string | null; include_pending_ids?: boolean }) {
      return statusService.getStatus({ include_pending_ids: input?.include_pending_ids });
    }
  };
}

export function listTools(): ToolName[] {
  return ['ai-memory-query', 'ai-memory-capture', 'ai-memory-events', 'ai-memory-status'];
}
