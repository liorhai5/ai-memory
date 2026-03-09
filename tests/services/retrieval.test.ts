import { describe, expect, test } from 'vitest';
import { createTempApp, ensureSession, seedMemory } from '../test-helpers.js';
import { nowIso } from '../../src/utils/time.js';
import { hashContent } from '../../src/utils/hash.js';
import { newId } from '../../src/utils/id.js';
import { estimateTokens } from '../../src/utils/token.js';

describe('RetrievalService', () => {
  test('20 retrieval.fts5-top-k', () => {
    const { app } = createTempApp();
    for (let i = 0; i < 10; i += 1) {
      seedMemory(app, { id: `m${i}`, content: `alpha ${i}`, workspace: 'w1', score: 0.6 });
    }
    const r = app.retrievalService.query({ query: 'alpha', workspace: 'w1', top_k: 5, token_budget: 500 });
    expect(r.memories.length).toBeLessThanOrEqual(5);
  });

  test('21 retrieval.score-reranking', () => {
    const { app } = createTempApp();
    seedMemory(app, { id: 'a', content: 'same phrase rerank', workspace: 'w1', score: 0.9 });
    seedMemory(app, { id: 'b', content: 'same phrase rerank duplicate', workspace: 'w1', score: 0.1 });
    const r = app.retrievalService.query({ query: 'phrase rerank', workspace: 'w1', top_k: 2, token_budget: 200 });
    expect(r.memories[0].score).toBeGreaterThanOrEqual(r.memories[1].score);
  });

  test('22 retrieval.workspace-boost', () => {
    const { app } = createTempApp();
    expect(app.retrievalService.workspaceBoost('w1', 'w1')).toBeGreaterThan(app.retrievalService.workspaceBoost('w2', 'w1'));
  });

  test('23 retrieval.cross-workspace-visible', () => {
    const { app } = createTempApp();
    seedMemory(app, { id: 'x', content: 'cross visible memory', workspace: 'w2', score: 0.95 });
    const r = app.retrievalService.query({ query: 'cross visible', workspace: 'w1', top_k: 5, token_budget: 200 });
    expect(r.memories.some((m) => m.workspace === 'w2')).toBe(true);
  });

  test('24 retrieval.universal-boost', () => {
    const { app } = createTempApp();
    expect(app.retrievalService.workspaceBoost(null, 'w1')).toBe(0.2);
    expect(app.retrievalService.workspaceBoost('w1', 'w1')).toBe(0.3);
  });

  test('25 retrieval.token-budget', () => {
    const { app } = createTempApp();
    seedMemory(app, { id: 'm1', content: 'a'.repeat(200), workspace: 'w1', score: 0.9 });
    const r = app.retrievalService.query({ query: '*', workspace: 'w1', top_k: 5, token_budget: 10 });
    expect(r.used_tokens).toBeLessThanOrEqual(10);
    expect(r.truncated).toBe(true);
  });

  test('126 retrieval.merged-sources', () => {
    // R9: Query returns results from BOTH memory_entries_fts and captured_events_fts
    const { app } = createTempApp();
    ensureSession(app, 's1', 'w1');

    seedMemory(app, { id: 'm1', content: 'use sqlite database for storage', workspace: 'w1' });

    app.captureStore.insert({
      id: 'e1',
      session_id: 's1',
      workspace: 'w1',
      content: 'testing sqlite performance benchmarks',
      content_hash: hashContent('testing sqlite performance benchmarks'),
      source: 'hook',
      created_at: nowIso(),
      extraction_status: 'pending'
    });

    const r = app.retrievalService.query({ query: 'sqlite', workspace: 'w1', top_k: 10, token_budget: 800 });

    expect(r.memories.length).toBeGreaterThanOrEqual(1);
    expect(r.events.length).toBeGreaterThanOrEqual(1);
    expect(r.memories.some((m) => m.content.includes('sqlite database'))).toBe(true);
    expect(r.events.some((e) => e.content.includes('sqlite performance'))).toBe(true);
  });

  test('126b retrieval.merged-sources-wildcard', () => {
    // R9 regression: wildcard query should still return BOTH memories and captured events
    const { app } = createTempApp();
    ensureSession(app, 's1', 'w1');

    seedMemory(app, { id: 'm1', content: 'memory source wildcard sqlite', workspace: 'w1' });
    app.captureStore.insert({
      id: 'e1',
      session_id: 's1',
      workspace: 'w1',
      content: 'captured event wildcard sqlite',
      content_hash: hashContent('captured event wildcard sqlite'),
      source: 'hook',
      created_at: nowIso(),
      extraction_status: 'pending'
    });

    const r = app.retrievalService.query({ query: '*', workspace: 'w1', top_k: 10, token_budget: 800 });
    expect(r.memories.length).toBeGreaterThanOrEqual(1);
    expect(r.events.length).toBeGreaterThanOrEqual(1);
  });

  test('127 retrieval.merged-dedup', () => {
    // R9: Same content in both sources → deduplicated, not doubled
    const { app } = createTempApp();
    ensureSession(app, 's1', 'w1');

    const content = 'use sqlite for local memory storage dedup test';
    const hash = hashContent(content);

    seedMemory(app, { id: 'm1', content, workspace: 'w1' });
    app.captureStore.insert({
      id: 'e1',
      session_id: 's1',
      workspace: 'w1',
      content,
      content_hash: hash,
      source: 'hook',
      created_at: nowIso(),
      extraction_status: 'pending'
    });

    const r = app.retrievalService.query({ query: 'sqlite memory storage', workspace: 'w1', top_k: 10, token_budget: 800 });

    // Should not be doubled — only one of them included
    const total = r.memories.length + r.events.length;
    expect(total).toBe(1);
  });

  test('128 retrieval.captured-events-recency', () => {
    // R9: Captured events ranked by recency × workspace_boost (no type_weight)
    const { app } = createTempApp();
    ensureSession(app, 's1', 'w1');

    const oldDate = new Date(Date.now() - 30 * 86400000).toISOString();
    const newDate = nowIso();

    app.captureStore.insert({
      id: 'e-old',
      session_id: 's1',
      workspace: 'w1',
      content: 'ranking alpha old event for recency test',
      content_hash: hashContent('ranking alpha old event for recency test'),
      source: 'hook',
      created_at: oldDate,
      extraction_status: 'pending'
    });
    app.captureStore.insert({
      id: 'e-new',
      session_id: 's1',
      workspace: 'w1',
      content: 'ranking alpha new event for recency test',
      content_hash: hashContent('ranking alpha new event for recency test'),
      source: 'hook',
      created_at: newDate,
      extraction_status: 'pending'
    });

    const r = app.retrievalService.query({ query: 'ranking alpha recency', workspace: 'w1', top_k: 10, token_budget: 800 });

    expect(r.events.length).toBe(2);
    // Recent event should rank higher (higher combined_score)
    expect(r.events[0].combined_score).toBeGreaterThan(r.events[1].combined_score);
  });

  test('129 retrieval.graph-expansion', () => {
    // R13: Retrieved entry with links → linked entries included in result
    const { app } = createTempApp();
    ensureSession(app, 's1', 'w1');

    seedMemory(app, { id: 'primary', content: 'primary graph expansion entry about sqlite', workspace: 'w1', score: 0.9 });
    seedMemory(app, { id: 'linked', content: 'linked entry about postgres alternative', workspace: 'w1', score: 0.6 });

    app.linkStore.insert({
      id: newId(),
      source_id: 'primary',
      target_id: 'linked',
      type: 'related',
      confidence: 0.7,
      created_at: nowIso()
    });

    const r = app.retrievalService.query({ query: 'sqlite graph expansion', workspace: 'w1', top_k: 5, token_budget: 800 });

    const primary = r.memories.find((m) => m.id === 'primary');
    expect(primary).toBeDefined();
    expect(primary!.linked_items).toBeDefined();
    expect(primary!.linked_items!.length).toBe(1);
    expect(primary!.linked_items![0].id).toBe('linked');
    expect(primary!.linked_items![0].link_type).toBe('related');
  });

  test('130 retrieval.graph-bidirectional', () => {
    // R13: Old entry retrieved → its newer contradicting entry pulled in (target→source direction)
    const { app } = createTempApp();
    ensureSession(app, 's1', 'w1');

    seedMemory(app, { id: 'old-entry', content: 'old decision bidirectional graph use sqlite here', workspace: 'w1', score: 0.8 });
    seedMemory(app, { id: 'new-entry', content: 'newer decision changed to postgres for analytics', workspace: 'w1', score: 0.7 });

    // Link: new → old (source=new, target=old)
    app.linkStore.insert({
      id: newId(),
      source_id: 'new-entry',
      target_id: 'old-entry',
      type: 'contradicts',
      confidence: 0.8,
      created_at: nowIso()
    });

    // Query matching the OLD entry
    const r = app.retrievalService.query({ query: 'bidirectional sqlite', workspace: 'w1', top_k: 5, token_budget: 800 });

    const oldEntry = r.memories.find((m) => m.id === 'old-entry');
    expect(oldEntry).toBeDefined();

    // New entry should be linked (bidirectional: old found via target, new via source_id)
    expect(oldEntry!.linked_items).toBeDefined();
    expect(oldEntry!.linked_items!.some((li) => li.id === 'new-entry')).toBe(true);
    expect(oldEntry!.linked_items![0].link_type).toBe('contradicts');
  });

  test('131 retrieval.graph-depth-1', () => {
    // R13: A→B→C chain: retrieving A pulls B, but NOT C (no cascading)
    const { app } = createTempApp();
    ensureSession(app, 's1', 'w1');

    seedMemory(app, { id: 'A', content: 'entry depth alpha chain graph test', workspace: 'w1', score: 0.9 });
    seedMemory(app, { id: 'B', content: 'entry depth beta chain link test', workspace: 'w1', score: 0.6 });
    seedMemory(app, { id: 'C', content: 'entry depth gamma chain deepest test', workspace: 'w1', score: 0.4 });

    app.linkStore.insert({ id: newId(), source_id: 'A', target_id: 'B', type: 'related', confidence: 0.7, created_at: nowIso() });
    app.linkStore.insert({ id: newId(), source_id: 'B', target_id: 'C', type: 'related', confidence: 0.5, created_at: nowIso() });

    const r = app.retrievalService.query({ query: 'depth alpha chain graph', workspace: 'w1', top_k: 2, token_budget: 800 });

    const entryA = r.memories.find((m) => m.id === 'A');
    expect(entryA).toBeDefined();

    // B should be linked from A
    const hasB = entryA!.linked_items?.some((li) => li.id === 'B') ?? false;
    expect(hasB).toBe(true);

    // C should NOT be linked (depth > 1)
    const hasC = entryA!.linked_items?.some((li) => li.id === 'C') ?? false;
    expect(hasC).toBe(false);
  });

  test('132 retrieval.linked-score', () => {
    // R13: Linked entries scored as link.confidence × entry.score
    const { app } = createTempApp();
    ensureSession(app, 's1', 'w1');

    seedMemory(app, { id: 'main', content: 'linked score main entry calculation test', workspace: 'w1', score: 0.9 });
    seedMemory(app, { id: 'side', content: 'linked score side entry different purpose', workspace: 'w1', score: 0.6 });

    app.linkStore.insert({
      id: newId(),
      source_id: 'main',
      target_id: 'side',
      type: 'related',
      confidence: 0.5,
      created_at: nowIso()
    });

    const r = app.retrievalService.query({ query: 'linked score calculation', workspace: 'w1', top_k: 5, token_budget: 800 });

    const main = r.memories.find((m) => m.id === 'main');
    expect(main?.linked_items).toBeDefined();

    const sideLinked = main!.linked_items![0];
    expect(sideLinked.linked_score).toBeCloseTo(0.5 * 0.6, 2);
  });

  test('133 retrieval.linked-dedup', () => {
    // R13: Linked entry already in primary results → not duplicated
    const { app } = createTempApp();
    ensureSession(app, 's1', 'w1');

    seedMemory(app, { id: 'p1', content: 'dedup linked primary alpha entry test', workspace: 'w1', score: 0.9 });
    seedMemory(app, { id: 'p2', content: 'dedup linked primary alpha other test', workspace: 'w1', score: 0.8 });

    app.linkStore.insert({
      id: newId(),
      source_id: 'p1',
      target_id: 'p2',
      type: 'related',
      confidence: 0.7,
      created_at: nowIso()
    });

    const r = app.retrievalService.query({ query: 'dedup linked primary alpha', workspace: 'w1', top_k: 5, token_budget: 800 });

    // Both should be in primary results
    expect(r.memories.length).toBe(2);

    // p2 should NOT appear as linked_items of p1 (it's already primary)
    const p1 = r.memories.find((m) => m.id === 'p1');
    expect(p1?.linked_items ?? []).toHaveLength(0);
  });

  test('134 retrieval.linked-budget', () => {
    // R13: Linked entries fit within reserved budget; primary entries not displaced
    const { app } = createTempApp();
    ensureSession(app, 's1', 'w1');

    seedMemory(app, { id: 'p', content: 'budget primary linked test entry here', workspace: 'w1', score: 0.9 });
    // Linked entry: very large content that exceeds linked reserve
    seedMemory(app, { id: 'big-link', content: 'x'.repeat(2000), workspace: 'w1', score: 0.5 });

    app.linkStore.insert({
      id: newId(),
      source_id: 'p',
      target_id: 'big-link',
      type: 'related',
      confidence: 0.7,
      created_at: nowIso()
    });

    // Budget: 100 tokens. LinkedReserve: min(20, 200) = 20 tokens. PrimaryBudget: 80.
    const r = app.retrievalService.query({ query: 'budget primary linked', workspace: 'w1', top_k: 5, token_budget: 100 });

    // Primary should be present
    expect(r.memories.some((m) => m.id === 'p')).toBe(true);

    // big-link (500 tokens) should NOT be linked (exceeds linked reserve of 20 tokens)
    const primary = r.memories.find((m) => m.id === 'p');
    expect(primary?.linked_items ?? []).toHaveLength(0);
  });

  test('135 retrieval.budget-reclaim', () => {
    // R13: No linked entries → primary results reclaim reserved space
    const { app } = createTempApp();
    ensureSession(app, 's1', 'w1');

    // Create entries that would exceed (budget - reserve) but fit within full budget
    // Budget: 200 tokens. LinkedReserve: min(40, 200) = 40. PrimaryBudget: 160.
    for (let i = 0; i < 25; i++) {
      seedMemory(app, { id: `r${i}`, content: `reclaim budget entry number ${i}`, workspace: 'w1', score: 0.9 - i * 0.01 });
    }

    const r = app.retrievalService.query({ query: '*', workspace: 'w1', top_k: 25, token_budget: 200 });

    // Without reclaim: ~160/8 = ~20 entries max
    // With reclaim: ~200/8 = ~25 entries max
    expect(r.memories.length).toBeGreaterThan(20);
    expect(r.used_tokens).toBeLessThanOrEqual(200);
  });

  test('136 retrieval.core-memories', () => {
    // R9: Session-start injects top-N high-score entries in reserved ~200 token block
    const { app } = createTempApp();

    seedMemory(app, { id: 'high', content: 'core high score entry pinned', workspace: 'w1', score: 0.95 });
    seedMemory(app, { id: 'low', content: 'core low score entry pinned', workspace: 'w1', score: 0.2 });
    seedMemory(app, { id: 'mid', content: 'core mid score entry pinned', workspace: 'w1', score: 0.6 });

    const core = app.retrievalService.coreMemories('w1', 200);

    expect(core.length).toBeGreaterThanOrEqual(1);
    // Should be sorted by score DESC (with workspace boost)
    expect(core[0].id).toBe('high');

    // Total tokens should be within budget
    const totalTokens = core.reduce((sum, e) => sum + estimateTokens(e.content), 0);
    expect(totalTokens).toBeLessThanOrEqual(200);
  });

  test('137 retrieval.injection-format', () => {
    // R13: Linked entries formatted as nested under primary with [type, conf: X]
    const { app } = createTempApp();
    ensureSession(app, 's1', 'w1');

    seedMemory(app, { id: 'fmt-p', content: 'use sqlite for storage', workspace: 'w1', score: 0.82 });
    seedMemory(app, { id: 'fmt-l', content: 'switched to postgres for analytics', workspace: 'w1', score: 0.71 });

    app.linkStore.insert({
      id: newId(),
      source_id: 'fmt-p',
      target_id: 'fmt-l',
      type: 'contradicts',
      confidence: 0.8,
      created_at: nowIso()
    });

    const r = app.retrievalService.query({ query: 'sqlite storage', workspace: 'w1', top_k: 5, token_budget: 800 });
    const formatted = app.retrievalService.formatForInjection(r.memories, r.events);

    expect(formatted).toContain('[decision]');
    expect(formatted).toContain('use sqlite for storage');
    expect(formatted).toContain('[contradicts, conf: 0.8]');
    expect(formatted).toContain('switched to postgres');
  });
});
