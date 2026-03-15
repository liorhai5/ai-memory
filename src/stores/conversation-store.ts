import type Database from 'better-sqlite3';
import type { Conversation, IdeType, Turn, TurnRole } from '../types.js';
import { hashContent } from '../utils/hash.js';
import { newId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';
import { normalizeWorkspaceLabel } from '../utils/workspace-identity.js';

export class ConversationStore {
  constructor(
    private readonly db: Database.Database,
    private readonly titleMaxChars = 80
  ) {}

  upsertConversationByExternalId(input: {
    external_id: string;
    workspace: string | null;
    workspace_path?: string | null;
    ide: IdeType | null;
    source_path?: string | null;
    source_mtime?: string | null;
    started_at?: string;
  }): Conversation {
    const workspace = normalizeWorkspaceLabel(input.workspace);
    const workspacePath = input.workspace_path ?? null;
    const existing = this.byExternalId(input.external_id);
    if (existing) {
      this.db
        .prepare(
          `
          UPDATE conversations
          SET workspace = COALESCE(?, workspace),
              workspace_path = COALESCE(?, workspace_path),
              ide = COALESCE(?, ide),
              source_path = COALESCE(?, source_path),
              source_mtime = COALESCE(?, source_mtime)
          WHERE id = ?
          `
        )
        .run(workspace, workspacePath, input.ide, input.source_path ?? null, input.source_mtime ?? null, existing.id);
      return this.byId(existing.id)!;
    }

    const now = input.started_at ?? nowIso();
    const row: Conversation = {
      id: newId(),
      external_id: input.external_id,
      workspace,
      workspace_path: workspacePath,
      ide: input.ide,
      source_path: input.source_path ?? null,
      source_mtime: input.source_mtime ?? null,
      title: null,
      summary: null,
      turn_count: 0,
      started_at: now,
      updated_at: now
    };
    this.db
      .prepare(
        `
        INSERT INTO conversations (
          id, external_id, workspace, workspace_path, ide, source_path, source_mtime,
          title, summary, turn_count, started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        row.id,
        row.external_id,
        row.workspace,
        row.workspace_path,
        row.ide,
        row.source_path,
        row.source_mtime,
        row.title,
        row.summary,
        row.turn_count,
        row.started_at,
        row.updated_at
      );
    return row;
  }

  byExternalId(externalId: string): Conversation | null {
    return (
      (this.db.prepare(`SELECT * FROM conversations WHERE external_id = ?`).get(externalId) as Conversation | undefined) ??
      null
    );
  }

  byId(id: string): Conversation | null {
    return (this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id) as Conversation | undefined) ?? null;
  }

  listRecentByWorkspace(input: {
    workspace: string | null;
    limit: number;
    include_other?: boolean;
  }): Conversation[] {
    const normalizedWorkspace = normalizeWorkspaceLabel(input.workspace);
    const includeOther = input.include_other ?? true;
    if (!includeOther) {
      return this.db
        .prepare(
          `SELECT * FROM conversations WHERE workspace IS ? ORDER BY updated_at DESC LIMIT ?`
        )
        .all(normalizedWorkspace, input.limit) as Conversation[];
    }
    const same = this.db
      .prepare(
        `SELECT * FROM conversations WHERE workspace IS ? ORDER BY updated_at DESC LIMIT ?`
      )
      .all(normalizedWorkspace, input.limit) as Conversation[];
    if (same.length >= input.limit) return same;
    const rest = this.db
      .prepare(
        `SELECT * FROM conversations WHERE workspace IS NOT ? ORDER BY updated_at DESC LIMIT ?`
      )
      .all(normalizedWorkspace, input.limit - same.length) as Conversation[];
    return [...same, ...rest];
  }

  private normalizeTitle(title: string, rejectEmpty = true): string | null {
    const normalized = title.replace(/\s+/g, ' ').trim().slice(0, this.titleMaxChars);
    if (!normalized) {
      if (rejectEmpty) {
        throw new Error('Invalid title: must contain non-whitespace characters');
      }
      return null;
    }
    return normalized;
  }

  private updateTitleSql(conversationId: string, title: string, onlyIfEmpty: boolean): void {
    const sql = onlyIfEmpty
      ? `UPDATE conversations SET title = ? WHERE id = ? AND (title IS NULL OR title = '')`
      : `UPDATE conversations SET title = ? WHERE id = ?`;
    const result = this.db.prepare(sql).run(title, conversationId);
    if (result.changes === 0 && !this.byId(conversationId)) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
  }

  setTitleIfEmpty(conversationId: string, title: string): void {
    const normalized = this.normalizeTitle(title, false);
    if (!normalized) return;
    this.updateTitleSql(conversationId, normalized, true);
  }

  updateTitle(conversationId: string, title: string): void {
    this.updateTitleSql(conversationId, this.normalizeTitle(title)!, false);
  }

  upsertSummary(conversationId: string, summary: string): void {
    const result = this.db.prepare(`UPDATE conversations SET summary = ? WHERE id = ?`).run(summary, conversationId);
    if (result.changes === 0) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
  }

  addTurn(input: {
    conversation_id: string;
    role: TurnRole;
    content: string;
    created_at?: string;
  }): Turn | null {
    const createdAt = input.created_at ?? nowIso();
    const contentHash = hashContent(input.content);
    const nextTurn =
      ((this.db.prepare(`SELECT MAX(turn_number) as n FROM turns WHERE conversation_id = ?`).get(input.conversation_id) as { n: number | null })
        ?.n ?? 0) + 1;

    const turn: Turn = {
      id: newId(),
      conversation_id: input.conversation_id,
      role: input.role,
      content: input.content,
      content_hash: contentHash,
      turn_number: nextTurn,
      created_at: createdAt
    };

    const inserted = this.db
      .prepare(
        `
        INSERT OR IGNORE INTO turns (
          id, conversation_id, role, content, content_hash, turn_number, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        turn.id,
        turn.conversation_id,
        turn.role,
        turn.content,
        turn.content_hash,
        turn.turn_number,
        turn.created_at
      );
    if (inserted.changes === 0) return null;

    this.db
      .prepare(`INSERT OR REPLACE INTO turns_fts (id, content) VALUES (?, ?)`)
      .run(turn.id, turn.content);

    this.db
      .prepare(`UPDATE conversations SET turn_count = turn_count + 1, updated_at = ? WHERE id = ?`)
      .run(createdAt, input.conversation_id);

    return turn;
  }

  listTurns(conversationId: string): Turn[] {
    return this.db
      .prepare(`SELECT * FROM turns WHERE conversation_id = ? ORDER BY turn_number ASC`)
      .all(conversationId) as Turn[];
  }

  pruneEmptyConversations(olderThanMs = 3_600_000): number {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const result = this.db
      .prepare(`DELETE FROM conversations WHERE turn_count = 0 AND title IS NULL AND updated_at < ?`)
      .run(cutoff);
    return result.changes;
  }

  listConversations(input: {
    workspace?: string | null;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
  }): Conversation[] {
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;
    const where: string[] = [];
    const params: unknown[] = [];
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
    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    return this.db
      .prepare(`SELECT * FROM conversations${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Conversation[];
  }
}
