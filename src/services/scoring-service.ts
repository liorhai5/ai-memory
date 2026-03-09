import type { MemoryType } from '../types.js';
import { daysBetween } from '../utils/time.js';

const TYPE_WEIGHTS: Record<MemoryType, number> = {
  decision: 0.8,
  correction: 0.7,
  pattern: 0.6,
  learning: 0.6,
  preference: 0.5,
  fact: 0.3
};

export class ScoringService {
  getTypeWeight(type: MemoryType): number {
    return TYPE_WEIGHTS[type];
  }

  computeRecencyFactor(lastAccessedAt: string | null): number {
    const days = daysBetween(lastAccessedAt);
    const decay = Math.min(0.3, days * 0.01);
    return Number((1 - decay).toFixed(4));
  }

  computeRepetitionBoost(repetitionCount: number): number {
    const capped = Math.min(Math.max(repetitionCount - 1, 0), 5);
    return Number((1 + 0.1 * capped).toFixed(4));
  }

  computeScore(input: {
    type: MemoryType;
    extractionConfidence: number;
    lastAccessedAt: string | null;
    repetitionCount: number;
  }): number {
    const baseScore = this.getTypeWeight(input.type) * input.extractionConfidence;
    const recencyFactor = this.computeRecencyFactor(input.lastAccessedAt);
    const repetitionBoost = this.computeRepetitionBoost(input.repetitionCount);
    return Number((baseScore * recencyFactor * repetitionBoost).toFixed(6));
  }
}
