import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { IdeType } from '../types.js';

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

/**
 * Extract the working directory from already-read JSONL transcript lines.
 * - Claude Code: `row.cwd` on `type: "user"` lines
 * - Codex: `row.payload.cwd` on `type: "session_meta"` lines
 * - Cursor: no cwd available, returns null
 */
export function extractCwdFromTranscript(lines: string[], ide: IdeType): string | null {
  if (ide === 'cursor') return null;
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (ide === 'claude-code' && row.type === 'user' && typeof row.cwd === 'string') {
        return row.cwd;
      }
      if (ide === 'codex' && row.type === 'session_meta' && typeof row.payload?.cwd === 'string') {
        return row.payload.cwd;
      }
    } catch { /* skip malformed */ }
  }
  return null;
}

/**
 * Greedy left-to-right filesystem probe to decode an IDE project token back to
 * a real directory path. At each dash, try it as `/`. If the prefix exists on
 * disk, commit and continue. If not, keep the dash as literal.
 */
export function probeTokenToPath(token: string): string | null {
  const stripped = token.replace(/^-+/, '');
  if (!stripped) return null;

  const dashes: number[] = [];
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '-') dashes.push(i);
  }
  if (dashes.length === 0) {
    const candidate = `/${stripped}`;
    return existsSync(candidate) ? candidate : null;
  }

  let committed = '';
  let cursor = 0;

  for (let i = 0; i < dashes.length; i++) {
    const dashPos = dashes[i];
    const segment = stripped.slice(cursor, dashPos);
    const tryPath = `${committed}/${segment}`;
    if (existsSync(tryPath)) {
      committed = tryPath;
      cursor = dashPos + 1;
    }
    // else: keep dash as literal, try next dash
  }

  // Append remaining text after last committed dash
  const remaining = stripped.slice(cursor);
  if (remaining) {
    committed = `${committed}/${remaining}`;
  }

  return committed && existsSync(committed) ? committed : null;
}

/**
 * Resolve workspace name and path for a conversation being imported.
 * Three-tier: cwd from transcript > filesystem probe of token > raw token fallback.
 */
export function resolveWorkspace(
  ide: IdeType,
  token: string | null,
  lines: string[]
): { workspace: string | null; workspace_path: string | null } {
  // Tier 1: cwd from transcript content
  const cwd = extractCwdFromTranscript(lines, ide);
  if (cwd) {
    return { workspace: basename(cwd), workspace_path: cwd };
  }

  // Tier 2: filesystem probe of IDE token
  if (token) {
    const resolved = probeTokenToPath(token);
    if (resolved) {
      return { workspace: basename(resolved), workspace_path: resolved };
    }
  }

  // Tier 3: raw token fallback
  return { workspace: normalizeWorkspaceLabel(token), workspace_path: null };
}
