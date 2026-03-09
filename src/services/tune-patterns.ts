import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { stripNonProseContent } from '../utils/content-strip.js';
import type { PatternConfig, PatternEntry } from './deterministic-classifier.js';

// ─── Labels ──────────────────────────────────────────────────────────

export type HeuristicLabel =
  | 'CORRECTION'
  | 'DECISION'
  | 'PREFERENCE'
  | 'EXPLICIT_SAVE'
  | 'ACTION_REQUEST'
  | 'APPROVAL_GATE'
  | 'CONTEXT_DUMP'
  | 'QUESTION'
  | 'OTHER';

// ─── Heuristic Labeling ─────────────────────────────────────────────

export function heuristicLabel(prose: string): Set<HeuristicLabel> {
  const labels = new Set<HeuristicLabel>();
  const words = prose.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    labels.add('OTHER');
    return labels;
  }

  // Short approval — gate out early
  if (words.length <= 3 && /^(y|yes|ok|approve|approved|do it|proceed)$/i.test(prose.trim())) {
    labels.add('APPROVAL_GATE');
    return labels;
  }

  // Action request — imperative verb start, no decision/preference signals
  if (
    /^(create|add|update|remove|fix|run|check|move|rename|deploy|install)\b/i.test(prose) &&
    !/\b(instead|from now on|i prefer|i want to keep)\b/i.test(prose)
  ) {
    labels.add('ACTION_REQUEST');
  }

  // Correction
  if (/^no[,.\s]/i.test(prose)) labels.add('CORRECTION');
  if (/\b(scratch that|thats wrong|not what i|revert|undo)\b/i.test(prose)) labels.add('CORRECTION');
  if (/\bstill (see|get|have|the same|not|broken|failing)\b/i.test(prose)) labels.add('CORRECTION');
  if (/\b(does not work|doesnt work|didnt work|did not work)\b/i.test(prose)) labels.add('CORRECTION');
  if (/\bno need\b/i.test(prose)) labels.add('CORRECTION');
  if (/\binstead\b/i.test(prose) && words.length < 50) labels.add('CORRECTION');
  if (/\bwrong\b/i.test(prose)) labels.add('CORRECTION');

  // Preference
  if (/\bi (prefer|hate)\b/i.test(prose)) labels.add('PREFERENCE');
  if (/\bi want to avoid\b/i.test(prose)) labels.add('PREFERENCE');
  if (/\b(always use|never use|always do|never do)\b/i.test(prose)) labels.add('PREFERENCE');

  // Decision
  if (/\b(from now on|going with|settled on|decided|chose to|will use)\b/i.test(prose)) {
    labels.add('DECISION');
  }

  // Explicit save
  if (/\b(remember (this|that)|add to memory|update memory)\b/i.test(prose)) {
    labels.add('EXPLICIT_SAVE');
  }

  // Context dump
  if (/^(this|here|currently|the )\b/i.test(prose) && words.length > 20 && labels.size === 0) {
    labels.add('CONTEXT_DUMP');
  }

  // Question
  if (/^(what|how|why|can|does|is |are |do )\b/i.test(prose)) {
    labels.add('QUESTION');
  }

  if (labels.size === 0) labels.add('OTHER');
  return labels;
}

// ─── Context-Enriched Labeling (Session Progression) ────────────────

export function contextEnrichedLabel(msgText: string, prevAgentMsg: string | null): Set<HeuristicLabel> {
  const prose = stripNonProseContent(msgText);
  const base = heuristicLabel(prose);

  if (!prevAgentMsg) return base;

  // Bare approval + agent was proposing → upgrade to DECISION
  if (base.has('APPROVAL_GATE')) {
    if (/\b(should we|shall i|would you like|option|proposal|recommend)\b/i.test(prevAgentMsg)) {
      base.delete('APPROVAL_GATE');
      base.add('DECISION');
    }
  }

  return base;
}

// ─── Scoring ────────────────────────────────────────────────────────

export interface PatternMetrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  volume: number;
}

export type PatternGrade = 'A' | 'B' | 'C' | 'F';

/** Map category names to heuristic label names */
const CATEGORY_TO_LABEL: Record<string, HeuristicLabel> = {
  CORRECTION: 'CORRECTION',
  DECISION: 'DECISION',
  PREFERENCE: 'PREFERENCE',
  EXPLICIT_SAVE: 'EXPLICIT_SAVE'
};

export function scorePattern(
  pattern: RegExp,
  category: string,
  corpus: Array<{ text: string; prev_agent_msg?: string | null }>,
  options?: { human_labels?: Record<string, HeuristicLabel[]> }
): PatternMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;

  const label = CATEGORY_TO_LABEL[category];
  if (!label) return { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0, volume: 0 };

  for (const msg of corpus) {
    const prose = stripNonProseContent(msg.text);
    if (!prose || prose.length === 0) continue;

    const patMatch = pattern.test(prose);
    const human = options?.human_labels?.[msg.text];
    const labels = human?.length
      ? new Set(human)
      : msg.prev_agent_msg
        ? contextEnrichedLabel(msg.text, msg.prev_agent_msg)
        : heuristicLabel(prose);
    const labelMatch = labels.has(label);

    if (patMatch && labelMatch) tp++;
    if (patMatch && !labelMatch) fp++;
    if (!patMatch && labelMatch) fn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    tp,
    fp,
    fn,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    volume: tp + fp
  };
}

export function gradePattern(metrics: PatternMetrics): PatternGrade {
  if (metrics.precision >= 0.8 && metrics.f1 >= 0.3) return 'A';
  if (metrics.precision >= 0.5) return 'B';
  if (metrics.precision >= 0.3) return 'C';
  return 'F';
}

// ─── Config File I/O ────────────────────────────────────────────────

export interface TuneConfig extends PatternConfig {
  min_precision?: number;
  candidates?: Record<string, PatternEntry[]>;
  retired?: PatternEntry[];
  human_labels?: Record<string, HeuristicLabel[]>;
}

const DEFAULT_CONFIG_PATH = join(homedir(), '.ai-memory/classifier-patterns.json');

function loadTuneConfig(configPath?: string): TuneConfig {
  const path = configPath ?? DEFAULT_CONFIG_PATH;
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf8')) as TuneConfig;
  }
  // Return minimal default structure
  return {
    version: 1,
    evaluated_on: new Date().toISOString().slice(0, 10),
    corpus_size: 0,
    patterns: {
      CORRECTION: [],
      DECISION: [],
      PREFERENCE: [],
      EXPLICIT_SAVE: []
    },
    candidates: {},
    retired: [],
    human_labels: {}
  };
}

function saveTuneConfig(config: TuneConfig, configPath?: string): void {
  const path = configPath ?? DEFAULT_CONFIG_PATH;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
}

// ─── Tune Runner ────────────────────────────────────────────────────

export interface TuneResult {
  corpus_size: number;
  patterns_evaluated: number;
  patterns_retired: number;
  candidates_promoted: number;
  per_pattern: Array<{
    id: string;
    category: string;
    precision: number;
    recall: number;
    f1: number;
    grade: PatternGrade;
    action: 'keep' | 'retired' | 'promoted';
  }>;
}

export function runTunePatterns(input: {
  corpus: Array<{ text: string; session_id?: string; prev_agent_msg?: string | null }>;
  configPath?: string;
  threshold?: number;
  auto?: boolean;
}): TuneResult {
  const config = loadTuneConfig(input.configPath);
  const corpus = input.corpus;
  const minPrecision = input.threshold ?? config.min_precision ?? 0.5;

  const result: TuneResult = {
    corpus_size: corpus.length,
    patterns_evaluated: 0,
    patterns_retired: 0,
    candidates_promoted: 0,
    per_pattern: []
  };

  const retiredPatterns: PatternEntry[] = [...(config.retired ?? [])];

  // Phase 2: Evaluate current patterns
  for (const [category, patterns] of Object.entries(config.patterns)) {
    const surviving: PatternEntry[] = [];

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.regex, pattern.flags);
      const metrics = scorePattern(regex, category, corpus, { human_labels: config.human_labels });
      const grade = gradePattern(metrics);
      result.patterns_evaluated++;

      if (grade === 'C' || grade === 'F' || metrics.precision < minPrecision) {
        // Auto-retire
        retiredPatterns.push({ ...pattern, precision: metrics.precision });
        result.patterns_retired++;
        result.per_pattern.push({
          id: pattern.id,
          category,
          precision: metrics.precision,
          recall: metrics.recall,
          f1: metrics.f1,
          grade,
          action: 'retired'
        });
      } else {
        // Update scores and keep
        surviving.push({
          ...pattern,
          precision: metrics.precision,
          category_weight: pattern.category_weight
        });
        result.per_pattern.push({
          id: pattern.id,
          category,
          precision: metrics.precision,
          recall: metrics.recall,
          f1: metrics.f1,
          grade,
          action: 'keep'
        });
      }
    }

    config.patterns[category as keyof typeof config.patterns] = surviving;
  }

  // Phase 3: Evaluate candidate patterns
  if (config.candidates) {
    for (const [category, candidates] of Object.entries(config.candidates)) {
      for (const candidate of candidates) {
        const regex = new RegExp(candidate.regex, candidate.flags);
        const metrics = scorePattern(regex, category, corpus, { human_labels: config.human_labels });
        const grade = gradePattern(metrics);
        result.patterns_evaluated++;

        if ((grade === 'A' || grade === 'B') && metrics.precision >= minPrecision) {
          // Auto-promote
          const promoted: PatternEntry = {
            ...candidate,
            precision: metrics.precision,
            category_weight: candidate.category_weight
          };
          const categoryPatterns = config.patterns[category as keyof typeof config.patterns];
          if (categoryPatterns) {
            categoryPatterns.push(promoted);
          }
          result.candidates_promoted++;
          result.per_pattern.push({
            id: candidate.id,
            category,
            precision: metrics.precision,
            recall: metrics.recall,
            f1: metrics.f1,
            grade,
            action: 'promoted'
          });
        } else {
          result.per_pattern.push({
            id: candidate.id,
            category,
            precision: metrics.precision,
            recall: metrics.recall,
            f1: metrics.f1,
            grade,
            action: 'retired'
          });
        }
      }
    }
    // Clear candidates after evaluation
    config.candidates = {};
  }

  // Phase 4: Update config
  config.retired = retiredPatterns;
  config.corpus_size = corpus.length;
  config.min_precision = minPrecision;
  config.evaluated_on = new Date().toISOString().slice(0, 10);

  saveTuneConfig(config, input.configPath);

  return result;
}
