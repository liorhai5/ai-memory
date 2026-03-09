import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

/** Configuration shape — all fields optional (merged with defaults) */
export interface AiMemoryConfig {
  /** L2 extraction interval in turns. 0 = disable L2 entirely. Default: 10 */
  extraction_interval: number;
  /** Total token budget for session-start injection. Default: 400 */
  token_budget: number;
  /** Token budget reserved for core memories (top-scored, always injected). Default: 200 */
  core_budget: number;
  /** Number of new captured events before auto-tune triggers. 0 = disable auto-tune. Default: 500 */
  tune_threshold: number;
}

const DEFAULTS: AiMemoryConfig = {
  extraction_interval: 10,
  token_budget: 400,
  core_budget: 200,
  tune_threshold: 500,
};

const VALID_KEYS = Object.keys(DEFAULTS) as (keyof AiMemoryConfig)[];

function configPath(): string {
  return join(homedir(), '.ai-memory', 'config.json');
}

export function loadConfig(customPath?: string): AiMemoryConfig {
  const path = customPath ?? configPath();
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      return { ...DEFAULTS, ...raw };
    } catch {
      // Corrupted config — use defaults
    }
  }
  return { ...DEFAULTS };
}

export function saveConfig(config: AiMemoryConfig, customPath?: string): void {
  const path = customPath ?? configPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
}

export function getConfigValue(key: string, customPath?: string): { key: string; value: number } | { error: string } {
  if (!VALID_KEYS.includes(key as keyof AiMemoryConfig)) {
    return { error: `Unknown config key: ${key}. Valid keys: ${VALID_KEYS.join(', ')}` };
  }
  const config = loadConfig(customPath);
  return { key, value: config[key as keyof AiMemoryConfig] };
}

export function setConfigValue(key: string, value: string, customPath?: string): { key: string; value: number } | { error: string } {
  if (!VALID_KEYS.includes(key as keyof AiMemoryConfig)) {
    return { error: `Unknown config key: ${key}. Valid keys: ${VALID_KEYS.join(', ')}` };
  }
  const numValue = Number(value);
  if (isNaN(numValue) || numValue < 0) {
    return { error: `Value must be a non-negative number, got: ${value}` };
  }
  const config = loadConfig(customPath);
  config[key as keyof AiMemoryConfig] = numValue;
  saveConfig(config, customPath);
  return { key, value: numValue };
}
