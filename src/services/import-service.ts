import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import type { IdeType, TurnRole } from '../types.js';
import { ConversationStore } from '../stores/conversation-store.js';
import { stripPromptWrappers } from '../utils/strip.js';
import { deriveProjectKey, normalizeWorkspaceLabel } from '../utils/workspace-identity.js';

export interface ImportReport {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface ParsedMessage {
  role: TurnRole;
  content: string;
  created_at: string;
}

function firstTextContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content.find((c) => c?.type === 'text' && typeof c.text === 'string');
    return text?.text ?? '';
  }
  return '';
}

function toIso(ts: unknown): string {
  if (typeof ts === 'string') return ts;
  return new Date().toISOString();
}

export class ImportService {
  constructor(private readonly conversationStore: ConversationStore) {}

  importTranscripts(source: 'cursor' | 'claude-code' | 'all' = 'all', forceSummary = false): ImportReport {
    const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: 0 };
    if (source === 'all' || source === 'claude-code') {
      this.importClaude(report, forceSummary);
    }
    if (source === 'all' || source === 'cursor') {
      this.importCursor(report, forceSummary);
    }
    return report;
  }

  private importClaude(report: ImportReport, forceSummary: boolean): void {
    const base = `${homedir()}/.claude/projects`;
    if (!existsSync(base)) return;
    const projectDirs = readdirSync(base);
    for (const project of projectDirs) {
      const dir = `${base}/${project}`;
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      for (const file of files) {
        this.importFile({
          ide: 'claude-code',
          filePath: `${dir}/${file}`,
          externalId: file.replace(/\.jsonl$/, ''),
          workspace: project.replace(/^-/, ''),
          report,
          forceSummary
        });
      }
    }
  }

  private importCursor(report: ImportReport, forceSummary: boolean): void {
    const base = `${homedir()}/.cursor/projects`;
    if (!existsSync(base)) return;
    const projectDirs = readdirSync(base);
    for (const project of projectDirs) {
      const transcriptBase = `${base}/${project}/agent-transcripts`;
      if (!existsSync(transcriptBase)) continue;
      const conversationDirs = readdirSync(transcriptBase);
      for (const convDir of conversationDirs) {
        const path = `${transcriptBase}/${convDir}/${convDir}.jsonl`;
        if (!existsSync(path)) continue;
        this.importFile({
          ide: 'cursor',
          filePath: path,
          externalId: convDir,
          workspace: project,
          report,
          forceSummary
        });
      }
    }
  }

  private importFile(input: {
    ide: IdeType;
    filePath: string;
    externalId: string;
    workspace: string;
    report: ImportReport;
    forceSummary: boolean;
  }): void {
    try {
      const stat = statSync(input.filePath);
      const lines = readFileSync(input.filePath, 'utf8').split('\n').filter(Boolean);
      const messages = this.parseMessages(lines, input.ide);
      if (messages.length === 0) {
        input.report.skipped += 1;
        return;
      }

      const existing = this.conversationStore.byExternalId(input.externalId);
      const workspaceLabel = normalizeWorkspaceLabel(input.workspace);
      const conversation = this.conversationStore.upsertConversationByExternalId({
        external_id: input.externalId,
        workspace: workspaceLabel,
        project_key: deriveProjectKey({
          workspace: workspaceLabel,
          sourcePath: input.filePath
        }),
        ide: input.ide,
        source_path: input.filePath,
        source_mtime: stat.mtime.toISOString(),
        started_at: messages[0].created_at
      });
      if (existing) input.report.updated += 1;
      else input.report.created += 1;

      const firstUser = messages.find((m) => m.role === 'user');
      if (firstUser) {
        const clean = stripPromptWrappers(firstUser.content);
        this.conversationStore.setTitleIfEmpty(conversation.id, clean);
        if (input.forceSummary || !conversation.summary) {
          this.conversationStore.upsertSummary(conversation.id, clean);
        }
      }

      for (const msg of messages) {
        const inserted = this.conversationStore.addTurn({
          conversation_id: conversation.id,
          role: msg.role,
          content: msg.content,
          created_at: msg.created_at
        });
        if (!inserted) input.report.skipped += 1;
      }
    } catch {
      input.report.errors += 1;
    }
  }

  private parseMessages(lines: string[], ide: IdeType): ParsedMessage[] {
    const messages: ParsedMessage[] = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (ide === 'cursor') {
          if (row.role !== 'user' && row.role !== 'assistant') continue;
          const text = firstTextContent(row.message?.content);
          if (!text.trim()) continue;
          messages.push({ role: row.role, content: text, created_at: toIso(row.timestamp) });
          continue;
        }
        if (ide === 'claude-code') {
          if (row.type !== 'user' && row.type !== 'assistant') continue;
          const text = firstTextContent(row.message?.content);
          if (!text.trim()) continue;
          messages.push({ role: row.type, content: text, created_at: toIso(row.timestamp) });
        }
      } catch {
        // Ignore malformed JSON lines. Caller tracks file-level errors on failure.
      }
    }
    return messages;
  }
}
