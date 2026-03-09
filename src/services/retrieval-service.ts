import type { MemoryEntry, CapturedEvent, LinkType } from '../types.js';
import { MemoryStore } from '../stores/memory-store.js';
import { CaptureStore } from '../stores/capture-store.js';
import { LinkStore } from '../stores/link-store.js';
import { estimateTokens } from '../utils/token.js';

export interface LinkedRetrievalItem {
  id: string;
  type: string;
  content: string;
  score: number;
  linked_score: number;
  link_type: LinkType;
  link_confidence: number;
}

export interface RetrievalResult {
  memories: Array<MemoryEntry & { combined_score: number; linked_items?: LinkedRetrievalItem[] }>;
  events: Array<CapturedEvent & { combined_score: number }>;
  used_tokens: number;
  truncated: boolean;
}

export class RetrievalService {
  constructor(
    private readonly memoryStore: MemoryStore,
    private readonly captureStore: CaptureStore,
    private readonly linkStore: LinkStore
  ) {}

  workspaceBoost(entryWorkspace: string | null, currentWorkspace: string | null): number {
    if (entryWorkspace === currentWorkspace && currentWorkspace !== null) return 0.3;
    if (entryWorkspace === null) return 0.2;
    return 0;
  }

  private sanitizeFtsQuery(query: string): string {
    return query.replace(/[,.!"#$%&'()*+/:;<=>?@[\\\]^_`{|}~]/g, ' ').trim();
  }

  private recencyScore(createdAt: string): number {
    const now = Date.now();
    const created = new Date(createdAt).getTime();
    const daysDiff = (now - created) / (1000 * 60 * 60 * 24);
    return Number(Math.min(1.0, Math.max(0.1, 1 - daysDiff * 0.02)).toFixed(4));
  }

  /** Core memories: top-N entries by stored score (no query matching needed) */
  coreMemories(workspace: string | null, tokenBudget: number): MemoryEntry[] {
    const all = this.memoryStore.list(50);
    const active = all.filter((e) => e.state === 'active');
    active.sort((a, b) => {
      const aScore = a.score * (1 + this.workspaceBoost(a.workspace, workspace));
      const bScore = b.score * (1 + this.workspaceBoost(b.workspace, workspace));
      return bScore - aScore;
    });
    const picked: MemoryEntry[] = [];
    let used = 0;
    for (const entry of active) {
      const cost = estimateTokens(entry.content);
      if (used + cost > tokenBudget) break;
      used += cost;
      picked.push(entry);
    }
    return picked;
  }

  query(input: { query: string; workspace: string | null; token_budget?: number; top_k?: number }): RetrievalResult {
    const topK = input.top_k ?? 5;
    const tokenBudget = input.token_budget ?? 800;
    const queryText = input.query.trim();
    const linkedReserve = Math.min(Math.floor(tokenBudget * 0.2), 200);
    const primaryBudget = tokenBudget - linkedReserve;

    // Step 1: Query memory_entries_fts
    const sanitized = this.sanitizeFtsQuery(queryText);
    const memoryRaw: Array<MemoryEntry & { bm25_score: number }> =
      queryText === '*' || queryText.length === 0
        ? this.memoryStore.list(topK * 4).map((row) => ({ ...row, bm25_score: 1 }))
        : sanitized.length > 0
          ? this.memoryStore.searchFts(sanitized, topK * 4)
          : [];

    // Step 2: Query captured events (fts for query, recent list for wildcard)
    let eventRaw: Array<CapturedEvent & { bm25_score: number }> = [];
    if (queryText === '*' || queryText.length === 0) {
      eventRaw = this.captureStore
        .query(undefined, undefined, input.workspace, topK * 4)
        .map((row) => ({ ...row, bm25_score: 1 }));
    } else if (sanitized.length > 0) {
      try {
        eventRaw = this.captureStore.searchFts(sanitized, topK * 4);
      } catch {
        // FTS query might fail on empty table or bad query
      }
    }

    // Step 3+4: Merge, dedup by content_hash, rank
    type RankedItem =
      | { kind: 'memory'; data: MemoryEntry & { bm25_score: number }; combined_score: number }
      | { kind: 'event'; data: CapturedEvent & { bm25_score: number }; combined_score: number };

    const seenHashes = new Set<string>();
    const items: RankedItem[] = [];

    for (const row of memoryRaw) {
      if (row.state === 'superseded' || row.state === 'archived') continue;
      if (seenHashes.has(row.content_hash)) continue;
      seenHashes.add(row.content_hash);
      const relevance = Math.max(0.0001, 1 / Math.max(0.0001, row.bm25_score + 1));
      const combined = relevance * row.score * (1 + this.workspaceBoost(row.workspace, input.workspace));
      items.push({ kind: 'memory', data: row, combined_score: combined });
    }

    for (const row of eventRaw) {
      if (seenHashes.has(row.content_hash)) continue;
      seenHashes.add(row.content_hash);
      const relevance = Math.max(0.0001, 1 / Math.max(0.0001, row.bm25_score + 1));
      const recency = this.recencyScore(row.created_at);
      const combined = relevance * recency * (1 + this.workspaceBoost(row.workspace, input.workspace));
      items.push({ kind: 'event', data: row, combined_score: combined });
    }

    items.sort((a, b) => b.combined_score - a.combined_score);

    // Step 5: Pack PRIMARY entries (budget - linked_reserve)
    const pickedMemories: Array<MemoryEntry & { combined_score: number; linked_items?: LinkedRetrievalItem[] }> = [];
    const pickedEvents: Array<CapturedEvent & { combined_score: number }> = [];
    let usedPrimary = 0;
    const primaryIds = new Set<string>();
    let nextItemIndex = items.length;

    for (let i = 0; i < items.length; i++) {
      if (pickedMemories.length + pickedEvents.length >= topK) {
        nextItemIndex = i;
        break;
      }
      const item = items[i];
      const cost = estimateTokens(item.data.content);
      if (usedPrimary + cost > primaryBudget) {
        nextItemIndex = i;
        break;
      }
      usedPrimary += cost;
      primaryIds.add(item.data.id);
      if (item.kind === 'memory') {
        pickedMemories.push({ ...item.data, combined_score: item.combined_score });
      } else {
        pickedEvents.push({ ...item.data, combined_score: item.combined_score });
      }
    }

    // Steps 6-9: Graph expansion for picked memory entries
    let usedLinked = 0;
    for (const memory of pickedMemories) {
      const links = this.linkStore.findByEntryId(memory.id);
      if (links.length === 0) continue;

      const scored: Array<{ entry: MemoryEntry; link: (typeof links)[0]; linked_score: number }> = [];
      for (const link of links) {
        const linkedId = link.source_id === memory.id ? link.target_id : link.source_id;
        if (primaryIds.has(linkedId)) continue;

        const linkedEntry = this.memoryStore.byId(linkedId);
        if (!linkedEntry || linkedEntry.state !== 'active') continue;

        const linkedScore = link.confidence * linkedEntry.score;
        scored.push({ entry: linkedEntry, link, linked_score: linkedScore });
      }

      scored.sort((a, b) => b.linked_score - a.linked_score);

      const linkedItems: LinkedRetrievalItem[] = [];
      for (const { entry, link, linked_score } of scored) {
        const cost = estimateTokens(entry.content);
        if (usedLinked + cost > linkedReserve) break;
        usedLinked += cost;
        primaryIds.add(entry.id);
        linkedItems.push({
          id: entry.id,
          type: entry.type,
          content: entry.content,
          score: entry.score,
          linked_score,
          link_type: link.type,
          link_confidence: link.confidence
        });
      }

      if (linkedItems.length > 0) {
        memory.linked_items = linkedItems;
      }
    }

    // Budget reclaim: if no linked entries, pack more primaries into remaining budget
    if (usedLinked === 0 && nextItemIndex < items.length) {
      const fullBudget = tokenBudget;
      for (let i = nextItemIndex; i < items.length; i++) {
        if (pickedMemories.length + pickedEvents.length >= topK) break;
        const item = items[i];
        const cost = estimateTokens(item.data.content);
        if (usedPrimary + cost > fullBudget) break;
        usedPrimary += cost;
        primaryIds.add(item.data.id);
        if (item.kind === 'memory') {
          pickedMemories.push({ ...item.data, combined_score: item.combined_score });
        } else {
          pickedEvents.push({ ...item.data, combined_score: item.combined_score });
        }
      }
    }

    const totalUsed = usedPrimary + usedLinked;
    const totalPicked = pickedMemories.length + pickedEvents.length;

    return {
      memories: pickedMemories,
      events: pickedEvents,
      used_tokens: totalUsed,
      truncated: items.length > totalPicked
    };
  }

  /** Format retrieval results for injection, including linked entries */
  formatForInjection(
    memories: Array<MemoryEntry & { combined_score: number; linked_items?: LinkedRetrievalItem[] }>,
    events: Array<CapturedEvent & { combined_score: number }>
  ): string {
    const lines: string[] = [];
    for (const m of memories) {
      lines.push(`- [${m.type}] ${m.content} (score: ${m.combined_score.toFixed(2)})`);
      if (m.linked_items) {
        for (const li of m.linked_items) {
          lines.push(`  -> [${li.link_type}, conf: ${li.link_confidence}] ${li.content} (score: ${li.score.toFixed(2)})`);
        }
      }
    }
    for (const e of events) {
      lines.push(`- [raw_event] ${e.content}`);
    }
    return lines.join('\n');
  }
}
