# Alternative: File-Watching Approach

- **Source**: Analysis — watching IDE provider/transcript files
- **Type**: analysis
- **Accessed**: 2026-03-13

## Findings

### The Idea

Instead of hooking into IDE lifecycle events, watch the files that IDEs already write:
- Cursor: `~/.cursor/projects/*/agent-transcripts/*/*.jsonl`
- Claude Code: `~/.claude/projects/*/*.jsonl`
- Codex: transcript files (location TBD)

Use FSEvents (macOS) / inotify (Linux) to detect changes and ingest new content.

### What Already Exists

ai-memory already has `import-transcripts` — a CLI command that reads these exact files. The import is idempotent (content-hash dedup). So file watching is essentially "auto-import on file change."

### Advantages

1. **Zero IDE configuration** — no hooks.json, no settings.json, no MCP registration, no init command
2. **No stdin contract dependency** — reads the IDE's own format, which is more stable than hook payloads
3. **No phantom hook problem** — no hook duplication to detect
4. **Simpler mental model** — "watch files, import changes"
5. **Works retroactively** — can import conversations that happened before installation

### Problems

1. **No session-start injection** — file watching is passive. Can't inject context into new sessions because there's no hook to respond to. This is the biggest loss — injection is a core feature.

2. **Delayed capture** — file watching has latency (FSEvents batches, write buffering). Hooks capture turns immediately.

3. **JSONL format dependency** — IDEs could change transcript format or location. But this is already a dependency for the import command.

4. **Daemon requirement** — needs a long-running process (or launchd agent) to watch files. Current system is event-driven (hook fires → CLI runs → exits). A daemon adds deployment complexity.

5. **No workspace/session metadata** — transcript files may not contain all the metadata hooks provide (workspace path, session lifecycle).

6. **Cursor transcript completeness** — Cursor transcripts may not include all assistant content (streaming, tool calls).

### Hybrid Possibility

Use hooks ONLY for injection (session-start) and use file watching for capture. This eliminates:
- prompt-submit hooks
- stop hooks
- afterAgentResponse hooks
- Phantom hook detection (only session-start remains)

But still requires:
- IDE config for session-start hook
- MCP for search/summarize tools
- A daemon for file watching

### Verdict

File watching could replace ~70% of hook complexity (capture) but cannot replace injection. A hybrid approach is possible but adds a daemon dependency.
