import type Database from 'better-sqlite3';
import type { AiMemoryConfig } from './config-service.js';
import type { SearchConversationMatch, SearchParams } from '../types.js';
import { normalizeWorkspaceLabel } from '../utils/workspace-identity.js';

export interface SearchResult {
  conversations: SearchConversationMatch[];
  total: number;
  has_more: boolean;
}

function sanitizeFtsQuery(query: string): string {
  return query.replace(/[,.\-!"#$%&'()*+/:;<=>?@[\\\]^_`{|}~]/g, ' ').trim();
}

export class SearchService {
  private readonly defaultLimit: number;

  constructor(private readonly db: Database.Database, config: AiMemoryConfig) {
    this.defaultLimit = config.search_default_limit;
  }

  search(input: SearchParams): SearchResult {
    const limit = input.limit ?? this.defaultLimit;
    const offset = input.offset ?? 0;
    const rows: SearchConversationMatch[] = [];
    const seen = new Set<string>();
    const query = (input.query ?? '').trim();
    const sanitized = sanitizeFtsQuery(query);

    if (sanitized.length > 0) {
      const where: string[] = ['turns_fts MATCH ?'];
      const params: unknown[] = [sanitized];
      if (typeof input.workspace !== 'undefined') {
        const normalizedWorkspace = normalizeWorkspaceLabel(input.workspace);
        where.push('c.workspace IS ?');
        params.push(normalizedWorkspace);
      }
      if (input.date_from) {
        where.push('c.updated_at >= ?');
        params.push(input.date_from);
      }
      if (input.date_to) {
        where.push('c.updated_at <= ?');
        params.push(input.date_to);
      }
      if (input.role) {
        where.push('t.role = ?');
        params.push(input.role);
      }

      const turnMatches = this.db
        .prepare(
          `
          SELECT
            c.id, c.title, c.summary, c.workspace, c.ide, c.started_at, c.turn_count,
            t.role, t.content, t.turn_number
          FROM turns_fts
          JOIN turns t ON t.id = turns_fts.id
          JOIN conversations c ON c.id = t.conversation_id
          WHERE ${where.join(' AND ')}
          ORDER BY bm25(turns_fts), c.updated_at DESC
          LIMIT ? OFFSET ?
          `
        )
        .all(...params, limit * 3, 0) as Array<{
        id: string;
        title: string | null;
        summary: string | null;
        workspace: string | null;
        ide: string | null;
        started_at: string;
        turn_count: number;
        role: string;
        content: string;
        turn_number: number;
      }>;

      for (const row of turnMatches) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push({
          id: row.id,
          title: row.title,
          summary: row.summary,
          workspace: row.workspace,
          ide: row.ide,
          started_at: row.started_at,
          turn_count: row.turn_count,
          match_source: 'turn',
          matching_turns: [{ role: row.role, content: row.content, turn_number: row.turn_number }]
        });
        if (rows.length >= limit + offset + 1) break;
      }
    }

    if (query.length > 0 && rows.length < limit + offset + 1) {
      const like = `%${query}%`;
      const where: string[] = ['(summary LIKE ? OR title LIKE ?)'];
      const params: unknown[] = [like, like];
      if (typeof input.workspace !== 'undefined') {
        const normalizedWorkspace = normalizeWorkspaceLabel(input.workspace);
        where.push('workspace IS ?');
        params.push(normalizedWorkspace);
      }
      if (input.date_from) {
        where.push('updated_at >= ?');
        params.push(input.date_from);
      }
      if (input.date_to) {
        where.push('updated_at <= ?');
        params.push(input.date_to);
      }
      const summaryTitleMatches = this.db
        .prepare(
          `
          SELECT *
          FROM conversations
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC
          LIMIT ?
          `
        )
        .all(...params, limit * 3) as Array<{
        id: string;
        title: string | null;
        summary: string | null;
        workspace: string | null;
        ide: string | null;
        started_at: string;
        turn_count: number;
      }>;

      for (const row of summaryTitleMatches) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const source: 'summary' | 'title' = row.summary && row.summary.includes(query) ? 'summary' : 'title';
        rows.push({
          ...row,
          match_source: source,
          matching_turns: []
        });
        if (rows.length >= limit + offset + 1) break;
      }
    }

    const has_more = rows.length > limit + offset;
    const page = rows.slice(offset, offset + limit);
    return {
      conversations: page,
      total: page.length,
      has_more
    };
  }
}
