import { useCallback, useEffect, useState } from 'react';
import { rpc } from '../rpc';
import { workspaceStyle, IDE_INDICATOR, formatDate, TIME_RANGES, timeRangeToIso, type TimeRange } from '../workspace-colors';
import { type RefreshStateChange } from '../refresh';

interface Project {
  name: string;
  path: string | null;
  ides: string;
  conversation_count: number;
  total_turns: number;
  last_activity: string;
  first_seen: string;
}

export function ProjectsView({
  active,
  onRefreshStateChange,
}: {
  active: boolean;
  onRefreshStateChange: RefreshStateChange;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await rpc<{ projects: Project[] }>('listProjects', {
        date_from: timeRangeToIso(timeRange),
      });
      setProjects(res.projects);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  useEffect(() => {
    onRefreshStateChange({ run: load, canRefresh: true, isRefreshing: loading });
    return () => onRefreshStateChange(null);
  }, [load, loading, onRefreshStateChange]);

  const totalConversations = projects.reduce((s, p) => s + p.conversation_count, 0);
  const totalTurns = projects.reduce((s, p) => s + p.total_turns, 0);

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">Projects</span>
        <span className="toolbar-count">{projects.length}</span>
        <span className="toolbar-spacer" />
        <select
          className="form-select"
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as TimeRange)}
        >
          {TIME_RANGES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {error && <div className="error-state"><div className="error-state-title">{error}</div></div>}
      {loading && projects.length === 0 && <div className="loading">Loading projects...</div>}

      <div className="projects-scroll">
        <div className="projects-summary">
          {totalConversations} conversations &middot; {totalTurns} turns
        </div>
        <div className="projects-grid">
          {projects.map((p) => {
            const style = workspaceStyle(p.name);
            const ideList = p.ides ? p.ides.split(',') : [];
            return (
              <div key={`${p.name}-${p.path ?? ''}`} className="project-card">
                <div className="project-card-header">
                  <span className="badge" style={style}>{p.name}</span>
                  <span className="project-conv-count">{p.conversation_count} conv</span>
                </div>
                {p.path && <div className="project-path" title={p.path}>{p.path}</div>}
                <div className="project-card-body">
                  <div className="project-meta-row">
                    <span className="project-meta-label">Turns</span>
                    <span>{p.total_turns}</span>
                  </div>
                  <div className="project-meta-row">
                    <span className="project-meta-label">IDEs</span>
                    <span className="project-ides">
                      {ideList.map((ide) => {
                        const ind = IDE_INDICATOR[ide];
                        return ind ? (
                          <span key={ide} className={`ide-badge ${ind.className}`} title={ind.label}>
                            <span className="ide-badge-icon">{ind.icon}</span>
                          </span>
                        ) : (
                          <span key={ide} className="ide-badge">{ide}</span>
                        );
                      })}
                    </span>
                  </div>
                  <div className="project-meta-row">
                    <span className="project-meta-label">First seen</span>
                    <span>{formatDate(p.first_seen)}</span>
                  </div>
                  <div className="project-meta-row">
                    <span className="project-meta-label">Last activity</span>
                    <span>{formatDate(p.last_activity)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
