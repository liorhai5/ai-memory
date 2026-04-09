# ai-memory

![License](https://img.shields.io/badge/license-ISC-blue) ![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen) ![SQLite](https://img.shields.io/badge/SQLite-%3E%3D3.35-blue)

**Conversation log and retrieval for AI coding assistants.**

AI coding assistants have no memory. Every session starts blank — they don't know what you discussed last week, what decisions were made, or what was tried and abandoned. You end up repeating context, re-explaining goals, and losing track of past work.

ai-memory logs every conversation and makes it searchable. It watches IDE transcript directories and imports turns automatically, supports full-text search, and lets the LLM write progressive summaries via MCP tools. It runs locally, stores everything on your machine, and works without any LLM involvement.

---

## Prerequisites

- Node.js >= 22
- SQLite >= 3.35 (bundled by `better-sqlite3`; required for `ALTER TABLE DROP COLUMN`)

## Install

```bash
# 1. Install the binary + create database
npm install -g ai-memory
ai-memory init

# 2. Register MCP server (auto-detects all installed IDEs)
npx add-mcp "ai-memory mcp" -g -n ai-memory -y

# 3. Install skills (auto-detects all installed IDEs)
npx skills add liorhai5/ai-memory

# Verify
ai-memory status
```

Step 1 creates `~/.ai-memory/` (database + config). Step 2 registers the MCP server (LLM tools) across all detected IDEs. Step 3 installs slash commands (`/mem`). Each step is idempotent — safe to re-run.

<details>
<summary>From source</summary>

```bash
git clone <repo-url> && cd ai-memory
npm install && npm run build:all
npm link
ai-memory init
```
</details>

---

## What Happens

```
You talk to AI ──→ IDE writes transcript files ──→ ai-memory file-watcher picks them up
       ↑                                                         │
       └──── searchable history available to LLM via MCP ◄──────┘
```

### How capture works

The MCP server (`ai-memory mcp`) watches three transcript directories:

| Directory | IDE |
|-----------|-----|
| `~/.claude/projects/` | Claude Code |
| `~/.cursor/projects/` | Cursor |
| `~/.codex/sessions/` | Codex |

When a `.jsonl` file changes, the watcher imports it within 500ms (debounced). On startup, it also does a catch-up import of any transcripts written while the MCP server was offline. Import is idempotent — conversations are deduped by `external_id`, turns by `content_hash`.

### Summaries

Summaries are the only enrichment layer. They're written by the LLM or user via the `ai-memory-summarize` MCP tool:

- **Initial:** First user prompt is stored as the initial summary (automatic).
- **Progressive:** LLM calls `ai-memory-summarize` after key progress — decisions, direction changes, milestones. Each call replaces the previous summary.
- **Title refresh:** `ai-memory-summarize` can optionally include `title` to update stale conversation titles when the topic becomes clear or changes.
- **Optional:** Conversations without summaries still have full transcript + title + FTS5 search.

---

## Usage

### With IDE (automatic)

Once initialized, everything is automatic. Conversations are captured as you work, and the LLM can search and summarize via MCP tools.

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

These tools are called autonomously by the LLM. For user-triggered commands, install the [AgentSkills](https://agentskills.io) skill:

```bash
npx skills add liorhai5/ai-memory
```

This provides a single `/mem` command with subcommands:

| Command | What it does |
|---------|-------------|
| `/mem status` | Quick health check |
| `/mem search <query>` | Search with a query argument |
| `/mem recent` | Last 10 conversations overview |
| `/mem summarize` | Ask the LLM to summarize and save |

MCP is registered across all detected IDEs with:

```bash
npx add-mcp "ai-memory mcp" -g -n ai-memory -y
```

---

## Configuration

```bash
ai-memory config list              # Show all settings
ai-memory config get <key>         # Show one setting
ai-memory config set <key> <value> # Change a value
```

| Key | Default | Description |
|-----|---------|-------------|
| `search_default_limit` | `20` | Default result count when `--limit` is not specified |

Stored at `~/.ai-memory/config.json`.

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
- Codex: `~/.codex/sessions/YYYY/MM/DD/*.jsonl`

Import is idempotent — safe to rerun. Conversations are deduped by `external_id`, turns by `content_hash`. Reports `{created, updated, skipped, errors}`.

---

## CLI Reference

```
ai-memory init [--reset-db]
ai-memory status [--json]
ai-memory search <text> [--workspace ...] [--from ...] [--to ...] [--role ...] [--limit ...] [--offset ...] [--json]
ai-memory conversations [--workspace ...] [--from ...] [--to ...] [--limit ...] [--offset ...] [--json]
ai-memory conversation <id> [--json]
ai-memory summarize <id> <summary> [--json]
ai-memory title <id> <title> [--json]
ai-memory import-transcripts [--source cursor|claude-code|codex|all] [--force-summary] [--json]
ai-memory usage [--range 24h|7d|30d] [--json]
ai-memory config get|set|list
ai-memory project init [--slug ...] [--skip]
ai-memory project status [--json]
ai-memory clean-data [--dry-run] [--json]
ai-memory dashboard [--port ...] [--no-open]
ai-memory mcp
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

- `conversations` — id, external_id, workspace, workspace_path, ide, source_path, source_mtime, title, summary, turn_count, started_at, updated_at
- `turns` — id, conversation_id, role (`user|assistant|system`), content, content_hash, turn_number, created_at
- `turns_fts` — FTS5 virtual table on turn content (BM25 search)
- `tool_usage` — MCP and import telemetry (latency, result counts, success/error type) used by `ai-memory usage`
- `health_warnings` — integration health tracking (missing fields, config drift, empty captures) with upsert/resolve semantics

---

## Development

```bash
npm run build:all # TypeScript + dashboard assets → dist/
npm test          # Vitest — all suites
```

### Project Structure

```
skills/
└── mem/                              AgentSkills skill (installed via npx skills add)
    ├── SKILL.md                      Entry point — routes /mem subcommands
    └── commands/                     Subcommand files (status, search, recent, summarize)

src/
├── cli.ts                            CLI entry point
├── app.ts                            Application context (wires all services)
├── types.ts                          Core types (Conversation, Turn, SearchParams, IdeType)
├── db/
│   ├── schema.ts                     SQLite schema (conversations, turns, turns_fts)
│   └── connection.ts                 Database connection and migration
├── stores/
│   └── conversation-store.ts         CRUD for conversations and turns
├── services/
│   ├── search-service.ts             FTS5 BM25 search + summary/title fallback
│   ├── import-service.ts             Transcript import from Cursor/Claude/Codex JSONL
│   ├── status-service.ts             Health check, stats, and MCP detection
│   ├── usage-service.ts              MCP usage analytics
│   └── config-service.ts             Configuration management
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
    ├── project-config.ts             Per-project config reading
    ├── workspace-identity.ts         Stable project identity derivation
    └── time.ts                       ISO timestamp helpers
```

---

## Design Philosophy

1. **Conversation-first** — every session is a durable conversation with turn-level history
2. **On-demand retrieval** — search and browse when you need it, no inference pipeline
3. **LLM-assisted summaries** — summaries are written by LLM or user via MCP tool call
4. **Local and private** — all data stays on your machine
6. **Thin adapters** — CLI, dashboard, and MCP expose the same core services

---

## License

ISC
