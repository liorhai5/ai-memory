export type IdeType = 'cursor' | 'claude-code' | 'codex' | 'cli';
export type TurnRole = 'user' | 'assistant' | 'system';

export interface Conversation {
  id: string;
  external_id: string;
  project_key: string | null;
  workspace: string | null;
  ide: IdeType | null;
  source_path: string | null;
  source_mtime: string | null;
  title: string | null;
  summary: string | null;
  turn_count: number;
  started_at: string;
  updated_at: string;
}

export interface Turn {
  id: string;
  conversation_id: string;
  role: TurnRole;
  content: string;
  content_hash: string;
  turn_number: number;
  created_at: string;
}

export interface SearchParams {
  query?: string;
  workspace?: string | null;
  date_from?: string;
  date_to?: string;
  role?: 'user' | 'assistant';
  limit?: number;
  offset?: number;
}

export interface SearchConversationMatch {
  id: string;
  title: string | null;
  summary: string | null;
  workspace: string | null;
  ide: string | null;
  started_at: string;
  turn_count: number;
  match_source: 'turn' | 'summary' | 'title';
  matching_turns: Array<{
    role: string;
    content: string;
    turn_number: number;
  }>;
}