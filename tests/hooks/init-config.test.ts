import { describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateInitConfig } from '../../src/hooks/init-config.js';

describe('Init Config (generateInitConfig)', () => {
  test('83 init.cursor-hooks-config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-init-83-'));
    const filePath = join(dir, 'hooks.json');
    generateInitConfig({ ide: 'cursor', filePath });
    const json = JSON.parse(readFileSync(filePath, 'utf8'));
    // D25: Cursor format { version: 1, hooks: { sessionStart: [{ command: "..." }] } }
    expect(json).toHaveProperty('version', 1);
    expect(json.hooks).toHaveProperty('sessionStart');
    expect(json.hooks).toHaveProperty('stop');
    expect(json.hooks).toHaveProperty('sessionEnd');
    expect(json.hooks.sessionStart[0]).toHaveProperty('command');
  });

  test('84 init.claude-code-config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-init-84-'));
    const filePath = join(dir, 'settings.json');
    generateInitConfig({ ide: 'claude-code', filePath });
    const json = JSON.parse(readFileSync(filePath, 'utf8'));
    // D25: Claude Code format { hooks: { SessionStart: [{ type: "command", command: "..." }] } }
    expect(json.hooks).toHaveProperty('SessionStart');
    expect(json.hooks).toHaveProperty('Stop');
    expect(json.hooks).toHaveProperty('SessionEnd');
    expect(json.hooks.SessionStart[0]).toHaveProperty('type', 'command');
    expect(json.hooks.SessionStart[0]).toHaveProperty('command');
  });

  test('85 init.idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-init-85-'));
    const filePath = join(dir, 'hooks.json');
    generateInitConfig({ ide: 'cursor', filePath });
    generateInitConfig({ ide: 'cursor', filePath });
    const json = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(json.hooks.sessionStart.length).toBe(1);
  });
});
