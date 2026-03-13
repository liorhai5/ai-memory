import { useState, useEffect, useRef, useCallback } from 'react';
import { rpc } from '../rpc';
import {
  formatWorkspace,
  formatDate,
  workspaceStyle,
  IDE_INDICATOR,
  TIME_RANGES,
  timeRangeToIso,
  type TimeRange,
} from '../workspace-colors';
import { readHash, writeHash } from '../url-state';
import { type RefreshStateChange } from '../refresh';

interface MatchTurn {
  role: string;
  content: string;
  turn_number: number;
}

interface SearchItem {
  id: string;
  title: string | null;
  summary: string | null;
  workspace: string | null;
  ide: string | null;
  started_at: string;
  turn_count: number;
  match_source: 'turn' | 'summary' | 'title';
  matching_turns: MatchTurn[];
}

const MATCH_BADGE: Record<string, string> = {
  turn: 'badge-purple',
  summary: 'badge-yellow',
  title: 'badge-green',
};

function truncateSnippet(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

function WorkspaceBadge({ ws }: { ws: string | null }) {
  return (
    <span className="badge" style={workspaceStyle(ws)}>
      {formatWorkspace(ws)}
    </span>
  );
}

function IdeBadge({ ide }: { ide: string | null }) {
  if (!ide) return null;
  const info = IDE_INDICATOR[ide];
  if (!info) return null;
  return (
    <span className={`ide-badge ${info.className}`} title={info.label}>
      {info.icon}
    </span>
  );
}

interface SearchViewProps {
  active: boolean;
  onRefreshStateChange: RefreshStateChange;
}

export function SearchView({ active, onRefreshStateChange }: SearchViewProps) {
  const initHash = useRef(readHash());
  const isSearchView = initHash.current.view === 'search';

  const [query, setQuery] = useState(isSearchView ? initHash.current.params.get('q') ?? '' : '');
  const [workspace, setWorkspace] = useState(isSearchView ? initHash.current.params.get('ws') ?? '' : '');
  const [role, setRole] = useState(isSearchView ? initHash.current.params.get('role') ?? '' : '');
  const [timeRange, setTimeRange] = useState<TimeRange>(
    isSearchView ? (initHash.current.params.get('time') as TimeRange) ?? 'day' : 'day'
  );
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Sync key state → URL hash
  useEffect(() => {
    if (!active) return;
    writeHash('search', { q: query, ws: workspace, role, time: timeRange });
  }, [active, query, workspace, role, timeRange]);

  useEffect(() => {
    rpc<{ workspaces: string[] }>('listWorkspaces', {})
      .then((res) => setWorkspaces(res.workspaces))
      .catch(() => {});
  }, []);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const result = await rpc<{ conversations: SearchItem[]; total: number }>('searchConversations', {
        query,
        workspace: workspace || undefined,
        role: role || undefined,
        date_from: timeRangeToIso(timeRange),
        limit: 50,
        offset: 0,
      });
      setItems(result.conversations);
      setTotalResults(result.total);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [query, workspace, role, timeRange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') runSearch();
  };

  const navigateToConversation = (id: string) => {
    const params = new URLSearchParams({ id });
    if (query.trim()) {
      params.set('q', query.trim());
    }
    window.location.hash = `#/conversations?${params.toString()}`;
  };

  useEffect(() => {
    onRefreshStateChange({
      run: runSearch,
      canRefresh: searched && query.trim().length > 0,
      isRefreshing: loading,
    });
    return () => onRefreshStateChange(null);
  }, [onRefreshStateChange, runSearch, searched, query, loading]);

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">Search</span>
        <span className="toolbar-spacer" />
        <input
          className="form-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search text…"
        />
        <select
          className="form-select"
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as TimeRange)}
        >
          {TIME_RANGES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          className="form-select"
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
        >
          <option value="">All workspaces</option>
          {workspaces.map((ws) => (
            <option key={ws} value={ws}>
              {formatWorkspace(ws)}
            </option>
          ))}
        </select>
        <select
          className="form-select"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="">All roles</option>
          <option value="user">User only</option>
          <option value="assistant">Assistant only</option>
        </select>
        <button
          className="btn btn-primary"
          onClick={runSearch}
          disabled={!query.trim() || loading}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {error && (
        <div className="error-state">
          <div className="error-state-title">{error}</div>
        </div>
      )}

      <div className="search-body">
        {loading && (
          <div className="loading-center"><div className="spinner spinner-md" /></div>
        )}

        {!loading && searched && items.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-title">No results</div>
            <div>Try a different search term or time range</div>
          </div>
        )}

        {!loading && items.length > 0 && (
          <>
            <div className="search-results-count">
              {totalResults} result{totalResults !== 1 ? 's' : ''}
            </div>
            {items.map((item) => (
              <div
                key={item.id}
                className="search-result-card"
                onClick={() => navigateToConversation(item.id)}
              >
                <div className="search-result-header">
                  <span className="search-result-title">{item.title ?? '[untitled]'}</span>
                  <span className={`badge ${MATCH_BADGE[item.match_source] ?? 'badge-muted'}`}>
                    {item.match_source}
                  </span>
                </div>
                <div className="search-result-meta">
                  <WorkspaceBadge ws={item.workspace} />
                  <IdeBadge ide={item.ide} />
                  <span>{item.turn_count} turns</span>
                  <span>{formatDate(item.started_at)}</span>
                </div>
                {item.matching_turns.length > 0 &&
                  item.matching_turns.slice(0, 3).map((t, i) => (
                    <div key={`${item.id}-${i}`} className="search-result-snippet">
                      <span className="search-result-snippet-role">#{t.turn_number} [{t.role}]</span>{' '}
                      {truncateSnippet(t.content, 300)}
                    </div>
                  ))}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
