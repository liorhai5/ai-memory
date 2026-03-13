# Init System Complexity

- **Source**: `src/hooks/init-config.ts`, `src/cli.ts` init command
- **Type**: code
- **Accessed**: 2026-03-13

## Findings

### What init touches

`ai-memory init` modifies up to **9 files** across the system:

1. `~/.ai-memory/` directory (create)
2. `~/.ai-memory/services/` directory (create)
3. `~/.ai-memory/services/memory.db` (create SQLite)
4. `~/.ai-memory/config.json` (create with defaults)
5. `~/.cursor/hooks.json` (merge hook entries)
6. `~/.cursor/mcp.json` (add MCP server)
7. `~/.claude/settings.json` (merge hooks + MCP)
8. `~/.claude.json` (runtime MCP registry)
9. `~/.codex/config.toml` (add notify + MCP)
10. `~/.<ide>/skills/ai-memory-*/SKILL.md` × 4 skills × 3 IDEs = up to 12 files

**Total**: up to ~21 files created/modified on `--ide all`.

### Config format complexity

Each IDE has a different config format:
- **Cursor**: flat JSON arrays per event (`hooks.sessionStart: [{ command: "..." }]`)
- **Claude Code**: grouped format with matchers (`hooks.SessionStart: [{ matcher: "...", hooks: [{ type: "command", command: "..." }] }]`)
- **Codex**: TOML format (`notify = [...]` + `[mcp_servers.ai-memory]`)

The init code handles:
- Old format migration (stripping flat ai-memory entries from Claude Code)
- Matcher updates (ensuring sessionStart fires on startup|resume|clear|compact)
- Idempotent merging (checking existence before adding)
- MCP dual-path registration (settings.json + `claude mcp add` runtime)

### Validation

After registration, `checkHookPresence()` re-reads config files and verifies every expected hook is present. Missing hooks → `init_drift` warnings in the database.

On every `session-start`, the same check runs again — lightweight drift detection.

### Fragility assessment

- **Config file corruption**: If a user manually edits hooks.json and introduces invalid JSON, init fails. No recovery mechanism beyond re-running.
- **Partial writes**: If init crashes mid-way, some files are written, others not. No rollback.
- **IDE version changes**: If Cursor changes hooks.json format → init breaks silently (writes to wrong structure).
- **Claude MCP dual-path**: Two separate registration mechanisms (settings.json + `claude mcp add`) — either could drift independently.
- **Skill files**: 4 skills × 3 IDEs = many small files. Low fragility individually, but surface area for conflicts.
