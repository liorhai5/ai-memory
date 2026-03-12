import { describe, expect, test } from 'vitest';
import { createTempApp } from '../test-helpers.js';

function insertUsage(app: ReturnType<typeof createTempApp>['app'], overrides: Partial<{
  tool_name: string;
  called_at: string;
  latency_ms: number;
  workspace: string | null;
  param_keys: string;
  result_count: number | null;
  success: number;
  error_type: string | null;
}> = {}) {
  const row = {
    tool_name: overrides.tool_name ?? 'ai-memory-search',
    called_at: overrides.called_at ?? new Date().toISOString(),
    latency_ms: overrides.latency_ms ?? 5,
    workspace: overrides.workspace ?? null,
    param_keys: overrides.param_keys ?? '["query"]',
    result_count: overrides.result_count ?? 1,
    success: overrides.success ?? 1,
    error_type: overrides.error_type ?? null,
  };
  app.db.prepare(`
    INSERT INTO tool_usage (tool_name, called_at, latency_ms, workspace, param_keys, result_count, success, error_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.tool_name, row.called_at, row.latency_ms, row.workspace, row.param_keys, row.result_count, row.success, row.error_type);
}

describe('StatusService tool_usage aggregates', () => {
  test('status includes tool_usage section', () => {
    const { app } = createTempApp();
    const status = app.statusService.getStatus();
    expect(status).toHaveProperty('tool_usage');
    expect(status.tool_usage).toHaveProperty('last_24h');
    expect(status.tool_usage).toHaveProperty('last_7d');
    expect(status.tool_usage).toHaveProperty('total');
    expect(status.tool_usage).toHaveProperty('empty_search_rate_7d');
    expect(status.tool_usage).toHaveProperty('error_rate_7d');
  });

  test('empty table returns zero counts', () => {
    const { app } = createTempApp();
    const { tool_usage } = app.statusService.getStatus();
    expect(tool_usage.total).toEqual({});
    expect(tool_usage.last_24h).toEqual({});
    expect(tool_usage.last_7d).toEqual({});
    expect(tool_usage.empty_search_rate_7d).toBe(0);
    expect(tool_usage.error_rate_7d).toBe(0);
  });

  test('counts tool calls by period', () => {
    const { app } = createTempApp();
    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();

    insertUsage(app, { tool_name: 'ai-memory-search', called_at: hoursAgo(1) });
    insertUsage(app, { tool_name: 'ai-memory-search', called_at: hoursAgo(2) });
    insertUsage(app, { tool_name: 'ai-memory-summarize', called_at: hoursAgo(1) });
    insertUsage(app, { tool_name: 'ai-memory-search', called_at: hoursAgo(48) });

    const { tool_usage } = app.statusService.getStatus();
    expect(tool_usage.last_24h['ai-memory-search']).toBe(2);
    expect(tool_usage.last_24h['ai-memory-summarize']).toBe(1);
    expect(tool_usage.last_7d['ai-memory-search']).toBe(3);
    expect(tool_usage.total['ai-memory-search']).toBe(3);
  });

  test('empty_search_rate_7d reflects zero-result searches', () => {
    const { app } = createTempApp();
    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();

    insertUsage(app, { tool_name: 'ai-memory-search', called_at: hoursAgo(1), result_count: 3 });
    insertUsage(app, { tool_name: 'ai-memory-search', called_at: hoursAgo(2), result_count: 0 });
    insertUsage(app, { tool_name: 'ai-memory-search', called_at: hoursAgo(3), result_count: 5 });
    insertUsage(app, { tool_name: 'ai-memory-search', called_at: hoursAgo(4), result_count: 0 });

    const { tool_usage } = app.statusService.getStatus();
    expect(tool_usage.empty_search_rate_7d).toBe(0.5);
  });

  test('error_rate_7d reflects failed calls', () => {
    const { app } = createTempApp();
    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();

    insertUsage(app, { called_at: hoursAgo(1), success: 1 });
    insertUsage(app, { called_at: hoursAgo(2), success: 1 });
    insertUsage(app, { called_at: hoursAgo(3), success: 0, error_type: 'NOT_FOUND' });
    insertUsage(app, { called_at: hoursAgo(4), success: 1 });

    const { tool_usage } = app.statusService.getStatus();
    expect(tool_usage.error_rate_7d).toBe(0.25);
  });

  test('old data outside 7d window excluded from rates', () => {
    const { app } = createTempApp();
    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

    insertUsage(app, { tool_name: 'ai-memory-search', called_at: daysAgo(10), result_count: 0 });
    insertUsage(app, { tool_name: 'ai-memory-search', called_at: daysAgo(1), result_count: 5 });

    const { tool_usage } = app.statusService.getStatus();
    expect(tool_usage.empty_search_rate_7d).toBe(0);
    expect(tool_usage.last_7d['ai-memory-search']).toBe(1);
    expect(tool_usage.total['ai-memory-search']).toBe(2);
  });
});
