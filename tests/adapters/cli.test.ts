import { describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTempApp, ensureSession, seedMemory, writeMemoryMd } from '../test-helpers.js';

function runCli(args: string[], env: Record<string, string>) {
  return spawnSync('npx', ['tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
}

describe('CLI', () => {
  test('37 cli.query-returns-results', () => {
    const { app, dbPath } = createTempApp();
    seedMemory(app, { id: 'm1', content: 'queryable value', workspace: 'w1' });
    const r = runCli(['query', 'queryable', '--workspace', 'w1'], { AI_MEMORY_DB_PATH: dbPath });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('memories');
  });

  test('38 cli.query-json-mode', () => {
    const { app, dbPath } = createTempApp();
    seedMemory(app, { id: 'm1', content: 'json query value', workspace: 'w1' });
    const r = runCli(['query', 'json', '--workspace', 'w1', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toHaveProperty('memories');
    expect(parsed).toHaveProperty('used_tokens');
  });

  test('39 cli.query-empty', () => {
    const { dbPath } = createTempApp();
    const r = runCli(['query', 'zzz-no-match', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(r.status).toBe(1);
  });

  test('40 cli.capture-stores-entry', () => {
    const { dbPath } = createTempApp();
    const r = runCli(['capture', 'hello', '--type', 'decision', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(r.status).toBe(0);
    const q = runCli(['query', 'hello', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(q.status).toBe(0);
  });

  test('41 cli.capture-invalid-type', () => {
    const { dbPath } = createTempApp();
    const r = runCli(['capture', 'hello', '--type', 'invalid', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(r.status).toBe(2);
  });

  test('42 cli.events-by-session', () => {
    const { app, dbPath } = createTempApp();
    ensureSession(app, 's1');
    app.captureStore.insert({ id: 'e1', session_id: 's1', workspace: 'w1', content: 'x', content_hash: 'h1', source: 'hook', created_at: new Date().toISOString(), extraction_status: 'pending' });
    const r = runCli(['events', '--session', 's1', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.events).toHaveLength(1);
  });

  test('43 cli.status-health', () => {
    const { dbPath } = createTempApp();
    const r = runCli(['status'], { AI_MEMORY_DB_PATH: dbPath });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('pending_extractions_count');
  });

  test('44 cli.status-json', () => {
    const { dbPath } = createTempApp();
    const r = runCli(['status', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toHaveProperty('db_path');
  });

  test('45 cli.sweep-runs-maintenance', () => {
    const { dbPath } = createTempApp();
    const r = runCli(['sweep', '--workspace', 'w1', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toHaveProperty('decayed');
  });

  test('46 cli.exit-codes', () => {
    const { dbPath } = createTempApp();
    const ok = runCli(['status', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    const empty = runCli(['query', 'no-match', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    const err = runCli(['capture', 'x', '--type', 'invalid', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(ok.status).toBe(0);
    expect(empty.status).toBe(1);
    expect(err.status).toBe(2);
  });
});

describe('CLI — Migration', () => {
  test('47 migrate.section-type-mapping', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-migrate-'));
    const dbPath = join(dir, 'm.db');
    const projectMd = join(dir, 'project.md');
    writeMemoryMd(projectMd);

    const m = runCli(['migrate', 'memory-md', '--scope', 'project', '--project-memory-path', projectMd, '--workspace', 'w1', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(m.status).toBe(0);

    const q1 = runCli(['query', 'sqlite', '--workspace', 'w1', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(q1.stdout).toContain('decision');
  });

  test('48 migrate.scope-machine', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-migrate-machine-'));
    const dbPath = join(dir, 'm.db');
    const machineMd = join(dir, 'machine.md');
    writeMemoryMd(machineMd);

    const m = runCli(['migrate', 'memory-md', '--scope', 'machine', '--machine-memory-path', machineMd, '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(m.status).toBe(0);
  });

  test('49 migrate.scope-project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-migrate-project-'));
    const dbPath = join(dir, 'm.db');
    const projectMd = join(dir, 'project.md');
    writeMemoryMd(projectMd);

    const m = runCli(['migrate', 'memory-md', '--scope', 'project', '--project-memory-path', projectMd, '--workspace', 'project-a', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(m.status).toBe(0);
  });

  test('50 migrate.idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-memory-migrate-idem-'));
    const dbPath = join(dir, 'm.db');
    const projectMd = join(dir, 'project.md');
    writeMemoryMd(projectMd);

    const m1 = runCli(['migrate', 'memory-md', '--scope', 'project', '--project-memory-path', projectMd, '--workspace', 'w1', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    const m2 = runCli(['migrate', 'memory-md', '--scope', 'project', '--project-memory-path', projectMd, '--workspace', 'w1', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    expect(m1.status).toBe(0);
    expect(m2.status).toBe(0);

    const q = runCli(['query', 'sqlite', '--workspace', 'w1', '--json'], { AI_MEMORY_DB_PATH: dbPath });
    const parsed = JSON.parse(q.stdout);
    expect(parsed.memories.length).toBeGreaterThan(0);
  });
});
