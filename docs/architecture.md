# Architecture

> Conversation log and retrieval for AI coding assistants.

ai-memory captures every AI conversation and makes it searchable via FTS5. It watches IDE transcript directories and imports turns automatically via the MCP server process. It runs locally, stores everything on the user's machine, and operates without LLM involvement (except optional LLM-written summaries via MCP tool).

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Adapters                                    │
│                                                                      │
│  ┌─────────┐  ┌──────────────────────┐  ┌──────────────┐            │
│  │   CLI   │  │   MCP (stdio)        │  │  Dashboard   │            │
│  │Commander│  │ tools + file watcher │  │  HTTP + SPA  │            │
│  └────┬────┘  └──────────┬───────────┘  └──────┬───────┘            │
│       │                  │                     │                     │
│       └──────────────────┼─────────────────────┘                     │
│                                   │                                  │
├───────────────────────────────────┼──────────────────────────────────┤
│                                   ▼                                  │
│                        ┌──────────────────┐                          │
│                        │    AppContext    │                          │
│                        │    (app.ts)     │                          │
│                        └────────┬─────────┘                          │
│                                 │                                    │
│                   ┌─────────────┼─────────────┐                      │
│                   ▼             ▼             ▼                      │
│             ┌──────────┐  ┌───────────┐  ┌────────────┐             │
│             │ Services │  │  Stores   │  │   Config   │             │
│             │ Search   │  │Conversation│  │config.json │             │
│             │ Import   │  │  Store    │  └────────────┘             │
│             │ Status   │  └─────┬─────┘                             │
│             │ Status   │        │                                    │
│             │ Usage    │        ▼                                    │
│             └──────────┘ ┌──────────────────┐                       │
│                        │     SQLite       │                          │
│                        │ conversations    │                          │
│                        │ turns + FTS5     │                          │
│                        │ tool_usage       │                          │
│                        │ health_warnings  │                          │
│                        └──────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

Three adapters (CLI, MCP, Dashboard) are wrappers over `AppContext`. They share the same services, store, and database. The MCP server also hosts the file watcher that imports IDE transcripts automatically.

---

## Project Structure

```
skills/
└── mem/                      AgentSkills skill (installed via npx skills add)
    ├── SKILL.md              Entry point — routes /mem subcommands
    └── commands/             Subcommand files (status, search, recent, summarize)

src/
├── cli.ts                    CLI entry point (Commander)
├── app.ts                    AppContext factory — wires DB, config, stores, services
├── types.ts                  Core types: Conversation, Turn, SearchParams, IdeType (cursor|claude-code|codex|cli)
├── db/
│   ├── schema.ts             DDL: conversations, turns, turns_fts (FTS5), tool_usage, health_warnings
│   └── connection.ts         DB creation + column migrations
├── stores/
│   └── conversation-store.ts Data access for conversations and turns
├── services/
│   ├── search-service.ts     FTS5 BM25 search + summary/title LIKE fallback
│   ├── import-service.ts     Transcript import from Cursor/Claude/Codex JSONL
│   ├── status-service.ts     Health check, stats, and MCP detection
│   ├── usage-service.ts      MCP tool usage analytics and dashboard data
│   └── config-service.ts     Load/save config from ~/.ai-memory/config.json
├── mcp/
│   ├── server.ts             MCP tool handler map (5 tools)
│   └── stdio.ts              MCP stdio transport + tool registration
├── dashboard/
│   ├── server.ts             HTTP server — static SPA + /rpc endpoint
│   ├── rpc.ts                RPC method dispatch (listConversations, search, etc.)
│   └── client/               React 19 SPA (Vite, hash-based routing)
└── utils/
    ├── hash.ts               SHA-256 content hashing for turn dedup
    ├── id.ts                 UUID generation
    ├── time.ts               ISO timestamp helpers
    ├── project-config.ts     Per-project config reading (.ai-memory/config.json)
    ├── workspace-identity.ts Stable project key derivation from workspace paths
    └── strip.ts              XML wrapper tag removal from captured prompts

tests/                        Vitest — mirrors src/ structure
docs/                         Style guides, this file
```

### Layer responsibilities

| Layer | Role | Rule |
|-------|------|------|
| **Adapters** (cli, mcp, dashboard) | Translate external protocols to service calls | Format input, call service, format output |
| **Services** | Business logic and orchestration | Stateless — receive store/config via constructor |
| **Stores** | Data access — SQL queries, insert/upsert | One store per aggregate (ConversationStore owns both conversations and turns) |
| **DB** | Schema definition and connection | Schema is declarative DDL (`CREATE ... IF NOT EXISTS`); connection runs lightweight column migrations on existing DBs |

---

## Core Components

### AppContext (`app.ts`)

Central wiring point. `createApp(dbPath?, configPath?)` constructs all dependencies and returns them as a flat object:

```typescript
interface AppContext {
  db: Database.Database;
  config: AiMemoryConfig;
  conversationStore: ConversationStore;
  searchService: SearchService;
  importService: ImportService;
  statusService: StatusService;
  usageService: UsageService;
}
```

Each adapter calls `createApp()` to get a fully wired context. No global state, no singletons (the CLI's lazy `getApp()` is the sole exception — see CLI section).

### ConversationStore (`stores/conversation-store.ts`)

Single data access class for the `conversations` and `turns` tables. Key operations:

- `upsertConversationByExternalId()` — create or update by IDE session ID
- `byId()` / `byExternalId()` — single-conversation lookup
- `listConversations()` — paginated list with workspace/date filters
- `addTurn()` — insert turn with content-hash dedup + FTS5 index sync; returns `Turn` on insert, `null` on duplicate
- `listTurns()` — all turns for a conversation, ordered by `turn_number`
- `setTitleIfEmpty()` — auto-title from first user message (init only)
- `updateTitle()` — replace conversation title (manual/LLM refresh)
- `upsertSummary()` — replace conversation summary
- `pruneEmptyConversations()` — delete conversations with 0 turns, no title, older than 1 hour (called after import to clean up stale upserts)

### SearchService (`services/search-service.ts`)

Two-phase search:
1. **FTS5 + BM25** on `turns_fts` — primary, returns turn snippets with conversation context
2. **LIKE fallback** on `conversations.summary` and `conversations.title` — fills remaining slots

Results are grouped by conversation and include `match_source` (`turn` | `summary` | `title`).

### ImportService (`services/import-service.ts`)

Reads JSONL transcript files from IDE data directories:
- **Claude Code**: `~/.claude/projects/*/*.jsonl`
- **Cursor**: `~/.cursor/projects/*/agent-transcripts/*/*.jsonl`
- **Codex**: `~/.codex/sessions/YYYY/MM/DD/*.jsonl` (session_meta + response_item records)

Idempotent — deduplicates conversations by `external_id`, turns by `content_hash`. Also exposes `importFile(filePath)` for single-file import triggered by the MCP server's file watcher.

### Workspace Identity (`utils/workspace-identity.ts`)

Resolves workspace names from IDE transcript paths. Key behaviors:

- `normalizeWorkspaceLabel()` — strips paths to basename, removes leading `-` prefixes from Claude folder names
- `extractCwdFromTranscript()` — extracts working directory from JSONL transcript lines (Claude Code `row.cwd`, Codex `session_meta.payload.cwd`)
- `probeTokenToPath()` — greedy left-to-right filesystem probe to decode IDE project tokens (e.g., `Users-alice-Projects-ai-memory` → `/Users/alice/Projects/ai-memory`)
- `resolveWorkspace()` — three-tier resolution: `cwd` from transcript (most reliable) > filesystem probe of IDE token > raw token fallback

---

## Data Model

### Schema

```
┌─────────────────────────┐       ┌─────────────────────────┐
│     conversations       │       │         turns            │
├─────────────────────────┤       ├─────────────────────────┤
│ id           TEXT PK    │──┐    │ id           TEXT PK    │
│ external_id  TEXT UNIQUE│  │    │ conversation_id TEXT FK ◄─┘
│ workspace    TEXT       │  │    │ role         TEXT       │
│ workspace_path TEXT     │  │    │ content      TEXT       │
│ ide          TEXT       │  │    │ content_hash TEXT       │
│ source_path  TEXT       │  │    │ turn_number  INTEGER    │
│ source_mtime TEXT       │  │    │ created_at   TEXT       │
│ title        TEXT       │  │    └─────────────────────────┘
│ summary      TEXT       │  │              │
│ turn_count   INTEGER    │  │              ▼
│ started_at   TEXT       │  │    ┌─────────────────────────┐
│ updated_at   TEXT       │  │    │      turns_fts (FTS5)    │
└─────────────────────────┘  │    ├─────────────────────────┤
                             │    │ id        UNINDEXED     │
                             │    │ content   (indexed)     │
                             │    │ tokenize: unicode61     │
                             │    └─────────────────────────┘

┌─────────────────────────┐  ┌─────────────────────────┐
│      tool_usage          │  │    health_warnings       │
├─────────────────────────┤  ├─────────────────────────┤
│ id         INTEGER PK   │  │ id           INTEGER PK │
│ tool_name  TEXT          │  │ category     TEXT       │
│ called_at  TEXT          │  │ message      TEXT       │
│ latency_ms INTEGER      │  │ detail       TEXT       │
│ workspace  TEXT          │  │ first_seen_at TEXT      │
│ param_keys TEXT          │  │ last_seen_at  TEXT      │
│ result_count INTEGER     │  │ resolved_at   TEXT      │
│ success    INTEGER       │  └─────────────────────────┘
│ error_type TEXT          │  UNIQUE(category, message)
└─────────────────────────┘
```

### Key constraints

- `external_id` is UNIQUE — maps to IDE session identifiers
- `(content_hash, conversation_id)` is UNIQUE — prevents duplicate turns on reimport
- `turns_fts` is a virtual table synced manually on each `addTurn()` call
- Foreign key: `turns.conversation_id` → `conversations.id`
- `(tool_name, called_at)` is indexed on `tool_usage` — used for time-windowed usage analytics. Watcher-triggered imports use `import:watch` naming
- `(category, message)` is UNIQUE on `health_warnings` — deduplicates warnings, upsert updates `last_seen_at`

### Why SQLite + FTS5

- Single-file database — no server, no configuration, portable
- FTS5 with BM25 provides relevance-ranked full-text search without external dependencies
- `unicode61` tokenizer handles multilingual content

---

## Data Flows

### 1. Capture (file watcher → DB)

```
MCP server starts (ai-memory mcp)
  → startup catch-up: ImportService.importTranscripts('all')
  → fs.watch() on ~/.claude/projects, ~/.cursor/projects, ~/.codex/sessions

IDE writes transcript file (.jsonl)
  → watcher fires, debounce 500ms
  → ImportService.importFile(filePath)
    → detect IDE from path, parse JSONL
    → ConversationStore.upsertConversationByExternalId()
    → ConversationStore.addTurn()
      → hash content (SHA-256)
      → INSERT OR IGNORE into turns (dedup by content_hash)
      → INSERT OR REPLACE into turns_fts (sync FTS index)
      → UPDATE conversations.turn_count, updated_at
    → On first user turn: setTitleIfEmpty() + upsertSummary()
  → Record import:watch entry in tool_usage
```

### 2. Search (query → ranked results)

```
User/LLM issues search query
  → SearchService.search()
    → Phase 1: FTS5 MATCH on turns_fts, ORDER BY bm25(), grouped by conversation
    → Phase 2: LIKE on conversations.summary + title (fills remaining slots)
    → Apply filters: workspace, date_from, date_to, role
  → Return: conversations[] with match_source and matching_turns[]
```

### 4. Import (JSONL files → DB)

```
ai-memory import-transcripts
  → ImportService.importTranscripts()
    → Scan IDE transcript directories
    → For each .jsonl file:
      → Parse messages (role + content + timestamp)
      → upsertConversationByExternalId() (dedup by external_id)
      → addTurn() for each message (dedup by content_hash)
      → Auto-title + summary from first user message
  → Return: { created, updated, skipped, errors }
```

---

## Adapter Details

### CLI (`cli.ts`)

Commander-based. Uses lazy `getApp()` initialization so that `init` can run before the DB directory exists. Supports `--json` flag for machine-readable output.

Entry: `package.json` `"bin": "dist/cli.js"` → installed globally as `ai-memory`.

#### Commands

| Command | Action |
|---------|--------|
| `init` | Create DB + config (see below) |
| `search` | FTS5 search with filters |
| `conversations` | List conversations with pagination |
| `conversation` | Get full transcript by ID |
| `summarize` | Update conversation summary |
| `title` | Update conversation title |
| `import-transcripts` | Import JSONL from Cursor/Claude Code/Codex |
| `status` | Health check, stats, and MCP registration detection |
| `usage` | MCP tool usage analytics (`--range 24h\|7d\|30d`) |
| `clean-data` | Strip XML wrapper tags from titles/summaries (`--dry-run` supported) |
| `mcp` | Start MCP stdio server (+ file watcher) |
| `config get\|set\|list` | Read/write config values |
| `project init` | Create per-project `.ai-memory/config.json` |
| `project status` | Show effective project config for current directory |
| `dashboard` | Start local web UI |

#### Init (`ai-memory init`)

Creates local data directory and database. Phases run in order:

1. **Directories** — create `~/.ai-memory/` and `~/.ai-memory/services/`
2. **Database** — create SQLite DB (optional `--reset-db` backs up existing DB first)
3. **Config** — write `~/.ai-memory/config.json` with defaults if missing

MCP registration and skill deployment are handled by ecosystem tools (`npx add-mcp` and `npx skills add`), not by init.

### MCP (`mcp/stdio.ts` + `mcp/server.ts`)

[Model Context Protocol](https://modelcontextprotocol.io) server over stdio JSON-RPC. Also hosts the file watcher that imports IDE transcripts automatically. Registered via `npx add-mcp "ai-memory mcp" -g -n ai-memory -y`.

5 tools with Zod-validated input schemas:

| Tool | Maps to |
|------|---------|
| `ai-memory-search` | `SearchService.search()` |
| `ai-memory-conversations` | `ConversationStore.listConversations()` |
| `ai-memory-conversation` | `ConversationStore.byId()` + `listTurns()` |
| `ai-memory-summarize` | `ConversationStore.upsertSummary()` + optional `ConversationStore.updateTitle()` |
| `ai-memory-status` | `StatusService.getStatus()` |

Each handler is wrapped with `withTracking()` which records every call to the `tool_usage` table — tool name, timestamp, latency, parameter keys, result count, success/failure, and error classification. Error types are classified as `NOT_FOUND`, `VALIDATION`, or `INTERNAL`.

User-triggered slash commands are provided as an [AgentSkills](https://agentskills.io) skill at `skills/mem/SKILL.md`, installed via `npx skills add liorhai5/ai-memory`. The skill provides a single `/mem` command with argument-based dispatch:

| Subcommand | Action |
|------------|--------|
| `/mem status` | Instructs LLM to call `ai-memory-status` tool and present results |
| `/mem search <query>` | Instructs LLM to call `ai-memory-search` with the query |
| `/mem conversations` | Instructs LLM to call `ai-memory-conversations` (limit 10) |
| `/mem summarize` | Instructs LLM to summarize the conversation and call `ai-memory-summarize` |

Skills complement tools: tools are LLM-initiated (autonomous), skills are user-initiated (explicit `/` command). The skill has `disable-model-invocation: true` so the LLM won't trigger it unprompted.

### Naming Conventions

The API surface has three tiers with different prefix conventions:

| Tier | Prefix | Example | Convention |
|---|---|---|---|
| CLI binary | `ai-memory <command>` | `ai-memory conversations` | Shell subcommands, spaces |
| MCP tools | `ai-memory-<name>` | `ai-memory-conversations` | Flat identifiers, hyphens (MCP convention) |
| Skill | `/mem <command>` | `/mem conversations` | Short prefix, brevity for IDE use |

**Why different prefixes:** Each tier operates in a different namespace with different collision pressure. The CLI is a dedicated binary — `ai-memory` is unambiguous. MCP tools share a flat global namespace with every other MCP server — `ai-memory-` prefix prevents collisions. The skill shares `/` autocomplete with all other skills — `mem` is short to avoid clutter while staying recognizable.

**The rule:** Same operation uses the same base noun across all layers. `conversations` appears as `ai-memory conversations` (CLI), `ai-memory-conversations` (MCP), and `/mem conversations` (skill). When adding a new operation, verify the noun appears identically in every layer that exposes it.

**Operations exposed per tier:**

| Operation | CLI | MCP | Skill |
|---|---|---|---|
| `conversations` | `ai-memory conversations` | `ai-memory-conversations` | `/mem conversations` |
| `conversation` (single) | `ai-memory conversation <id>` | `ai-memory-conversation` | — |
| `search` | `ai-memory search` | `ai-memory-search` | `/mem search` |
| `summarize` | `ai-memory summarize` | `ai-memory-summarize` | `/mem summarize` |
| `status` | `ai-memory status` | `ai-memory-status` | `/mem status` |

CLI-only admin commands (`title`, `usage`, `dashboard`, `clean-data`, `import-transcripts`, `config`, `project init`, `project status`) are intentionally not exposed in MCP or skill — they are operator commands, not LLM-facing.

### Dashboard (`dashboard/`)

Node HTTP server serving a React SPA + a JSON-RPC endpoint. No authentication — local-only access on `localhost:8485`.

- **Server** (`dashboard/server.ts`): Static file serving from `dist/dashboard/client`, single `/rpc` POST endpoint
- **RPC** (`dashboard/rpc.ts`): Method dispatcher that maps JSON-RPC method names to `AppContext` calls

| RPC method | Maps to |
|------------|---------|
| `listConversations` | `ConversationStore.listConversations()` |
| `getConversation` | `ConversationStore.byId()` + `listTurns()` |
| `searchConversations` | `SearchService.search()` |
| `listWorkspaces` | Distinct workspace query |
| `setSummary` | `ConversationStore.upsertSummary()` |
| `getConfig` / `updateConfig` | `loadConfig()` / `saveConfig()` |
| `getStatus` / `getDashboardStatus` | `StatusService.getStatus()` + watcher status + MCP integration checks |
| `getUsageDashboard` / `getUsageSummary` | `UsageService` methods |

- **Client** (`dashboard/client/`): React 19 + Vite SPA, hash-based routing (`#/conversations`, `#/search`, `#/settings`, `#/usage`), inline styles, no external CSS framework

---

## Design Invariants

These are architectural constraints that should be maintained:

1. **Content-hash dedup** — Turns are deduplicated by `SHA-256(content)` per conversation. Import and capture are idempotent — running them twice produces no duplicates.

4. **Local-only storage** — All data lives in `~/.ai-memory/`. No network calls, no cloud sync, no telemetry. The database is a single SQLite file.

4. **Thin adapters** — Adapters translate protocol-specific input to service calls and format the output. Adding a new adapter means mapping its protocol to `AppContext` methods. The `clean-data` command is an exception — it contains direct SQL for bulk data cleanup.

5. **Single store per aggregate** — `ConversationStore` owns both `conversations` and `turns` tables. It manages the FTS5 sync internally. New features should go through the store rather than writing SQL directly.

6. **Minimal shared state** — Services receive dependencies through constructors. Each `createApp()` call produces an independent context. The CLI uses a lazy `_app` singleton so `init` can run before the DB exists, but no other adapter shares state across operations.

---

## Configuration

Stored at `~/.ai-memory/config.json`. Created by `ai-memory init` with defaults if missing. Loaded by `loadConfig()` at `AppContext` creation.

| Key | Default | Controls |
|-----|---------|----------|
| `search_default_limit` | `20` | Default search result count |

Config flows through the system via `AiMemoryConfig` object passed to service constructors. `saveConfig()` writes the file (used by init and `config set`).

---

## Development

### Build

```bash
npm run build           # TypeScript → dist/ (backend)
npm run build:dashboard # Vite build (React SPA → dist/dashboard/client)
npm run build:all       # Both
```

### Test

```bash
npm test                # Vitest — all suites
```

Tests use in-memory SQLite (`:memory:`) — no filesystem side effects. Test structure mirrors `src/`.

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js >= 22 |
| Language | TypeScript (ES2022, NodeNext modules) |
| Database | SQLite via `better-sqlite3` |
| Search | FTS5 with BM25 ranking |
| CLI | Commander |
| MCP | `@modelcontextprotocol/sdk` (stdio transport) |
| Dashboard backend | Node `http` module |
| Dashboard frontend | React 19, Vite |
| Tests | Vitest |

### Adding a new service

1. Create `src/services/my-service.ts` with a class that takes dependencies via constructor
2. Add to `AppContext` interface and `createApp()` in `app.ts`
3. Expose through whichever adapters need it (CLI command, MCP tool, dashboard RPC method)

### Adding a new MCP tool

1. Add handler to `createToolHandlers()` in `mcp/server.ts`
2. Register with Zod schema in `mcp/stdio.ts`
3. Add tool name to `ToolName` union and `listTools()` in `mcp/server.ts`

---

## Glossary

| Term | Definition |
|------|-----------|
| **Conversation** | A durable session with an AI assistant, identified by `external_id` from the IDE |
| **Turn** | A single user or assistant message within a conversation |
| **FTS5** | SQLite Full-Text Search extension, version 5 |
| **BM25** | Best Matching 25 — probabilistic relevance ranking function used by FTS5 |
| **MCP** | Model Context Protocol — standard for IDE-to-tool communication |
| **Workspace** | Normalized project directory basename (not full path) — used as a human-readable label for grouping conversations |
| **JSONL** | JSON Lines — one JSON object per line, used by Cursor and Claude Code for transcripts |
| **external_id** | IDE-assigned session identifier, used for conversation dedup across imports |
| **content_hash** | SHA-256 of turn content, used for turn-level dedup |
| **workspace_path** | Full absolute path to the project directory — resolved via `resolveWorkspace()` from transcript `cwd` or filesystem probe of IDE token. Enables cross-IDE matching and workspace re-derivation |
| **tool_usage** | Per-call telemetry table for MCP tools — records latency, result count, and errors. Watcher-triggered imports use `import:watch` tool name |
| **health_warnings** | Upsert-based table tracking integration health issues (import errors, watcher errors). Warnings are resolved when conditions clear |
