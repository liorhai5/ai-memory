import type Database from 'better-sqlite3';
import { createDb, getDbPath } from './db/connection.js';
import { ConversationStore } from './stores/conversation-store.js';
import { SearchService } from './services/search-service.js';
import { ImportService } from './services/import-service.js';
import { StatusService } from './services/status-service.js';
import { UsageService } from './services/usage-service.js';
import { type AiMemoryConfig, loadConfig } from './services/config-service.js';

export interface AppContext {
  db: Database.Database;
  config: AiMemoryConfig;
  conversationStore: ConversationStore;
  searchService: SearchService;
  importService: ImportService;
  statusService: StatusService;
  usageService: UsageService;
}

export function createApp(dbPath = getDbPath(), configPath?: string): AppContext {
  const db = createDb(dbPath);
  const config = loadConfig(configPath);
  const conversationStore = new ConversationStore(db);
  const searchService = new SearchService(db, config);
  const importService = new ImportService(conversationStore);
  const statusService = new StatusService(db, dbPath);
  const usageService = new UsageService(db);

  return {
    db,
    config,
    conversationStore,
    searchService,
    importService,
    statusService,
    usageService
  };
}
