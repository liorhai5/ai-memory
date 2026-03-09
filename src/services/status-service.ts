import { CaptureStore } from '../stores/capture-store.js';
import { MemoryStore } from '../stores/memory-store.js';

export class StatusService {
  constructor(private readonly captureStore: CaptureStore, private readonly memoryStore: MemoryStore, private readonly dbPath: string) {}

  getStatus(opts?: { include_pending_ids?: boolean }) {
    const result: Record<string, unknown> = {
      pending_extractions_count: this.captureStore.countPending(),
      memory_entries_count: this.memoryStore.count(),
      db_path: this.dbPath,
      index_status: 'ok',
      last_run: new Date().toISOString()
    };
    if (opts?.include_pending_ids) {
      result.pending_extractions = this.captureStore.listPending(20).map((e) => ({
        id: e.id,
        session_id: e.session_id,
        workspace: e.workspace,
        created_at: e.created_at
      }));
    }
    return result;
  }
}
