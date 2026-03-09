import { describe, expect, test } from 'vitest';
import { createTempApp } from '../test-helpers.js';
import { nowIso } from '../../src/utils/time.js';

describe('ScoringService', () => {
  test('15 scoring.formula-correct', () => {
    const { app } = createTempApp();
    const s = app.scoringService.computeScore({ type: 'decision', extractionConfidence: 1, lastAccessedAt: null, repetitionCount: 1 });
    expect(s).toBeCloseTo(0.8, 3);
  });

  test('16 scoring.type-weights', () => {
    const { app } = createTempApp();
    expect(app.scoringService.getTypeWeight('decision')).toBe(0.8);
    expect(app.scoringService.getTypeWeight('correction')).toBe(0.7);
    expect(app.scoringService.getTypeWeight('pattern')).toBe(0.6);
    expect(app.scoringService.getTypeWeight('learning')).toBe(0.6);
    expect(app.scoringService.getTypeWeight('preference')).toBe(0.5);
    expect(app.scoringService.getTypeWeight('fact')).toBe(0.3);
  });

  test('17 scoring.recency-decay', () => {
    const { app } = createTempApp();
    const oldDate = new Date(Date.now() - 30 * 86400000).toISOString();
    const fresh = app.scoringService.computeScore({ type: 'decision', extractionConfidence: 1, lastAccessedAt: nowIso(), repetitionCount: 1 });
    const old = app.scoringService.computeScore({ type: 'decision', extractionConfidence: 1, lastAccessedAt: oldDate, repetitionCount: 1 });
    expect(fresh).toBeGreaterThan(old);
    expect(app.scoringService.computeRecencyFactor(oldDate)).toBeGreaterThanOrEqual(0.7);
  });

  test('18 scoring.repetition-caps', () => {
    const { app } = createTempApp();
    expect(app.scoringService.computeRepetitionBoost(1)).toBe(1.0);
    expect(app.scoringService.computeRepetitionBoost(3)).toBe(1.2);
    expect(app.scoringService.computeRepetitionBoost(6)).toBe(1.5);
    expect(app.scoringService.computeRepetitionBoost(10)).toBe(1.5);
  });
});
