import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';

export function createTempApp() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-memory-'));
  const dbPath = join(dir, 'memory.db');
  const app = createApp(dbPath);
  return { app, dbPath, dir };
}

export function createConversation(app: ReturnType<typeof createApp>, input?: { external_id?: string; workspace?: string | null }) {
  return app.conversationStore.upsertConversationByExternalId({
    external_id: input?.external_id ?? 'conv-1',
    workspace: input?.workspace ?? 'w1',
    ide: 'cli'
  });
}
