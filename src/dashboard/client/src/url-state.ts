export function readHash(): { view: string; params: URLSearchParams } {
  const raw = window.location.hash.replace('#/', '');
  const qi = raw.indexOf('?');
  return {
    view: qi >= 0 ? raw.slice(0, qi) : raw || 'conversations',
    params: new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : ''),
  };
}

/**
 * Write view params to URL via replaceState (no history entry).
 * Empty-string values are omitted to keep the URL clean.
 */
export function writeHash(view: string, state: Record<string, string>) {
  const entries = Object.entries(state).filter(([, v]) => v !== '');
  const qs = entries.length ? '?' + new URLSearchParams(entries).toString() : '';
  const target = `#/${view}${qs}`;
  if (window.location.hash !== target) {
    history.replaceState(null, '', target);
  }
}
