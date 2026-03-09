import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { stripNonProseContent } from '../utils/content-strip.js';
import type { MemoryType } from '../types.js';

/** A single pattern entry from the config */
export interface PatternEntry {
  id: string;
  regex: string;
  flags: string;
  precision: number;
  category_weight: number;
}

/** The full pattern config shape */
export interface PatternConfig {
  version: number;
  evaluated_on: string;
  corpus_size: number;
  patterns: {
    CORRECTION: PatternEntry[];
    DECISION: PatternEntry[];
    PREFERENCE: PatternEntry[];
    EXPLICIT_SAVE: PatternEntry[];
  };
}

/** Classification result */
export interface ClassificationResult {
  type: MemoryType;
  pattern_id: string;
  extraction_confidence: number;
}

/** Category → MemoryType mapping */
const CATEGORY_TYPE_MAP: Record<string, MemoryType> = {
  CORRECTION: 'correction',
  DECISION: 'decision',
  PREFERENCE: 'preference',
  EXPLICIT_SAVE: 'preference', // default type for explicit saves
};

/** Priority order: highest index wins */
const PRIORITY_ORDER = ['PREFERENCE', 'DECISION', 'CORRECTION', 'EXPLICIT_SAVE'] as const;

/** Default patterns embedded in code (R1 validated patterns) */
const DEFAULT_PATTERNS: PatternConfig = {
  version: 1,
  evaluated_on: '2026-03-08',
  corpus_size: 6034,
  patterns: {
    CORRECTION: [
      { id: 'C1', regex: '^no[,.\\s]', flags: 'i', precision: 1.0, category_weight: 0.9 },
      { id: 'C4', regex: '\\bno need\\b', flags: 'i', precision: 1.0, category_weight: 0.9 },
      { id: 'C6', regex: '\\bstill (see|get|have|the same|not|broken|failing)\\b', flags: 'i', precision: 1.0, category_weight: 0.9 },
      { id: 'C5', regex: '\\b(revert|undo)\\b', flags: 'i', precision: 1.0, category_weight: 0.9 },
      { id: 'C8', regex: '\\bwrong\\b', flags: 'i', precision: 1.0, category_weight: 0.9 },
      { id: 'C11', regex: '\\b(does not work|doesnt work|didnt work|did not work)\\b', flags: 'i', precision: 0.95, category_weight: 0.9 },
      { id: 'C3', regex: '\\binstead\\b', flags: 'i', precision: 0.64, category_weight: 0.9 },
    ],
    DECISION: [
      { id: 'D1', regex: '\\b(from now on|going with|settled on|decided|chose to|will use)\\b', flags: 'i', precision: 1.0, category_weight: 0.8 },
    ],
    PREFERENCE: [
      { id: 'P1', regex: '\\bi (prefer|hate)\\b', flags: 'i', precision: 1.0, category_weight: 0.7 },
      { id: 'P5', regex: '\\bi want to avoid\\b', flags: 'i', precision: 1.0, category_weight: 0.7 },
      { id: 'P3', regex: '\\b(always use|never use|always do|never do)\\b', flags: 'i', precision: 1.0, category_weight: 0.7 },
    ],
    EXPLICIT_SAVE: [
      { id: 'S1', regex: '\\b(remember (this|that))\\b', flags: 'i', precision: 1.0, category_weight: 1.0 },
      { id: 'S2', regex: '\\b(add to memory|update memory)\\b', flags: 'i', precision: 1.0, category_weight: 1.0 },
    ],
  },
};

/** Compiled pattern with pre-built RegExp */
interface CompiledPattern {
  entry: PatternEntry;
  regexp: RegExp;
  category: string;
}

export class DeterministicClassifier {
  private compiledPatterns: CompiledPattern[];
  private patternConfig: PatternConfig;

  constructor(configPath?: string) {
    this.patternConfig = this.loadConfig(configPath);
    this.compiledPatterns = this.compilePatterns(this.patternConfig);
  }

  private loadConfig(configPath?: string): PatternConfig {
    const path = configPath ?? join(homedir(), '.ai-memory/classifier-patterns.json');
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf8');
        return JSON.parse(raw) as PatternConfig;
      } catch {
        // Fall back to defaults on parse error
      }
    }
    return DEFAULT_PATTERNS;
  }

  private compilePatterns(config: PatternConfig): CompiledPattern[] {
    const compiled: CompiledPattern[] = [];
    for (const category of PRIORITY_ORDER) {
      const entries = config.patterns[category];
      if (!entries) continue;
      for (const entry of entries) {
        compiled.push({
          entry,
          regexp: new RegExp(entry.regex, entry.flags),
          category,
        });
      }
    }
    return compiled;
  }

  /**
   * Classify a raw message. Strips non-prose content first, then runs patterns
   * in priority order (EXPLICIT_SAVE > CORRECTION > DECISION > PREFERENCE).
   *
   * Returns the first matching classification or null if no pattern matches.
   */
  classify(rawContent: string): ClassificationResult | null {
    const prose = stripNonProseContent(rawContent);
    if (prose.length === 0) return null;

    // Check in priority order (highest priority first = end of PRIORITY_ORDER)
    for (let i = PRIORITY_ORDER.length - 1; i >= 0; i--) {
      const category = PRIORITY_ORDER[i];
      for (const compiled of this.compiledPatterns) {
        if (compiled.category !== category) continue;
        if (compiled.regexp.test(prose)) {
          return {
            type: CATEGORY_TYPE_MAP[category],
            pattern_id: compiled.entry.id,
            extraction_confidence: compiled.entry.precision * compiled.entry.category_weight,
          };
        }
      }
    }

    return null;
  }

  /** Get the loaded pattern config (for testing/introspection) */
  getPatterns(): PatternConfig {
    return this.patternConfig;
  }
}
