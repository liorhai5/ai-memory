import type Database from 'better-sqlite3';

export type UsageRange = '24h' | '7d' | '30d' | 'day' | 'week' | 'month' | 'year' | '';

export interface UsageSummary {
  range: UsageRange;
  window_start: string;
  total_calls: number;
  error_calls: number;
  error_rate: number;
  search_calls: number;
  empty_search_calls: number;
  empty_search_rate: number;
  avg_latency_ms: number;
}

export interface UsageDashboardData {
  generated_at: string;
  summary: UsageSummary;
  time_series: Array<{
    bucket: string;
    calls: number;
    errors: number;
  }>;
  by_tool: Array<{
    tool_name: string;
    calls: number;
    errors: number;
    avg_latency_ms: number;
    empty_results: number;
  }>;
  errors_by_type: Array<{
    error_type: string;
    count: number;
  }>;
}

const RANGE_TO_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseUsageRange(value: unknown): UsageRange {
  if (typeof value === 'string' && value in RANGE_TO_MS) return value as UsageRange;
  if (value === '') return '';
  return '7d';
}

export class UsageService {
  constructor(private readonly db: Database.Database) {}

  getUsageSummary(range: UsageRange): UsageSummary {
    const since = range && RANGE_TO_MS[range]
      ? new Date(Date.now() - RANGE_TO_MS[range]).toISOString()
      : '1970-01-01T00:00:00Z';
    const row = this.db
      .prepare(
        `
        SELECT
          COUNT(*) AS total_calls,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS error_calls,
          AVG(latency_ms) AS avg_latency_ms,
          SUM(CASE WHEN tool_name = 'ai-memory-search' THEN 1 ELSE 0 END) AS search_calls,
          SUM(CASE WHEN tool_name = 'ai-memory-search' AND result_count = 0 THEN 1 ELSE 0 END) AS empty_search_calls
        FROM tool_usage
        WHERE called_at >= ?
        `
      )
      .get(since) as {
      total_calls: number;
      error_calls: number | null;
      avg_latency_ms: number | null;
      search_calls: number | null;
      empty_search_calls: number | null;
    };

    const totalCalls = row.total_calls ?? 0;
    const errorCalls = row.error_calls ?? 0;
    const searchCalls = row.search_calls ?? 0;
    const emptySearchCalls = row.empty_search_calls ?? 0;

    return {
      range,
      window_start: since,
      total_calls: totalCalls,
      error_calls: errorCalls,
      error_rate: totalCalls > 0 ? round2(errorCalls / totalCalls) : 0,
      search_calls: searchCalls,
      empty_search_calls: emptySearchCalls,
      empty_search_rate: searchCalls > 0 ? round2(emptySearchCalls / searchCalls) : 0,
      avg_latency_ms: row.avg_latency_ms != null ? round2(row.avg_latency_ms) : 0
    };
  }

  getUsageDashboard(range: UsageRange): UsageDashboardData {
    const generatedAt = new Date().toISOString();
    const summary = this.getUsageSummary(range);
    const since = summary.window_start;
    const bucketExpr = (range === '24h' || range === 'day') ? `substr(called_at, 1, 13) || ':00:00Z'` : `substr(called_at, 1, 10)`;

    const timeSeries = this.db
      .prepare(
        `
        SELECT
          ${bucketExpr} AS bucket,
          COUNT(*) AS calls,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS errors
        FROM tool_usage
        WHERE called_at >= ?
        GROUP BY bucket
        ORDER BY bucket ASC
        `
      )
      .all(since) as Array<{ bucket: string; calls: number; errors: number }>;

    const byTool = this.db
      .prepare(
        `
        SELECT
          tool_name,
          COUNT(*) AS calls,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS errors,
          AVG(latency_ms) AS avg_latency_ms,
          SUM(CASE WHEN tool_name = 'ai-memory-search' AND result_count = 0 THEN 1 ELSE 0 END) AS empty_results
        FROM tool_usage
        WHERE called_at >= ?
        GROUP BY tool_name
        ORDER BY calls DESC, tool_name ASC
        `
      )
      .all(since) as Array<{
      tool_name: string;
      calls: number;
      errors: number | null;
      avg_latency_ms: number | null;
      empty_results: number | null;
    }>;

    const errorsByType = this.db
      .prepare(
        `
        SELECT COALESCE(error_type, 'UNKNOWN') AS error_type, COUNT(*) AS count
        FROM tool_usage
        WHERE called_at >= ? AND success = 0
        GROUP BY COALESCE(error_type, 'UNKNOWN')
        ORDER BY count DESC, error_type ASC
        `
      )
      .all(since) as Array<{ error_type: string; count: number }>;

    return {
      generated_at: generatedAt,
      summary,
      time_series: timeSeries.map((r) => ({
        bucket: r.bucket,
        calls: r.calls,
        errors: r.errors ?? 0
      })),
      by_tool: byTool.map((r) => ({
        tool_name: r.tool_name,
        calls: r.calls,
        errors: r.errors ?? 0,
        avg_latency_ms: r.avg_latency_ms != null ? round2(r.avg_latency_ms) : 0,
        empty_results: r.empty_results ?? 0
      })),
      errors_by_type: errorsByType
    };
  }
}
