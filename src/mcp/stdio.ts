import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createToolHandlers } from './server.js';
import { createApp } from '../app.js';

export async function startStdioServer(dbPath: string) {
  const server = new McpServer({ name: 'ai-memory', version: '0.2.0' });
  const handlers = createToolHandlers(dbPath);

  server.tool(
    'ai-memory-search',
    'Search conversation history. Returns matching conversations with turn snippets. Use this when you need past context.',
    {
      query: z.string().optional().describe('Search query text'),
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

  // MCP Prompts — user-triggered slash commands (appear in IDE `/` autocomplete)
  const app = createApp(dbPath);

  server.prompt(
    'status',
    'Quick health check — conversation count, turn count, tool usage stats',
    async () => ({
      messages: [{
        role: 'user' as const,
        content: { type: 'text' as const, text: `Here is the current ai-memory status:\n${JSON.stringify(app.statusService.getStatus(), null, 2)}\n\nPresent this to the user as a brief, readable summary.` }
      }]
    })
  );

  server.prompt(
    'search',
    'Search conversation history by keyword',
    { query: z.string().describe('Search query text') },
    async ({ query }) => {
      const result = await handlers['ai-memory-search']({ query });
      return {
        messages: [{
          role: 'user' as const,
          content: { type: 'text' as const, text: `Search results for "${query}":\n${JSON.stringify(result, null, 2)}\n\nPresent these results to the user — show conversation titles, dates, and matching snippets.` }
        }]
      };
    }
  );

  server.prompt(
    'recent',
    'Recent conversations — titles, summaries, dates',
    async () => {
      const result = await handlers['ai-memory-conversations']({ limit: 10 });
      return {
        messages: [{
          role: 'user' as const,
          content: { type: 'text' as const, text: `Recent conversations from ai-memory:\n${JSON.stringify(result, null, 2)}\n\nPresent these as a readable list — title, date, and summary for each.` }
        }]
      };
    }
  );

  server.prompt(
    'summarize',
    'Summarize this conversation and save it via ai-memory',
    async () => ({
      messages: [{
        role: 'user' as const,
        content: { type: 'text' as const, text: 'The user wants to save a summary of this conversation to ai-memory.\n\nSteps:\n1. Call ai-memory-conversations (limit 5) to find the current conversation by matching the title or most recent timestamp.\n2. Write a progressive summary: start with a one-line overview, then key decisions and open items. Be specific — include names, choices, and reasoning.\n3. Write a concise title (~60 chars) that reflects the current topic.\n4. Call ai-memory-summarize with the conversation_id, your summary text, and the title.' }
      }]
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
