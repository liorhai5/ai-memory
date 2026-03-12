import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc } from '../rpc';
import { type RefreshStateChange } from '../refresh';

type UsageRange = '24h' | '7d' | '30d';

interface UsageDashboardPayload {
  generated_at: string;
  summary: {
    range: UsageRange;
    total_calls: number;
    error_rate: number;
    empty_search_rate: number;
    avg_latency_ms: number;
  };
  time_series: Array<{ bucket: string; calls: number; errors: number }>;
  by_tool: Array<{
    tool_name: string;
    calls: number;
    errors: number;
    avg_latency_ms: number;
    empty_results: number;
  }>;
  errors_by_type: Array<{ error_type: string; count: number }>;
}

const RANGE_OPTIONS: Array<{ value: UsageRange; label: string }> = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' }
];

interface UsageViewProps {
  active: boolean;
  onRefreshStateChange: RefreshStateChange;
}

function kpiPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

type ToolSort = 'calls-desc' | 'error-desc' | 'latency-desc' | 'name-asc';

function formatBucketLabel(bucket: string): string {
  // 2026-03-11T15:00:00Z -> 03-11 15:00
  if (bucket.includes('T')) {
    return `${bucket.slice(5, 10)} ${bucket.slice(11, 16)}`;
  }
  // 2026-03-11 -> 2026-03-11
  return bucket;
}

export function UsageView({ active, onRefreshStateChange }: UsageViewProps) {
  const [range, setRange] = useState<UsageRange>('7d');
  const [toolSort, setToolSort] = useState<ToolSort>('calls-desc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageDashboardPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await rpc<UsageDashboardPayload>('getUsageDashboard', { range });
      setData(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    if (active) {
      void load();
    }
  }, [active, load]);

  useEffect(() => {
    onRefreshStateChange({
      run: load,
      canRefresh: true,
      isRefreshing: loading,
    });
    return () => onRefreshStateChange(null);
  }, [onRefreshStateChange, load, loading]);

  const totalFromTools = useMemo(
    () => (data ? data.by_tool.reduce((sum, row) => sum + row.calls, 0) : 0),
    [data]
  );

  const maxCallsInSeries = useMemo(
    () => (data ? Math.max(0, ...data.time_series.map((r) => r.calls)) : 0),
    [data]
  );

  const sortedTools = useMemo(() => {
    if (!data) return [];
    const rows = [...data.by_tool];
    rows.sort((a, b) => {
      switch (toolSort) {
        case 'name-asc':
          return a.tool_name.localeCompare(b.tool_name);
        case 'latency-desc':
          return b.avg_latency_ms - a.avg_latency_ms;
        case 'error-desc': {
          const ea = a.calls > 0 ? a.errors / a.calls : 0;
          const eb = b.calls > 0 ? b.errors / b.calls : 0;
          return eb - ea;
        }
        case 'calls-desc':
        default:
          return b.calls - a.calls;
      }
    });
    return rows;
  }, [data, toolSort]);

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">Usage</span>
        {data?.generated_at && <span className="toolbar-meta">Snapshot: {data.generated_at}</span>}
        <span className="toolbar-spacer" />
        <select className="form-select" value={range} onChange={(e) => setRange(e.target.value as UsageRange)}>
          {RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="error-state">
          <div className="error-state-title">{error}</div>
        </div>
      )}

      {!error && loading && !data && (
        <div className="loading-center">
          <div className="spinner spinner-md" />
        </div>
      )}

      {!error && data && (
        <div className="usage-body">
          <div className="usage-grid">
            <div className="usage-card">
              <div className="usage-card-k">Total calls</div>
              <div className="usage-big">{data.summary.total_calls}</div>
            </div>
            <div className="usage-card">
              <div className="usage-card-k">Error rate</div>
              <div className="usage-big">{kpiPct(data.summary.error_rate)}</div>
            </div>
            <div className="usage-card">
              <div className="usage-card-k">Empty search rate</div>
              <div className="usage-big">{kpiPct(data.summary.empty_search_rate)}</div>
            </div>
            <div className="usage-card">
              <div className="usage-card-k">Avg latency</div>
              <div className="usage-big">{data.summary.avg_latency_ms} ms</div>
            </div>
          </div>

          <div className="usage-card">
            <div className="usage-card-k">Calls over time</div>
            {data.time_series.length === 0 ? (
              <div className="status-note">No MCP usage in this period.</div>
            ) : (
              <div className="usage-timeseries-list">
                {data.time_series.map((row) => (
                  <div key={row.bucket} className="usage-series-row">
                    <span className="status-mono usage-series-label">{formatBucketLabel(row.bucket)}</span>
                    <div className="usage-series-bar-wrap">
                      <div
                        className="usage-series-bar"
                        style={{ width: `${maxCallsInSeries > 0 ? (row.calls / maxCallsInSeries) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="status-mono usage-series-value">{row.calls}</span>
                    <span className="status-mono usage-series-value usage-series-errors">{row.errors} err</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="usage-card">
            <div className="usage-card-head">
              <div className="usage-card-k">By tool</div>
              <select className="form-select usage-sort-select" value={toolSort} onChange={(e) => setToolSort(e.target.value as ToolSort)}>
                <option value="calls-desc">Sort: calls</option>
                <option value="error-desc">Sort: error %</option>
                <option value="latency-desc">Sort: avg latency</option>
                <option value="name-asc">Sort: name</option>
              </select>
            </div>
            {data.by_tool.length === 0 ? (
              <div className="status-note">No MCP usage in this period.</div>
            ) : (
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>tool</th>
                    <th>calls</th>
                    <th>share</th>
                    <th>avg ms</th>
                    <th>error %</th>
                    <th>empty %</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTools.map((row) => {
                    const share = totalFromTools > 0 ? row.calls / totalFromTools : 0;
                    const errorRate = row.calls > 0 ? row.errors / row.calls : 0;
                    const emptyRate = row.tool_name === 'ai-memory-search' && row.calls > 0 ? row.empty_results / row.calls : null;
                    return (
                      <tr key={row.tool_name}>
                        <td className="status-mono">{row.tool_name}</td>
                        <td>{row.calls}</td>
                        <td>{kpiPct(share)}</td>
                        <td>{row.avg_latency_ms}</td>
                        <td>{kpiPct(errorRate)}</td>
                        <td>{emptyRate == null ? '-' : kpiPct(emptyRate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="usage-card">
            <div className="usage-card-k">Errors by type</div>
            {data.errors_by_type.length === 0 ? (
              <div className="status-note">No errors in this period.</div>
            ) : (
              <div className="usage-timeseries-list">
                {data.errors_by_type.map((row) => (
                  <div key={row.error_type} className="usage-list-row">
                    <span className="status-mono">{row.error_type}</span>
                    <span className="status-mono">{row.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
