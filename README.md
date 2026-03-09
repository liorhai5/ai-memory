# ai-memory

![Tests](https://img.shields.io/badge/tests-170%20passed-green) ![License](https://img.shields.io/badge/license-ISC-blue) ![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)

**Personal, persistent, self-learning memory for AI coding assistants.**

AI coding assistants have no memory. Every session starts blank — they don't know your stack, your conventions, your past decisions, or what you corrected them about yesterday. You end up repeating yourself, re-explaining context, and watching the AI make the same mistakes across sessions.

ai-memory captures what matters from every conversation and brings it back automatically. Decisions, preferences, corrections, patterns — all indexed, scored, and injected into the next session. It runs locally, learns from repetition, and works without any LLM involvement.

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
npm install && npm run build
npm link
```
</details>

## Set Up

```bash
# Initialize and connect to your IDE (one-time, machine-level)
ai-memory init --ide cursor
ai-memory init --ide claude-code

# Verify
ai-memory status
```

This creates `~/.ai-memory/` (database + config), registers global hooks (session lifecycle), and adds the MCP server (LLM tools). Run once per IDE — it applies to all projects on this machine.

---

## What Happens

```
You talk to AI ──→ ai-memory captures & scores ──→ Next session starts smarter
       ↑_________________________________________________________┘
```

**One memory, three contexts:**

| Scope | What it captures | Example |
|-------|-----------------|---------|
| **Session** | What you said in this conversation | "Let's use Redis for caching" |
| **Workspace** | Project-specific decisions and patterns | "This repo uses ESM imports" |
| **Machine** | Your global preferences, everywhere | "I prefer functional components" |

### Concrete example

```
You say: "Always use functional components"  → preference (conf: 0.70)
You say: "No, use PostgreSQL instead"        → correction  (conf: 0.90)
You say: "We decided to go with REST"        → decision    (conf: 0.80)
```

Next session start → your AI already knows:

```
- [preference] Always use functional components
- [correction] No, use PostgreSQL instead
- [decision] We decided to go with REST
```

### Over time

Memories that repeat across sessions get reinforced. Unused ones decay:

```
score = type_weight × confidence × recency × repetition_boost
```

---

## Usage

### With IDE (automatic)

Once initialized, everything is automatic:
- **Session starts** → relevant memories injected into context
- **Every turn** → captured, classified, linked to related memories
- **Session ends** → maintenance runs (decay, dedup, promotion)

### With CLI

```bash
ai-memory capture "Always use TypeScript strict mode" --type preference
ai-memory query "TypeScript"
ai-memory status
ai-memory sweep                    # manual maintenance
```

### With MCP

When your IDE supports [Model Context Protocol](https://modelcontextprotocol.io), these tools are available to the AI:

| Tool | What it does |
|------|-------------|
| `ai-memory-query` | Search memories with workspace context and token budget |
| `ai-memory-capture` | Store LLM-extracted memories (upgrades existing entries) |
| `ai-memory-events` | Retrieve raw captured events |
| `ai-memory-status` | Health check and database stats |

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
ai-memory config list                          # Show all settings
ai-memory config set extraction_interval 20    # Change a value
ai-memory config set extraction_interval 0     # Disable L2 (LLM) entirely
```

| Key | Default | Description |
|-----|---------|-------------|
| `extraction_interval` | `10` | Turns between L2 (LLM) extractions. `0` = L2 disabled |
| `token_budget` | `400` | Total tokens injected at session start |
| `core_budget` | `200` | Tokens reserved for top-scored memories (always injected) |
| `tune_threshold` | `500` | New events before auto-tune triggers. `0` = auto-tune disabled |

Stored at `~/.ai-memory/config.json`.

---

## Two-Layer Architecture

### Layer 1 — Deterministic (always active)

Runs every turn with zero LLM cost:
- Captures raw turns → FTS5-indexed for search
- Classifies via regex/keyword patterns → memory type + confidence
- Deduplicates via content hash and FTS5 near-matching
- Links related entries with confidence scores
- Scores via Hebbian reinforcement (repetition × recency)

**L1 is fully self-sufficient.** It produces useful, queryable memory without any LLM.

### Layer 2 — LLM (optional)

Fires every N turns (configurable) when the IDE's LLM is available:
- Extracts semantic insights L1 missed
- Upgrades L1 entries with better types and confidence
- Detects semantic relationships (contradictions, refinements)

**Set `extraction_interval` to `0` to run pure L1.**

### Memory Types

| Type | Example |
|------|---------|
| `decision` | "We chose PostgreSQL for the user service" |
| `preference` | "I prefer functional components over classes" |
| `correction` | "Don't use `any` for return types" |
| `pattern` | "Always validate input at the API boundary" |
| `learning` | "FTS5 requires content sync on insert" |
| `fact` | "The API runs on port 3000" |

### Memory Links

Entries are connected through typed links with confidence scores:

| Link Type | Created By | Meaning |
|-----------|-----------|---------|
| `related` | L1 (keyword overlap) | Same topic, co-relevant |
| `supports` | L1 / L2 | Confirms or reinforces |
| `contradicts` | L1 (negation) / L2 | Potentially conflicting |
| `refines` | L2 | More specific version |
| `supersedes` | L2 only | Replaces an older entry |

L1 follows a **"describe, don't assume"** philosophy — it links with confidence but never makes destructive judgments. Supersession is L2's job.

---

## Pattern Tuning

ai-memory auto-tunes its classifier patterns based on your real usage:

```bash
ai-memory tune-patterns              # Manual tune with report
ai-memory tune-patterns --auto       # Silent tune (update config only)
```

Computes precision, recall, and F1 for each pattern against your captured data. Auto-retires underperformers and promotes strong candidates.

Auto-tuning triggers in the background when your corpus grows by `tune_threshold` events (configurable, default 500). Set to `0` to disable.

---

## CLI Reference

```
ai-memory init [--ide cursor|claude-code]        Initialize ai-memory
ai-memory status [--json]                        Database health and stats
ai-memory query <text> [options]                 Search memories
ai-memory capture <text> --type <type> [options] Store a memory
ai-memory events [options]                       List captured events
ai-memory sweep [--workspace <ws>] [--json]      Run maintenance
ai-memory config get|set|list                    Manage configuration
ai-memory tune-patterns [--auto] [--threshold N] Tune classifier patterns
ai-memory migrate memory-md --scope machine|project  Import MEMORY.md
```

---

## Data Storage

Everything local:

| What | Where |
|------|-------|
| Database | `~/.ai-memory/services/memory.db` |
| Configuration | `~/.ai-memory/config.json` |
| Classifier patterns | `~/.ai-memory/classifier-patterns.json` |

Override the database path with `AI_MEMORY_DB_PATH` environment variable.

---

## Development

```bash
npm run build     # TypeScript → dist/
npm test          # Run all 170 tests
```

### Project Structure

```
src/
├── cli.ts                            CLI entry point
├── app.ts                            Application context (wires all services)
├── types.ts                          Core types
├── db/                               SQLite schema and connection
├── stores/                           Data access (thin, no business logic)
├── services/                         Business logic (the engine)
│   ├── capture-service.ts            Event ingestion and storage
│   ├── config-service.ts             Configuration management
│   ├── deterministic-classifier.ts   Regex/keyword classification
│   ├── hebbian-matcher.ts            Dedup, matching, overlap, L2 capture
│   ├── maintenance-service.ts        Decay, dedup, promotion, staleness
│   ├── migration-service.ts          Import/Export and schema migration
│   ├── retrieval-service.ts          FTS5 query, rank, graph expand, budget
│   ├── scoring-service.ts            Score computation
│   ├── status-service.ts             Health check and stats
│   └── tune-patterns.ts              Pattern evaluation and tuning
├── hooks/                            IDE integration (sessionStart, stop, sessionEnd)
├── mcp/                              MCP tool handlers (thin adapter)
└── utils/                            Pure utilities (hash, tokens, time)
```

---

## Design Philosophy

1. **Deterministic first** — L1 is fully functional without LLM. LLM enhances, never gates
2. **Describe, don't assume** — L1 describes relationships, lets the LLM interpret
3. **Hebbian reinforcement** — what you mention often matters most
4. **Local and private** — your memory stays on your machine
5. **Thin adapters** — CLI and MCP are translation layers. All logic lives in services
6. **Self-tuning** — the system gets better at understanding you over time

---

## License

ISC
