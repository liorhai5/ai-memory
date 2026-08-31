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

  test('formatWorkspace reduces a full path to the project name', () => {
    expect(formatWorkspace('/home/user/projects/ai-memory')).toBe('ai-memory');
    expect(formatWorkspace('C:\\Users\\dev\\projects\\ai-memory')).toBe('ai-memory');
    expect(formatWorkspace('/home/user/projects/ai-memory/')).toBe('ai-memory');
  });

  test('formatWorkspace passes a bare project name through', () => {
    expect(formatWorkspace('ai-memory')).toBe('ai-memory');
    expect(formatWorkspace('some-project-with-dashes')).toBe('some-project-with-dashes');
  });

  test('formatWorkspace still shortens the legacy flattened project token', () => {
    // older rows stored an absolute path with separators flattened to '-';
    // a project name may itself contain '-', so this relies on the container
    // marker rather than splitting
    expect(formatWorkspace('Users-dev-Projects-Playgrounds-ai-memory')).toBe('ai-memory');
  });

  test('formatWorkspace strips the leading dashes Claude project tokens carry', () => {
    expect(formatWorkspace('-Users-dev-code')).toBe('Users-dev-code');
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
