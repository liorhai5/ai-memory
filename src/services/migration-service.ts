import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { HebbianMatcher } from './hebbian-matcher.js';
import type { MemoryType } from '../types.js';

function sectionToType(section: string): MemoryType {
  const s = section.toLowerCase();
  if (s.includes('decision')) return 'decision';
  if (s.includes('pattern')) return 'pattern';
  if (s.includes('learning')) return 'learning';
  return 'fact';
}

export class MigrationService {
  constructor(private readonly matcher: HebbianMatcher) {}

  migrateMemoryMd(input: { filePath: string; scope: 'machine' | 'project'; workspace: string | null; session_id: string }): { imported: number } {
    const txt = readFileSync(input.filePath, 'utf8');
    const lines = txt.split('\n');
    let section = 'Context';
    const items: Array<{ type: MemoryType; content: string; extraction_confidence: number }> = [];

    for (const line of lines) {
      if (line.startsWith('## ')) {
        section = line.replace(/^##\s+/, '').trim();
        continue;
      }
      if (line.startsWith('- ')) {
        items.push({ type: sectionToType(section), content: line.slice(2).trim(), extraction_confidence: 1 });
      }
    }

    const result = this.matcher.capture({
      session_id: `${input.session_id}:${basename(input.filePath)}`,
      workspace: input.scope === 'machine' ? null : input.workspace,
      items,
      source: 'migration'
    });
    return { imported: result.created + result.updated };
  }
}
