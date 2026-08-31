const PALETTE = [
  { color: '#58a6ff', bg: 'rgba(88, 166, 255, 0.15)' },
  { color: '#3fb950', bg: 'rgba(63, 185, 80, 0.15)' },
  { color: '#d29922', bg: 'rgba(210, 153, 34, 0.15)' },
  { color: '#bc8cff', bg: 'rgba(188, 140, 255, 0.15)' },
  { color: '#f0883e', bg: 'rgba(240, 136, 62, 0.15)' },
  { color: '#f85149', bg: 'rgba(248, 81, 73, 0.15)' },
  { color: '#7dd3fc', bg: 'rgba(125, 211, 252, 0.15)' },
  { color: '#5ec2a7', bg: 'rgba(94, 194, 167, 0.15)' },
];

function stableHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const cache = new Map<string, (typeof PALETTE)[0]>();

export function workspaceStyle(ws: string | null): { color: string; backgroundColor: string } {
  const key = ws ?? 'global';
  let entry = cache.get(key);
  if (!entry) {
    entry = PALETTE[stableHash(key) % PALETTE.length];
    cache.set(key, entry);
  }
  return { color: entry.color, backgroundColor: entry.bg };
}

export function formatWorkspace(ws: string | null): string {
  if (!ws) return 'global';
  // A filesystem path: the project is the trailing segment. The previous
  // implementation did not handle this case at all and returned the whole path.
  if (ws.includes('/') || ws.includes('\\')) {
    const seg = ws.split(/[/\\]/).filter(Boolean).pop();
    if (seg) return seg;
  }
  // Older rows stored an IDE project token instead: an absolute path with the
  // separators flattened to '-'. A project name can itself contain '-', so
  // there is no generic way to split one back apart — trimming the known
  // container prefix is a compatibility shim for that legacy data, not a
  // description of where projects live.
  const marker = ws.lastIndexOf('Playgrounds-');
  if (marker >= 0) return ws.slice(marker + 'Playgrounds-'.length);
  return ws.replace(/^-+/, '');
}

export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export const IDE_INDICATOR: Record<string, { icon: string; label: string; className: string }> = {
  cursor:        { icon: '⌘',  label: 'Cursor', className: 'ide-cursor' },
  'claude-code': { icon: '>_', label: 'Claude Code', className: 'ide-claude' },
  codex:         { icon: '◈',  label: 'Codex', className: 'ide-codex' },
};

export type TimeRange = '' | 'day' | 'week' | 'month' | 'year';

export const TIME_RANGES: Array<{ value: TimeRange; label: string }> = [
  { value: '', label: 'All time' },
  { value: 'day', label: 'Last 24h' },
  { value: 'week', label: 'Last week' },
  { value: 'month', label: 'Last month' },
  { value: 'year', label: 'Last year' },
];

export function timeRangeToIso(range: TimeRange): string | undefined {
  if (!range) return undefined;
  const now = Date.now();
  const ms: Record<string, number> = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  };
  return new Date(now - ms[range]).toISOString();
}
