import { describe, expect, test } from 'vitest';
import {
  TIME_RANGES,
  formatWorkspace,
  timeRangeToIso,
  workspaceStyle,
} from '../../src/dashboard/client/src/workspace-colors.ts';

describe('dashboard workspace helpers', () => {
  test('formatWorkspace returns global for null', () => {
    expect(formatWorkspace(null)).toBe('global');
  });

  test('formatWorkspace trims Playgrounds prefix', () => {
    const full = '/Users/liorha/Projects/Wix/Playgrounds-ai-memory';
    expect(formatWorkspace(full)).toBe('ai-memory');
  });

  test('workspaceStyle is deterministic for same workspace', () => {
    const first = workspaceStyle('alpha');
    const second = workspaceStyle('alpha');
    expect(first).toEqual(second);
  });

  test('TIME_RANGES exposes expected labels', () => {
    expect(TIME_RANGES.map((r) => r.label)).toEqual([
      'All time',
      'Last 24h',
      'Last week',
      'Last month',
      'Last year',
    ]);
  });

  test('timeRangeToIso returns undefined for empty range', () => {
    expect(timeRangeToIso('')).toBeUndefined();
  });

  test('timeRangeToIso returns valid past ISO for concrete ranges', () => {
    const now = Date.now();
    for (const range of ['day', 'week', 'month', 'year'] as const) {
      const iso = timeRangeToIso(range);
      expect(iso).toBeDefined();
      const ms = Date.parse(String(iso));
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeLessThanOrEqual(now);
    }
  });
});
