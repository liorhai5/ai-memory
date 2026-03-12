import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { ConversationsView } from './views/ConversationsView';
import { SearchView } from './views/SearchView';
import { InjectionSimulator } from './views/InjectionSimulator';
import { StatusView } from './views/StatusView';
import { UsageView } from './views/UsageView';
import { readHash } from './url-state';
import { type ViewRefreshState } from './refresh';

type View = 'conversations' | 'search' | 'injection' | 'status' | 'usage';

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 9h10M7 13h6" strokeLinecap="round" />
      <path
        d="M6 4.75h12A2.25 2.25 0 0 1 20.25 7v7.5A2.25 2.25 0 0 1 18 16.75H12l-4.5 3v-3H6A2.25 2.25 0 0 1 3.75 14.5V7A2.25 2.25 0 0 1 6 4.75Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="6.25" />
      <path d="m16 16 3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}

function InjectionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 18 18 6" strokeLinecap="round" />
      <rect x="4.5" y="16.2" width="4.8" height="2.8" rx="0.8" transform="rotate(-45 4.5 16.2)" />
      <path d="m16 4.8 3.2 3.2M18.2 2.6l3.2 3.2" strokeLinecap="round" />
      <path d="m14.9 5.9 3.2 3.2" strokeLinecap="round" />
    </svg>
  );
}

function StatusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 18.5h14" strokeLinecap="round" />
      <path d="M7.25 16V12m4.75 4V8m4.75 8v-6" strokeLinecap="round" />
      <rect x="4" y="4" width="16" height="16" rx="2.25" />
    </svg>
  );
}

function UsageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4.75 18.5h14.5" strokeLinecap="round" />
      <path d="m6.5 15.75 3.25-3.25 2.75 2.75 4.75-5.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.25 10h2.25v2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV_ITEMS: Array<{ id: View; label: string; icon: ReactNode }> = [
  { id: 'conversations', label: 'Conversations', icon: <ChatIcon /> },
  { id: 'search', label: 'Search', icon: <SearchIcon /> },
  { id: 'injection', label: 'Injection', icon: <InjectionIcon /> },
  { id: 'status', label: 'Status', icon: <StatusIcon /> },
  { id: 'usage', label: 'Usage', icon: <UsageIcon /> },
];

export function App() {
  const [view, setView] = useState<View>(() => (readHash().view as View) || 'conversations');
  const [refreshByView, setRefreshByView] = useState<Partial<Record<View, ViewRefreshState>>>({});
  const [refreshingHeader, setRefreshingHeader] = useState(false);

  const onHash = useCallback(() => {
    const v = readHash().view as View;
    if (NAV_ITEMS.some((n) => n.id === v)) setView(v);
  }, []);

  useEffect(() => {
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [onHash]);

  const navigate = (v: View) => {
    window.location.hash = `#/${v}`;
  };

  const onRefreshStateChange = useCallback((targetView: View, state: ViewRefreshState | null) => {
    setRefreshByView((prev) => {
      const next = { ...prev };
      if (state) next[targetView] = state;
      else delete next[targetView];
      return next;
    });
  }, []);

  const activeRefresh = refreshByView[view];
  const canRefresh = Boolean(activeRefresh?.canRefresh) && !refreshingHeader && !activeRefresh?.isRefreshing;

  const refreshActiveView = async () => {
    if (!activeRefresh || !activeRefresh.canRefresh || refreshingHeader) return;
    setRefreshingHeader(true);
    try {
      await activeRefresh.run();
    } finally {
      setRefreshingHeader(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-logo">ai-memory</span>
        <span className="app-header-label">Dashboard</span>
        <span className="app-header-spacer" />
        <button
          className="btn btn-secondary app-header-refresh"
          onClick={() => void refreshActiveView()}
          disabled={!canRefresh}
          title="Refresh current page data"
        >
          {refreshingHeader || activeRefresh?.isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>
      <div className="app-body">
        <nav className="sidebar">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`sidebar-item ${view === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <main className="main-content">
          <div style={{ display: view === 'conversations' ? 'contents' : 'none' }}>
            <ConversationsView
              active={view === 'conversations'}
              onRefreshStateChange={(state) => onRefreshStateChange('conversations', state)}
            />
          </div>
          <div style={{ display: view === 'search' ? 'contents' : 'none' }}>
            <SearchView
              active={view === 'search'}
              onRefreshStateChange={(state) => onRefreshStateChange('search', state)}
            />
          </div>
          <div style={{ display: view === 'injection' ? 'contents' : 'none' }}>
            <InjectionSimulator
              active={view === 'injection'}
              onRefreshStateChange={(state) => onRefreshStateChange('injection', state)}
            />
          </div>
          <div style={{ display: view === 'status' ? 'contents' : 'none' }}>
            <StatusView
              active={view === 'status'}
              onRefreshStateChange={(state) => onRefreshStateChange('status', state)}
            />
          </div>
          <div style={{ display: view === 'usage' ? 'contents' : 'none' }}>
            <UsageView
              active={view === 'usage'}
              onRefreshStateChange={(state) => onRefreshStateChange('usage', state)}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
