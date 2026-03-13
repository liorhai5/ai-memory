# Research 001: System Complexity & Alternative Collection Approaches

**Question**: How complex and fragile is ai-memory's collection system? Are there simpler ways to achieve the same goals — file watching, terminal capture, machine-level integration?

**Status**: Complete

## Sources

| # | Source | Type | Status | Summary |
|---|--------|------|--------|---------|
| 001 | `docs/architecture.md` + codebase | code | harvested | 9 capabilities, 4-layer architecture, 13 integration points |
| 002 | `src/cli.ts` + `src/hooks/` | code | harvested | ~530 lines adaptation code for ~100 lines business logic; 4 fragility points |
| 003 | `src/hooks/init-config.ts` | code | harvested | Init touches up to 21 files, 3 different config formats |
| 004 | `design-logs/` | doc | harvested | System already simplified once (D011), hardened once (D038) |
| 005 | Alternative: file-watching | analysis | harvested | Could replace 70% of hook complexity but no injection |
| 006 | Alternative: terminal capture | analysis | harvested | Poor fit — doesn't work for IDE-embedded AI |
| 007 | Alternative: machine-level | analysis | harvested | All OS-level approaches are either file watching or overpowered/underprecise |
| 008 | MCP protocol capabilities | analysis | harvested | MCP lacks lifecycle events; dual integration (hooks + MCP) is the root of complexity |

## Synthesis

### The Complexity Picture

**What the system does** (beyond dashboard):
1. Capture conversations from 3 IDEs via hooks
2. Full-text search via FTS5
3. Bounded context injection at session start
4. Transcript import from IDE files
5. Health observability + usage analytics
6. MCP tools for LLM-callable access
7. IDE skills for user-triggered commands

**Where the complexity lives:**

| Component | Lines | What it does | Fragility |
|-----------|-------|-------------|-----------|
| cli.ts (hooks) | ~530 | Adapt 3 IDE stdin formats + phantom detection | **High** — unversioned contracts |
| init-config.ts | ~270 | Generate 3 different config formats | **Medium** — IDE format changes |
| handlers.ts | ~165 | Actual business logic | **Low** — straightforward |
| Services + stores | ~700 | Search, injection, import, status | **Low** — pure logic |

**The 5:1 ratio**: ~530 lines of adaptation code serve ~100 lines of capture logic. The complexity is almost entirely in bridging IDE contracts, not in the domain logic.

### Could We Have Done It Simpler?

| Alternative | Replaces Hooks? | Replaces MCP? | Injection? | Practical? |
|-------------|----------------|---------------|------------|------------|
| File watching | Capture only | No | No | Yes (+ daemon) |
| Terminal capture | CLI tools only | No | No | No (IDE gap) |
| OS-level (FSEvents) | = file watching | No | No | Same as above |
| OS-level (ES/eBPF) | No (wrong abstraction) | No | No | No (privileges) |
| Network interception | Capture only | No | No | No (TLS/privacy) |
| Pure MCP + lifecycle events | Yes (if spec existed) | Yes | Yes | **Not yet** |

### Key Findings

1. **IDE hooks are the right abstraction level.** The OS sees files and processes; we need conversations and turns. Only the IDE knows session boundaries, workspace context, and turn roles.

2. **The complexity is accidental, not essential.** The ~530 lines of adaptation code exist because 3 IDEs have 3 different hook contracts with no shared standard. If all IDEs used the same contract, this would be ~50 lines.

3. **MCP is half the answer.** MCP provides tool-calling but no lifecycle events. If MCP added `onSessionStart` and `onTurnComplete`, the entire hook system (init, config generation, stdin parsing, phantom detection) would collapse into the MCP server.

4. **File watching is the best alternative for capture.** It already works (import-transcripts), is idempotent, and requires zero IDE config. But it cannot do injection, which is a core feature.

5. **The hybrid sweet spot** would be: hooks for injection only (session-start) + file watching for capture + MCP for tools. This eliminates ~80% of hook complexity but adds a daemon.

6. **The system has been iteratively simplified.** D011 removed the inference engine. D038 hardened the hook contracts. Each round finds new accidental complexity. The current state is much simpler than where it started.

### Assessment

**Complexity**: Moderate-high. ~1,700 lines of non-dashboard code, but ~800 of those are adaptation/bridging code.

**Fragility**: The fragility is concentrated in two places:
1. **IDE stdin contracts** — unversioned, undocumented, could change any release
2. **Config file formats** — 3 IDEs × different formats, manual edits can break

**Mitigations are solid**: content-hash dedup, never-crash-IDE policy, health observability, drift detection, usage tracking. The system degrades gracefully.

**Bottom line**: The system is as simple as it can be given current IDE capabilities. The real simplification would come from MCP adding lifecycle events — reducing two integration points (hooks + MCP) to one (MCP). Until then, the hook adapter layer is necessary complexity.
