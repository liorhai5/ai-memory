# Codex Integration — Design Log

[Status: implemented]
[Created: 2026-03-12]

## 1. Problem Statement

ai-memory supports Cursor and Claude Code as IDE providers. OpenAI Codex CLI is a new coding agent (Rust-based, Apache 2.0) that runs as a desktop app and as a VS Code extension. It needs to be evaluated as a third provider.

Key question: does Codex expose enough hook surface to support ai-memory's capture model?

## 2. POC Findings (2026-03-12)

### 2.1 Version Landscape

| Surface | Binary Location | Version | Hooks Support |
|---|---|---|---|
| Codex Desktop (app) | `/Applications/Codex.app/Contents/Resources/codex` | **v0.115** | `notify` works, `hooks.json` silently ignored |
| VS Code extension | `~/.vscode/extensions/openai.chatgpt-*/bin/macos-aarch64/codex` | **v0.108** | Neither system available |
| CLI (brew) | TBD — brew install pending | TBD | TBD |

Both surfaces share `~/.codex/` for config, auth, and state.

### 2.2 Two Hook Systems — Tested

**`notify` (config.toml) — WORKS in v0.115**

```toml
notify = ["python3", "/path/to/capture.py"]
```

- Fires on `agent-turn-complete` (every turn, including internal title generation)
- Payload arrives as `argv[1]` JSON
- Fire-and-forget — no stdout response, no injection capability

Captured payload:
```json
{
  "type": "agent-turn-complete",
  "thread-id": "019ce227-735b-...",
  "turn-id": "019ce227-843d-...",
  "cwd": "/Users/liorha/Documents/Playground",
  "client": "Codex Desktop",
  "input-messages": ["how much is 2+2?\n"],
  "last-assistant-message": "2+2 = 4"
}
```

**`hooks.json` — SILENTLY IGNORED in v0.115**

Feature flag `codex_hooks` is "under development". Enabling it + creating `~/.codex/hooks.json`:
- Does not error on startup
- Does not fire hooks (verified: no stdin captured, no files written)
- `additionalContext` in stdout has no effect

This means **context injection via hooks is not possible today**. Revisit when `codex_hooks` feature moves to experimental/stable.

### 2.3 What `notify` Gives Us

| ai-memory Need | Available in `notify` | Field |
|---|---|---|
| Session ID | Yes | `thread-id` |
| Workspace / cwd | Yes | `cwd` |
| Client identifier | Yes | `client` (e.g. "Codex Desktop") |
| User prompt | Yes | `input-messages` array |
| Assistant response | Yes | `last-assistant-message` |
| Turn ID | Yes | `turn-id` |
| Context injection | **No** | Fire-and-forget, no stdout |
| Session start event | **No** | Only `agent-turn-complete` |
| Session end event | **No** | Only `agent-turn-complete` |

### 2.4 Noise: Title Generation Turns

Codex fires `notify` for internal system prompts (title generation). These contain system prompt patterns like "Generate a concise UI title" in `input-messages[0]`. Must be filtered in the adapter.

### 2.5 Wix npm Embargo Note

Codex CLI via npm (`@openai/codex`) is subject to 2-week package embargo (Wix security policy). Workarounds:
- **macOS:** `brew install codex` (uses GitHub releases, not npm)
- **Direct download:** github.com/openai/codex/releases
- Whitelist for `@openai/*` scope is in progress (Slack thread: C0JLGMT28/p1770205521567699)

## 3. Design: Capture-Only Integration

Given that injection is not possible today, the integration scope is **capture only** — same data flows into ai-memory, but no memory context is pushed back into Codex sessions.

### 3.1 Data Mapping

| ai-memory Field | Codex `notify` Source |
|---|---|
| `conversation.external_id` | `thread-id` |
| `conversation.workspace` | `cwd` (normalized) |
| `conversation.ide` | `'codex'` (new enum value) |
| `conversation.project_key` | Derived from `cwd` (same logic as CC/Cursor) |
| `conversation.title` | `input-messages[0]` from first non-system turn (truncated) |
| `turn.role = 'user'` | `input-messages[0]` |
| `turn.role = 'assistant'` | `last-assistant-message` |
| `turn.content_hash` | SHA256 of content (existing dedup) |

### 3.2 Architecture: New `turn-complete` Handler

Current system has separate handlers per lifecycle event (session-start, prompt-submit, stop). Codex delivers everything in one event. Rather than faking the lifecycle, add a single handler:

```
ai-memory hook turn-complete --ide codex
```

Codex `notify` calls `ai-memory` directly — no adapter script needed:
```toml
notify = ["ai-memory", "hook", "turn-complete", "--ide", "codex"]
```

The handler:
1. Reads JSON from argv (Codex passes payload as argv[1], not stdin)
2. Passes it through `parseIdeStdin('codex', ...)` — same adapter pattern as CC/Cursor
3. Calls `handleTurnComplete()` which creates-or-resumes conversation + captures both turns
4. Uses `content_hash` dedup (existing) to handle any double-fires

### 3.3 Changes Required

| # | Change | Where | Notes |
|---|---|---|---|
| 1 | Add `'codex'` to `IdeType` | `types.ts` | One line |
| 2 | Add `codex` branch to `parseIdeStdin` | `cli.ts` | Maps `thread-id` → sessionId, `cwd` → workspace, `input-messages[0]` → prompt, `last-assistant-message` → assistantContent. Includes system prompt filter (skip title-generation turns). Same adapter pattern as CC/Cursor. |
| 3 | New `turn-complete` CLI subcommand | `cli.ts` | Thin: reads JSON from argv (not stdin), calls `parseIdeStdin`, calls handler. Only new wiring. |
| 4 | New `handleTurnComplete()` | `handlers.ts` | Create-or-resume conversation by `external_id`, capture user turn + assistant turn in sequence. |
| 5 | Config setup | `init` command or docs | Add `notify` line to `~/.codex/config.toml` |

No new files. No changes to existing CC/Cursor paths.

No changes to existing Claude Code or Cursor paths.

### 3.4 Multi-turn Dedup (Verified)

Codex sends the **same `input-messages[0]`** (the original first prompt) for every turn in a thread, not the latest follow-up. This means `content_hash` dedup correctly prevents duplicate user turns, but follow-up user prompts are lost — only assistant responses are captured for turns 2+.

This is a limitation of the `notify` payload, not our system. When `hooks.json` matures and provides per-turn stdin, this will resolve naturally.

## 4. Known Gaps & Future Work

| Gap | Impact | Mitigation | Revisit When |
|---|---|---|---|
| **No context injection** | Codex sessions don't get memory context | None for now. `hooks.json` SessionStart with `additionalContext` is the intended path | `codex_hooks` feature reaches experimental/stable |
| **No session-start event** | Can't prepare context before first turn | Create conversation on first `agent-turn-complete` | Same as above |
| **No prompt-submit event** | Can't capture user prompt before response | User prompt available in `input-messages` on turn-complete (post-hoc) | Not blocking |
| **Follow-up user prompts lost** | `input-messages[0]` is always the first prompt; turns 2+ only capture assistant response | `content_hash` dedup is correct; accept partial capture until `hooks.json` matures | `codex_hooks` feature stable |
| **VS Code extension on v0.108** | No `notify` support in extension binary | Wait for extension update, or symlink app binary | Extension release cycle |
| **`hooks.json` silently ignored** | Feature flag enabled but no effect | Documented. Will re-test on future versions | Next Codex release |

## 5. Decisions

### Q1: Capture-only scope acceptable?

**Yes.** Injection is blocked by Codex's hook maturity. Capture gives us cross-IDE conversation history which is valuable on its own — other IDEs (CC, Cursor) can surface Codex conversations via ai-memory-search.

### Q2: New `turn-complete` handler vs reuse existing?

**New handler.** A unified `turn-complete` is the right abstraction for a single-event-per-turn model. Cleaner than faking session-start + prompt-submit + stop from one payload.

### Q3: Notify adapter approach?

**Direct call.** No adapter script needed — `notify` calls `ai-memory` directly:
```toml
notify = ["ai-memory", "hook", "turn-complete", "--ide", "codex"]
```
The CLI subcommand reads JSON from argv (Codex passes it as argv[1]) and feeds it through the same `parseIdeStdin` adapter as CC/Cursor.

### Q4: Codex instructions file (AGENTS.md) for memory usage?

**No.** We don't have equivalent instruction files for Claude Code or Cursor. Avoid creating Codex-specific infra that diverges from the shared model.

## 6. Verification (2026-03-12)

### Test Matrix

| Test | Result |
|---|---|
| Unit: `turnCompleteHook` captures both turns | Pass |
| Unit: first turn sets title and summary | Pass |
| Unit: multi-turn appends via dedup | Pass |
| Unit: skips empty prompt/content | Pass |
| CLI: turn-complete via argv JSON | Pass |
| CLI: system prompt filter blocks title-generation | Pass |
| E2E: Codex Desktop single turn capture | Pass — user + assistant captured |
| E2E: Codex Desktop multi-turn (3 prompts) | Partial — first user prompt + all 3 assistant responses captured; follow-up user prompts deduped (known gap) |
| Regression: all 159 existing tests pass | Pass (165 total with 6 new) |

### Config

```toml
# ~/.codex/config.toml
notify = ["ai-memory", "hook", "turn-complete", "--ide", "codex"]

[features]
codex_hooks = true  # Required but hooks.json silently ignored in v0.115
```

## 7. Implementation Results

### Files Changed

| File | Change |
|---|---|
| `src/types.ts` | Added `'codex'` to `IdeType` |
| `src/cli.ts` | Added `codex` branch to `parseIdeStdin` (thread-id, cwd, input-messages, last-assistant-message); new `turn-complete` CLI subcommand with system prompt filter |
| `src/hooks/handlers.ts` | New `turnCompleteHook()` — create-or-resume + capture user + assistant in one call |
| `tests/hooks/handlers.test.ts` | 4 new tests for `turnCompleteHook` |
| `tests/adapters/cli.test.ts` | 2 new tests for CLI turn-complete + system prompt filter |
| `~/.codex/config.toml` | Added `notify` config |

No new files created. No changes to existing CC/Cursor code paths.
