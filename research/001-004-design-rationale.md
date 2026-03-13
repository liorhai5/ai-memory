# Design Rationale from Design Logs

- **Source**: `design-logs/001-unified-machine-memory.md`, `011-conversation-log-pivot.md`, `038-harden-ide-integration.md`
- **Type**: doc
- **Accessed**: 2026-03-13

## Findings

### Origin Story (D001)

The system converged from three separate projects:
- **ai-conductor** — complex state machine for AI dev workflow (2,231 lines → ~55 lines of rules)
- **companion** — CLI personal AI assistant with extensions, skills, RAG
- **Wix MCP-S** — OAuth-gated workplace tools

Key realization: file overhead of project-level memory was excessive. Complex orchestration was dropped in favor of simple design-log methodology.

### The Pivot (D011) — Most Relevant

**Original system was over-engineered for inference.** Had: 6 memory types, 5 link types with confidence scores, Hebbian scoring with decay, regex classification, graph expansion, token budgets. All to decide which 400 tokens to inject at session start.

**Core misalignment identified**: System optimized for *automatic pre-selection* (pick best 400 tokens) when actual need was *on-demand retrieval* (find my stuff) plus *curated summary*.

**Decision**: Pivot from inference engine to conversation log. Replace complexity with:
- Conversations + turns (simple data model)
- FTS5 search (no custom scoring)
- Summaries on conversations (no highlights, no tags, no link graphs)
- Bounded injection (recent conversations only)

### Hardening (D038) — Recent

**Anti-pattern identified**: "guessing what the IDE does instead of having a contract with it"

Key fixes:
- Replaced 8-field fallback chains with single known field per IDE
- Added afterAgentResponse for Cursor (was parsing transcript files)
- Added phantom hook detection
- Added health_warnings table for observability

### What These Decisions Tell Us

1. The system has already been simplified once (D011 stripped inference engine)
2. The hook system has already been hardened once (D038 replaced guessing with contracts)
3. Each hardening round discovers new fragility
4. The fundamental tension remains: we depend on unstable, unversioned IDE APIs
