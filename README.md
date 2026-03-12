# ai-memory

![License](https://img.shields.io/badge/license-ISC-blue) ![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)

**Conversation log and retrieval for AI coding assistants.**

AI coding assistants have no memory. Every session starts blank — they don't know what you discussed last week, what decisions were made, or what was tried and abandoned. You end up repeating context, re-explaining goals, and losing track of past work.

ai-memory logs every conversation, makes it searchable, and injects recent context at session start. It captures full turn-level transcripts, supports full-text search, and lets the LLM write progressive summaries via MCP tools. It runs locally, stores everything on your machine, and works without any LLM involvement.

---

## Prerequisites

- Node.js >= 22

## Install

```bash
npm install -g ai-memory
```

<details>
<summary>From source</summary>

```bash
git clone <repo-url> && cd ai-memory
npm install && npm run build:all
npm link
```
</details>

## Set Up

```bash
# Initialize and connect to all detected IDEs (one-time, machine-level)
ai-memory init --ide all

# Or initialize for a specific IDE
ai-memory init --ide cursor
ai-memory init --ide claude-code

# CLI-only (no IDE hooks)
ai-memory init

# Verify
ai-memory status
```

This creates `~/.ai-memory/` (database + config), registers global hooks (session lifecycle), and adds the MCP server (LLM tools). Run once — it applies to all projects on this machine. Re-running is safe (idempotent).

---

## What Happens

```
You talk to AI ──→ ai-memory captures turns ──→ Next session starts with context
       ↑_________________________________________________________┘
```

### Hook lifecycle

| Hook | What it does |
|------|-------------|
| **Session start** | Creates/resumes conversation by external ID. Injects recent conversation titles + summaries (project-first, then other recent). |
| **Prompt submit** | Captures user turn. First turn sets title (truncated to 80 chars) and initial summary (full first message). |
| **Stop** | Captures assistant turn (Claude Code: from `last_assistant_message`; Cursor: metadata-only). |
| **After agent response** | Captures assistant turn from Cursor `stdin.text` (Cursor only). |
| **Session end** | No-op (does not affect recency). |

Hooks are fully deterministic — no LLM calls, no extraction, no scoring.

### Summaries

Summaries are the only enrichment layer. They're written by the LLM or user via the `ai-memory-summarize` MCP tool:

- **Initial:** First user prompt is stored as the initial summary (automatic).
- **Progressive:** LLM calls `ai-memory-summarize` after key progress — decisions, direction changes, milestones. Each call replaces the previous summary.
- **Title refresh:** `ai-memory-summarize` can optionally include `title` to update stale conversation titles when the topic becomes clear or changes.
- **Optional:** Conversations without summaries still have full transcript + title + FTS5 search.

---

## Usage

### With IDE (automatic)

Once initialized, everything is automatic. Conversations are captured, context is injected at session start, and the LLM can search and summarize via MCP tools.

### With CLI

```bash
ai-memory search "PostgreSQL"                  # Full-text search over turns
ai-memory conversations                        # List recent conversations
ai-memory conversation <id>                    # Full transcript
ai-memory summarize <id> "Chose Redis, 15m TTL"  # Update summary
ai-memory title <id> "Session recap title"     # Update title directly
ai-memory import-transcripts                   # Import from Cursor/Claude transcripts
ai-memory usage --range 7d                     # MCP tool usage analytics
ai-memory clean-data --dry-run                 # Strip IDE wrapper tags from titles/summaries
ai-memory status                               # Health check
```

### With MCP

When your IDE supports [Model Context Protocol](https://modelcontextprotocol.io), these tools are available to the AI:

| Tool | What it does |
|------|-------------|
| `ai-memory-search` | Full-text search over conversation history with turn snippets |
| `ai-memory-conversations` | List recent conversations with titles and summaries |
| `ai-memory-conversation` | Get full transcript for a conversation |
| `ai-memory-summarize` | Update summary; optionally update title for the conversation |
| `ai-memory-status` | Health check — conversation count, turn count, index status, active warnings |

These tools are called autonomously by the LLM. For user-triggered commands, ai-memory also registers MCP prompts that appear in the IDE `/` autocomplete:

| Prompt | Trigger | What it does |
|--------|---------|-------------|
| `status` | `/mcp__ai-memory__status` | Quick health check |
| `search` | `/mcp__ai-memory__search` | Search with a query argument |
| `recent` | `/mcp__ai-memory__recent` | Last 10 conversations overview |
| `summarize` | `/mcp__ai-memory__summarize` | Ask the LLM to summarize and save |

MCP is auto-configured by `ai-memory init --ide <name>`. The init command registers the MCP server globally:

| IDE | MCP config location |
|-----|-------------------|
| Cursor | `~/.cursor/mcp.json` |
| Claude Code | `~/.claude/settings.json` |

<details>
<summary>Manual setup (if not using init)</summary>

Add to your IDE's global MCP configuration:

```json
{
  "mcpServers": {
    "ai-memory": {
      "command": "ai-memory",
      "args": ["mcp"]
    }
  }
}
```
</details>

---

## Configuration

```bash
ai-memory config list              # Show all settings
ai-memory config get <key>         # Show one setting
ai-memory config set <key> <value> # Change a value
```

| Key | Default | Description |
|-----|---------|-------------|
| `injection_max_conversations` | `5` | Max conversations included in session-start injection |
| `injection_max_title_chars` | `80` | Max characters per title (truncated with `...`) |
| `injection_max_summary_chars` | `150` | Max characters per summary in injection |
| `injection_max_total_chars` | `1800` | Hard cap on total injection output length |
| `search_default_limit` | `20` | Default result count when `--limit` is not specified |

Stored at `~/.ai-memory/config.json`.

---

## Session Injection

At session start, ai-memory injects recent conversation context:

```
<!-- p1:injected:begin -->
Recent work (ai-memory):
- "Fix caching bug in session service" (2026-03-09)
  -> Chose Redis, 15min TTL, pub/sub invalidation. Open: deploy cache clear.
- "Design the tagging model" (2026-03-09)
  -> Decided no tags — workspace + date columns + FTS5 search.

Other recent:
- "Refactor API endpoints" (2026-03-08, ws: editor-platform)
  -> [no summary]

Use ai-memory-search to find past conversations.
Use ai-memory-summarize after key progress.
<!-- p1:injected:end -->
```

**Hard limits (deterministic, no token heuristics):**
- Max 5 conversations
- Max 80 chars per title
- Max 150 chars per summary
- Max 1800 chars total injection

Current project conversations appear first, then other recent ones.

---

## Search

Search runs across three sources, ranked in order:

1. **Turn content** — FTS5 full-text search with BM25 ranking (primary)
2. **Conversation summaries** — secondary matching
3. **Conversation titles** — secondary matching

Results include `match_source` so you can see what matched. No custom scoring formulas — BM25 + explicit filters (workspace, date range, role).

---

## Transcript Import

Import existing conversations from IDE transcripts on disk:

```bash
ai-memory import-transcripts                    # Import from all sources
ai-memory import-transcripts --source cursor    # Cursor only
ai-memory import-transcripts --source claude-code  # Claude Code only
ai-memory import-transcripts --force-summary    # Overwrite existing summaries
```

Sources:
- Claude Code: `~/.claude/projects/*/*.jsonl`
- Cursor: `~/.cursor/projects/*/agent-transcripts/*/*.jsonl`

Import is idempotent — safe to rerun. Conversations are deduped by `external_id`, turns by `content_hash`. Reports `{created, updated, skipped, errors}`.

---

## CLI Reference

```
ai-memory init [--ide cursor|claude-code|all] [--reset-db]
ai-memory status [--json]
ai-memory search <text> [--workspace ...] [--from ...] [--to ...] [--role ...] [--limit ...] [--offset ...] [--json]
ai-memory conversations [--workspace ...] [--from ...] [--to ...] [--limit ...] [--offset ...] [--json]
ai-memory conversation <id> [--json]
ai-memory summarize <id> <summary> [--json]
ai-memory title <id> <title> [--json]
ai-memory import-transcripts [--source cursor|claude-code|all] [--force-summary] [--json]
ai-memory usage [--range 24h|7d|30d] [--json]
ai-memory config get|set|list
ai-memory clean-data [--dry-run] [--json]
ai-memory dashboard [--port ...] [--no-open]
ai-memory mcp
ai-memory hook session-start|prompt-submit|stop|afterAgentResponse|session-end --ide <ide>
```

---

## Data Storage

Everything local:

| What | Where |
|------|-------|
| Database | `~/.ai-memory/services/memory.db` |
| Configuration | `~/.ai-memory/config.json` |

Override the database path with `AI_MEMORY_DB_PATH` environment variable.

### Project Identity

Conversations are grouped by a stable `project_key`:

- If an absolute workspace path is available, ai-memory uses `path:<hash(workspacePath)>`.
- If no path is available but transcript source metadata exists, ai-memory uses `src:<token>`.
- Otherwise it falls back to `ws:<normalized-workspace>`.

ai-memory does not create project-local marker files.

### Schema

Five tables + one FTS index:

- `conversations` — id, external_id, project_key, workspace, ide, source_path, source_mtime, title, summary, turn_count, started_at, updated_at
- `turns` — id, conversation_id, role (`user|assistant|system`), content, content_hash, turn_number, created_at
- `turns_fts` — FTS5 virtual table on turn content (BM25 search)
- `tool_usage` — MCP and hook telemetry (latency, result counts, success/error type) used by `ai-memory usage`
- `health_warnings` — integration health tracking (missing fields, config drift, empty captures) with upsert/resolve semantics

---

## Development

```bash
npm run build:all # TypeScript + dashboard assets → dist/
npm test          # 159 tests across 20 suites
```

### Project Structure

```
src/
├── cli.ts                            CLI entry point
├── app.ts                            Application context (wires all services)
├── types.ts                          Core types (Conversation, Turn, SearchParams)
├── db/
│   ├── schema.ts                     SQLite schema (conversations, turns, turns_fts)
│   └── connection.ts                 Database connection and migration
├── stores/
│   └── conversation-store.ts         CRUD for conversations and turns
├── services/
│   ├── search-service.ts             FTS5 BM25 search + summary/title fallback
│   ├── injection-service.ts          Bounded session-start context injection
│   ├── import-service.ts             Transcript import from Cursor/Claude JSONL
│   ├── status-service.ts             Health check and stats
│   ├── usage-service.ts              MCP usage analytics
│   └── config-service.ts             Configuration management
├── hooks/
│   ├── handlers.ts                   IDE hook handlers (deterministic capture + injection)
│   └── init-config.ts                IDE config file generation
├── mcp/
│   ├── server.ts                     MCP tool handlers
│   └── stdio.ts                      MCP stdio transport + tool registration
├── dashboard/
│   ├── server.ts                     Dashboard HTTP server
│   ├── rpc.ts                        Dashboard RPC (listConversations, search, etc.)
│   └── client/                       React UI (Conversations + Search views)
└── utils/
    ├── hash.ts                       Content hashing
    ├── id.ts                         ID generation
    ├── strip.ts                      IDE wrapper tag stripping
    ├── workspace-identity.ts         Stable project identity derivation
    └── time.ts                       ISO timestamp helpers
```

---

## Design Philosophy

1. **Conversation-first** — every session is a durable conversation with turn-level history
2. **On-demand retrieval** — search and browse when you need it, no inference pipeline
3. **LLM-assisted summaries** — summaries are written by LLM or user via MCP tool call
4. **Deterministic hooks** — hooks only capture turns and inject bounded context, no LLM orchestration
5. **Local and private** — all data stays on your machine
6. **Thin adapters** — CLI, dashboard, and MCP expose the same core services

---

## License

ISC
