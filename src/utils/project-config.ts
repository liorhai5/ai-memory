import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ProjectConfig {
  project_slug?: string;
  skip?: boolean;
}

/**
 * Read per-project config from <workspacePath>/.ai-memory/config.json.
 * Returns null if workspace path is null, file doesn't exist, or JSON is malformed.
 * On malformed JSON, logs a warning to stderr (caller may persist to health_warnings).
 */
export function readProjectConfig(workspacePath: string | null): ProjectConfig | null {
  if (!workspacePath) return null;
  const configPath = join(workspacePath, '.ai-memory', 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      process.stderr.write(`[ai-memory] malformed project config (not an object): ${configPath}\n`);
      return null;
    }
    const config: ProjectConfig = {};
    if (typeof parsed.project_slug === 'string') config.project_slug = parsed.project_slug;
    if (typeof parsed.skip === 'boolean') config.skip = parsed.skip;
    return config;
  } catch {
    process.stderr.write(`[ai-memory] failed to parse project config: ${configPath}\n`);
    return null;
  }
}
