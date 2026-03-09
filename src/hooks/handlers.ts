import { createApp } from '../app.js';
import { StatusService } from '../services/status-service.js';
import { loadConfig } from '../services/config-service.js';
import { hashContent } from '../utils/hash.js';
import { newId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';
import { estimateTokens } from '../utils/token.js';
import { runTunePatterns } from '../services/tune-patterns.js';
import { interceptMemoryCommand } from './interceptor.js';
import type { IdeType } from '../types.js';

export function sessionStartHook(input: { ide: IdeType; workspace: string | null; session_id?: string; dbPath?: string }) {
  const app = createApp(input.dbPath);
  const sessionId = input.session_id ?? newId();
  app.sessionStore.create({
    id: sessionId,
    workspace: input.workspace,
    ide: input.ide,
    status: 'active',
    turn_count: 0,
    last_extraction_turn: 0,
    started_at: nowIso(),
    ended_at: null
  });

  const config = loadConfig();
  const totalBudget = config.token_budget;
  const coreBudget = config.core_budget;

  // Core memories: top entries by score (R9)
  const core = app.retrievalService.coreMemories(input.workspace, coreBudget);
  const coreIds = new Set(core.map((e) => e.id));
  const coreTokens = core.reduce((sum, e) => sum + estimateTokens(e.content), 0);

  // Context: merged retrieval from both FTS sources (remaining budget, R9)
  const contextBudget = Math.max(0, totalBudget - coreTokens);
  const context = app.retrievalService.query({
    query: '*',
    workspace: input.workspace,
    top_k: 5,
    token_budget: contextBudget
  });

  // Format injection
  const lines: string[] = [];
  for (const m of core) {
    lines.push(`- [${m.type}] ${m.content}`);
  }
  // Context memories (dedup against core)
  for (const m of context.memories) {
    if (coreIds.has(m.id)) continue;
    lines.push(`- [${m.type}] ${m.content}`);
    if (m.linked_items) {
      for (const li of m.linked_items) {
        lines.push(`  -> [${li.link_type}, conf: ${li.link_confidence}] ${li.content} (score: ${li.score.toFixed(2)})`);
      }
    }
  }

  const additional_context = `<!-- p1:injected:begin -->\nUse ai-memory-query / ai-memory-capture tools when needed.\n${lines.join('\n')}\n<!-- p1:injected:end -->`;

  return { additional_context, session_id: sessionId };
}

export function stopHook(input: {
  ide: IdeType;
  session_id: string;
  workspace: string | null;
  content: string;
  extraction_interval?: number;
  dbPath?: string;
  stdin?: { status?: string; loop_count?: number };
}) {
  const app = createApp(input.dbPath);

  // Gate 1: Capture (every turn, unconditional)
  app.captureService.captureTurn({ session_id: input.session_id, workspace: input.workspace, content: input.content, source: 'hook' });

  // L1 Classification: strip → classify → (if classified) HebbianMatcher deterministic (R6)
  const classification = app.classifier.classify(input.content);
  if (classification) {
    app.hebbianMatcher.capture({
      session_id: input.session_id,
      workspace: input.workspace,
      items: [
        {
          type: classification.type,
          content: input.content,
          extraction_confidence: classification.extraction_confidence
        }
      ],
      source: 'hook'
    });
  }

  // Gate 2: Enrichment (periodic L2 trigger)
  const session = app.sessionStore.byId(input.session_id);
  const config = loadConfig();
  const interval = input.extraction_interval ?? config.extraction_interval;
  if (!session) return {};
  // extraction_interval = 0 means L2 is disabled
  if (interval === 0) return {};

  const shouldExtract = session.turn_count >= interval && session.turn_count - session.last_extraction_turn >= interval;
  if (!shouldExtract) return {};

  app.sessionStore.setLastExtractionTurn(input.session_id, session.turn_count);
  const followup_message =
    'Extract key memories from recent turns as decision/correction/pattern/learning/preference/fact, call ai-memory-capture, then respond briefly: Extracting memories...';

  if (input.ide === 'cursor') {
    return { followup_message };
  }
  return { type: 'agent', message: followup_message };
}

export function sessionEndHook(input: { ide: IdeType; session_id: string; workspace: string | null; content: string; dbPath?: string }) {
  try {
    const app = createApp(input.dbPath);
    app.captureStore.insert({
      id: newId(),
      session_id: input.session_id,
      workspace: input.workspace,
      content: input.content,
      content_hash: hashContent(`final:${input.session_id}:${input.content}`),
      source: 'hook',
      created_at: nowIso(),
      extraction_status: 'pending'
    });
    app.sessionStore.setStatus(input.session_id, 'completed');

    // Run maintenance: decay + dedup + orphan links + promotion + staleness (R11)
    const maintenance = app.maintenanceService.run(input.workspace);

    // Check tune trigger condition (R12): delta ≥ tune_threshold captured events since last tune
    const config = loadConfig();
    const lastCorpusSize = app.classifier.getPatterns().corpus_size;
    const tuneSuggested = app.maintenanceService.shouldTriggerTune(lastCorpusSize, config.tune_threshold);
    if (tuneSuggested) {
      // Non-blocking auto-tune: runs in background and updates config in place.
      setTimeout(() => {
        try {
          const autoApp = createApp(input.dbPath);
          const allEvents = autoApp.captureStore.listAll();
          runTunePatterns({
            corpus: allEvents.map((e) => ({ text: e.content, session_id: e.session_id })),
            auto: true
          });
        } catch {
          // Background tuning is best-effort and must never fail the hook.
        }
      }, 0);
    }

    return { ok: true, maintenance, tune_suggested: tuneSuggested };
  } catch {
    return { ok: false };
  }
}

export function beforeSubmitPromptHook(input: { prompt: string; dbPath?: string }) {
  const intercept = interceptMemoryCommand(input.prompt);
  if (!intercept.intercepted) return { block: false };

  const app = createApp(input.dbPath);
  const statusService = new StatusService(app.captureStore, app.memoryStore, input.dbPath ?? ':memory:');

  if (intercept.command?.startsWith('ai-memory status')) {
    return { block: true, user_message: JSON.stringify(statusService.getStatus()) };
  }
  if (intercept.command?.startsWith('ai-memory query')) {
    const q = input.prompt.replace(/^\/memory\s+query\s+/, '');
    return { block: true, user_message: JSON.stringify(app.retrievalService.query({ query: q, workspace: null })) };
  }
  if (intercept.command?.startsWith('ai-memory sweep')) {
    return { block: true, user_message: JSON.stringify(app.maintenanceService.run(null)) };
  }
  return { block: true, user_message: intercept.user_message };
}
