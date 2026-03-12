import { describe, expect, test } from 'vitest';
import { deriveProjectKey, normalizeWorkspaceLabel, toProjectKey } from '../../src/utils/workspace-identity.js';

describe('workspace identity', () => {
  test('normalizeWorkspaceLabel keeps basename for absolute path', () => {
    expect(normalizeWorkspaceLabel('/Users/me/Projects/ai-memory')).toBe('ai-memory');
  });

  test('toProjectKey uses ws: fallback', () => {
    expect(toProjectKey('ai-memory')).toBe('ws:ai-memory');
    expect(toProjectKey(null)).toBe('ws:global');
  });

  test('deriveProjectKey prefers path hash when absolute workspacePath exists', () => {
    const key = deriveProjectKey({
      workspace: 'ai-memory',
      workspacePath: '/Users/me/Projects/ai-memory'
    });
    expect(key.startsWith('path:')).toBe(true);
  });

  test('deriveProjectKey uses src token when no absolute workspacePath', () => {
    const key = deriveProjectKey({
      workspace: 'ai-memory',
      sourcePath: '/Users/me/.cursor/projects/Users-me-Projects-ai-memory/agent-transcripts/a/a.jsonl'
    });
    expect(key).toBe('src:Users-me-Projects-ai-memory');
  });

  // D038 D7: Playgrounds- marker removed — raw basename is used as-is
  test('deriveProjectKey falls back to ws label when no path/token available', () => {
    const key = deriveProjectKey({
      workspace: 'Users-me-Projects-Playgrounds-ai-memory'
    });
    expect(key).toBe('ws:Users-me-Projects-Playgrounds-ai-memory');
  });
});
