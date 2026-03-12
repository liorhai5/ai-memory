import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, normalize } from 'node:path';

export function normalizeWorkspaceLabel(input: string | null | undefined): string | null {
  if (input == null) return null;
  let raw = String(input).trim();
  if (!raw) return null;

  // If we receive an actual path, keep only repo folder name.
  if (raw.includes('/')) {
    raw = basename(raw);
  }

  // Claude project tokens can be prefixed with '-'.
  raw = raw.replace(/^-+/, '');

  return raw;
}

export function toProjectKey(workspace: string | null | undefined): string {
  const normalized = normalizeWorkspaceLabel(workspace);
  return `ws:${normalized ?? 'global'}`;
}

function extractProjectTokenFromSourcePath(sourcePath: string): string | null {
  const cursorMarker = `${join('.cursor', 'projects')}/`;
  const ci = sourcePath.indexOf(cursorMarker);
  if (ci >= 0) {
    const rest = sourcePath.slice(ci + cursorMarker.length);
    const token = rest.split('/')[0];
    return token || null;
  }

  const claudeMarker = `${join('.claude', 'projects')}/`;
  const ai = sourcePath.indexOf(claudeMarker);
  if (ai >= 0) {
    const rest = sourcePath.slice(ai + claudeMarker.length);
    const token = rest.split('/')[0]?.replace(/^-+/, '');
    return token || null;
  }

  return null;
}

function shortPathHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

export function deriveProjectKey(input: {
  workspace: string | null | undefined;
  workspacePath?: string | null;
  sourcePath?: string | null;
}): string {
  const workspacePath = input.workspacePath ? normalize(input.workspacePath) : null;
  if (workspacePath && isAbsolute(workspacePath)) {
    return `path:${shortPathHash(workspacePath)}`;
  }

  if (input.sourcePath) {
    const token = extractProjectTokenFromSourcePath(input.sourcePath);
    if (token) return `src:${token}`;
  }

  return toProjectKey(input.workspace);
}

