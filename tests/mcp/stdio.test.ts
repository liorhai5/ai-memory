import { describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Resolve tsx from node_modules rather than going through npx — see tests/adapters/cli.test.ts.
const TSX = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
);

describe('mcp stdio server', () => {
  test('exits when stdin is closed instead of lingering as an orphan', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-mcp-eof-'));
    const dbPath = join(dir, 'memory.db');

    const child = spawn(TSX, ['src/cli.ts', 'mcp'], {
      cwd: process.cwd(),
      env: { ...process.env, AI_MEMORY_DB_PATH: dbPath, HOME: dir }
    });

    const exited = new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code));
    });

    // Let startup (imports, watcher registration) settle before closing stdin.
    await new Promise((resolve) => setTimeout(resolve, 500));

    child.stdin.end();

    const code = await Promise.race([
      exited,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000))
    ]);

    expect(code).toBe(0);
  });
});
