# Project Memory — ai-memory

## Decisions
- This repo IS the ai-memory system — the CLI, templates, global rule, and design docs
- CLI is a pure bash script (~220 lines), zero dependencies, manages `~/.ai-memory/` only
- Cursor global rule (~32 lines) is the integration layer — bridges shared + project memory
- Skills are YAML files with two modes: `recipe` (single-phase) or `phases` (multi-phase workflow with gates)
- No INDEX.md for design logs — numbered files (`NNN-name.md`) are self-indexing
- Markdown everywhere — no JSON, no databases
- Companion project (ai-lior-claw) is on pause, separate repo — not archived, not merged
- **022**: ai-memory is a local workflow layer, not project knowledge discovery. Keep fixed paths for personal workflow (`ai-memory/MEMORY.md`, `ai-memory/design-logs/`) and keep skills machine-level only (`~/.ai-memory/skills/`). Project committed knowledge stays self-contained and is defined by project `.cursor/rules/*.mdc`

## Patterns
- Structured design: break complex topics into numbered decisions, approve one by one (dogfooded in 001)
- Design log = task artifact — one file carries a feature from research through implementation
- Three-layer architecture: shared memory (`~/.ai-memory/`) + project memory (`ai-memory/`) + global rule (bridge)
- Skills use semantic `requires` (capability descriptions, not tool names)
- `tracking` field in workflow skills points to the markdown file where state persists

## Learnings
- ~60 lines of design-log methodology achieves ~80% of what 2,231 lines of state machine rules achieve (ai-conductor R098)
- The file structure IS the API — no MCP server or special runtime needed for memory
- Cursor can read/write `~/.ai-memory/` directly — CLI exists for bootstrap and terminal convenience
- Wix MCP-S (89 tools across 6 MCPs) eliminates the need for custom CLI extensions in Cursor

## Context
- Evolved from three projects: ai-conductor (state machine), companion/ai-lior-claw (CLI assistant), Wix MCP-S (workplace tools)
- 9 starter skills ship with init: design-first, bootstrap-project, code-review, investigate, refactor, daily-digest, prep-1on1, weekly-digest, research-topic
- The design log `001-unified-machine-memory.md` documents the full evolution and all 8 topic decisions
- `022-project-knowledge-generalization.md` — finalized as local ai-memory workflow + self-contained ai-gh/project knowledge separation. Updated global rule, templates, and docs accordingly
