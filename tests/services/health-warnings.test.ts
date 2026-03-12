import { describe, expect, test } from 'vitest';
import { createTempApp } from '../test-helpers.js';

describe('Health Warnings', () => {
  test('inserted warning appears in getActiveWarnings()', () => {
    const { app } = createTempApp();
    app.db.prepare(
      `INSERT INTO health_warnings (category, message) VALUES (?, ?)`
    ).run('import', 'Failed to import 3 files');

    const warnings = app.statusService.getActiveWarnings();
    expect(warnings.length).toBe(1);
    expect(warnings[0].category).toBe('import');
    expect(warnings[0].message).toBe('Failed to import 3 files');
  });

  test('upsert same warning twice yields 1 row with updated last_seen_at', () => {
    const { app } = createTempApp();
    app.db.prepare(
      `INSERT INTO health_warnings (category, message, first_seen_at, last_seen_at)
       VALUES (?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    ).run('import', 'duplicate file');

    // Upsert the same (category, message) — should update last_seen_at
    app.db.prepare(
      `INSERT INTO health_warnings (category, message, first_seen_at, last_seen_at)
       VALUES (?, ?, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z')
       ON CONFLICT(category, message) DO UPDATE SET last_seen_at = excluded.last_seen_at`
    ).run('import', 'duplicate file');

    const all = app.db.prepare(`SELECT * FROM health_warnings`).all() as Array<Record<string, unknown>>;
    expect(all.length).toBe(1);

    const warnings = app.statusService.getActiveWarnings();
    expect(warnings.length).toBe(1);
    expect(warnings[0].last_seen_at).toBe('2026-01-02T00:00:00Z');
  });

  test('resolved warning does not appear in getActiveWarnings()', () => {
    const { app } = createTempApp();
    app.db.prepare(
      `INSERT INTO health_warnings (category, message, resolved_at) VALUES (?, ?, datetime('now'))`
    ).run('search', 'High empty search rate');

    const warnings = app.statusService.getActiveWarnings();
    expect(warnings.length).toBe(0);
  });

  test('getActiveWarningCount() returns correct count', () => {
    const { app } = createTempApp();
    expect(app.statusService.getActiveWarningCount()).toBe(0);

    app.db.prepare(
      `INSERT INTO health_warnings (category, message) VALUES (?, ?)`
    ).run('import', 'warning 1');
    app.db.prepare(
      `INSERT INTO health_warnings (category, message) VALUES (?, ?)`
    ).run('search', 'warning 2');
    app.db.prepare(
      `INSERT INTO health_warnings (category, message, resolved_at) VALUES (?, ?, datetime('now'))`
    ).run('config', 'resolved warning');

    expect(app.statusService.getActiveWarningCount()).toBe(2);
  });

  test('re-triggering a resolved warning un-resolves it (sets resolved_at to NULL)', () => {
    const { app } = createTempApp();
    app.db.prepare(
      `INSERT INTO health_warnings (category, message, resolved_at) VALUES (?, ?, datetime('now'))`
    ).run('import', 'flaky warning');

    // Verify it is resolved
    expect(app.statusService.getActiveWarningCount()).toBe(0);

    // Re-trigger: upsert same (category, message), clear resolved_at
    app.db.prepare(
      `INSERT INTO health_warnings (category, message)
       VALUES (?, ?)
       ON CONFLICT(category, message) DO UPDATE SET resolved_at = NULL, last_seen_at = datetime('now')`
    ).run('import', 'flaky warning');

    const warnings = app.statusService.getActiveWarnings();
    expect(warnings.length).toBe(1);
    expect(warnings[0].category).toBe('import');
    expect(warnings[0].message).toBe('flaky warning');
  });
});
