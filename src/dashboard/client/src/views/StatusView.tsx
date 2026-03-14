import { useCallback, useEffect, useState } from 'react';
import { rpc } from '../rpc';
import { formatDate, formatWorkspace } from '../workspace-colors';
import { type RefreshStateChange } from '../refresh';

interface StatusPayload {
  generated_at: string;
  system_health: {
    db_path: string;
    db_exists: boolean;
    db_readable: boolean;
    conversation_count: number;
    turn_count: number;
    latest_updated_at: string | null;
  };
  data_coverage: {
    by_ide: Array<{ ide: string; count: number }>;
    by_workspace_top: Array<{ workspace: string; count: number }>;
    oldest_started_at: string | null;
    latest_updated_at: string | null;
    last_24h_conversations: number;
    last_7d_conversations: number;
  };
  integrations: {
    cursor: {
      mcp_file: string;
      mcp_file_exists: boolean;
      mcp_configured: boolean;
      mcp_parse_error: string | null;
    };
    claude_code: {
      settings_file: string;
      settings_exists: boolean;
      settings_mcp_configured: boolean;
      registry_file: string;
      registry_exists: boolean;
      registry_mcp_configured: boolean;
      mcp_configured: boolean;
      settings_parse_error: string | null;
      registry_parse_error: string | null;
    };
    codex: {
      config_file: string;
      config_exists: boolean;
      mcp_configured: boolean;
      config_parse_error: string | null;
    };
  };
  watcher: {
    watched_dirs: Array<{ path: string; exists: boolean }>;
    last_import_at: string | null;
    import_error_count: number;
  };
  skills: {
    expected: string[];
    by_ide: Record<string, { installed: number; total: number; missing: string[] }>;
  };
  config_snapshot: {
    search_default_limit: number;
    config_path: string;
    config_exists: boolean;
    config_mtime: string | null;
  };
  warnings: Array<{ category: string; message: string; first_seen_at: string; last_seen_at: string }>;
  runtime: {
    last_ingest_at: string | null;
    last_error: string | null;
  };
  usage_summary: {
    tool_calls_24h: number;
    tool_calls_7d: number;
    error_rate_7d: number;
    empty_search_rate_7d: number;
    avg_latency_ms_7d: number;
  };
}

function BoolBadge({ ok }: { ok: boolean }) {
  return <span className={`status-badge ${ok ? 'ok' : 'warn'}`}>{ok ? 'ok' : 'warn'}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="status-section">
      <h3 className="status-section-title">{title}</h3>
      {children}
    </section>
  );
}

interface StatusViewProps {
  active: boolean;
  onRefreshStateChange: RefreshStateChange;
}

export function StatusView({ active, onRefreshStateChange }: StatusViewProps) {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await rpc<StatusPayload>('getDashboardStatus', {});
      setData(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && !data) load();
  }, [active, data, load]);

  useEffect(() => {
    onRefreshStateChange({
      run: load,
      canRefresh: true,
      isRefreshing: loading,
    });
    return () => onRefreshStateChange(null);
  }, [onRefreshStateChange, load, loading]);

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">Status</span>
        {data?.generated_at && (
          <span className="toolbar-meta">Snapshot: {formatDate(data.generated_at)}</span>
        )}
        <span className="toolbar-spacer" />
      </div>

      {error && (
        <div className="error-state">
          <div className="error-state-title">{error}</div>
        </div>
      )}

      {!error && !data && (
        <div className="loading-center"><div className="spinner spinner-md" /></div>
      )}

      {data && (
        <div className="status-body">
          {data.warnings.length > 0 && (
            <Section title="Health Warnings">
              <div className="status-warnings">
                {data.warnings.map((w, i) => (
                  <div key={i} className="status-warning-row">
                    <span className="status-badge warn">{w.category}</span>
                    <span>{w.message}</span>
                    <span className="status-mono status-warning-date">since {formatDate(w.first_seen_at)}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
          <Section title="System Health">
            <div className="status-grid">
              <div className="status-card">
                <div className="status-card-k">DB path</div>
                <div className="status-mono">{data.system_health.db_path}</div>
              </div>
              <div className="status-card">
                <div className="status-card-k">DB exists</div>
                <BoolBadge ok={data.system_health.db_exists} />
              </div>
              <div className="status-card">
                <div className="status-card-k">DB readable</div>
                <BoolBadge ok={data.system_health.db_readable} />
              </div>
              <div className="status-card">
                <div className="status-card-k">Conversations</div>
                <div className="status-big">{data.system_health.conversation_count}</div>
              </div>
              <div className="status-card">
                <div className="status-card-k">Turns</div>
                <div className="status-big">{data.system_health.turn_count}</div>
              </div>
              <div className="status-card">
                <div className="status-card-k">Latest update</div>
                <div>{data.system_health.latest_updated_at ? formatDate(data.system_health.latest_updated_at) : '—'}</div>
              </div>
            </div>
          </Section>

          <Section title="Data Coverage">
            <div className="status-row">
              <div className="status-card">
                <div className="status-card-k">Date range</div>
                <div>
                  {data.data_coverage.oldest_started_at ? formatDate(data.data_coverage.oldest_started_at) : '—'}
                  {' '}→{' '}
                  {data.data_coverage.latest_updated_at ? formatDate(data.data_coverage.latest_updated_at) : '—'}
                </div>
              </div>
              <div className="status-card">
                <div className="status-card-k">Last 24h / 7d</div>
                <div>{data.data_coverage.last_24h_conversations} / {data.data_coverage.last_7d_conversations}</div>
              </div>
            </div>
            <div className="status-two-col">
              <div className="status-card">
                <div className="status-card-k">By IDE</div>
                {data.data_coverage.by_ide.map((row) => (
                  <div key={row.ide} className="status-list-row">
                    <span>{row.ide}</span>
                    <span className="status-mono">{row.count}</span>
                  </div>
                ))}
              </div>
              <div className="status-card">
                <div className="status-card-k">Top workspaces</div>
                {data.data_coverage.by_workspace_top.map((row) => (
                  <div key={row.workspace} className="status-list-row">
                    <span>{formatWorkspace(row.workspace)}</span>
                    <span className="status-mono">{row.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section title="File Watcher">
            <div className="status-card">
              <div className="status-card-k">Watched directories</div>
              {data.watcher.watched_dirs.map((d) => (
                <div key={d.path} className="status-list-row">
                  <span className="status-mono">{d.path}</span>
                  <BoolBadge ok={d.exists} />
                </div>
              ))}
              <div className="status-list-row">
                <span>Last import</span>
                <span>{data.watcher.last_import_at ? formatDate(data.watcher.last_import_at) : '—'}</span>
              </div>
              <div className="status-list-row">
                <span>Import errors</span>
                <span className="status-mono">{data.watcher.import_error_count}</span>
              </div>
            </div>
          </Section>

          <Section title="IDE Integrations">
            <div className="status-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="status-card">
                <div className="status-card-k">Cursor</div>
                <div className="status-list-row"><span>MCP file exists</span><BoolBadge ok={data.integrations.cursor.mcp_file_exists} /></div>
                <div className="status-list-row"><span>MCP configured</span><BoolBadge ok={data.integrations.cursor.mcp_configured} /></div>
                <div className="status-mono status-path">{data.integrations.cursor.mcp_file}</div>
                {data.integrations.cursor.mcp_parse_error && <div className="status-warn">{data.integrations.cursor.mcp_parse_error}</div>}
              </div>
              <div className="status-card">
                <div className="status-card-k">Claude Code</div>
                <div className="status-list-row"><span>Settings exists</span><BoolBadge ok={data.integrations.claude_code.settings_exists} /></div>
                <div className="status-list-row"><span>Settings MCP</span><BoolBadge ok={data.integrations.claude_code.settings_mcp_configured} /></div>
                <div className="status-list-row"><span>Registry MCP</span><BoolBadge ok={data.integrations.claude_code.registry_mcp_configured} /></div>
                <div className="status-list-row"><span>MCP ready</span><BoolBadge ok={data.integrations.claude_code.mcp_configured} /></div>
                <div className="status-mono status-path">{data.integrations.claude_code.settings_file}</div>
                {data.integrations.claude_code.registry_file && <div className="status-mono status-path">{data.integrations.claude_code.registry_file}</div>}
                {data.integrations.claude_code.settings_parse_error && <div className="status-warn">{data.integrations.claude_code.settings_parse_error}</div>}
                {data.integrations.claude_code.registry_parse_error && <div className="status-warn">{data.integrations.claude_code.registry_parse_error}</div>}
              </div>
              <div className="status-card">
                <div className="status-card-k">Codex</div>
                <div className="status-list-row"><span>Config exists</span><BoolBadge ok={data.integrations.codex.config_exists} /></div>
                <div className="status-list-row"><span>MCP configured</span><BoolBadge ok={data.integrations.codex.mcp_configured} /></div>
                <div className="status-mono status-path">{data.integrations.codex.config_file}</div>
                {data.integrations.codex.config_parse_error && <div className="status-warn">{data.integrations.codex.config_parse_error}</div>}
              </div>
            </div>
          </Section>

          <Section title="Skills">
            <div className="status-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {Object.entries(data.skills.by_ide).map(([ide, info]) => (
                <div key={ide} className="status-card">
                  <div className="status-card-k">{ide.replace('_', ' ')}</div>
                  <div className="status-list-row">
                    <span>Installed</span>
                    <span className="status-mono">{info.installed}/{info.total}</span>
                  </div>
                  {info.missing.length > 0 && (
                    <div className="status-note" style={{ color: 'var(--accent-yellow)' }}>
                      Missing: {info.missing.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Config Snapshot">
            <div className="status-card">
              <div className="status-list-row"><span>search_default_limit</span><span className="status-mono">{data.config_snapshot.search_default_limit}</span></div>
              <div className="status-list-row"><span>config exists</span><BoolBadge ok={data.config_snapshot.config_exists} /></div>
              <div className="status-list-row"><span>config mtime</span><span>{data.config_snapshot.config_mtime ? formatDate(data.config_snapshot.config_mtime) : '—'}</span></div>
              <div className="status-mono status-path">{data.config_snapshot.config_path}</div>
            </div>
          </Section>

          <Section title="Runtime Operations">
            <div className="status-card">
              <div className="status-list-row"><span>last_ingest_at</span><span>{data.runtime.last_ingest_at ? formatDate(data.runtime.last_ingest_at) : '—'}</span></div>
              <div className="status-list-row"><span>last_error</span><span>{data.runtime.last_error ?? '—'}</span></div>
            </div>
          </Section>

          <Section title="Usage Summary">
            <div className="status-grid">
              <div className="status-card">
                <div className="status-card-k">Operations (24h)</div>
                <div className="status-big">{data.usage_summary.tool_calls_24h}</div>
              </div>
              <div className="status-card">
                <div className="status-card-k">Operations (7d)</div>
                <div className="status-big">{data.usage_summary.tool_calls_7d}</div>
              </div>
              <div className="status-card">
                <div className="status-card-k">Error rate (7d)</div>
                <div className="status-big">{(data.usage_summary.error_rate_7d * 100).toFixed(1)}%</div>
              </div>
              <div className="status-card">
                <div className="status-card-k">Empty search rate (7d)</div>
                <div className="status-big">{(data.usage_summary.empty_search_rate_7d * 100).toFixed(1)}%</div>
              </div>
              <div className="status-card">
                <div className="status-card-k">Avg latency (7d)</div>
                <div className="status-big">{data.usage_summary.avg_latency_ms_7d} ms</div>
              </div>
            </div>
          </Section>
        </div>
      )}
    </>
  );
}
