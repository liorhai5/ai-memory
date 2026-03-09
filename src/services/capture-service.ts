import { CaptureStore } from '../stores/capture-store.js';
import { SessionStore } from '../stores/session-store.js';
import { hashContent } from '../utils/hash.js';
import { newId } from '../utils/id.js';
import { nowIso } from '../utils/time.js';

export class CaptureService {
  constructor(private readonly captureStore: CaptureStore, private readonly sessionStore: SessionStore) {}

  captureTurn(input: { session_id: string; workspace: string | null; content: string; source?: string }): boolean {
    const inserted = this.captureStore.insert({
      id: newId(),
      session_id: input.session_id,
      workspace: input.workspace,
      content: input.content,
      content_hash: hashContent(input.content),
      source: input.source ?? 'hook',
      created_at: nowIso(),
      extraction_status: 'pending'
    });
    this.sessionStore.incrementTurn(input.session_id);
    return inserted;
  }
}
