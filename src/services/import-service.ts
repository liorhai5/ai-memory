import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import type { IdeType, TurnRole } from '../types.js';
import { ConversationStore } from '../stores/conversation-store.js';
import { stripPromptWrappers } from '../utils/strip.js';
import { resolveWorkspace } from '../utils/workspace-identity.js';

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

/** Extract the IDE project token from a source path. */
function extractToken(filePath: string): string | null {
  for (const marker of ['/.claude/projects/', '/.cursor/projects/']) {
    const idx = filePath.indexOf(marker);
    if (idx >= 0) {
      const rest = filePath.substring(idx + marker.length);
      const token = rest.split('/')[0];
      return token || null;
    }
  }
  return null;
}

/** Recursively collect all .jsonl files under a directory. */
function collectJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        results.push(...collectJsonlFiles(full));
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(full);
      }
    }
  } catch { /* skip inaccessible dirs */ }
  return results;
}

export class ImportService {
  constructor(private readonly conversationStore: ConversationStore) {}

  importTranscripts(source: 'cursor' | 'claude-code' | 'codex' | 'all' = 'all', forceSummary = false): ImportReport {
    const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: 0 };
    if (source === 'all' || source === 'claude-code') {
      this.importClaude(report, forceSummary);
    }
    if (source === 'all' || source === 'cursor') {
      this.importCursor(report, forceSummary);
    }
    if (source === 'all' || source === 'codex') {
      this.importCodex(report, forceSummary);
    }
    // D044 D9: Defensive prune — import only creates conversations with turns, but clean up any stragglers
    this.conversationStore.pruneEmptyConversations();
    return report;
  }

  // D044: Import a single file (for file-watcher triggered imports)
  importFile(filePath: string, forceSummary = false): ImportReport {
    const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: 0 };
    if (filePath.includes('/.claude/projects/')) {
      const fileName = filePath.split('/').pop()!;
      if (!fileName.endsWith('.jsonl')) { report.skipped += 1; return report; }
      const externalId = fileName.replace(/\.jsonl$/, '');
      const token = extractToken(filePath);
      this.importSingleFile({ ide: 'claude-code', filePath, externalId, token, report, forceSummary });
    } else if (filePath.includes('/.cursor/projects/')) {
      const fileName = filePath.split('/').pop()!;
      if (!fileName.endsWith('.jsonl')) { report.skipped += 1; return report; }
      const externalId = fileName.replace(/\.jsonl$/, '');
      const token = extractToken(filePath);
      this.importSingleFile({ ide: 'cursor', filePath, externalId, token, report, forceSummary });
    } else if (filePath.includes('/.codex/sessions/')) {
      this.importCodexFile(filePath, report, forceSummary);
    } else {
      report.skipped += 1;
    }
    return report;
  }

  // D045: Recursive traversal to pick up subagent .jsonl files
  private importClaude(report: ImportReport, forceSummary: boolean): void {
    const base = `${homedir()}/.claude/projects`;
    if (!existsSync(base)) return;
    const projectDirs = readdirSync(base);
    for (const project of projectDirs) {
      const dir = `${base}/${project}`;
      if (!existsSync(dir)) continue;
      const jsonlFiles = collectJsonlFiles(dir);
      for (const filePath of jsonlFiles) {
        const fileName = filePath.split('/').pop()!;
        const externalId = fileName.replace(/\.jsonl$/, '');
        this.importSingleFile({
          ide: 'claude-code',
          filePath,
          externalId,
          token: project,
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
        this.importSingleFile({
          ide: 'cursor',
          filePath: path,
          externalId: convDir,
          token: project,
          report,
          forceSummary
        });
      }
    }
  }

  // D044 D2: Codex transcript import — reads from ~/.codex/sessions/YYYY/MM/DD/*.jsonl
  private importCodex(report: ImportReport, forceSummary: boolean): void {
    const base = `${homedir()}/.codex/sessions`;
    if (!existsSync(base)) return;
    const years = readdirSync(base);
    for (const year of years) {
      const yearDir = `${base}/${year}`;
      if (!existsSync(yearDir)) continue;
      let months: string[];
      try { months = readdirSync(yearDir); } catch { continue; }
      for (const month of months) {
        const monthDir = `${yearDir}/${month}`;
        if (!existsSync(monthDir)) continue;
        let days: string[];
        try { days = readdirSync(monthDir); } catch { continue; }
        for (const day of days) {
          const dayDir = `${monthDir}/${day}`;
          if (!existsSync(dayDir)) continue;
          let files: string[];
          try { files = readdirSync(dayDir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
          for (const file of files) {
            this.importCodexFile(`${dayDir}/${file}`, report, forceSummary);
          }
        }
      }
    }
  }

  private importCodexFile(filePath: string, report: ImportReport, forceSummary: boolean): void {
    try {
      const stat = statSync(filePath);
      const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
      const { externalId, workspace, workspacePath, startedAt } = this.parseCodexMeta(lines);
      if (!externalId) { report.skipped += 1; return; }
      const messages = this.parseCodexMessages(lines);
      if (messages.length === 0) { report.skipped += 1; return; }

      const existing = this.conversationStore.byExternalId(externalId);
      const conversation = this.conversationStore.upsertConversationByExternalId({
        external_id: externalId,
        workspace,
        workspace_path: workspacePath,
        ide: 'codex',
        source_path: filePath,
        source_mtime: stat.mtime.toISOString(),
        started_at: startedAt ?? messages[0].created_at
      });
      if (existing) report.updated += 1;
      else report.created += 1;

      const firstUser = messages.find((m) => m.role === 'user');
      if (firstUser) {
        const clean = stripPromptWrappers(firstUser.content);
        this.conversationStore.setTitleIfEmpty(conversation.id, clean);
        if (forceSummary || !conversation.summary) {
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
        if (!inserted) report.skipped += 1;
      }
    } catch {
      report.errors += 1;
    }
  }

  private parseCodexMeta(lines: string[]): { externalId: string | null; workspace: string | null; workspacePath: string | null; startedAt: string | null } {
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row.type === 'session_meta' && row.payload) {
          const externalId = typeof row.payload.id === 'string' ? row.payload.id : null;
          const cwd = typeof row.payload.cwd === 'string' ? row.payload.cwd : null;
          const workspace = cwd ? basename(cwd) : null;
          const startedAt = typeof row.timestamp === 'string' ? row.timestamp : null;
          return { externalId, workspace, workspacePath: cwd, startedAt };
        }
      } catch { /* skip malformed */ }
    }
    return { externalId: null, workspace: null, workspacePath: null, startedAt: null };
  }

  private parseCodexMessages(lines: string[]): ParsedMessage[] {
    const messages: ParsedMessage[] = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row.type !== 'response_item') continue;
        const payload = row.payload;
        if (!payload || payload.type !== 'message') continue;
        const role = payload.role;
        if (role !== 'user' && role !== 'assistant') continue; // skip developer/system
        const content = Array.isArray(payload.content)
          ? payload.content
              .filter((c: any) => (c?.type === 'input_text' || c?.type === 'output_text') && typeof c.text === 'string')
              .map((c: any) => c.text as string)
              .join('')
          : '';
        if (!content.trim()) continue;
        messages.push({ role: role as TurnRole, content, created_at: toIso(row.timestamp) });
      } catch { /* skip malformed */ }
    }
    return messages;
  }

  // D045: importSingleFile now uses resolveWorkspace() with token + transcript lines
  private importSingleFile(input: {
    ide: IdeType;
    filePath: string;
    externalId: string;
    token: string | null;
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

      const { workspace, workspace_path } = resolveWorkspace(input.ide, input.token, lines);
      const existing = this.conversationStore.byExternalId(input.externalId);
      const conversation = this.conversationStore.upsertConversationByExternalId({
        external_id: input.externalId,
        workspace,
        workspace_path,
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
