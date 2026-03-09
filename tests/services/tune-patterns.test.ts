import { describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTempApp, ensureSession } from '../test-helpers.js';
import { nowIso } from '../../src/utils/time.js';
import { hashContent } from '../../src/utils/hash.js';
import { newId } from '../../src/utils/id.js';
import {
  heuristicLabel,
  scorePattern,
  gradePattern,
  contextEnrichedLabel,
  runTunePatterns,
  type PatternMetrics
} from '../../src/services/tune-patterns.js';

describe('TunePatterns', () => {
  test('148 tune.heuristic-labels', () => {
    // R12: heuristicLabel correctly labels known message types
    expect(heuristicLabel('no, use tabs').has('CORRECTION')).toBe(true);
    expect(heuristicLabel('create a file').has('ACTION_REQUEST')).toBe(true);
    expect(heuristicLabel('i prefer dark mode').has('PREFERENCE')).toBe(true);
    expect(heuristicLabel('from now on we use ESLint').has('DECISION')).toBe(true);
    expect(heuristicLabel('remember this always').has('EXPLICIT_SAVE')).toBe(true);
    expect(heuristicLabel('yes').has('APPROVAL_GATE')).toBe(true);

    // Non-matching → OTHER
    const otherLabels = heuristicLabel('some random message about the weather');
    expect(otherLabels.has('OTHER')).toBe(true);
  });

  test('149 tune.score-precision', () => {
    // R12: scorePattern returns correct precision/recall/F1 given known corpus
    const corpus = [
      { text: 'no, use tabs instead of spaces' },      // matches CORRECTION (starts with "no,")
      { text: 'no, revert that change' },               // matches CORRECTION
      { text: 'please create a new file' },              // ACTION_REQUEST, not CORRECTION
      { text: 'still broken after the fix' },            // matches CORRECTION (heuristic + C6 would match)
      { text: 'deploy to production' },                  // ACTION_REQUEST, not CORRECTION
    ];

    // Pattern C1: /^no[,.\s]/i — should match 2 of the 5 messages
    const metrics = scorePattern(/^no[,.\s]/i, 'CORRECTION', corpus);

    // "no, use tabs instead of spaces" → matches pattern AND heuristic label (CORRECTION) → TP
    // "no, revert that change" → matches pattern AND heuristic label → TP
    // "please create a new file" → no match, no correction label → ignored
    // "still broken after the fix" → no match, but heuristic labels CORRECTION → FN
    // "deploy to production" → no match, no correction label → ignored
    expect(metrics.tp).toBe(2);
    expect(metrics.fp).toBe(0);
    expect(metrics.fn).toBeGreaterThanOrEqual(1);  // "still broken" is CORRECTION by heuristic but not by this pattern
    expect(metrics.precision).toBe(1.0);  // 2/(2+0) = 1.0
    expect(metrics.recall).toBeLessThan(1.0);  // 2/(2+fn) < 1.0
  });

  test('150 tune.grading', () => {
    // R12: Grading based on precision and F1
    const gradeA: PatternMetrics = { tp: 80, fp: 5, fn: 15, precision: 0.94, recall: 0.84, f1: 0.89, volume: 85 };
    expect(gradePattern(gradeA)).toBe('A');

    const gradeB: PatternMetrics = { tp: 50, fp: 30, fn: 20, precision: 0.625, recall: 0.714, f1: 0.667, volume: 80 };
    expect(gradePattern(gradeB)).toBe('B');

    const gradeC: PatternMetrics = { tp: 30, fp: 60, fn: 10, precision: 0.333, recall: 0.75, f1: 0.461, volume: 90 };
    expect(gradePattern(gradeC)).toBe('C');

    const gradeF: PatternMetrics = { tp: 10, fp: 80, fn: 10, precision: 0.111, recall: 0.5, f1: 0.182, volume: 90 };
    expect(gradePattern(gradeF)).toBe('F');
  });

  test('151 tune.retire-f-grade', () => {
    // R12: Pattern graded F → moved to retired list in config
    const dir = mkdtempSync(join(tmpdir(), 'tune-'));
    const configPath = join(dir, 'patterns.json');

    // Write a config with a terrible pattern
    const config = {
      version: 1,
      evaluated_on: '2026-03-08',
      corpus_size: 0,
      patterns: {
        CORRECTION: [
          { id: 'BAD1', regex: '\\b(the)\\b', flags: 'i', precision: 0.1, category_weight: 0.9 }
        ],
        DECISION: [],
        PREFERENCE: [],
        EXPLICIT_SAVE: []
      },
      candidates: {},
      retired: []
    };
    writeFileSync(configPath, JSON.stringify(config), 'utf8');

    // Corpus: "the" appears in non-correction messages → low precision
    const corpus = [
      { text: 'the cat sat on the mat' },
      { text: 'the dog ran away' },
      { text: 'update the config file' },
      { text: 'no, the wrong approach' },  // This one is a CORRECTION
    ];

    const result = runTunePatterns({ corpus, configPath });

    // BAD1 matches all 4 but only 1 is CORRECTION → precision ~25% → grade F → retired
    expect(result.patterns_retired).toBeGreaterThanOrEqual(1);
    const bad1 = result.per_pattern.find((p) => p.id === 'BAD1');
    expect(bad1).toBeDefined();
    expect(bad1!.grade).toBe('F');
    expect(bad1!.action).toBe('retired');

    // Verify config file updated: BAD1 no longer in active patterns
    const updated = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(updated.patterns.CORRECTION.find((p: any) => p.id === 'BAD1')).toBeUndefined();
    expect(updated.retired.some((p: any) => p.id === 'BAD1')).toBe(true);
  });

  test('152 tune.promote-candidate', () => {
    // R12: Candidate pattern graded A → moved to patterns list in config
    const dir = mkdtempSync(join(tmpdir(), 'tune-'));
    const configPath = join(dir, 'patterns.json');

    // Write a config with no active patterns but a good candidate
    const config = {
      version: 1,
      evaluated_on: '2026-03-08',
      corpus_size: 0,
      patterns: {
        CORRECTION: [],
        DECISION: [],
        PREFERENCE: [],
        EXPLICIT_SAVE: []
      },
      candidates: {
        CORRECTION: [
          { id: 'CAND1', regex: '^no[,.\\s]', flags: 'i', precision: 0, category_weight: 0.9 }
        ]
      },
      retired: []
    };
    writeFileSync(configPath, JSON.stringify(config), 'utf8');

    // Corpus: "no," always starts corrections
    const corpus = [
      { text: 'no, use tabs' },
      { text: 'no, revert that' },
      { text: 'no, wrong approach' },
      { text: 'create a file' },
      { text: 'deploy to production' },
    ];

    const result = runTunePatterns({ corpus, configPath });

    expect(result.candidates_promoted).toBe(1);
    const cand1 = result.per_pattern.find((p) => p.id === 'CAND1');
    expect(cand1).toBeDefined();
    expect(cand1!.grade).toBe('A');
    expect(cand1!.action).toBe('promoted');

    // Verify config file updated: CAND1 now in active patterns
    const updated = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(updated.patterns.CORRECTION.some((p: any) => p.id === 'CAND1')).toBe(true);
    expect(updated.candidates.CORRECTION ?? []).toHaveLength(0);
  });

  test('152b tune.threshold-respected', () => {
    // Regression: --threshold must gate promotions/keeps
    const dir = mkdtempSync(join(tmpdir(), 'tune-'));
    const configPath = join(dir, 'patterns.json');

    const config = {
      version: 1,
      evaluated_on: '2026-03-08',
      corpus_size: 0,
      min_precision: 0.5,
      patterns: { CORRECTION: [], DECISION: [], PREFERENCE: [], EXPLICIT_SAVE: [] },
      candidates: {
        CORRECTION: [{ id: 'TH1', regex: '\\buse\\b', flags: 'i', precision: 0, category_weight: 0.9 }]
      },
      retired: []
    };
    writeFileSync(configPath, JSON.stringify(config), 'utf8');

    // Precision for TH1 here is low because "use" appears in non-corrections too.
    const corpus = [{ text: 'no, use tabs' }, { text: 'use docker in ci' }, { text: 'use cached deps for speed' }];
    runTunePatterns({ corpus, configPath, threshold: 0.7 });

    const updated = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(updated.patterns.CORRECTION.some((p: any) => p.id === 'TH1')).toBe(false);
    expect(updated.min_precision).toBe(0.7);
  });

  test('153 tune.corpus-size-updated', () => {
    // R12: After tune run, corpus_size updated in config
    const dir = mkdtempSync(join(tmpdir(), 'tune-'));
    const configPath = join(dir, 'patterns.json');

    const config = {
      version: 1,
      evaluated_on: '2026-01-01',
      corpus_size: 100,
      patterns: { CORRECTION: [], DECISION: [], PREFERENCE: [], EXPLICIT_SAVE: [] },
      candidates: {},
      retired: []
    };
    writeFileSync(configPath, JSON.stringify(config), 'utf8');

    const corpus = Array.from({ length: 42 }, (_, i) => ({ text: `message number ${i}` }));

    runTunePatterns({ corpus, configPath });

    const updated = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(updated.corpus_size).toBe(42);
    expect(updated.evaluated_on).not.toBe('2026-01-01');
  });

  test('154 tune.auto-trigger-condition', () => {
    // R12: delta ≥ 500 → tune recommended; delta < 500 → no trigger
    const { app } = createTempApp();

    // No events → shouldTriggerTune(0) should be false (0 - 0 = 0 < 500)
    expect(app.maintenanceService.shouldTriggerTune(0)).toBe(false);

    // Insert 500 captured events
    for (let i = 0; i < 500; i++) {
      const sid = `s-auto-${i % 5}`;
      ensureSession(app, sid, 'w1');
      app.captureStore.insert({
        id: newId(),
        session_id: sid,
        workspace: 'w1',
        content: `auto trigger test message ${i}`,
        content_hash: hashContent(`auto trigger test message ${i}`),
        source: 'hook',
        created_at: nowIso(),
        extraction_status: 'pending'
      });
    }

    // delta = 500 - 0 = 500 → should trigger
    expect(app.maintenanceService.shouldTriggerTune(0)).toBe(true);

    // delta = 500 - 499 = 1 < 500 → should NOT trigger
    expect(app.maintenanceService.shouldTriggerTune(499)).toBe(false);

    // delta = 500 - 1 = 499 < 500 → should NOT trigger
    expect(app.maintenanceService.shouldTriggerTune(1)).toBe(false);
  });

  test('155 tune.session-progression', () => {
    // R12: Bare "yes" after agent proposal → enriched label includes DECISION
    const labels = contextEnrichedLabel('yes', 'Should we use TypeScript for the project? I recommend it.');

    expect(labels.has('DECISION')).toBe(true);
    expect(labels.has('APPROVAL_GATE')).toBe(false);

    // Without agent context → remains APPROVAL_GATE
    const labelsNoContext = contextEnrichedLabel('yes', null);
    expect(labelsNoContext.has('APPROVAL_GATE')).toBe(true);
    expect(labelsNoContext.has('DECISION')).toBe(false);

    // With non-proposal agent message → remains APPROVAL_GATE
    const labelsNoProposal = contextEnrichedLabel('ok', 'I have implemented the changes you requested.');
    expect(labelsNoProposal.has('APPROVAL_GATE')).toBe(true);
    expect(labelsNoProposal.has('DECISION')).toBe(false);
  });
});
