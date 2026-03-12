import { afterEach, describe, expect, test, vi } from 'vitest';
import { readHash, writeHash } from '../../src/dashboard/client/src/url-state.ts';

function installFakeLocation(initialHash: string) {
  const location = { hash: initialHash };
  const replaceState = vi.fn((_state: unknown, _title: string, url?: string | URL | null) => {
    location.hash = String(url ?? '');
  });

  (globalThis as { window?: unknown }).window = { location };
  (globalThis as { history?: unknown }).history = { replaceState };

  return { location, replaceState };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { history?: unknown }).history;
});

describe('dashboard url-state', () => {
  test('readHash defaults to conversations when hash is empty', () => {
    installFakeLocation('');
    const state = readHash();
    expect(state.view).toBe('conversations');
    expect(state.params.get('id')).toBeNull();
  });

  test('readHash parses view and query params', () => {
    installFakeLocation('#/search?q=design&ws=alpha&time=week');
    const state = readHash();
    expect(state.view).toBe('search');
    expect(state.params.get('q')).toBe('design');
    expect(state.params.get('ws')).toBe('alpha');
    expect(state.params.get('time')).toBe('week');
  });

  test('writeHash omits empty values from URL', () => {
    const { location } = installFakeLocation('#/search');
    writeHash('search', { q: 'dashboard', ws: '', role: '', time: 'day' });
    expect(location.hash).toBe('#/search?q=dashboard&time=day');
  });

  test('writeHash does not rewrite same hash', () => {
    const { replaceState } = installFakeLocation('#/search?q=design');
    writeHash('search', { q: 'design', ws: '' });
    expect(replaceState).not.toHaveBeenCalled();
  });
});
