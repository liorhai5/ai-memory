import { describe, expect, test } from 'vitest';
import { DeterministicClassifier } from '../../src/services/deterministic-classifier.js';

describe('DeterministicClassifier', () => {
  const classifier = new DeterministicClassifier();

  test('109 classifier.correction-patterns', () => {
    // C1: "no, ..."
    const r1 = classifier.classify('no, use tabs instead of spaces');
    expect(r1).not.toBeNull();
    expect(r1!.type).toBe('correction');

    // C6: "still broken"
    const r2 = classifier.classify('still broken after the last change');
    expect(r2).not.toBeNull();
    expect(r2!.type).toBe('correction');

    // C3: "instead"
    const r3 = classifier.classify('use PostgreSQL instead');
    expect(r3).not.toBeNull();
    expect(r3!.type).toBe('correction');
  });

  test('110 classifier.decision-pattern', () => {
    // D1: "decided"
    const r1 = classifier.classify('decided to use SQLite for the project');
    expect(r1).not.toBeNull();
    expect(r1!.type).toBe('decision');

    // D1: "from now on"
    const r2 = classifier.classify('from now on we do strict mode');
    expect(r2).not.toBeNull();
    expect(r2!.type).toBe('decision');
  });

  test('111 classifier.preference-patterns', () => {
    // P1: "i prefer"
    const r1 = classifier.classify('i prefer dark mode');
    expect(r1).not.toBeNull();
    expect(r1!.type).toBe('preference');

    // P5: "i want to avoid"
    const r2 = classifier.classify('i want to avoid global state');
    expect(r2).not.toBeNull();
    expect(r2!.type).toBe('preference');
  });

  test('112 classifier.explicit-save', () => {
    // S1: "remember this"
    const r1 = classifier.classify('remember this: always use strict mode');
    expect(r1).not.toBeNull();
    // Explicit save gets highest priority
    expect(r1!.pattern_id).toBe('S1');
    expect(r1!.extraction_confidence).toBe(1.0); // 1.0 × 1.0
  });

  test('113 classifier.no-match', () => {
    // Action request — should NOT match any pattern
    const r1 = classifier.classify('create a new file called utils.ts');
    expect(r1).toBeNull();

    // Code-only message
    const r2 = classifier.classify('```\nconst x = 1;\n```');
    expect(r2).toBeNull();
  });

  test('114 classifier.priority-order', () => {
    // Message matches both CORRECTION ("no,") and DECISION ("decided")
    // CORRECTION has higher priority than DECISION per R1 priority order:
    // EXPLICIT_SAVE > CORRECTION > DECISION > PREFERENCE
    // But "no," is C1 (CORRECTION) — it should win
    const r = classifier.classify('no, i decided against that');
    expect(r).not.toBeNull();
    // Since both CORRECTION and DECISION match, CORRECTION wins (higher priority)
    expect(r!.type).toBe('correction');
  });

  test('115 classifier.extraction-confidence', () => {
    // C1: precision=1.0, category_weight=0.9 → confidence=0.90
    const r1 = classifier.classify('no, that is wrong');
    expect(r1).not.toBeNull();
    expect(r1!.extraction_confidence).toBeCloseTo(0.9, 2);

    // C3: precision=0.64, category_weight=0.9 → confidence=0.576
    const r2 = classifier.classify('use X instead');
    expect(r2).not.toBeNull();
    expect(r2!.extraction_confidence).toBeCloseTo(0.576, 2);

    // D1: precision=1.0, category_weight=0.8 → confidence=0.80
    const r3 = classifier.classify('decided to go with SQLite');
    expect(r3).not.toBeNull();
    expect(r3!.extraction_confidence).toBeCloseTo(0.8, 2);

    // P1: precision=1.0, category_weight=0.7 → confidence=0.70
    const r4 = classifier.classify('i prefer tabs over spaces');
    expect(r4).not.toBeNull();
    expect(r4!.extraction_confidence).toBeCloseTo(0.7, 2);
  });
});
