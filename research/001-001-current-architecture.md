# Current System Architecture

- **Source**: `docs/architecture.md` + codebase exploration
- **Type**: code
- **Accessed**: 2026-03-13

## Findings

### What the system provides (beyond dashboard)

1. **Conversation capture** — Turn-level recording (user + assistant) from IDE hooks
2. **Full-text search** — FTS5 with BM25 ranking across all conversation history
3. **Bounded session injection** — Automatic context (recent titles + summaries) prepended to new sessions
4. **Transcript import** — Idempotent import from Cursor and Claude Code JSONL files
5. **Health observability** — Integration health tracking via `health_warnings` table
6. **Usage analytics** — Per-tool telemetry (latency, error rates) in `tool_usage` table
7. **MCP tools** — 5 LLM-callable tools for search, browse, summarize
8. **IDE skills** — 4 slash commands for user-triggered actions
9. **CLI** — 12+ commands for direct interaction

### Architecture layers

```
Adapters (hooks, CLI, MCP, dashboard)
  → AppContext (wiring)
    → Services (search, injection, import, status, usage, config)
      → Store (ConversationStore)
        → SQLite (conversations, turns, turns_fts, tool_usage, health_warnings)
```

### Key design invariants

- Hooks never call LLMs — deterministic, instant
- Bounded injection — hard char caps, no token estimation
- Content-hash dedup — SHA-256 per turn, idempotent capture
- Local-only — single SQLite file, no network, no cloud
- Hooks never crash IDE — catch all errors, exit(0)

### Integration surface area

- **3 IDEs** with different hook contracts (Cursor, Claude Code, Codex)
- **5 hook event types** per IDE (session-start, prompt-submit, stop, afterAgentResponse, turn-complete)
- **6 config file locations** touched by init
- **3 skill file locations** per IDE
- **2 transcript import paths** (Cursor, Claude Code)
