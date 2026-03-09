import type Database from 'better-sqlite3';
import { createDb, getDbPath } from './db/connection.js';
import { CaptureStore } from './stores/capture-store.js';
import { LinkStore } from './stores/link-store.js';
import { MemoryStore } from './stores/memory-store.js';
import { SessionStore } from './stores/session-store.js';
import { CaptureService } from './services/capture-service.js';
import { DeterministicClassifier } from './services/deterministic-classifier.js';
import { HebbianMatcher } from './services/hebbian-matcher.js';
import { MaintenanceService } from './services/maintenance-service.js';
import { MigrationService } from './services/migration-service.js';
import { RetrievalService } from './services/retrieval-service.js';
import { ScoringService } from './services/scoring-service.js';

export interface AppContext {
  db: Database.Database;
  captureStore: CaptureStore;
  memoryStore: MemoryStore;
  linkStore: LinkStore;
  sessionStore: SessionStore;
  scoringService: ScoringService;
  retrievalService: RetrievalService;
  hebbianMatcher: HebbianMatcher;
  maintenanceService: MaintenanceService;
  captureService: CaptureService;
  migrationService: MigrationService;
  classifier: DeterministicClassifier;
}

export function createApp(dbPath = getDbPath()): AppContext {
  const db = createDb(dbPath);
  const captureStore = new CaptureStore(db);
  const memoryStore = new MemoryStore(db);
  const linkStore = new LinkStore(db);
  const sessionStore = new SessionStore(db);
  const scoringService = new ScoringService();
  const retrievalService = new RetrievalService(memoryStore, captureStore, linkStore);
  const hebbianMatcher = new HebbianMatcher(memoryStore, linkStore, captureStore, sessionStore, scoringService);
  const maintenanceService = new MaintenanceService(db, memoryStore, scoringService);
  const captureService = new CaptureService(captureStore, sessionStore);
  const migrationService = new MigrationService(hebbianMatcher);
  const classifier = new DeterministicClassifier();

  return {
    db,
    captureStore,
    memoryStore,
    linkStore,
    sessionStore,
    scoringService,
    retrievalService,
    hebbianMatcher,
    maintenanceService,
    captureService,
    migrationService,
    classifier
  };
}
