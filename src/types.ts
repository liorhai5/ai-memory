export type MemoryType = 'decision' | 'correction' | 'pattern' | 'learning' | 'preference' | 'fact';
export type MemoryState = 'active' | 'superseded' | 'archived';
export type LinkType = 'supersedes' | 'contradicts' | 'supports' | 'refines' | 'related';
export type SessionStatus = 'active' | 'completed' | 'crashed';
export type ExtractionStatus = 'pending' | 'extracted' | 'failed';
export type MemorySource = 'hook' | 'cli' | 'migration' | 'mcp';
export type IdeType = 'cursor' | 'claude-code' | 'cli';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  content_hash: string;
  workspace: string | null;
  session_id: string | null;
  score: number;
  repetition_count: number;
  source: MemorySource | null;
  source_event_id: string | null;
  extraction_confidence: number;
  created_at: string;
  last_accessed_at: string | null;
  state: MemoryState;
  embedding: Buffer | null;
}

export interface CapturedEvent {
  id: string;
  session_id: string;
  workspace: string | null;
  content: string;
  content_hash: string;
  source: string | null;
  created_at: string;
  extraction_status: ExtractionStatus;
}

export interface MemoryLink {
  id: string;
  source_id: string;
  target_id: string;
  type: LinkType;
  confidence: number;
  created_at: string;
}

export interface SessionRow {
  id: string;
  workspace: string | null;
  ide: IdeType | null;
  status: SessionStatus;
  turn_count: number;
  last_extraction_turn: number;
  started_at: string;
  ended_at: string | null;
}

export const MEMORY_TYPES: MemoryType[] = ['decision', 'correction', 'pattern', 'learning', 'preference', 'fact'];
export const LINK_TYPES: LinkType[] = ['supersedes', 'contradicts', 'supports', 'refines', 'related'];
