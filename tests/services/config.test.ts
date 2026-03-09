import { describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, getConfigValue, setConfigValue } from '../../src/services/config-service.js';

describe('ConfigService', () => {
  test('159 config.defaults-when-no-file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    const path = join(dir, 'nonexistent.json');
    const config = loadConfig(path);
    expect(config.extraction_interval).toBe(10);
    expect(config.token_budget).toBe(400);
    expect(config.core_budget).toBe(200);
    expect(config.tune_threshold).toBe(500);
  });

  test('160 config.save-and-load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    const path = join(dir, 'config.json');
    const config = { extraction_interval: 20, token_budget: 600, core_budget: 300, tune_threshold: 1000 };
    saveConfig(config, path);
    const loaded = loadConfig(path);
    expect(loaded).toEqual(config);
  });

  test('161 config.partial-merge-with-defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ extraction_interval: 0 }));
    const loaded = loadConfig(path);
    expect(loaded.extraction_interval).toBe(0);
    expect(loaded.token_budget).toBe(400);
    expect(loaded.core_budget).toBe(200);
    expect(loaded.tune_threshold).toBe(500);
  });

  test('162 config.get-valid-key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    const path = join(dir, 'config.json');
    const result = getConfigValue('extraction_interval', path);
    expect(result).toEqual({ key: 'extraction_interval', value: 10 });
  });

  test('163 config.get-invalid-key', () => {
    const result = getConfigValue('nonexistent_key');
    expect('error' in result).toBe(true);
  });

  test('164 config.set-value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    const path = join(dir, 'config.json');
    const result = setConfigValue('extraction_interval', '0', path);
    expect(result).toEqual({ key: 'extraction_interval', value: 0 });
    const loaded = loadConfig(path);
    expect(loaded.extraction_interval).toBe(0);
  });

  test('165 config.set-invalid-value', () => {
    const result = setConfigValue('extraction_interval', 'abc');
    expect('error' in result).toBe(true);
  });

  test('166 config.set-negative-rejected', () => {
    const result = setConfigValue('extraction_interval', '-5');
    expect('error' in result).toBe(true);
  });

  test('167 config.corrupted-file-uses-defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    const path = join(dir, 'config.json');
    writeFileSync(path, 'not json at all{{{');
    const loaded = loadConfig(path);
    expect(loaded.extraction_interval).toBe(10);
  });
});
