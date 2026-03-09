import { describe, expect, test } from 'vitest';
import { createTempApp, ensureSession, seedMemory } from '../test-helpers.js';
import type { MemoryLink } from '../../src/types.js';

describe('HebbianMatcher', () => {
  test('27 hebbian.exact-dedup', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'same memory' }] });
    const second = app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'same memory' }] });
    expect(second.updated).toBe(1);
  });

  test('28 hebbian.fts5-near-match-confirms', () => {
    // D24/D33: high FTS5 score → CONFIRMING: boost existing score + repetition, not create new
    const { app } = createTempApp();
    ensureSession(app, 's1');
    ensureSession(app, 's2');
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'use sqlite for local memory storage' }] });
    const countBefore = app.memoryStore.count();
    const before = app.memoryStore.list(1)[0];
    const r = app.hebbianMatcher.capture({ session_id: 's2', workspace: 'w1', items: [{ type: 'learning', content: 'sqlite local memory storage works well' }] });
    // Near match should boost (updated), not create new
    expect(r.updated).toBe(1);
    expect(r.created).toBe(0);
    // No new memory entries created — just boosted
    expect(app.memoryStore.count()).toBe(countBefore);
    const after = app.memoryStore.byId(before.id)!;
    expect(after.repetition_count).toBeGreaterThan(before.repetition_count);
  });

  test('29 hebbian.no-match-creates-new', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    const r = app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'fact', content: 'totally unrelated content 12345' }] });
    expect(r.created).toBe(1);
  });

  test('30 hebbian.link-created-on-overlap', () => {
    // R3: Two entries with sufficient keyword overlap → related/contradicts link
    const { app } = createTempApp();
    ensureSession(app, 's1');
    ensureSession(app, 's2');
    // Use unique first-6 words so step 2 (FTS near-match) does NOT catch the second entry
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'xylophone marimba vibraphone orchestra timpani snare performing classical music symphony ensemble' }] });
    // Overlapping content words but different first-6 raw words → goes to step 4 (overlap detection)
    const r = app.hebbianMatcher.capture({ session_id: 's2', workspace: 'w1', items: [{ type: 'decision', content: 'trumpet bassoon clarinet woodwind conducting brass performing classical music symphony ensemble' }] });
    expect(r.linked).toBeGreaterThanOrEqual(1);
    expect(app.linkStore.list().length).toBeGreaterThan(0);
  });

  test('31 hebbian.no-review-gate', () => {
    const { app } = createTempApp();
    ensureSession(app, 's1');
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'fact', content: 'no staging area needed' }] });
    expect(app.memoryStore.count()).toBe(1);
  });
});

describe('HebbianMatcher — Overlap Detection', () => {
  /**
   * Key: The near-match (step 2) uses the first 6 raw words (>2 chars) for FTS lookup.
   * To test overlap detection (step 4), the second entry's first 6 words must NOT appear
   * in any existing entry, so it bypasses near-match and creates a new entry.
   * Overlapping vocabulary must appear later in the content.
   */

  test('116 overlap.link-created', () => {
    // Two entries with ≥3 overlapping content words AND ≥30% ratio → related link created
    const { app } = createTempApp();
    ensureSession(app, 's1');
    ensureSession(app, 's2');
    // Entry 1
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'decided SQLite analytics database configuration setup' }] });
    // Entry 2: first 6 words are unique (bypass near-match), then overlapping words
    app.hebbianMatcher.capture({ session_id: 's2', workspace: 'w1', items: [{ type: 'decision', content: 'zebra xylophone quantum uranium titanium palladium SQLite analytics database configuration' }] });
    const links = app.linkStore.list();
    const overlapLinks = links.filter((l: MemoryLink) => l.type === 'related' || l.type === 'contradicts');
    expect(overlapLinks.length).toBeGreaterThanOrEqual(1);
  });

  test('117 overlap.below-threshold', () => {
    // Two entries with only 2 overlapping words → NO overlap link
    const { app } = createTempApp();
    ensureSession(app, 's1');
    ensureSession(app, 's2');
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'deploy application frontend rendering' }] });
    // Unique prefix to bypass near-match; only shares "deploy" and "application" (2 words < 3)
    app.hebbianMatcher.capture({ session_id: 's2', workspace: 'w1', items: [{ type: 'decision', content: 'zebra xylophone quantum uranium titanium palladium deploy application backend' }] });
    const links = app.linkStore.list();
    const overlapLinks = links.filter((l: MemoryLink) => l.type === 'related' || l.type === 'contradicts');
    expect(overlapLinks.length).toBe(0);
  });

  test('118 overlap.low-ratio', () => {
    // 3 overlapping words out of many (low ratio < 30%) → NO link
    const { app } = createTempApp();
    ensureSession(app, 's1');
    ensureSession(app, 's2');
    // Short entry (few content words)
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'implement caching strategy middleware layer endpoint' }] });
    // Long entry with unique prefix + only 3 shared words out of 20+ → ratio < 30%
    app.hebbianMatcher.capture({ session_id: 's2', workspace: 'w1', items: [{ type: 'decision', content: 'zebra xylophone quantum uranium titanium palladium comprehensive testing framework pipeline integration deployment monitoring logging alerting dashboard visualization reporting analytics benchmarking profiling optimization caching strategy middleware' }] });
    const links = app.linkStore.list();
    const overlapLinks = links.filter((l: MemoryLink) => l.type === 'related' || l.type === 'contradicts');
    expect(overlapLinks.length).toBe(0);
  });

  test('119 overlap.negation-contradicts', () => {
    // Overlap + negation signal → link type=contradicts
    const { app } = createTempApp();
    ensureSession(app, 's1');
    ensureSession(app, 's2');
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'decided SQLite analytics database configuration' }] });
    // Unique prefix + overlapping words + negation "no longer"
    app.hebbianMatcher.capture({ session_id: 's2', workspace: 'w1', items: [{ type: 'decision', content: 'zebra xylophone quantum uranium titanium palladium no longer SQLite analytics database configuration' }] });
    const links = app.linkStore.list();
    const contradicts = links.filter((l: MemoryLink) => l.type === 'contradicts');
    expect(contradicts.length).toBeGreaterThanOrEqual(1);
  });

  test('120 overlap.no-negation-related', () => {
    // Overlap without negation → link type=related
    const { app } = createTempApp();
    ensureSession(app, 's1');
    ensureSession(app, 's2');
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'preference', content: 'prefer dark mode editor themes styling' }] });
    // Unique prefix + overlapping words without negation
    app.hebbianMatcher.capture({ session_id: 's2', workspace: 'w1', items: [{ type: 'preference', content: 'zebra xylophone quantum uranium titanium palladium dark mode editor themes defaults' }] });
    const links = app.linkStore.list();
    const related = links.filter((l: MemoryLink) => l.type === 'related');
    expect(related.length).toBeGreaterThanOrEqual(1);
  });

  test('121 overlap.confidence-range', () => {
    // Link confidence should be between 0.3 and 1.0
    const { app } = createTempApp();
    ensureSession(app, 's1');
    ensureSession(app, 's2');
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'decided SQLite analytics database configuration' }] });
    app.hebbianMatcher.capture({ session_id: 's2', workspace: 'w1', items: [{ type: 'decision', content: 'zebra xylophone quantum uranium titanium palladium SQLite analytics database configuration' }] });
    const links = app.linkStore.list();
    const overlapLinks = links.filter((l: MemoryLink) => l.type === 'related' || l.type === 'contradicts');
    expect(overlapLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of overlapLinks) {
      expect(link.confidence).toBeGreaterThanOrEqual(0.3);
      expect(link.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  test('122 overlap.negation-boost', () => {
    // Negation present → confidence boosted by 0.2 (capped at 1.0)
    const { app } = createTempApp();
    ensureSession(app, 's1');
    ensureSession(app, 's2');
    ensureSession(app, 's3');
    // Base entry
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'decided SQLite analytics database configuration' }] });

    // Related WITHOUT negation
    app.hebbianMatcher.capture({ session_id: 's2', workspace: 'w1', items: [{ type: 'decision', content: 'zebra xylophone quantum uranium titanium palladium SQLite analytics database configuration optimized' }] });
    const linksNoNeg = app.linkStore.list().filter((l: MemoryLink) => l.type === 'related');
    const confNoNeg = linksNoNeg.length > 0 ? linksNoNeg[0].confidence : 0;

    // Contradicts WITH negation
    app.hebbianMatcher.capture({ session_id: 's3', workspace: 'w1', items: [{ type: 'decision', content: 'alpha bravo charlie foxtrot tango november no longer SQLite analytics database configuration' }] });
    const linksNeg = app.linkStore.list().filter((l: MemoryLink) => l.type === 'contradicts');
    const confNeg = linksNeg.length > 0 ? linksNeg[0].confidence : 0;

    // Both should be valid confidence values
    expect(confNoNeg).toBeGreaterThanOrEqual(0.3);
    expect(confNeg).toBeGreaterThanOrEqual(0.3);
    // Negation-boosted confidence should be ≥ non-negation confidence
    expect(confNeg).toBeGreaterThanOrEqual(confNoNeg);
  });

  test('123 deterministic.no-supersession', () => {
    // Deterministic mode NEVER sets state='superseded' on any entry
    const { app } = createTempApp();
    ensureSession(app, 's1');
    ensureSession(app, 's2');
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'decided SQLite analytics database configuration' }] });
    // Entry with negation that creates a contradicts link but does NOT supersede
    app.hebbianMatcher.capture({ session_id: 's2', workspace: 'w1', items: [{ type: 'decision', content: 'zebra xylophone quantum uranium titanium palladium no longer SQLite analytics database configuration' }] });
    // Check that NO entries are superseded
    const allEntries = app.memoryStore.list(100);
    const superseded = allEntries.filter((e) => e.state === 'superseded');
    expect(superseded.length).toBe(0);
  });

  test('124 deterministic.near-match-boosts-existing', () => {
    // FTS near-match → boosts existing entry's score + repetition (no spurious self-link)
    const { app } = createTempApp();
    ensureSession(app, 's1');
    ensureSession(app, 's2');
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'use sqlite for local memory storage' }] });
    const before = app.memoryStore.list(10)[0];
    app.hebbianMatcher.capture({ session_id: 's2', workspace: 'w1', items: [{ type: 'learning', content: 'sqlite local memory storage works well' }] });
    const after = app.memoryStore.byId(before.id)!;
    // Repetition count should increase
    expect(after.repetition_count).toBeGreaterThan(before.repetition_count);
    // No duplicate entry — still just 1 memory entry
    expect(app.memoryStore.count()).toBe(1);
  });

  test('125 l2.upgrade-existing', () => {
    // L2 capture matching existing L1 entry → updates score/confidence, no duplicate
    const { app } = createTempApp();
    ensureSession(app, 's1');
    // L1 capture
    app.hebbianMatcher.capture({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'unique memory for l2 test' }] });
    const countBefore = app.memoryStore.count();
    // L2 capture with same content — should update, not create new
    const r = app.hebbianMatcher.captureL2({ session_id: 's1', workspace: 'w1', items: [{ type: 'decision', content: 'unique memory for l2 test', extraction_confidence: 0.95 }] });
    expect(r.updated).toBe(1);
    expect(r.created).toBe(0);
    expect(app.memoryStore.count()).toBe(countBefore);
  });
});
