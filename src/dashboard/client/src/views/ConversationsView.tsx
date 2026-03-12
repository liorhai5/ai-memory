import { useEffect, useState, useCallback, useRef } from 'react';
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
import { countOccurrences, highlightText } from '../search-utils';
import { type RefreshStateChange } from '../refresh';

interface Conversation {
  id: string;
  external_id: string;
  workspace: string | null;
  ide: string | null;
  source_path: string | null;
  source_mtime: string | null;
  title: string | null;
  summary: string | null;
  turn_count: number;
  started_at: string;
  updated_at: string;
}

interface Turn {
  id: string;
  role: string;
  content: string;
  turn_number: number;
  created_at: string;
}

interface ConversationsViewProps {
  active: boolean;
  onRefreshStateChange: RefreshStateChange;
}

const PAGE_SIZE = 50;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

function turnPreview(content: string): string {
  const clean = content.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  return truncate(clean, 150);
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
  if (!info) {
    return (
      <span className="ide-badge ide-unknown" title={`IDE: ${ide}`}>
        <span className="ide-badge-icon">?</span>
      </span>
    );
  }
  return (
    <span className={`ide-badge ${info.className}`} title={`IDE: ${info.label}`}>
      <span className="ide-badge-icon">{info.icon}</span>
    </span>
  );
}

function shortenPath(p: string | null): string {
  if (!p) return '—';
  const home = '/Users/';
  if (p.startsWith(home)) {
    const rest = p.slice(home.length);
    const slash = rest.indexOf('/');
    return '~/' + (slash >= 0 ? rest.slice(slash + 1) : rest);
  }
  return p;
}

function DetailRow({ label, value, full }: { label: string; value: string; full?: string }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value" title={full ?? value}>{value}</span>
    </div>
  );
}

function DetailsPanel({ conv }: { conv: Conversation }) {
  return (
    <div className="conv-details-panel">
      <DetailRow label="id" value={conv.id} />
      <DetailRow label="external_id" value={conv.external_id} />
      <DetailRow label="workspace" value={conv.workspace ?? 'null'} />
      <DetailRow label="ide" value={conv.ide ?? 'null'} />
      <DetailRow label="source" value={shortenPath(conv.source_path)} full={conv.source_path ?? undefined} />
      <DetailRow label="source_mtime" value={conv.source_mtime ?? '—'} />
      <DetailRow label="started_at" value={conv.started_at} />
      <DetailRow label="updated_at" value={conv.updated_at} />
      <DetailRow label="turns" value={String(conv.turn_count)} />
    </div>
  );
}

function SelectConversationIllustration() {
  return (
    <svg
      className="conv-empty-illustration"
      viewBox="0 0 120 90"
      aria-hidden="true"
    >
      <rect x="18" y="14" width="84" height="56" rx="12" className="conv-empty-chat" />
      <path d="M52 70 L46 84 L68 70 Z" className="conv-empty-chat" />
      <circle cx="42" cy="42" r="4" className="conv-empty-dot" />
      <circle cx="60" cy="42" r="4" className="conv-empty-dot" />
      <circle cx="78" cy="42" r="4" className="conv-empty-dot" />
    </svg>
  );
}

export function ConversationsView({ active, onRefreshStateChange }: ConversationsViewProps) {
  const initHash = useRef(readHash());
  const isConvView = initHash.current.view === 'conversations';

  const [items, setItems] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(
    isConvView ? initHash.current.params.get('id') : null
  );
  const [turns, setTurns] = useState<Turn[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [workspace, setWorkspace] = useState<string>(
    isConvView ? initHash.current.params.get('ws') ?? '' : ''
  );
  const [timeRange, setTimeRange] = useState<TimeRange>(
    isConvView ? (initHash.current.params.get('time') as TimeRange) ?? '' : ''
  );
  const [query, setQuery] = useState<string>(isConvView ? initHash.current.params.get('q') ?? '' : '');
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(new Set());
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [missingSelected, setMissingSelected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  // Sync key state → URL hash (only when this view is active)
  useEffect(() => {
    if (!active) return;
    writeHash('conversations', {
      id: selectedId ?? '',
      ws: workspace,
      time: timeRange,
      q: query,
    });
  }, [active, selectedId, workspace, timeRange, query]);

  // Handle incoming deep-links (e.g. from Search → "view conversation")
  useEffect(() => {
    const onHash = () => {
      const { view, params } = readHash();
      if (view !== 'conversations') return;
      const id = params.get('id');
      if (id && id !== selectedId) setSelectedId(id);
      const nextQuery = params.get('q') ?? '';
      setQuery(nextQuery);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [selectedId]);

  useEffect(() => {
    rpc<{ workspaces: string[] }>('listWorkspaces', {})
      .then((res) => setWorkspaces(res.workspaces))
      .catch(() => {});
  }, []);

  const loadConversations = useCallback(
    (append: boolean) => {
      const nextOffset = append ? offset + PAGE_SIZE : 0;
      if (!append) setLoading(true);
      rpc<{ conversations: Conversation[]; total: number }>('listConversations', {
        workspace: workspace || undefined,
        date_from: timeRangeToIso(timeRange),
        limit: PAGE_SIZE,
        offset: nextOffset,
      })
        .then((res) => {
          if (append) {
            setItems((prev) => [...prev, ...res.conversations]);
          } else {
            setItems(res.conversations);
          }
          setTotal(res.total);
          setOffset(nextOffset);
        })
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    },
    [workspace, timeRange, offset]
  );

  const loadSelectedConversation = useCallback(async (conversationId: string) => {
    setMissingSelected(false);
    try {
      const res = await rpc<{ conversation: Conversation | null; turns: Turn[] }>('getConversation', {
        conversation_id: conversationId,
      });
      setTurns(res.turns);
      setSelectedConv(res.conversation);
      setMissingSelected(res.conversation === null);
      setExpandedTurns(new Set());
      setSummaryExpanded(false);
      setDetailsOpen(false);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    const listLimit = Math.max(items.length, PAGE_SIZE);
    setLoading(true);
    setError(null);
    try {
      const res = await rpc<{ conversations: Conversation[]; total: number }>('listConversations', {
        workspace: workspace || undefined,
        date_from: timeRangeToIso(timeRange),
        limit: listLimit,
        offset: 0,
      });
      setItems(res.conversations);
      setTotal(res.total);
      setOffset(Math.max(0, res.conversations.length - PAGE_SIZE));
      if (selectedId) {
        await loadSelectedConversation(selectedId);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [items.length, workspace, timeRange, selectedId, loadSelectedConversation]);

  useEffect(() => {
    setOffset(0);
    loadConversations(false);
  }, [workspace, timeRange]);

  useEffect(() => {
    if (!selectedId) {
      setTurns([]);
      setSelectedConv(null);
      setMissingSelected(false);
      return;
    }
    void loadSelectedConversation(selectedId);
  }, [selectedId, loadSelectedConversation]);

  useEffect(() => {
    onRefreshStateChange({
      run: refreshConversations,
      canRefresh: true,
      isRefreshing: loading,
    });
    return () => onRefreshStateChange(null);
  }, [onRefreshStateChange, refreshConversations, loading]);

  const toggleTurn = (id: string) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const targetIds = new Set(visibleTurns.map((row) => row.turn.id));
    const everyTargetExpanded = visibleTurns.length > 0 && visibleTurns.every((row) => expandedTurns.has(row.turn.id));
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (everyTargetExpanded) {
        for (const id of targetIds) next.delete(id);
      } else {
        for (const id of targetIds) next.add(id);
      }
      return next;
    });
  };

  const normalizedQuery = query.trim();
  const turnRows = turns.map((turn) => ({
    turn,
    matchCount: normalizedQuery ? countOccurrences(turn.content, normalizedQuery) : 0,
  }));
  const visibleTurns = normalizedQuery
    ? turnRows.filter((row) => row.matchCount > 0)
    : turnRows;
  const allVisibleExpanded =
    visibleTurns.length > 0 && visibleTurns.every((row) => expandedTurns.has(row.turn.id));
  const hasMore = items.length < total;
  const summaryLong = (selectedConv?.summary?.length ?? 0) > 150;

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">Conversations</span>
        <span className="toolbar-count">{total}</span>
        <span className="toolbar-spacer" />
        <select
          className="form-select"
          value={timeRange}
          onChange={(e) => {
            setTimeRange(e.target.value as TimeRange);
            setSelectedId(null);
          }}
        >
          {TIME_RANGES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          className="form-select"
          value={workspace}
          onChange={(e) => {
            setWorkspace(e.target.value);
            setSelectedId(null);
          }}
        >
          <option value="">All workspaces</option>
          {workspaces.map((ws) => (
            <option key={ws} value={ws}>
              {formatWorkspace(ws)}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-state"><div className="error-state-title">{error}</div></div>}

      {loading ? (
        <div className="loading-center"><div className="spinner spinner-md" /></div>
      ) : (
        <div className="conv-layout">
          <div className="conv-list-panel">
            <div className="conv-list-scroll">
              {items.length === 0 && (
                <div className="empty-state">
                  <div className="empty-state-title">No conversations</div>
                </div>
              )}
              {items.map((c) => (
                <button
                  key={c.id}
                  className={`conv-list-item ${selectedId === c.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(c.id)}
                  title={c.title ?? '[untitled]'}
                >
                  <div className="conv-list-title">{c.title ?? '[untitled]'}</div>
                  <div className="conv-list-meta">
                    <WorkspaceBadge ws={c.workspace} />
                    <IdeBadge ide={c.ide} />
                    <span>{c.turn_count} turns</span>
                    <span>{formatDate(c.updated_at)}</span>
                  </div>
                </button>
              ))}
              {hasMore && (
                <button className="conv-load-more" onClick={() => loadConversations(true)}>
                  Load more ({total - items.length} remaining)
                </button>
              )}
            </div>
          </div>

          <div className="conv-transcript-panel">
            {!selectedConv ? (
              <div className="conv-placeholder">
                {missingSelected ? (
                  <>
                    <div className="empty-state-title">Conversation not found</div>
                    <div className="empty-state-desc">
                      The selected conversation is unavailable for the current data or filters.
                    </div>
                    <button className="btn btn-ghost" onClick={() => setSelectedId(null)}>
                      Clear selection
                    </button>
                  </>
                ) : (
                  <>
                    <SelectConversationIllustration />
                    <div className="empty-state-title">Select a conversation</div>
                    <div className="empty-state-desc">
                      Pick an item from the left panel to view turns, summary, and metadata.
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="conv-header">
                  <div className="conv-header-top">
                    <div className="conv-header-identity">
                      <span className="conv-transcript-inline-title">
                        {selectedConv.title ?? '[untitled]'}
                      </span>
                    </div>
                    <div className="conv-header-controls">
                      <input
                        className="form-input conv-search-input"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search in conversation..."
                        aria-label="Search in conversation"
                      />
                      {normalizedQuery && (
                        <button className="btn btn-ghost" onClick={() => setQuery('')}>
                          Clear search
                        </button>
                      )}
                      <button className="btn btn-ghost" onClick={toggleAll}>
                        {allVisibleExpanded ? 'Collapse all' : 'Expand all'}
                      </button>
                    </div>
                  </div>

                  <div className="conv-header-meta">
                    <div className="conv-header-meta-left">
                      <WorkspaceBadge ws={selectedConv.workspace} />
                      <IdeBadge ide={selectedConv.ide} />
                      <span className="toolbar-meta">{selectedConv.turn_count} turns</span>
                      <span className="toolbar-meta">
                        {formatDate(selectedConv.started_at)} → {formatDate(selectedConv.updated_at)}
                      </span>
                    </div>
                    {normalizedQuery && (
                      <div className="conv-header-meta-right">
                        <span>Filtered by: "{normalizedQuery}"</span>
                        <span>Showing {visibleTurns.length} of {turns.length} turns</span>
                      </div>
                    )}
                    <button
                      className={`btn btn-ghost ${detailsOpen ? 'btn-active' : ''}`}
                      onClick={() => setDetailsOpen(!detailsOpen)}
                      title="Show details"
                    >
                      ⓘ
                    </button>
                  </div>
                </div>

                {detailsOpen && selectedConv && (
                  <DetailsPanel conv={selectedConv} />
                )}

                {selectedConv.summary && (
                  <div
                    className={`conv-summary-bar ${summaryExpanded ? 'expanded' : ''}`}
                    onClick={() => summaryLong && setSummaryExpanded(!summaryExpanded)}
                  >
                    <div className="conv-summary-content">
                      <span className="conv-summary-label">Summary</span>
                      <span className="conv-summary-text">
                        {summaryExpanded || !summaryLong
                          ? selectedConv.summary
                          : truncate(selectedConv.summary, 150)}
                      </span>
                    </div>
                    {summaryLong && (
                      <button className="btn btn-ghost conv-summary-toggle">
                        {summaryExpanded ? '▲' : '▼'}
                      </button>
                    )}
                  </div>
                )}

                <div className="conv-transcript-scroll">
                  {normalizedQuery && visibleTurns.length === 0 && (
                    <div className="empty-state">
                      <div className="empty-state-title">No matching turns in this conversation.</div>
                    </div>
                  )}
                  {visibleTurns.map(({ turn: t, matchCount }) => {
                    const isExpanded = expandedTurns.has(t.id);
                    const isUser = t.role === 'user';
                    return (
                      <div
                        key={t.id}
                        className={`turn ${isUser ? 'turn-user' : 'turn-assistant'}`}
                      >
                        <div className="turn-header" onClick={() => toggleTurn(t.id)}>
                          <span className={`turn-expand-icon ${isExpanded ? 'expanded' : ''}`}>▶</span>
                          <span className="turn-number">#{t.turn_number}</span>
                          <span className={`badge ${isUser ? 'badge-blue' : 'badge-green'}`}>
                            {t.role}
                          </span>
                          {normalizedQuery && (
                            <span className="badge badge-purple turn-match-count">
                              {matchCount} match{matchCount === 1 ? '' : 'es'}
                            </span>
                          )}
                          {!isExpanded && (
                            <span className="turn-preview">{turnPreview(t.content)}</span>
                          )}
                        </div>
                        {isExpanded && (
                          <div className="turn-content">
                            <div className={t.content.length > 5000 ? 'turn-content-scroll' : ''}>
                              {normalizedQuery ? highlightText(t.content, normalizedQuery) : t.content}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
