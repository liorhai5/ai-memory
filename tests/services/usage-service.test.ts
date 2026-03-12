import { describe, expect, test } from 'vitest';
import { createTempApp } from '../test-helpers.js';
import { parseUsageRange } from '../../src/services/usage-service.js';

function insertUsage(
  app: ReturnType<typeof createTempApp>['app'],
  row: {
    tool_name: string;
    called_at: string;
    latency_ms: number;
    result_count: number | null;
    success: number;
    error_type: string | null;
  }
) {
  app.db
    .prepare(
      `
      INSERT INTO tool_usage (tool_name, called_at, latency_ms, workspace, param_keys, result_count, success, error_type)
      VALUES (?, ?, ?, NULL, '[]', ?, ?, ?)
      `
    )
    .run(row.tool_name, row.called_at, row.latency_ms, row.result_count, row.success, row.error_type);
}

describe('UsageService', () => {
  test('parseUsageRange defaults to 7d for invalid values', () => {
    expect(parseUsageRange('24h')).toBe('24h');
    expect(parseUsageRange('7d')).toBe('7d');
    expect(parseUsageRange('30d')).toBe('30d');
    expect(parseUsageRange('unknown')).toBe('7d');
  });

  test('getUsageSummary computes rates and averages', () => {
    const { app } = createTempApp();
    const now = new Date();
    const h = (n: number) => new Date(now.getTime() - n * 60 * 60 * 1000).toISOString();

    insertUsage(app, { tool_name: 'ai-memory-search', called_at: h(1), latency_ms: 20, result_count: 0, success: 1, error_type: null });
    insertUsage(app, { tool_name: 'ai-memory-search', called_at: h(2), latency_ms: 40, result_count: 2, success: 1, error_type: null });
    insertUsage(app, { tool_name: 'ai-memory-status', called_at: h(3), latency_ms: 10, result_count: 1, success: 0, error_type: 'INTERNAL' });

    const summary = app.usageService.getUsageSummary('7d');
    expect(summary.total_calls).toBe(3);
    expect(summary.error_calls).toBe(1);
    expect(summary.error_rate).toBeCloseTo(0.33, 2);
    expect(summary.search_calls).toBe(2);
    expect(summary.empty_search_calls).toBe(1);
    expect(summary.empty_search_rate).toBe(0.5);
    expect(summary.avg_latency_ms).toBeCloseTo(23.33, 2);
  });

  test('getUsageDashboard returns grouped rows', () => {
    const { app } = createTempApp();
    const now = new Date();
    const h = (n: number) => new Date(now.getTime() - n * 60 * 60 * 1000).toISOString();

    insertUsage(app, { tool_name: 'ai-memory-search', called_at: h(1), latency_ms: 21, result_count: 0, success: 1, error_type: null });
    insertUsage(app, { tool_name: 'ai-memory-search', called_at: h(2), latency_ms: 29, result_count: 1, success: 0, error_type: 'NOT_FOUND' });
    insertUsage(app, { tool_name: 'ai-memory-status', called_at: h(3), latency_ms: 10, result_count: 1, success: 1, error_type: null });

    const data = app.usageService.getUsageDashboard('24h');
    expect(data.summary.total_calls).toBe(3);
    expect(data.time_series.length).toBeGreaterThan(0);
    expect(data.by_tool.find((x) => x.tool_name === 'ai-memory-search')?.calls).toBe(2);
    expect(data.by_tool.find((x) => x.tool_name === 'ai-memory-search')?.empty_results).toBe(1);
    expect(data.errors_by_type.find((x) => x.error_type === 'NOT_FOUND')?.count).toBe(1);
  });
});
