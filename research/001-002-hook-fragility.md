# Hook Integration Fragility Analysis

- **Source**: `src/cli.ts`, `src/hooks/handlers.ts`
- **Type**: code
- **Accessed**: 2026-03-13

## Findings

### Complexity Inventory

**cli.ts** (860 lines) is the most complex file in the system. It contains:
- 6 hook subcommands (session-start, prompt-submit, stop, afterAgentResponse, session-end, turn-complete)
- Per-IDE stdin adapter (`parseIdeStdin`) — 90+ lines of field mapping for 3 IDEs
- Phantom hook detection — convention-based (PascalCase vs camelCase event names)
- Hook usage recording — every invocation tracked to `tool_usage` table
- Warning persistence — missing fields recorded to `health_warnings` table

**handlers.ts** (165 lines) is comparatively simple — straightforward business logic that receives already-parsed payloads.

### Fragility Points

1. **Stdin contract per IDE** — 3 different JSON shapes, no versioning, no schema validation
   - Claude Code: `session_id`, `cwd`, `last_assistant_message`, `prompt`
   - Cursor: `conversation_id`, `workspace_roots[]`, `text`, `prompt`
   - Codex: `thread-id`, `cwd`, `last-assistant-message`, `input-messages[]`
   - If any IDE changes field names → silent data loss (empty strings, not errors)

2. **Phantom hook detection** — relies on naming convention
   - Claude Code events: PascalCase (SessionStart, UserPromptSubmit, Stop)
   - Host IDE events: camelCase (sessionStart, beforeSubmitPrompt, stop)
   - If convention changes → duplicate captures or missed captures
   - "stop" (lowercase) exists in both sets — handled by set membership

3. **Missing field behavior** — degrades to empty strings + warning
   - No errors thrown, hooks continue with partial data
   - Missing session_id → generates new UUID (creates orphan conversation)
   - Missing workspace → falls back to process.cwd() basename
   - These fallbacks mask integration problems

4. **Codex special path** — completely different capture mechanism
   - JSON in argv (not stdin)
   - System prompt filtering with hardcoded string patterns
   - Fire-and-forget (no context injection possible)
   - No session lifecycle (start/end) — just turn capture

### What Goes Right

- **Never crashes IDE** — all hooks catch errors, write to stderr, exit(0)
- **Dedup is robust** — content-hash means double-firing produces no duplicates
- **Health observability** — every warning is tracked with timestamps
- **Drift detection** — session-start checks config file presence each time
- **Usage tracking** — every hook invocation recorded with latency

### Complexity Cost

The hook system has ~530 lines of code dedicated to:
- Parsing IDE-specific JSON formats
- Detecting and silencing phantom hooks
- Recording warnings and usage metrics
- Formatting output per-IDE (plain text vs JSON)

The actual capture logic in handlers.ts is ~100 lines. The remaining ~430 lines are adaptation complexity — bridging 3 different IDE contracts into a common format.
