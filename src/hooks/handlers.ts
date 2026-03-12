import { homedir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { checkHookPresence } from './init-config.js';
import { newId } from '../utils/id.js';
import { stripPromptWrappers } from '../utils/strip.js';
import type { IdeType } from '../types.js';

export function sessionStartHook(input: {
  ide: IdeType;
  workspace: string | null;
  project_key?: string | null;
  session_id?: string;
  dbPath?: string;
}) {
  const app = createApp(input.dbPath);
  app.conversationStore.pruneEmptyConversations();

  // D038 D16: Lightweight config drift detection on every session-start
  if (input.ide === 'cursor' || input.ide === 'claude-code') {
    try {
      const home = homedir();
      const filePath = input.ide === 'cursor'
        ? join(home, '.cursor/hooks.json')
        : join(home, '.claude/settings.json');
      const check = checkHookPresence(input.ide, filePath);
      if (!check.ok) {
        for (const msg of check.missing) {
          app.db.prepare(`
            INSERT INTO health_warnings (category, message, first_seen_at, last_seen_at)
            VALUES (?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(category, message) DO UPDATE SET last_seen_at = datetime('now'), resolved_at = NULL
          `).run('init_drift', msg);
        }
      } else {
        // Resolve any prior drift warnings for this IDE
        app.db.prepare(`UPDATE health_warnings SET resolved_at = datetime('now') WHERE category = 'init_drift' AND message LIKE ?`).run(`${input.ide}%`);
      }
    } catch {
      // Non-fatal — never let drift check break session-start
    }
  }

  const externalId = input.session_id ?? newId();
  const conversation = app.conversationStore.upsertConversationByExternalId({
    external_id: externalId,
    workspace: input.workspace,
    project_key: input.project_key ?? null,
    ide: input.ide,
    started_at: new Date().toISOString()
  });
  const warningCount = app.statusService.getActiveWarningCount();
  const additional_context = app.injectionService.buildForProjectKey(conversation.project_key, input.workspace, undefined, warningCount);
  return { additional_context, session_id: conversation.external_id };
}

export function stopHook(input: {
  ide: IdeType;
  session_id: string;
  workspace: string | null;
  project_key?: string | null;
  content: string;
  dbPath?: string;
}) {
  const normalizedContent = input.content.trim();
  if (!normalizedContent) {
    return {};
  }
  const app = createApp(input.dbPath);
  const conversation = app.conversationStore.upsertConversationByExternalId({
    external_id: input.session_id,
    workspace: input.workspace,
    project_key: input.project_key ?? null,
    ide: input.ide
  });
  app.conversationStore.addTurn({
    conversation_id: conversation.id,
    role: 'assistant',
    content: normalizedContent
  });
  return {};
}

export function turnCompleteHook(input: {
  ide: IdeType;
  session_id: string;
  workspace: string | null;
  project_key?: string | null;
  prompt: string;
  content: string;
  dbPath?: string;
}) {
  const app = createApp(input.dbPath);
  const conversation = app.conversationStore.upsertConversationByExternalId({
    external_id: input.session_id,
    workspace: input.workspace,
    project_key: input.project_key ?? null,
    ide: input.ide
  });

  // Capture user turn
  if (input.prompt.trim()) {
    const inserted = app.conversationStore.addTurn({
      conversation_id: conversation.id,
      role: 'user',
      content: input.prompt.trim()
    });
    if (inserted && inserted.turn_number === 1) {
      const clean = stripPromptWrappers(input.prompt);
      if (clean) {
        app.conversationStore.setTitleIfEmpty(conversation.id, clean);
        app.conversationStore.upsertSummary(conversation.id, clean);
      }
    }
  }

  // Capture assistant turn
  if (input.content.trim()) {
    app.conversationStore.addTurn({
      conversation_id: conversation.id,
      role: 'assistant',
      content: input.content.trim()
    });
  }

  return {};
}

export function sessionEndHook(input: { ide: IdeType; session_id: string; workspace: string | null; content: string; dbPath?: string }) {
  // D17: session end does not update recency.
  return { ok: true };
}

export function beforeSubmitPromptHook(input: {
  prompt: string;
  ide?: IdeType | null;
  session_id?: string;
  workspace?: string | null;
  project_key?: string | null;
  dbPath?: string;
}) {
  if (input.session_id) {
    const app = createApp(input.dbPath);
    const conversation = app.conversationStore.upsertConversationByExternalId({
      external_id: input.session_id,
      workspace: input.workspace ?? null,
      project_key: input.project_key ?? null,
      ide: input.ide ?? null
    });
    const inserted = app.conversationStore.addTurn({
      conversation_id: conversation.id,
      role: 'user',
      content: input.prompt
    });
    if (inserted && inserted.turn_number === 1) {
      const clean = stripPromptWrappers(input.prompt);
      if (clean) {
        app.conversationStore.setTitleIfEmpty(conversation.id, clean);
        app.conversationStore.upsertSummary(conversation.id, clean);
      }
    }
  }
  return { block: false };
}
