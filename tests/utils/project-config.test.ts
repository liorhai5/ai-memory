import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readProjectConfig } from '../../src/utils/project-config.js';

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'ai-memory-config-'));
}

describe('readProjectConfig', () => {
  test('returns null when workspacePath is null', () => {
    expect(readProjectConfig(null)).toBeNull();
  });

  test('returns null when .ai-memory/config.json does not exist', () => {
    const dir = createTempDir();
    expect(readProjectConfig(dir)).toBeNull();
  });

  test('reads valid config with both fields', () => {
    const dir = createTempDir();
    const configDir = join(dir, '.ai-memory');
    mkdirSync(configDir);
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ project_slug: 'my-app', skip: true }));

    const config = readProjectConfig(dir);
    expect(config).toEqual({ project_slug: 'my-app', skip: true });
  });

  test('reads config with only project_slug', () => {
    const dir = createTempDir();
    const configDir = join(dir, '.ai-memory');
    mkdirSync(configDir);
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ project_slug: 'platform' }));

    const config = readProjectConfig(dir);
    expect(config).toEqual({ project_slug: 'platform' });
  });

  test('reads config with only skip', () => {
    const dir = createTempDir();
    const configDir = join(dir, '.ai-memory');
    mkdirSync(configDir);
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ skip: true }));

    const config = readProjectConfig(dir);
    expect(config).toEqual({ skip: true });
  });

  test('reads empty config object', () => {
    const dir = createTempDir();
    const configDir = join(dir, '.ai-memory');
    mkdirSync(configDir);
    writeFileSync(join(configDir, 'config.json'), '{}');

    const config = readProjectConfig(dir);
    expect(config).toEqual({});
  });

  test('returns null on malformed JSON', () => {
    const dir = createTempDir();
    const configDir = join(dir, '.ai-memory');
    mkdirSync(configDir);
    writeFileSync(join(configDir, 'config.json'), '{invalid json');

    const config = readProjectConfig(dir);
    expect(config).toBeNull();
  });

  test('returns null when config is an array', () => {
    const dir = createTempDir();
    const configDir = join(dir, '.ai-memory');
    mkdirSync(configDir);
    writeFileSync(join(configDir, 'config.json'), '[]');

    const config = readProjectConfig(dir);
    expect(config).toBeNull();
  });

  test('ignores unknown fields', () => {
    const dir = createTempDir();
    const configDir = join(dir, '.ai-memory');
    mkdirSync(configDir);
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ project_slug: 'x', unknown_field: 42 }));

    const config = readProjectConfig(dir);
    expect(config).toEqual({ project_slug: 'x' });
  });

  test('ignores project_slug if not a string', () => {
    const dir = createTempDir();
    const configDir = join(dir, '.ai-memory');
    mkdirSync(configDir);
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ project_slug: 123 }));

    const config = readProjectConfig(dir);
    expect(config).toEqual({});
  });

  test('ignores skip if not a boolean', () => {
    const dir = createTempDir();
    const configDir = join(dir, '.ai-memory');
    mkdirSync(configDir);
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ skip: 'yes' }));

    const config = readProjectConfig(dir);
    expect(config).toEqual({});
  });
});
