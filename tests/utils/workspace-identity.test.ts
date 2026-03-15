import { describe, expect, test, vi } from 'vitest';
import { normalizeWorkspaceLabel, extractCwdFromTranscript, probeTokenToPath, resolveWorkspace } from '../../src/utils/workspace-identity.js';

describe('workspace identity', () => {
  test('normalizeWorkspaceLabel keeps basename for absolute path', () => {
    expect(normalizeWorkspaceLabel('/Users/me/Projects/ai-memory')).toBe('ai-memory');
  });

  test('normalizeWorkspaceLabel strips leading dashes', () => {
    expect(normalizeWorkspaceLabel('-Users-me-Projects')).toBe('Users-me-Projects');
  });

  test('normalizeWorkspaceLabel returns null for empty/null', () => {
    expect(normalizeWorkspaceLabel(null)).toBeNull();
    expect(normalizeWorkspaceLabel('')).toBeNull();
    expect(normalizeWorkspaceLabel('   ')).toBeNull();
  });
});

describe('extractCwdFromTranscript', () => {
  test('extracts cwd from Claude Code user line', () => {
    const lines = [
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
      JSON.stringify({ type: 'user', cwd: '/Users/me/Projects/ai-memory', message: { content: [{ type: 'text', text: 'hi' }] } }),
    ];
    expect(extractCwdFromTranscript(lines, 'claude-code')).toBe('/Users/me/Projects/ai-memory');
  });

  test('extracts cwd from Codex session_meta', () => {
    const lines = [
      JSON.stringify({ type: 'session_meta', payload: { id: 'abc', cwd: '/Users/me/Projects/foo' } }),
    ];
    expect(extractCwdFromTranscript(lines, 'codex')).toBe('/Users/me/Projects/foo');
  });

  test('returns null for Cursor (no cwd available)', () => {
    const lines = [
      JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'hi' }] } }),
    ];
    expect(extractCwdFromTranscript(lines, 'cursor')).toBeNull();
  });

  test('returns null when no cwd found in Claude Code lines', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
    ];
    expect(extractCwdFromTranscript(lines, 'claude-code')).toBeNull();
  });

  test('handles malformed JSON gracefully', () => {
    const lines = ['not json', '{"type":"user"}'];
    expect(extractCwdFromTranscript(lines, 'claude-code')).toBeNull();
  });
});

describe('probeTokenToPath', () => {
  test('returns null for empty token', () => {
    expect(probeTokenToPath('')).toBeNull();
    expect(probeTokenToPath('---')).toBeNull();
  });

  test('resolves token with existing directories', () => {
    // /tmp always exists on macOS/Linux
    const result = probeTokenToPath('tmp');
    expect(result).toBe('/tmp');
  });

  test('returns null for non-existent path', () => {
    expect(probeTokenToPath('nonexistent-path-xyz-abc')).toBeNull();
  });
});

describe('resolveWorkspace', () => {
  test('tier 1: uses cwd from transcript when available', () => {
    const lines = [
      JSON.stringify({ type: 'user', cwd: '/Users/me/Projects/ai-memory', message: { content: [{ type: 'text', text: 'hi' }] } }),
    ];
    const result = resolveWorkspace('claude-code', '-Users-me-Projects-ai-memory', lines);
    expect(result.workspace).toBe('ai-memory');
    expect(result.workspace_path).toBe('/Users/me/Projects/ai-memory');
  });

  test('tier 2: falls back to token probe when no cwd', () => {
    const lines = [
      JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'hi' }] } }),
    ];
    // Use 'tmp' which resolves to /tmp
    const result = resolveWorkspace('cursor', 'tmp', lines);
    expect(result.workspace).toBe('tmp');
    expect(result.workspace_path).toBe('/tmp');
  });

  test('tier 3: falls back to raw token when probe fails', () => {
    const lines = [
      JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'hi' }] } }),
    ];
    const result = resolveWorkspace('cursor', 'nonexistent-project-xyz', lines);
    expect(result.workspace).toBe('nonexistent-project-xyz');
    expect(result.workspace_path).toBeNull();
  });

  test('tier 3: handles null token', () => {
    const result = resolveWorkspace('cursor', null, []);
    expect(result.workspace).toBeNull();
    expect(result.workspace_path).toBeNull();
  });

  test('subagent gets workspace from cwd, not path segment', () => {
    const lines = [
      JSON.stringify({ type: 'user', cwd: '/Users/me/Projects/ai-memory', message: { content: [{ type: 'text', text: 'research task' }] } }),
    ];
    // Token would be the parent project dir, but subagent file watcher might pass wrong token
    // cwd should take priority
    const result = resolveWorkspace('claude-code', 'subagents', lines);
    expect(result.workspace).toBe('ai-memory');
    expect(result.workspace_path).toBe('/Users/me/Projects/ai-memory');
  });
});
