import { useEffect, useState, useCallback, useRef } from 'react';
import { rpc } from '../rpc';
import { formatWorkspace } from '../workspace-colors';
import { readHash, writeHash } from '../url-state';
import { type RefreshStateChange } from '../refresh';

interface InjectionConfig {
  injection_max_conversations: number;
  injection_max_title_chars: number;
  injection_max_summary_chars: number;
  injection_max_total_chars: number;
}

interface SimResult {
  output: string;
  limits: {
    max_conversations: number;
    max_title_chars: number;
    max_summary_chars: number;
    max_total_chars: number;
  };
  chars: number;
}

const SLIDERS: Array<{
  key: keyof InjectionConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}> = [
  { key: 'injection_max_conversations', label: 'Max conversations', min: 1, max: 20, step: 1, unit: '' },
  { key: 'injection_max_title_chars', label: 'Max title chars', min: 20, max: 200, step: 10, unit: 'ch' },
  { key: 'injection_max_summary_chars', label: 'Max summary chars', min: 50, max: 500, step: 10, unit: 'ch' },
  { key: 'injection_max_total_chars', label: 'Max total chars', min: 500, max: 5000, step: 100, unit: 'ch' },
];

interface InjectionSimulatorProps {
  active: boolean;
  onRefreshStateChange: RefreshStateChange;
}

export function InjectionSimulator({ active, onRefreshStateChange }: InjectionSimulatorProps) {
  const initHash = useRef(readHash());
  const isInjView = initHash.current.view === 'injection';

  const [workspace, setWorkspace] = useState<string>(
    isInjView ? initHash.current.params.get('ws') ?? '' : ''
  );
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<InjectionConfig | null>(null);
  const [overrides, setOverrides] = useState<InjectionConfig | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    writeHash('injection', { ws: workspace });
  }, [active, workspace]);

  useEffect(() => {
    Promise.all([
      rpc<{ workspaces: string[] }>('listWorkspaces', {}),
      rpc<{ config: InjectionConfig }>('getConfig', {}),
    ]).then(([wsRes, cfgRes]) => {
      setWorkspaces(wsRes.workspaces);
      setDefaults(cfgRes.config);
      setOverrides(cfgRes.config);
    });
  }, []);

  const simulate = useCallback(async () => {
    if (!overrides) return;
    setLoading(true);
    try {
      const nextResult = await rpc<SimResult>('simulateInjection', {
        workspace: workspace || undefined,
        max_conversations: overrides.injection_max_conversations,
        max_title_chars: overrides.injection_max_title_chars,
        max_summary_chars: overrides.injection_max_summary_chars,
        max_total_chars: overrides.injection_max_total_chars,
      });
      setResult(nextResult);
    } finally {
      setLoading(false);
    }
  }, [workspace, overrides]);

  useEffect(() => {
    if (overrides) void simulate();
  }, [overrides, simulate]);

  useEffect(() => {
    onRefreshStateChange({
      run: simulate,
      canRefresh: Boolean(overrides),
      isRefreshing: loading,
    });
    return () => onRefreshStateChange(null);
  }, [onRefreshStateChange, simulate, overrides, loading]);

  const resetDefaults = () => {
    if (defaults) setOverrides({ ...defaults });
  };

  const applyGlobally = async () => {
    if (!overrides || !isModified) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await rpc<{ config: InjectionConfig }>('updateConfig', {
        injection_max_conversations: overrides.injection_max_conversations,
        injection_max_title_chars: overrides.injection_max_title_chars,
        injection_max_summary_chars: overrides.injection_max_summary_chars,
        injection_max_total_chars: overrides.injection_max_total_chars,
      });
      setDefaults(res.config);
      setOverrides({ ...res.config });
      setSaveMsg('Applied globally.');
    } catch (e) {
      setSaveMsg(`Failed to apply: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const updateParam = (key: keyof InjectionConfig, value: number) => {
    setOverrides((prev) => prev ? { ...prev, [key]: value } : prev);
  };

  const isModified = defaults && overrides && SLIDERS.some(
    (s) => overrides[s.key] !== defaults[s.key]
  );

  const budgetPct = result && overrides
    ? Math.round((result.chars / overrides.injection_max_total_chars) * 100)
    : 0;

  if (!overrides) {
    return <div className="loading-center"><div className="spinner spinner-md" /></div>;
  }

  return (
    <>
      <div className="toolbar">
        <span className="toolbar-title">Injection Simulator</span>
        <span className="toolbar-spacer" />
        <select
          className="form-select"
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
        >
          <option value="">No workspace (global)</option>
          {workspaces.map((ws) => (
            <option key={ws} value={ws}>{formatWorkspace(ws)}</option>
          ))}
        </select>
      </div>

      <div className="sim-layout">
        <div className="sim-controls">
          <div className="sim-controls-header">
            <span className="sim-controls-title">Parameters</span>
            {isModified && (
              <button className="btn btn-ghost" onClick={resetDefaults}>Reset</button>
            )}
          </div>

          {SLIDERS.map((s) => (
            <div key={s.key} className="sim-slider">
              <div className="sim-slider-header">
                <span className="sim-slider-label">{s.label}</span>
                <span className="sim-slider-value">
                  {overrides[s.key]}{s.unit}
                  {defaults && overrides[s.key] !== defaults[s.key] && (
                    <span className="sim-slider-default"> (default: {defaults[s.key]})</span>
                  )}
                </span>
              </div>
              <input
                type="range"
                className="sim-range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={overrides[s.key]}
                onChange={(e) => updateParam(s.key, Number(e.target.value))}
              />
            </div>
          ))}

          <div className="sim-apply-box">
            <div className="sim-apply-note">Applies globally to all workspaces.</div>
            <button
              className="btn btn-primary"
              onClick={applyGlobally}
              disabled={!isModified || saving}
            >
              {saving ? 'Applying…' : 'Apply globally'}
            </button>
            {saveMsg && <div className="sim-apply-msg">{saveMsg}</div>}
          </div>
        </div>

        <div className="sim-output-panel">
          <div className="sim-stats">
            <div className="sim-stat">
              <span className="sim-stat-value">{result?.chars ?? 0}</span>
              <span className="sim-stat-label">chars</span>
            </div>
            <div className="sim-stat">
              <span className="sim-stat-value">{budgetPct}%</span>
              <span className="sim-stat-label">of budget</span>
            </div>
            <div className="sim-budget-bar">
              <div
                className="sim-budget-fill"
                data-over={budgetPct > 95 ? '' : undefined}
                style={{ width: `${Math.min(budgetPct, 100)}%` }}
              />
            </div>
          </div>

          <div className="sim-output">
            {loading && <div className="loading-center"><div className="spinner spinner-sm" /></div>}
            {!loading && result && (
              <pre className="sim-output-text">{result.output}</pre>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
