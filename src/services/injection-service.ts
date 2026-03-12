import type { AiMemoryConfig } from './config-service.js';
import { ConversationStore } from '../stores/conversation-store.js';

export interface InjectionLimits {
  max_conversations: number;
  max_title_chars: number;
  max_summary_chars: number;
  max_total_chars: number;
}

function limitsFromConfig(config: AiMemoryConfig): InjectionLimits {
  return {
    max_conversations: config.injection_max_conversations,
    max_title_chars: config.injection_max_title_chars,
    max_summary_chars: config.injection_max_summary_chars,
    max_total_chars: config.injection_max_total_chars,
  };
}

function truncate(text: string | null, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

export class InjectionService {
  private readonly defaultLimits: InjectionLimits;

  constructor(private readonly conversationStore: ConversationStore, config: AiMemoryConfig) {
    this.defaultLimits = limitsFromConfig(config);
  }

  buildForProjectKey(projectKey: string | null, workspace: string | null, limits = this.defaultLimits, warningCount = 0): string {
    const recent = this.conversationStore.listRecentByProjectKey({
      project_key: projectKey,
      workspace,
      limit: limits.max_conversations,
      include_other: true
    });
    const same = projectKey
      ? recent.filter((c) => c.project_key === projectKey)
      : recent.filter((c) => c.workspace === workspace);
    const other = projectKey
      ? recent.filter((c) => c.project_key !== projectKey)
      : recent.filter((c) => c.workspace !== workspace);

    const lines: string[] = [];
    // D038 D11: One-line warning count when active warnings exist
    if (warningCount > 0) {
      lines.push(`ai-memory: ${warningCount} health warning${warningCount > 1 ? 's' : ''} — run \`ai-memory status\` or check dashboard`);
    }
    lines.push('<!-- p1:injected:begin -->');
    lines.push(`Recent work (${workspace ?? 'global'}):`);
    if (same.length === 0) {
      lines.push('- [no recent conversations]');
    } else {
      for (const c of same) {
        const title = truncate(c.title ?? '[untitled]', limits.max_title_chars);
        const date = c.updated_at.slice(0, 10);
        lines.push(`- "${title}" (${date})`);
        if (c.summary) lines.push(`  -> ${truncate(c.summary, limits.max_summary_chars)}`);
      }
    }

    if (other.length > 0) {
      lines.push('');
      lines.push('Other recent:');
      for (const c of other) {
        const title = truncate(c.title ?? '[untitled]', limits.max_title_chars);
        const date = c.updated_at.slice(0, 10);
        lines.push(`- "${title}" (${date}, ws: ${c.workspace ?? 'global'})`);
        if (c.summary) lines.push(`  -> ${truncate(c.summary, limits.max_summary_chars)}`);
      }
    }
    lines.push('');
    lines.push('Use ai-memory-search to find past conversations.');
    lines.push('Use ai-memory-summarize after key progress.');
    lines.push('<!-- p1:injected:end -->');

    let output = lines.join('\n');
    if (output.length <= limits.max_total_chars) return output;

    const compactLines = output.split('\n');
    while (compactLines.length > 0 && compactLines.join('\n').length > limits.max_total_chars) {
      let idx = -1;
      for (let i = compactLines.length - 1; i >= 0; i--) {
        const line = compactLines[i];
        if (line.startsWith('- "') && line.includes(', ws: ')) {
          idx = i;
          break;
        }
      }
      if (idx === -1) break;
      compactLines.splice(idx, 1);
      if (idx < compactLines.length && compactLines[idx].startsWith('  ->')) compactLines.splice(idx, 1);
    }
    output = compactLines.join('\n');
    if (output.length > limits.max_total_chars) {
      output = `${output.slice(0, limits.max_total_chars - 3)}...`;
    }
    return output;
  }

  buildForWorkspace(workspace: string | null, limits = this.defaultLimits): string {
    return this.buildForProjectKey(null, workspace, limits);
  }
}
