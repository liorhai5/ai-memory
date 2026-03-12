# Architecture

> Conversation log and retrieval for AI coding assistants.

ai-memory captures every AI conversation, makes it searchable via FTS5, and injects recent context at session start. It runs locally, stores everything on the user's machine, and operates without LLM involvement (except optional LLM-written summaries via MCP tool).

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Adapters                                    │
│                                                                      │
│  ┌──────────┐  ┌─────────┐  ┌──────────┐  ┌──────────────┐         │
│  │IDE Hooks │  │   CLI   │  │   MCP    │  │  Dashboard   │         │
│  │ stdin IO │  │Commander│  │  stdio   │  │  HTTP + SPA  │         │
│  └────┬─────┘  └────┬────┘  └────┬─────┘  └──────┬───────┘         │
│       │              │            │               │                  │
│       └──────────────┴────────────┼───────────────┘                  │
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
│             │Injection │  │  Store    │  └────────────┘             │
│             │ Import   │  └─────┬─────┘                             │
│             │ Status   │        │                                    │
│             │ Usage    │        ▼                                    │
│             └──────────┘ ┌──────────────────┐                       │
│                        │     SQLite      │                          │
│                        │ conversations   │                          │
│                        │ turns + FTS5    │                          │
│                        │ tool_usage      │                          │
│                        └──────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

Four adapters (IDE Hooks, CLI, MCP, Dashboard) are wrappers over `AppContext`. They share the same services, store, and database.

---

## Project Structure

```
src/
├── cli.ts                    CLI entry point (Commander)
├── app.ts                    AppContext factory — wires DB, config, stores, services
├── types.ts                  Core types: Conversation, Turn, SearchParams
├── db/
│   ├── schema.ts             DDL: conversations, turns, turns_fts (FTS5), tool_usage
│   └── connection.ts         DB creation + column migrations
├── stores/
│   └── conversation-store.ts Data access for conversations and turns
├── services/
│   ├── search-service.ts     FTS5 BM25 search + summary/title LIKE fallback
│   ├── injection-service.ts  Bounded context injection at session start
│   ├── import-service.ts     Transcript import from Cursor/Claude JSONL
│   ├── status-service.ts     Health check and aggregate stats
│   ├── usage-service.ts      MCP tool usage analytics and dashboard data
│   └── config-service.ts     Load/save config from ~/.ai-memory/config.json
├── hooks/
│   ├── handlers.ts           IDE hook handlers (session-start, prompt-submit, stop)
│   └── init-config.ts        IDE config file generation
├── mcp/
│   ├── server.ts             MCP tool handler map (5 tools)
│   └── stdio.ts              MCP stdio transport + tool/prompt registration
├── dashboard/
│   ├── server.ts             HTTP server — static SPA + /rpc endpoint
│   ├── rpc.ts                RPC method dispatch (listConversations, search, etc.)
│   └── client/               React 19 SPA (Vite, hash-based routing)
└── utils/
    ├── hash.ts               SHA-256 content hashing for turn dedup
    ├── id.ts                 UUID generation
    ├── time.ts               ISO timestamp helpers
    ├── workspace-identity.ts Stable project key derivation from workspace paths
    └── strip.ts              XML wrapper tag removal from captured prompts

tests/                        Vitest — mirrors src/ structure
docs/                         Style guides, this file
design-logs/                  Design decision records (draft → approved → implemented)
```

### Layer responsibilities

| Layer | Role | Rule |
|-------|------|------|
| **Adapters** (hooks, cli, mcp, dashboard) | Translate external protocols to service calls | Format input, call service, format output |
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
  injectionService: InjectionService;
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
- `listRecentByProjectKey()` — project-key-first ordering for injection (falls back to `listRecentByWorkspace()` when `project_key` is null)
- `pruneEmptyConversations()` — delete conversations with 0 turns, no title, older than 1 hour (called on session start to clean up stale upserts)

### SearchService (`services/search-service.ts`)

Two-phase search:
1. **FTS5 + BM25** on `turns_fts` — primary, returns turn snippets with conversation context
2. **LIKE fallback** on `conversations.summary` and `conversations.title` — fills remaining slots

Results are grouped by conversation and include `match_source` (`turn` | `summary` | `title`).

### InjectionService (`services/injection-service.ts`)

Builds bounded context for session-start injection. Primary method is `buildForProjectKey(projectKey, workspace)`. `buildForWorkspace()` is a convenience wrapper that calls `buildForProjectKey(null, workspace)`. Hard limits (no token heuristics):
- Max N conversations (default 5)
- Max chars per title, per summary, total output
- Current project/workspace conversations first, then others
- Overflow: drops other-workspace entries, then hard-truncates

### ImportService (`services/import-service.ts`)

Reads JSONL transcript files from IDE data directories:
- **Cursor**: `~/.cursor/projects/*/agent-transcripts/*/*.jsonl`
- **Claude Code**: `~/.claude/projects/*/*.jsonl`

Idempotent — deduplicates conversations by `external_id`, turns by `content_hash`.

### Workspace Identity (`utils/workspace-identity.ts`)

Normalizes workspace labels and derives project keys. Key behaviors:

- `normalizeWorkspaceLabel()` — strips paths to basename, removes Claude `-` prefixes, extracts project names from tokenized IDE folder names (e.g. `Users-foo-Projects-Playgrounds-bar` → `bar`)
- `deriveProjectKey()` — three-tier derivation: `path:<sha1>` from absolute workspace path (most stable), `src:<token>` from IDE source path, or `ws:<label>` fallback from workspace label

---

## Data Model

### Schema

```
┌─────────────────────────┐       ┌─────────────────────────┐
│     conversations       │       │         turns            │
├─────────────────────────┤       ├─────────────────────────┤
│ id           TEXT PK    │──┐    │ id           TEXT PK    │
│ external_id  TEXT UNIQUE│  │    │ conversation_id TEXT FK ◄─┘
│ project_key  TEXT       │  │    │ role         TEXT       │
│ workspace    TEXT       │  │    │ content      TEXT       │
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

┌─────────────────────────┐
│      tool_usage          │
├─────────────────────────┤
│ id         INTEGER PK   │
│ tool_name  TEXT          │
│ called_at  TEXT          │
│ latency_ms INTEGER      │
│ workspace  TEXT          │
│ param_keys TEXT          │
│ result_count INTEGER     │
│ success    INTEGER       │
│ error_type TEXT          │
└─────────────────────────┘
```

### Key constraints

- `external_id` is UNIQUE — maps to IDE session identifiers
- `(content_hash, conversation_id)` is UNIQUE — prevents duplicate turns on reimport
- `turns_fts` is a virtual table synced manually on each `addTurn()` call
- Foreign key: `turns.conversation_id` → `conversations.id`
- `project_key` is indexed — used for project-scoped queries and injection grouping
- `(tool_name, called_at)` is indexed on `tool_usage` — used for time-windowed usage analytics

### Why SQLite + FTS5

- Single-file database — no server, no configuration, portable
- FTS5 with BM25 provides relevance-ranked full-text search without external dependencies
- `unicode61` tokenizer handles multilingual content

---

## Data Flows

### 1. Capture (IDE hooks → DB)

```
IDE hook (prompt-submit / stop)
  → cli.ts: parse stdin, normalize fields (resolveSessionId, resolveWorkspace, etc.)
  → handlers.ts: receive resolved params
  → ConversationStore.upsertConversationByExternalId()
  → ConversationStore.addTurn()
    → hash content (SHA-256)
    → INSERT OR IGNORE into turns (dedup by content_hash)
    → INSERT OR REPLACE into turns_fts (sync FTS index)
    → UPDATE conversations.turn_count, updated_at
  → On first user turn: setTitleIfEmpty() + upsertSummary()
```

### 2. Injection (session start → context)

```
IDE hook (session-start)
  → cli.ts: parse stdin, normalize fields (resolveSessionId, resolveWorkspace, etc.)
  → handlers.ts: prune empty conversations, upsert conversation
  → InjectionService.buildForProjectKey()
    → ConversationStore.listRecentByProjectKey() (same project first, falls back to workspace)
    → Format titles + summaries with hard char limits
    → Truncate overflow (drop other-project entries, then hard-cut)
  → Return additional_context string (HTML comment-wrapped)
  → cli.ts: emit plain text (Claude Code) or JSON (Cursor)
```

### 3. Search (query → ranked results)

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

### IDE Hooks (`hooks/` + `cli.ts hook`)

The hooks adapter captures conversations and injects context via IDE lifecycle events. It spans two files: `cli.ts` (stdin parsing, output formatting) and `hooks/handlers.ts` (business logic dispatch).

#### Event mapping

| Handler | CLI event | Claude Code hook | Cursor hook | Action |
|---------|-----------|-----------------|-------------|--------|
| `sessionStartHook` | `session-start` | `SessionStart` | `sessionStart` | Prune empty conversations, upsert conversation, return injected context |
| `beforeSubmitPromptHook` | `prompt-submit` | `UserPromptSubmit` | `beforeSubmitPrompt` | Capture user turn, auto-title on first turn |
| `stopHook` | `stop` | `Stop` | `stop` | Capture assistant turn (guards against empty content) |
| `sessionEndHook` | `session-end` | `SessionEnd` | `sessionEnd` | No-op |

All hooks receive `project_key` (derived from workspace path) for stable project identity across sessions.

#### Error handling

All hook CLI commands wrap in try/catch, write errors to stderr, and `exit(0)`. Hooks must never crash the IDE — a failed hook silently degrades rather than blocking the user.

#### Init Config (`hooks/init-config.ts`)

Generates IDE-specific hook and MCP configuration files. For Claude Code, old flat-format ai-memory entries are automatically stripped and replaced with the grouped format:

- **Cursor**: flat hook entries in `~/.cursor/hooks.json`, MCP in separate `~/.cursor/mcp.json`
- **Claude Code**: grouped matcher entries in `~/.claude/settings.json` with nested hooks arrays:
  ```json
  { "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command", "command": "..." }] }
  ```
  SessionStart hooks use a matcher so injection runs on startup, resume, clear, and compact events.

### CLI (`cli.ts`)

Commander-based. Uses lazy `getApp()` initialization so that `init` can run before the DB directory exists. Supports `--json` flag for machine-readable output.

Entry: `package.json` `"bin": "dist/cli.js"` → installed globally as `ai-memory`.

#### Commands

| Command | Action |
|---------|--------|
| `init` | Multi-phase bootstrap (see below) |
| `search` | FTS5 search with filters |
| `conversations` | List conversations with pagination |
| `conversation` | Get full transcript by ID |
| `summarize` | Update conversation summary |
| `title` | Update conversation title |
| `import-transcripts` | Import JSONL from Cursor/Claude Code |
| `status` | Health check and stats |
| `usage` | MCP tool usage analytics (`--range 24h\|7d\|30d`) |
| `clean-data` | Strip XML wrapper tags from titles/summaries (`--dry-run` supported) |
| `mcp` | Start MCP stdio server |
| `hook <event>` | IDE hook handler (see Hook Handlers) |
| `config get\|set\|list` | Read/write config values |
| `dashboard` | Start local web UI |

#### Init (`ai-memory init`)

Multi-phase setup command. Phases run in order:

1. **Directories** — create `~/.ai-memory/` and `~/.ai-memory/services/`
2. **Database** — create SQLite DB (optional `--reset-db` backs up existing DB first)
3. **Config** — write `~/.ai-memory/config.json` with defaults if missing
4. **IDE hooks + MCP** — register hooks and MCP server for selected IDE(s)

`--ide all` auto-detects installed IDEs by checking for `~/.cursor` and `~/.claude` directories.

For Claude Code, MCP registration is dual-path:
- `~/.claude/settings.json` — declarative MCP entry (used by hooks config)
- Runtime registration via `claude mcp add -s user ai-memory` (so the `claude` CLI discovers the server), with fallback to writing `~/.claude.json` directly if the `claude` command is unavailable

#### Stdin Normalization Layer (`cli.ts`)

Hook subcommands receive context from the IDE via stdin JSON. A normalization layer bridges protocol differences:

| Resolver | Claude Code field | Cursor field | Fallback |
|----------|------------------|--------------|----------|
| `resolveSessionId` | `session_id` | `conversation_id` | generate UUID |
| `resolveWorkspace` | `cwd` (basename) | `workspace_roots[0]` (basename) | `process.cwd()` basename |
| `resolvePrompt` | `prompt` | `prompt` | `""` |
| `resolveAssistantContent` | searches 8+ fields (`last_assistant_message`, `response`, `output`, etc.) | same | reads `transcript_path` JSONL as last resort |

`extractTextFromUnknown()` recursively unwraps text from nested content structures (arrays of `{type:"text", text:...}`, nested `.message.content`, etc.) to handle varying payload shapes.

Output format also varies: Claude Code hooks emit plain text, Cursor hooks emit JSON.

### MCP (`mcp/stdio.ts` + `mcp/server.ts`)

[Model Context Protocol](https://modelcontextprotocol.io) server over stdio JSON-RPC. Registered by `ai-memory init` — for Cursor in `~/.cursor/mcp.json`, for Claude Code in both `settings.json` and via `claude mcp add` runtime registration.

5 tools with Zod-validated input schemas:

| Tool | Maps to |
|------|---------|
| `ai-memory-search` | `SearchService.search()` |
| `ai-memory-conversations` | `ConversationStore.listConversations()` |
| `ai-memory-conversation` | `ConversationStore.byId()` + `listTurns()` |
| `ai-memory-summarize` | `ConversationStore.upsertSummary()` + optional `ConversationStore.updateTitle()` |
| `ai-memory-status` | `StatusService.getStatus()` |

Each handler is wrapped with `withTracking()` which records every call to the `tool_usage` table — tool name, timestamp, latency, parameter keys, result count, success/failure, and error classification. Error types are classified as `NOT_FOUND`, `VALIDATION`, or `INTERNAL`.

4 MCP prompts for user-triggered slash commands (appear in IDE `/` autocomplete as `/mcp__ai-memory__<name>`):

| Prompt | Arguments | Action |
|--------|-----------|--------|
| `status` | none | Returns live status JSON (conversation count, turn count, tool usage) |
| `search` | `query` | Runs FTS5 search, returns matching conversations with snippets |
| `recent` | none | Lists last 10 conversations with titles, summaries, dates |
| `summarize` | none | Instructs the LLM to summarize the conversation and call `ai-memory-summarize` |

Prompts complement tools: tools are LLM-initiated (autonomous), prompts are user-initiated (explicit `/` command).

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
| `simulateInjection` | `InjectionService.buildForProjectKey()` |
| `getStatus` / `getDashboardStatus` | `StatusService.getStatus()` + IDE integration checks |
| `getUsageDashboard` / `getUsageSummary` | `UsageService` methods |

- **Client** (`dashboard/client/`): React 19 + Vite SPA, hash-based routing (`#/conversations`, `#/search`, `#/settings`, `#/usage`), inline styles, no external CSS framework

---

## Design Invariants

These are architectural constraints that should be maintained:

1. **Deterministic hooks** — Hook handlers never call an LLM. They only capture turns and inject bounded context. All hook behavior is predictable and instant.

2. **Bounded injection** — Session-start injection is hard-capped by character counts (not token estimates). Limits are configurable but always enforced. No unbounded output.

3. **Content-hash dedup** — Turns are deduplicated by `SHA-256(content)` per conversation. Import and capture are idempotent — running them twice produces no duplicates.

4. **Local-only storage** — All data lives in `~/.ai-memory/`. No network calls, no cloud sync, no telemetry. The database is a single SQLite file.

5. **Thin adapters** — Adapters translate protocol-specific input to service calls and format the output. Adding a new adapter means mapping its protocol to `AppContext` methods. The CLI's stdin normalization layer and `clean-data` command are the main exceptions — they contain protocol bridging logic and direct SQL respectively.

6. **Single store per aggregate** — `ConversationStore` owns both `conversations` and `turns` tables. It manages the FTS5 sync internally. New features should go through the store rather than writing SQL directly.

7. **Minimal shared state** — Services receive dependencies through constructors. Each `createApp()` call produces an independent context. The CLI uses a lazy `_app` singleton so `init` can run before the DB exists, but no other adapter shares state across operations.

8. **Hooks never crash the IDE** — All hook CLI commands catch errors, log to stderr, and exit 0. A broken hook degrades silently rather than blocking the user's workflow.

---

## Configuration

Stored at `~/.ai-memory/config.json`. Created by `ai-memory init` with defaults if missing. Loaded by `loadConfig()` at `AppContext` creation.

| Key | Default | Controls |
|-----|---------|----------|
| `injection_max_conversations` | `5` | Max conversations in session injection |
| `injection_max_title_chars` | `80` | Title truncation length |
| `injection_max_summary_chars` | `150` | Summary truncation length |
| `injection_max_total_chars` | `1800` | Hard cap on injection output |
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
| **Injection** | Context automatically prepended to a new session (recent conversation titles + summaries) |
| **Workspace** | Normalized project directory basename (not full path) — used as a human-readable label for grouping conversations |
| **JSONL** | JSON Lines — one JSON object per line, used by Cursor and Claude Code for transcripts |
| **external_id** | IDE-assigned session identifier, used for conversation dedup across imports and hooks |
| **content_hash** | SHA-256 of turn content, used for turn-level dedup |
| **project_key** | Stable project identifier — derived via `deriveProjectKey()`: `path:<sha1>` from absolute workspace path, `src:<token>` from IDE source path, or `ws:<label>` fallback from workspace label |
| **tool_usage** | Per-call telemetry table for MCP tools — records latency, result count, and errors |
