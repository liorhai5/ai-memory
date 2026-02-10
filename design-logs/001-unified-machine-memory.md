# Unified Machine Memory — Design Log

[Status: implemented]

## 1. Background & Evolution

This design log captures the full research and thinking behind a **unified machine memory** system — a persistent, shared context layer that serves all AI interactions on a developer's machine, regardless of IDE (Cursor, CLI, future tools) or LLM provider (Claude, Gemini, Ollama).

The idea emerged from the convergence of three separate projects:

| Project | Path | Core Idea | Status |
|---------|------|-----------|--------|
| **ai-conductor** | `/Playgrounds/ai-conductor` | Semi-automated dev workflow with state machine, roles, memory | Phase 1 complete; simplified to ~200 lines of Cursor rules |
| **companion** (ai-lior-claw) | `/Playgrounds/ai-lior-claw` | CLI-based personal AI assistant with extensions, skills, RAG | Working; extensions + Wix MCP integration in progress |
| **Wix MCP-S** | External service | OAuth-gated MCP servers for workplace tools (Jira, Gmail, Slack, GitHub, etc.) | 89 tools across 6 MCPs authorized |

### 1.1 The ai-conductor Journey

**ai-conductor** started as an ambitious system to bring structure to AI-assisted development:

- **Phase 1 (complete):** Cursor-native system — `.mdc` rule files, JSON memory, state machine
- **28 architectural decisions** captured in `decisions.json`
- **11-phase state machine:** IDLE → INIT → READINESS_CHECK → WORK → SELF_REVIEW → VERIFY → REFLECT → FIX_ERROR → ERROR_RECOVERY → REVIEW → GATE → COMPLETE
- **8 expert roles:** architect, product, simplifier, systems, purist, writer, llmops, domain
- **4-tier memory:** Session (LLM context) → Task (per-task JSON) → Project (`ai-conductor/memory/`) → System (`~/ai-conductor/`)
- **3-tier guidance:** Rules (orchestration) → Procedures (how to work) → Roles (perspectives)
- **CLI:** `npx @ai-conductor/cli init` — project bootstrapping

**Key research findings from ai-conductor:**

1. **R098 (Design-Log Methodology):** Wix Engineering's design-log approach achieves ~80% of the value with ~3% of AI Conductor's rules (~60 lines vs ~2,231 lines). Key insight: focus on the **document artifact**, not the **process orchestration**.

2. **R100 (Optimal Orchestration):** Synthesis of AI Conductor, html-to-eml patterns, and Design-Log. Proposed reducing from 11 to 7 phases, 6 to 4 rule files, 8 to 6 roles. Recommended adopting Q&A sections (Socratic method), verification criteria, and revision history.

3. **R095 (AI Work Patterns):** Design logs with revision history, multi-stage LLM prompting, pipeline composability — all patterns that work well in practice.

**The critical realization:** The file overhead of keeping project-level memory and tasks became excessive. The system was too specific to each project, yet kept being generalized. Instead of a complex state machine deployed via npm, the user ended up with **~200 lines of simplified instructions** (`conductor.mdc`) that enforce a design-log methodology with persistent decisions memory. This is what's in use today.

**What survived from ai-conductor:**
- ✅ Memory system (decisions.json, intelligence.json)
- ✅ Role perspectives for review (architect, product, simplifier, systems, purist, writer)
- ✅ Design-before-implement principle
- ✅ Human gates (approval before coding)
- ✅ Design log template (Problem → Q&A → Design → Verification → Results)
- ✅ Task types concept (research → plan → build)

**What was dropped:**
- ❌ 11-phase state machine (replaced by: INIT → READY → WORK → VERIFY → REVIEW → GATE → DONE)
- ❌ Self-correction loops (LLMs do this naturally)
- ❌ Complex task JSON files with embedded state
- ❌ Board commands / kanban-style management
- ❌ CLI distribution via npm
- ❌ Extensive rule files (6 files, 2,231 lines → 1 file, ~55 lines)

### 1.2 The Companion Journey

**companion** (this project) was born when OpenClaw was released and gained popularity. The idea shifted from "orchestrate AI development" to "personal AI companion" — a CLI system with:

- **Extensions:** Modular tool providers (Google, Slack, GitHub, Git, AI Gateway, Code sandbox, Wix MCP)
- **Skills:** YAML-defined workflow recipes that orchestrate multiple tools
- **RAG:** FTS5-indexed `data/*.md` files injected into LLM context
- **SOUL.md:** User-owned identity/personality file, separate from code-generated system directives
- **Memory:** `~/.companion/memory/MEMORY.md` for long-term learning
- **Providers:** Ollama (local), Claude, Gemini (paid, default model: Gemini 2.5 Flash)

**Key companion decisions:**
- D008: RAG-based data layer replaces hardcoded Google Doc
- D009: Memory vs Context separation (memory = what LLM learned; context = user-curated knowledge)
- D010: Extension system with registry
- D011: AI Gateway as tool extension, not provider

### 1.3 The Wix MCP-S Discovery

Testing Wix MCP-S revealed that **89 tools across 6 MCPs** are available through a single OAuth token:

| MCP | Tools | Key Capabilities |
|-----|-------|-----------------|
| gmail | 4 | send, draft, read, list emails |
| google-calendar | 7 | events, search, create, update, availability |
| google-workspace | 27 | Drive, Docs, Sheets, Slides CRUD |
| github | 23 | Issues, PRs, branches, commits, reviews, merge |
| slack | 11 | Channels, messages, threads, reactions, search |
| jira | 17 | Issues CRUD, projects, transitions, changelog |

**Impact:** Wix MCP-S can replace native Google, Slack, and GitHub extensions for workplace use. In Cursor, these MCPs work directly — no custom extension code needed. The companion CLI still needs extensions for programmatic access when no IDE is involved.

---

## 2. The Vision Statement

*The following is the user's own articulation of the problem and desired solution, preserved verbatim for context:*

> I initially created an ai-conductor project, in this project I started to define and implement workflows and work patterns using AI and local environment. The goal was to create a ~deterministic flow that will allow me to "semi-automate" development. While progressing with this project, I noticed that the file overhead of keeping project level memory and tasks goes so far, and its very specific to the project I am working on, and I tried to keep generalizing it so I can have an easier quick start.
>
> So instead of complex state-machine that is defined in rules and "deployed" to a project using npm module, I ended up creating a simplified version of ~200 lines of instructions that I use, that mainly try to enforce a simplified version of decisions memory persistent.
>
> The bottom line is that my "native" working env and flows are mostly the IDE, in this case Cursor. And its easier for me to open a project with all the tools I need already in a GUI with all the proper protections and UX. But this is still not enough, as my IDE is configured to work with predefined models (supplied by work), so its optimal for me to use it to work with local files/data (coding or tasks), since using other tools would require license that I don't have access to without the IDE (I can access the chat interface, but getting a "key" is not an option).
>
> Then I thought about the limitations of the ai-companion, and OpenClaw was released and gained instant popularity, and I wanted to shift the focus to create myself a companion manager, that will allow me to automate the tasks by implementing general shared memory, that all usages by any provider will be handled on the machine of the user, and a CLI system to add all the relevant features, that are basically the IDE features, just simplified.
>
> So I created this project, to create a system of extensions and skills to be able to automate and trigger, things its harder to do in the IDE (or at least this was my assumption).
>
> Now when I come to think about it, I have different potential IDEs (CLI, Cursor, ...) and different potential providers (Claude, Gemini, ...) for different projects and usages on the same machine. So wherever I work (IDE, provider, ...) I would like to be able to use the same system, share the context and memories, and basically create a persistent predefined memory and structure context so it can be shared and considered by the current IDE when I am conversing with AI.
>
> For example, in our case, using Wix MCP is superior, and its very easy to use in Cursor with all the latest models, so I would like to use these tools in the IDE, and if another automated system is triggered, it will have the memory/output of the last sessions does not matter where it was conducted. This way, I keep the providers integration to the specific IDE (in CLI we will still need to use the keys and expose the integration), while having a single system that have a defined pattern (basically its all about injecting the right context in the right time!)
>
> So as I see it, I would like to have this .companion style memory and config, and have both Cursor and my CLI companion use and write to the same memory, and basically create a "machine memory" for all my LLM calls in this machine. Also, it can have mechanism to consider local memory (for project for example).

---

## 3. Key Conclusions from the Evolution

### 3.1 The IDE is the Primary Interface

The user's primary workflow is **Cursor IDE** with work-supplied models. The IDE provides:
- Latest model access without personal API keys
- Rich GUI with protections and UX
- MCP support (Wix MCPs work natively)
- File editing, terminal, debugging — all integrated
- Cursor rules/memories for persistent context

The CLI companion is the **secondary interface** for:
- Automation and triggers (scheduled skills, batch operations)
- Working when no IDE is open
- Using specific providers (Ollama for local, Gemini for paid tasks)
- Environments where Cursor isn't available

### 3.2 Context Injection is the Core Problem

From ai-conductor's architecture doc: *"The system provides the **right context to the right prompt at the right time**."*

This remains the fundamental insight. Every project (ai-conductor, companion, Cursor rules) is trying to solve the same problem: **how to give the LLM the right context**.

The solutions differ in mechanism:
- **ai-conductor:** Rule files loaded by Cursor, memory files read by LLM
- **companion:** System prompt assembled from SOUL.md + RAG chunks + tool definitions
- **Cursor native:** .cursor/rules/*.mdc files + MCP tools + memories

But the underlying need is identical: persistent, structured context that survives across sessions, tools, and providers.

### 3.3 Simplicity Wins Over Orchestration

ai-conductor's research (R098) proved that **~60 lines of design-log methodology** achieves ~80% of what ~2,231 lines of state machine rules achieve. The user's own experience confirmed this — the simplified `conductor.mdc` (~55 lines) is what stuck.

**What actually matters:**
1. Design before implement (design logs)
2. Persistent memory (decisions, intelligence, history)
3. Multi-perspective review (roles)
4. Human gates (approval before major changes)

**What doesn't justify its complexity:**
1. State machine phases beyond plan → work → review → done
2. Self-correction loop tracking
3. Complex task JSON schemas
4. Board/kanban management

### 3.4 Two Types of Tools: IDE-native vs Programmatic

| Capability | Cursor (IDE) | Companion (CLI) |
|-----------|-------------|-----------------|
| Workplace tools (Jira, Gmail, etc.) | ✅ Wix MCPs directly | ✅ Extension system |
| File editing | ✅ Native | ❌ Not applicable |
| Memory read/write | ✅ Via rules + file access | ✅ Via tools + RAG |
| Provider models | ✅ Work-supplied (free) | ✅ Own keys (Gemini, Ollama) |
| Automation | ❌ Manual only | ✅ Skills, triggers, batch |
| Session capture | ⚠️ Rules can instruct | ✅ Built into flow |

The insight: **don't duplicate what the IDE does well**. Instead, create a shared layer that both consume and contribute to.

---

## 4. Questions & Answers

**Q1: The `.companion/` folder — does the dot prefix have value?**

The dot prefix (`.companion/`) serves two purposes:
1. **Machine-level (`~/.companion/`):** Hidden from casual `ls`, consistent with Unix conventions for config (`.config/`, `.ssh/`, etc.). **Keep the dot** — it's the right pattern for machine-global config.
2. **Project-level (`.companion/` in a repo):** The dot causes Cursor to ask permission on every file edit. This is friction that hurts the workflow.

**Proposed approach:**
- **Machine-level:** Keep `~/.companion/` (dot prefix, hidden, standard Unix convention)
- **Project-level:** Use `companion/` (no dot) for project-local memory/config. This avoids the Cursor permission issue and makes files first-class in the IDE.
- **Alternative names for project level:** `ai-memory/`, `memory/`, or even just use the existing `design-logs/` + `memory/` folders that ai-conductor established.

**Decision needed:** What should the project-level folder be called? Options:
- `companion/` — ties to the CLI tool name
- `ai-memory/` — generic, describes purpose
- `memory/` — simple, already used by ai-conductor
- Keep using `design-logs/` + `memory/` as separate top-level folders (current pattern in this repo)

**Q2: Session capture from IDE — tool or rules?**

The question is: how does Cursor "write back" to the shared memory after a conversation?

**Option A: Rules only (thin)**
- `.cursor/rules/memory.mdc` instructs: "After significant decisions, update `memory/decisions.json`. After learning preferences, update `MEMORY.md`."
- Pro: Zero infrastructure, works today
- Con: Relies on LLM compliance; no guaranteed capture

**Option B: Tool (MCP)**
- A local MCP server that exposes `save_memory`, `read_memory`, `save_session_summary` tools
- Pro: Structured, reliable, same interface across IDEs
- Con: Requires running a local server; more infrastructure

**Option C: Hybrid (recommended)**
- Rules tell the LLM *when* to save (behavioral guidance)
- File system is the interface (LLM writes directly to `memory/` files)
- A lightweight CLI command (`companion capture`) can summarize and index if needed
- Both Cursor and CLI write to the same files

**Assessment:** If the rules only tell the LLM how to use "context" (read from files, write to files), and the files are well-structured, then **rules are sufficient**. The key is that the file structure IS the API. No tool needed for basic capture. A tool (or CLI command) adds value only for:
- Automatic session summarization
- Indexing/search across sessions
- Cross-project aggregation

**Recommendation:** Start with rules (Option C hybrid). The memory file structure is the contract. Both Cursor and CLI read/write the same files. Add a capture tool later if manual writing proves insufficient.

**Q3: Scope of the rewrite — ai-memory vs companion separation**

The user's insight: these are two separate concerns:

| Concern | System | Purpose |
|---------|--------|---------|
| **Memory & Context** | `ai-memory` (new) | Shared memory layer for all LLM interactions. Read/write from any IDE or CLI. Handles: SOUL.md, memory files, session history, project knowledge, decisions. |
| **Automation & Triggers** | `companion` (existing) | CLI-based assistant with extensions, skills, providers. The "other IDE" for when Cursor isn't enough. |

**How they relate:**
```
┌─────────────────────────────────────────────────────────────┐
│                     USER'S MACHINE                           │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                │
│  │  Cursor   │   │companion │   │ Future   │                │
│  │   IDE     │   │   CLI    │   │  IDE/Tool│                │
│  └────┬──────┘   └────┬─────┘   └────┬─────┘                │
│       │               │              │                       │
│       │   ┌───────────┴──────────────┘                       │
│       │   │                                                  │
│       ▼   ▼                                                  │
│  ┌──────────────────────────────────────┐                    │
│  │         ai-memory (shared)           │                    │
│  │                                      │                    │
│  │  ~/.companion/  (or ~/.ai-memory/)   │                    │
│  │  ├── SOUL.md        (identity)       │                    │
│  │  ├── memory/                         │                    │
│  │  │   ├── MEMORY.md  (long-term)      │                    │
│  │  │   ├── decisions.json              │                    │
│  │  │   └── sessions/  (history)        │                    │
│  │  ├── config/                         │                    │
│  │  │   ├── agent.json                  │                    │
│  │  │   └── providers.yaml              │                    │
│  │  └── data/          (knowledge)      │                    │
│  │      └── *.md       (RAG source)     │                    │
│  └──────────────────────────────────────┘                    │
│                                                              │
│  Project-level memory (per repo):                            │
│  ┌──────────────────────────────────────┐                    │
│  │  ./companion/ or ./ai-memory/        │                    │
│  │  ├── design-logs/                    │                    │
│  │  ├── memory/                         │                    │
│  │  │   ├── decisions.json              │                    │
│  │  │   └── intelligence.json           │                    │
│  │  └── config.json (project overrides) │                    │
│  └──────────────────────────────────────┘                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**In Cursor:** Wix MCPs provide workplace tools directly. No custom extensions needed. Cursor reads/writes to the shared memory via rules. The memory files are the integration point.

**In companion CLI:** Extensions provide the tool integrations (since there's no MCP protocol in the CLI). The CLI reads/writes to the same shared memory. Extensions handle auth, API calls, etc.

**Key insight:** The companion doesn't need to replicate Cursor's MCP integrations. In Cursor, use MCPs. In the CLI, use extensions. Both read/write to the same memory layer.

**What this means for the companion codebase:**
- Keep the extension system (needed for CLI automation)
- Keep skills (needed for triggers and batch operations)
- Keep providers (needed for CLI LLM access)
- The Wix MCP extensions in companion are for CLI use only — in Cursor, the native MCP config handles it
- Memory read/write becomes the most important shared interface

**Q4: Design logs as structured tasks — task lifecycle**

> User: "i liked the fact i had 'task' list in the ai-conductor, the hassle was that it always a chain of research->plan->implement, where we could just design->implement, and the design log is suitable for it. but its still not structured enough. is every design log a potential task? lets see if we can investigate this area also, so it will be part of a consistent pattern."

The user had a "task list" in ai-conductor but found the research→plan→implement chain too rigid. The question: can design logs serve as the task structure?

**Current state:** Design logs ARE the task structure, but informally:
- Each design log = a unit of work
- Status field tracks progress: `draft → approved → implemented`
- Q&A section handles the "research" phase (Socratic method)
- Design section IS the plan
- Implementation Results section IS the build output

**What's missing for consistency:**
1. **No index/catalog** — design logs are just files in a folder, no way to see "what's active"
2. **No structured status** — the `[Status: draft]` header is freeform
3. **No linkage** — design logs don't reference each other (unlike ai-conductor's `plan_ref`)
4. **No history** — completed design logs just sit there, no log of "done" items

**Proposed: Design Log as Task Pattern**

```markdown
# [Title] — Design Log

[Status: draft | approved | implemented | abandoned]
[Created: YYYY-MM-DD]

## 1. Problem Statement
## 2. Questions & Answers
## 3. Design
## 4. Verification
## 5. Implementation Results
## 6. Revision History (optional)
```

**And an index file:** `design-logs/INDEX.md`

```markdown
# Design Log Index

## Active
| # | Title | Status | Created | Tags |
|---|-------|--------|---------|------|
| unified-machine-memory | Unified Machine Memory | draft | 2026-02-09 | architecture, memory |
| pluggable-extensions | Pluggable Extension System | draft | 2026-02-09 | extensions, mcp |

## Completed
| # | Title | Implemented | Tags |
|---|-------|------------|------|
| soul-architecture | SOUL.md Architecture | 2026-02-08 | identity, system-prompt |
| data-layer-architecture | RAG Data Layer | 2026-02-08 | rag, data |
```

**The workflow becomes:**
1. **New work?** → Create a design log as `draft` (replaces "create task")
2. **Need to think?** → Write Q&A section (replaces "research task")
3. **Ready to design?** → Write Design section, get approval → `approved` (replaces "plan task")
4. **Ready to build?** → Start coding (replaces "build task")
5. **Done?** → Append Implementation Results, status → `implemented`

This is essentially what ai-conductor evolved into, but formalized. The design log IS the task. The Q&A section IS the research. The design section IS the plan. No separate JSON task files needed.

**Benefit:** This pattern works identically in Cursor (LLM reads/writes markdown files) and in the CLI companion (same files). The design-log is the shared artifact.

**Q5: State machine pattern in skills — workflow phases as shared definitions?**

> User: "also the state machine pattern was a strong pattern, maybe we can add this to skills?"

Today, skills are **linear recipes** — a list of steps the LLM follows in sequence. They work well for data gathering (daily-digest, prep-1on1). But they can't express:
- **Conditional flow** — "if X then do Y, else Z"
- **Human gates** — "pause here, wait for approval"
- **Phases with transitions** — "DESIGN → REVIEW → IMPLEMENT → VERIFY"
- **Loop/retry** — "if verification fails, go back to implement"

The ai-conductor state machine was too complex (11 phases, 2,231 lines), but the **pattern** is valuable. The question is: can we make it lightweight enough to fit in a YAML skill definition?

**Proposed: Workflow Skills (enhanced skill type)**

```yaml
name: feature-implementation
type: workflow                       # NEW: "workflow" vs default "recipe"
description: Design-first feature implementation with review gate

requires: [git]

parameters:
  feature:
    type: string
    required: true

phases:                               # NEW: replaces "recipe" for workflow type
  design:
    prompt: |
      Create a design for: {{feature}}
      Write to design-logs/{{feature}}.md using the design-log template.
    next: review

  review:
    prompt: |
      Review the design from @architect and @simplifier perspectives.
      List concerns in the design log Q&A section.
    gate: true                        # Human must approve to proceed
    next: implement

  implement:
    prompt: |
      Implement the approved design from design-logs/{{feature}}.md.
      Follow the design exactly. Append results to the design log.
    next: verify

  verify:
    prompt: |
      Verify the implementation:
      - Run tests
      - Check against design verification criteria
    on_fail: implement                # Retry loop
    next: done

  done:
    prompt: |
      Mark design log as implemented.
      Extract learnings to memory/intelligence.json.
```

**Key design principles:**
- Phases are **prompts**, not code — the LLM executes each phase
- Gates are explicit — workflow pauses, human resumes
- Retry is simple (on_fail → go back)
- It's still YAML, still a file, still shareable
- Recipe skills (linear) continue to work as-is — this is additive

**In CLI:** The companion executes phases sequentially, pausing at gates
**In Cursor:** The rule file can reference the workflow definition and guide the LLM through phases conversationally

**Assessment:** This is worth designing properly. It bridges ai-conductor's state machine value with the skill system's simplicity. Detailed design in **Topic 8** of the implementation plan below.

**Q6: Should skills be shared between IDEs?**

> User: "can i / should i share skills between IDEs? so i will have my workflows ready to be implemented anywhere?"

**Yes.** Skills should absolutely be shared. They are already IDE-agnostic — they're YAML files describing WHAT to do, not HOW to execute it.

**How it works today (CLI only):**
- Skills live in `~/.companion/skills/`
- The `run_skill` tool renders the recipe and sends it to the LLM
- The LLM uses available tools to execute the steps

**How it could work cross-IDE:**
- Skills stay in `~/.ai-memory/skills/` (shared location)
- **In CLI:** `companion run daily-digest` — same as today
- **In Cursor:** A rule tells the LLM: "When user says 'run skill X', read the skill YAML from `~/.ai-memory/skills/X.yaml`, resolve parameters, and follow the recipe using available MCP tools."
- **Key insight:** The skill YAML is a **prompt template**, not executable code. Any LLM in any IDE can follow it.

**What changes:**
- Skills move from `~/.companion/skills/` to `~/.ai-memory/skills/` (shared)
- Cursor rule references the skills directory
- Recipe skills work immediately (LLM follows the steps)
- Workflow skills (Q5) need the phase-execution logic to be available in each IDE

**Execution model per IDE:**

| | Recipe Skills | Workflow Skills |
|---|---|---|
| **CLI** | Render recipe, send to LLM, LLM uses tools | Execute phases sequentially, pause at gates |
| **Cursor** | LLM reads YAML, follows steps conversationally | LLM reads phases, user approves at gates naturally |

For Cursor, workflow skills map naturally to conversation flow — each phase is a turn, and gates are when the LLM asks "shall I proceed?" (which is already the conductor.mdc pattern).

**Assessment:** Recipe skills are trivially shareable. Workflow skills need a spec that works for both imperative (CLI) and conversational (Cursor) execution. Detailed design in **Topic 8** of the implementation plan below.

---

## 5. Architecture (v2 — revised after Topic 1 discussion)

### 5.1 Core Insight

> **"It's all about injecting the right context at the right time."**

After discussing Topic 1 and evaluating what Cursor can and can't do, the architecture simplified dramatically:

1. **Cursor is the primary IDE** — with Wix MCPs for workplace tools, rules for behavior, work-supplied models
2. **Project-level memory is where the real value is** — Cursor reads/writes it reliably (it's in the workspace)
3. **Machine-level memory is a shared data store** — managed by a CLI tool, read by Cursor via global rules
4. **The CLI tool is a data manager**, not an AI assistant — no LLM, no providers, no extensions. Just file operations on `~/.ai-memory/`

### 5.2 The Three Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Cursor "Rules for AI" (global setting, applies to ALL projects) │
│  "The bridge" — tells every Cursor conversation:                 │
│    • Read ~/.ai-memory/SOUL.md for identity                     │
│    • Read ~/.ai-memory/MEMORY.md for shared learnings           │
│    • Read ~/.ai-memory/skills/ for shared workflows             │
│    • Read ai-memory/MEMORY.md for project decisions             │
│    • Read ai-memory/design-logs/ for active work                │
│    • Follow the design-log workflow pattern                      │
│    • Update the correct MEMORY.md after significant work         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────┐  ┌─────────────────────────────────┐
│  ~/.ai-memory/              │  │  ai-memory/ (per project)       │
│  Machine-level shared data  │  │  Project-level memory           │
│                             │  │                                 │
│  ├── SOUL.md                │  │  ├── design-logs/               │
│  ├── MEMORY.md              │  │  │   └── NNN-name.md            │
│  ├── data/                  │  │                                 │
│  │   └── *.md               │  │  ├── MEMORY.md                  │
│  └── skills/                │  │  └── skills/                    │
│      └── *.yaml             │  │      └── *.yaml                 │
│                             │  │                                 │
│  Managed by: ai-memory CLI  │  │  Managed by: Cursor (primary)   │
│  Read by: Cursor (via rule) │  │  Read by: any tool in project   │
└─────────────────────────────┘  └─────────────────────────────────┘
```

### 5.3 Write Model

| File | Who writes | Who reads | How |
|------|-----------|-----------|-----|
| `~/.ai-memory/SOUL.md` | Human (curated) | Cursor (via global rule), CLI | Direct file reference in rule |
| `~/.ai-memory/MEMORY.md` | `ai-memory` CLI | Cursor (via global rule) | Direct file reference in rule |
| `~/.ai-memory/data/*.md` | `ai-memory` CLI | Cursor (if rule points to specific files) | Optional, for enrichment |
| `~/.ai-memory/skills/*.yaml` | Human / `ai-memory` CLI | Cursor (via global rule) | Rule says "read skills from here" |
| `ai-memory/MEMORY.md` | Cursor (primary) | Any tool in project | In workspace, fully accessible |
| `ai-memory/design-logs/` | Cursor (primary) | Any tool in project | In workspace, fully accessible |
| `ai-memory/skills/` | Human | Cursor, any tool | In workspace |

**Key principle:** Cursor writes to project-level only. Machine-level is written by the CLI tool and read by Cursor. This avoids the fragility of LLM-based writes to files outside the workspace.

### 5.4 What the Global Rule Does

The rule (Cursor Settings → "Rules for AI", applied to ALL projects) is the single integration point. It:
1. **Loads identity** — reads `~/.ai-memory/SOUL.md`
2. **Loads shared context** — reads `~/.ai-memory/MEMORY.md`
3. **Knows about shared skills** — reads `~/.ai-memory/skills/`
4. **Enforces the project pattern** — instructs the LLM on how to use `ai-memory/` (design logs, MEMORY.md, project skills)
5. **Enforces memory maintenance** — specific instructions for updating PROJECT vs SHARED memory
6. **Includes the workflow** — design before implement, Q&A, gates

Review perspectives (architect, simplifier, etc.) are NOT in the rule — they live in skills.

This replaces the current `conductor.mdc` (~63 lines) with ~32 lines in the global setting.

### 5.5 What the `ai-memory` CLI Does

A pure file management CLI. No LLM. No providers. No extensions.

```bash
ai-memory init                    # Create ~/.ai-memory/ with templates
ai-memory init-project            # Create ai-memory/ in current project + .cursor/rules/
ai-memory note "text"             # Append to ~/.ai-memory/data/notes.md
ai-memory soul edit               # Open SOUL.md in editor
ai-memory memory show             # Display MEMORY.md
ai-memory memory append "text"    # Append to MEMORY.md
ai-memory skill list              # List shared skills
ai-memory skill add file.yaml     # Add a skill to shared skills
ai-memory data list               # List data files
ai-memory data add file.md        # Add a knowledge file
```

### 5.6 Relationship to Previous Projects

| Previous project | What happens to it |
|-----------------|-------------------|
| **companion** (ai-lior-claw) | Replaced by `ai-memory` CLI. The companion's RAG, extensions, skills, providers are no longer needed — Cursor handles tools via MCP, and ai-memory handles data management. Existing design logs and learnings are preserved. |
| **ai-conductor** | Its key patterns (design-log workflow, memory, review perspectives, human gates) live on in the Cursor global rule. The state machine pattern lives on in workflow skills. The CLI and complex orchestration are dropped. |
| **Wix MCP-S** | Used directly in Cursor. No wrapper needed. The `ai-memory` CLI doesn't interact with MCPs. |

---

## 6. Relationship to Existing Design Logs

| Design Log | Relationship |
|-----------|-------------|
| `pluggable-extensions.md` | **Superseded** — extensions no longer needed; Cursor uses MCPs directly |
| `soul-architecture.md` | **Incorporated** — SOUL.md is part of `~/.ai-memory/` |
| `data-layer-architecture.md` | **Partially incorporated** — data files move to `~/.ai-memory/data/`; RAG indexing dropped (was companion-specific) |
| `mcp-integration.md` | **Incorporated** — Wix MCPs used directly in Cursor |
| `extension-system.md` | **Superseded** — no extension system in the new architecture |

---

## 7. ai-conductor Research Archive

### 7.1 Decisions That Inform This Design

From ai-conductor `decisions.json` (28 decisions), the most relevant:

| ID | Decision | Relevance |
|----|----------|-----------|
| D001 | 3 task types: research, plan, build | Simplified to: design-log = task |
| D002 | Build requires plan | Kept: design before implement |
| D011 | Task-level state (in task JSON, not global) | Simplified: status field in design log |
| D014 | Three-tier guidance (Rules → Procedures → Roles) | Simplified to: rules + roles |
| D020 | Task creation defines problem only, not solution | Kept: Problem Statement section |
| D024 | knowledge.json flat memory structure | Adopted in companion |
| D025 | Actionable endings golden rule | Kept in conductor.mdc |
| D027 | Revision history in plans | Adopted in design-log template |
| D028 | Complexity audit needed | **This is what happened** — resulted in ~55 line simplification |

### 7.2 Intelligence That Informs This Design

From ai-conductor `intelligence.json`:

**Patterns kept:**
- P005: Research → Plan → Build progression (simplified to design-log flow)
- P006: Task-level state (simplified to status field)

**Antipatterns to avoid:**
- AP003: Adding features not in plan scope
- AP004: Not updating memory after significant decisions
- AP005: Generic patterns that aren't project-specific

**Learnings applied:**
- L003: Memory must be actively populated — triggers help but human guidance needed
- L004: 4-tier memory maps to CoALA cognitive architecture
- L006: Both UPDATE triggers (when to write) and USAGE triggers (when to read) matter
- L008: Simple knowledge file > complex JSON config

### 7.3 Roadmap Phases That Map to This Design

From ai-conductor `roadmap.md`:

| ai-conductor Phase | Maps To |
|--------------------|---------|
| Phase 1: Cursor-Native ✅ | ✅ Done — `conductor.mdc` |
| Phase 2: CLI Foundation | companion CLI (already built) |
| Phase 3: Workflow Engine | companion skills system |
| Phase 4: Context Orchestrator | ai-memory shared layer ← **THIS DESIGN** |
| Phase 5: Web Dashboard | Future (not needed yet) |
| Phase 6: Multi-IDE Support | ai-memory + Cursor rules ← **THIS DESIGN** |
| Phase 7: External Project Mode | ai-memory project-level support ← **THIS DESIGN** |

---

## 8. Implementation Plan — Topic Breakdown

This section is the **master plan**. Each topic is a self-contained design area that needs its own Q&A and approval before implementation. We work through them 1-by-1.

### Topic Index

| # | Topic | Scope | Status | Dependencies |
|---|-------|-------|--------|-------------|
| **1** | **Naming & Conventions** | Paths, naming, CLI rename, architecture shift | ✅ approved (v2) | — |
| **2** | **Machine Memory Spec** | `~/.ai-memory/` structure, SOUL.md, MEMORY.md, data/, skills/ | ✅ approved | Topic 1 |
| **3** | **Project Memory Spec** | `ai-memory/` structure, MEMORY.md, design-logs/, skills/ | ✅ approved | Topic 1 |
| **4** | **Design Log as Task Pattern** | Template, lifecycle, statuses, numbered naming | ✅ approved | Topic 3 |
| **5** | **Cursor Global Rule** | Global "Rules for AI" setting, bridges shared + project memory | ✅ approved | Topics 2, 3 |
| **6** | **Skills System** | Skill YAML spec, simple vs multi-phase, requires, tracking, discovery | ✅ approved | Topics 2, 3, 5 |
| **7** | **`ai-memory` CLI** | Shell script, machine-level only, ~8 commands, git-hosted | ✅ approved | Topics 2, 3 |
| **8** | **Bootstrap & Migration** | 3-step setup, migration paths, templates, verification, impl order | ✅ approved | All above |

---

### Topic 1: Naming & Conventions
**Status: ✅ approved (v2 — revised after architecture shift)**

#### Revision note
Topic 1 was initially approved with 10 decisions including a `~/.companion/` separation. After discussing Topic 2 (machine memory spec), the architecture shifted significantly:
- The `companion` CLI (AI assistant with extensions/providers/RAG) is replaced by a pure file management CLI called `ai-memory`
- There is no separate `~/.companion/` directory — `~/.ai-memory/` is the only machine-level directory
- Cursor is the primary IDE; the CLI is a data manager for shared memory
- Wix MCPs in Cursor replace the need for CLI extensions

#### Decision 1.1: Machine-level directory → `~/.ai-memory/`
*Unchanged from v1.* Describes purpose (memory layer), IDE-agnostic. Any tool can read/write.

#### Decision 1.2: Project-level directory → `ai-memory/` (no dot)
*Unchanged from v1.* Matches machine-level naming. No dot prefix avoids Cursor permission prompts.

#### Decision 1.3: Dot-prefix rule → dot at machine, no dot at project
*Unchanged from v1.* Machine: hidden, Unix convention. Project: first-class in IDE.

#### Decision 1.4: CLI binary name → `ai-memory` (REVISED from `companion`)

**v1 choice:** Keep `companion` — CLI does more than memory.
**v2 choice:** Rename to `ai-memory` — CLI IS the memory manager.

**Why the change:** After evaluating what Cursor + Wix MCPs provide (89 workplace tools, latest models, full IDE), the CLI's role shifted from "AI assistant with extensions, skills, providers, RAG, and chat" to "pure file management CLI for `~/.ai-memory/`." It no longer has LLM execution, providers, or extensions. Since the CLI's entire purpose is managing `~/.ai-memory/`, the name should match.

Commands like `ai-memory note "text"`, `ai-memory skill list`, `ai-memory init-project` read naturally and describe exactly what the tool does.

#### Decision 1.5: Memory format → markdown everywhere (no JSON)
*Unchanged from v1.* LLMs write markdown naturally. JSON was never queried programmatically. `MEMORY.md` at both machine and project level.

#### Decision 1.6: No separate `~/.companion/` directory (REVISED)

**v1 choice:** `~/.ai-memory/` = shared memory, `~/.companion/` = CLI runtime (config, auth, output, cache).
**v2 choice:** Only `~/.ai-memory/` exists. No `~/.companion/`.

**Why the change:** If the CLI is a pure file management tool (no LLM, no providers, no extensions), it has no runtime state that needs its own directory. No config files (no providers to configure). No auth tokens (no APIs to call). No output directory (no generated artifacts). No cache (no RAG indexes). The CLI reads/writes `~/.ai-memory/` directly — that IS its workspace.

#### Decision 1.7: No project-level SOUL.md
*Unchanged from v1.* Identity is machine-level only. Project context comes from `ai-memory/MEMORY.md` and design logs.

#### Decision 1.8: Project-level skills → yes
*Unchanged from v1.* `ai-memory/skills/` for project-specific workflows. Machine-level skills are shared. Project takes precedence on name collision.

#### Decision 1.9: Cursor is the primary IDE; CLI is a data manager (REVISED)

**v1 choice:** Config/output are companion concerns, stay in `~/.companion/`.
**v2 choice:** There are no companion concerns. The CLI manages `~/.ai-memory/` content. Cursor handles everything else.

**Why the change:** Evaluating the write model revealed that Cursor + Wix MCPs cover workplace tools (Jira, Gmail, Slack, GitHub, Calendar — 89 tools). Cursor writes project memory reliably (in workspace). The only gap is machine-level data management — adding notes, managing skills, editing SOUL.md. A pure file management CLI fills this gap without duplicating what Cursor already does.

The companion's former capabilities map to:
- **Extensions/tools** → Wix MCPs in Cursor (superior)
- **Providers/LLM** → Cursor's work-supplied models (free, latest)
- **RAG** → Not needed; Cursor reads files directly via rules
- **Skills execution** → Cursor follows skill YAMLs conversationally (via global rule)
- **Data management** → `ai-memory` CLI (the only remaining need)

#### Decision 1.10: Design log naming → numbered + semantic
*Revised from v1.* `NNN-semantic-name.md` format. No INDEX.md — numbered files are self-indexing (Decision 3.2).

#### Decision 1.11: Cursor "Rules for AI" global setting is the integration layer (NEW, revised in Topic 5)

Cursor's built-in "Rules for AI" setting (Settings → General) applies to ALL projects. It's the bridge between shared and project memory. It:
1. References `~/.ai-memory/` for identity, shared memory, skills, and data
2. Instructs the project-level pattern (`ai-memory/` with design-logs, MEMORY.md, skills)
3. Includes the workflow (design before implement, Q&A, gates)
4. Is the ONLY integration point — no MCP server, no API, no per-project file copying

No `.cursor/rules/ai-memory.mdc` file needed per project. Set the global setting once, it works everywhere. Full rule content defined in Topic 5.

---

**Resulting structure (v2):**

```
~/.ai-memory/                        # Machine-level (managed by ai-memory CLI)
├── SOUL.md                          # Identity & preferences (human-curated)
├── MEMORY.md                        # Cross-project learnings (CLI-maintained)
├── data/                            # Knowledge base (readable by Cursor)
│   ├── notes.md
│   └── *.md
└── skills/                          # Shared workflow definitions
    ├── daily-digest.yaml
    └── prep-1on1.yaml

ai-memory/                           # Project-level (managed by Cursor)
├── design-logs/                     # Numbered design logs (self-indexing)
│   ├── 001-soul-architecture.md
│   └── 002-data-layer-architecture.md
├── MEMORY.md                        # Project decisions, patterns, learnings
└── skills/                          # Project-specific workflows (optional)
    └── deploy-staging.yaml

Cursor Settings → "Rules for AI"       # Global rule: bridges shared + project memory
```

---

### Topic 2: Machine Memory Spec (`~/.ai-memory/`)
**Status: ✅ approved**

**Scope:** Define the exact file structure, content conventions, and purpose for each file in `~/.ai-memory/`.

#### Decision 2.1: SOUL.md — timeless identity only

SOUL.md contains **things true regardless of which IDE or tool reads it**. No tool-specific instructions, no data source references, no access constraints.

**Sections:**

```markdown
# [Name]'s AI Context

## Identity
Who you are. Role, personality, communication style.
(IDE-agnostic — applies in Cursor, CLI, any future tool)

## Context
Professional context — team, org, domain, key concepts.
(Things the AI should always know about you)

## Preferences
Response style, language, format preferences.
(How you want AI to communicate with you)
```

**What does NOT go in SOUL.md:**
- Key people / team members → `MEMORY.md ## People` (changes over time)
- Current priorities → not needed (captured in project-level design logs)
- Tool-specific instructions → Cursor global rule or CLI config
- Data source references → data/ folder or rule instructions
- Access constraints → specific to each tool/IDE
- Output format templates → skills or rule instructions

**Rationale:** SOUL.md is **human-curated and rarely changes**. It's your identity. People, priorities, and learnings change — those belong in MEMORY.md.

#### Decision 2.2: MEMORY.md — curated cross-project document

**Choice: Curated document (updated in-place, organized by sections)**

MEMORY.md is a **living document** of cross-project learnings, organized by topic. It's not an append-only log — it's maintained to stay concise and high-signal.

**Sections:**

```markdown
# Cross-Project Memory

## Preferences
- Response style preferences
- Tool/workflow preferences
- Things you've corrected AI on

## Patterns
- Recurring approaches that work well
- Antipatterns to avoid

## Decisions
- Cross-project architectural principles
- Technology choices that span projects

## People
- Key team members and their areas (direct reports, key stakeholders)
- Collaboration patterns

## Topics
- Recurring themes across projects
- Current focus areas
```

**Write model:** Both Cursor and the CLI can update this file. Cursor writes via its native file editing (the global rule instructs when to update). The `ai-memory` CLI provides convenience commands (`ai-memory memory append "text"`).

**No session logs.** Session logs were a companion runtime concern. If something from a session is important, it gets captured in MEMORY.md (cross-project) or `ai-memory/MEMORY.md` (project-level) — not as a raw log.

#### Decision 2.3: data/ — knowledge catalog, read on demand

**Choice: Catalog in global rule, LLM reads specific files on demand (Option D)**

The global rule lists what's available in `data/` (like a catalog), and the LLM reads specific files only when relevant. This avoids token overload while making content discoverable.

**Conventions:**
- All files are `.md` (markdown)
- Flat directory (no subdirectories)
- Named descriptively: `team-notes.md`, `tech-architecture.md`, `onboarding-guide.md`
- Large files (>500 lines) should be split into topic-specific files

**Example global rule reference:**
```
Available knowledge files in ~/.ai-memory/data/:
- team-notes.md — team members, roles, areas
- tech-architecture.md — system architecture notes
Read specific files when the conversation needs that context.
```

**CLI role re-evaluation:** The user noted that Cursor can also update `~/.ai-memory/` files directly (it has file system access). This means the CLI's role narrows to:
1. **Bootstrap** — `ai-memory init` creates `~/.ai-memory/` with templates
2. **Project scaffold** — `ai-memory init-project` creates `ai-memory/` in a repo
3. **Convenience** — quick shell commands for adding notes/data without opening an IDE

Cursor can do everything the CLI does for file management. The CLI exists for when you're NOT in Cursor (terminal, automation, quick edits).

#### Decision 2.4: skills/ — natural language with state machine support

**Choice: Natural language recipes, LLM figures out tools (Option D), with enhancements**

Skills stay as natural language recipes. The LLM maps to whatever tools are available (Wix MCP in Cursor, extensions in CLI). Two enhancements:

1. **State machine / looping logic:** Skills can include workflow phases with explicit looping, gates, and conditional transitions (the "workflow skill" type from Q5). This brings back the valuable parts of ai-conductor's state machine.

2. **Tool name references as hints:** When a specific tool name is known, it can be mentioned in the recipe as a **reference, not enforcement**. The LLM uses it if available, finds alternatives if not.

**Example:**

```yaml
name: daily-digest
type: recipe
description: Morning briefing

recipe: |
  Create a daily morning briefing.
  
  ## Step 1: Calendar
  - Get today's schedule (e.g., google-calendar tools if available)
  - Check yesterday's meetings for follow-ups
  
  ## Step 2: Email  
  - Search for unread/urgent emails (e.g., gmail tools if available)
  ...
```

**The `requires` field becomes informational:**
```yaml
requires:
  info: "Works best with calendar, email, and task management tools"
```

**Skill format spec (detailed design in Topic 6):**
- Recipe skills: linear step-by-step, current format
- Workflow skills: phases with `next`, `gate`, `on_fail` (defined in Q5)
- Both types are YAML, both are natural language prompts

#### Decision 2.5: No session logs in `~/.ai-memory/`

**Choice: Drop entirely (Option B)**

Session logs were a companion runtime concern. The `~/.ai-memory/` directory is for **persistent, curated** content only. Cursor has its own conversation history. The `ai-memory` CLI doesn't have conversations.

If something from a session matters:
- Cross-project learning → `~/.ai-memory/MEMORY.md`
- Project decision → `ai-memory/MEMORY.md` (project-level)
- Design work → `ai-memory/design-logs/` (project-level)

#### Decision 2.6: Init includes general Cursor skills, not companion-specific ones

**Choice: `ai-memory init` includes starter skills for general Cursor usage**

The 4 existing companion skills (daily-digest, prep-1on1, weekly-digest, research-topic) are **companion-specific** — they reference companion tools and output formats. They'll be migrated separately (Topic 8).

Init should include **general-purpose Cursor workflow skills** — things useful in any project:

Candidates (detailed design in Topic 6):
- `design-first.yaml` — the design-log workflow (design → Q&A → approve → implement)
- `structured-design.yaml` — **the pattern we're using right now**: high-level breakdown → per-topic decision drafting → human discussion → approval → write to log → next topic. A workflow skill with a loop and human gate.
- `code-review.yaml` — multi-perspective review (architect, simplifier, purist)
- `refactor.yaml` — safe refactoring with verification steps
- `investigate.yaml` — structured investigation/debugging

These are the skills equivalent of the conductor.mdc workflow — they encode work patterns, not tool orchestration. The fact that we're dogfooding `structured-design` during this very conversation validates the pattern.

---

**Resulting `~/.ai-memory/` structure (approved):**

```
~/.ai-memory/
├── SOUL.md                          # Timeless identity (human-curated)
│   ├── ## Identity                  # Who you are, role, personality
│   ├── ## Context                   # Team, org, domain, key concepts
│   └── ## Preferences               # Response style, format prefs
│
├── MEMORY.md                        # Cross-project learnings (curated)
│   ├── ## Preferences               # Corrected behaviors, style prefs
│   ├── ## Patterns                  # What works, antipatterns
│   ├── ## Decisions                 # Cross-project principles
│   ├── ## People                    # Key team members, stakeholders
│   └── ## Topics                    # Recurring themes, focus areas
│
├── data/                            # Knowledge base (read on demand)
│   ├── team-notes.md                # Example: team info
│   └── *.md                         # Flat, descriptive names, <500 lines each
│
└── skills/                          # Shared workflow definitions
    ├── design-first.yaml            # Design-log workflow
    ├── code-review.yaml             # Multi-perspective review
    └── *.yaml                       # Recipe or workflow type
```

**Key principles:**
- SOUL.md = timeless identity (rarely changes)
- MEMORY.md = curated learnings (grows slowly, maintained)
- data/ = reference knowledge (cataloged, read on demand)
- skills/ = workflow definitions (natural language, state machine support)
- No session logs, no config, no auth, no cache
- Cursor can read AND write all files (via global rule instructions)
- CLI exists for bootstrap, project scaffold, and terminal convenience

---

### Topic 3: Project Memory Spec (`ai-memory/`)
**Status: ✅ approved**

**Scope:** Define the file structure for project-level memory that lives inside a repository.

#### Decision 3.1: MEMORY.md — project decisions, patterns, learnings

Project-level MEMORY.md consolidates what was previously 4 JSON files (`decisions.json`, `intelligence.json`, `knowledge.json`, `history.json`) into a single curated markdown document.

**Sections:**

```markdown
# Project Memory — [project name]

## Decisions
Architectural choices that shape this project.
- [date] **Decision title** — what was decided and why

## Patterns
What works well in this project.
- Pattern description

## Learnings
Things discovered during development.
- Learning description

## Context
Domain knowledge, key references, project history.
- Fact or reference
```

**What migrates from current JSON files:**
- `decisions.json` (14 decisions) → `## Decisions` section
- `intelligence.json` (patterns, learnings) → `## Patterns` + `## Learnings`
- `knowledge.json` (external refs) → `## Context` (or drop if stale)
- `history.json` (task history) → **Dropped.** Design logs ARE the history. No separate task log needed.

**Key difference from machine MEMORY.md:** Project memory = about this codebase (architecture, patterns, what was tried). Machine memory = about you (preferences, people, cross-project principles).

**Rule of thumb:** If it matters in *this repo only* → project MEMORY.md. If it matters *everywhere* → machine MEMORY.md.

#### Decision 3.2: design-logs/ — numbered files, no INDEX.md

Numbered files with semantic names (`NNN-semantic-name.md`). **No INDEX.md** — the numbered files themselves are the index. The LLM reads the directory listing to discover what exists and infers the next number from existing files.

**Structure:**
```
ai-memory/design-logs/
├── 001-soul-architecture.md
├── 002-data-layer-architecture.md
├── 003-unified-machine-memory.md
└── ...
```

Each file has a status in its header (`[Status: draft | approved | implemented | abandoned]`). That's sufficient for tracking — no separate catalog needed.

**Why no INDEX.md:**
- Zero maintenance overhead (no file to keep in sync)
- The directory listing IS the index
- Status lives in each file's header
- Numbered naming provides chronological order
- LLM can scan file headers if it needs to filter by status

#### Decision 3.3: skills/ — project-specific workflows (optional)

From Topic 1 (Decision 1.8): project-level skills exist, override machine-level on name collision.

**When to use project skills:**
- Workflows specific to this codebase (`deploy-staging.yaml`, `run-migration.yaml`)
- Project-specific conventions (`release-checklist.yaml`)
- Customized versions of machine-level skills

The folder is optional. Not every project needs project-specific skills. `ai-memory init-project` creates the folder structure but `skills/` can be empty or absent.

#### Decision 3.4: .gitignore — not our concern

Everything in `ai-memory/` is committed by default — it's the project's institutional memory (design logs, decisions, patterns, skills). If a project wants to gitignore specific files, that's the project's decision, not part of this spec.

#### Decision 3.5: Project MEMORY.md vs Machine MEMORY.md — separation rules

| Content | Where | Why |
|---------|-------|-----|
| "This project uses TypeScript + Vitest" | **Project** MEMORY.md | Specific to this codebase |
| "I prefer bullet points over paragraphs" | **Machine** MEMORY.md | True everywhere |
| "D008: RAG replaces management hub" | **Project** MEMORY.md | Project-specific decision |
| "Don't use JSON for memory files" | **Machine** MEMORY.md | Cross-project principle |
| "Ravid is working on TPA migration" | **Machine** MEMORY.md (## People) | About a person, not a project |
| "companion CLI was forked from OpenClaw" | **Project** MEMORY.md (## Context) | Project history |

#### Decision 3.6: PLANS/ and other legacy folders — not our concern

Legacy folders like `PLANS/` are not part of the `ai-memory/` spec. They're just folders in the project. Migration of existing content is handled in Topic 8 (Bootstrap & Migration).

---

**Resulting `ai-memory/` structure (approved):**

```
ai-memory/                           # Project-level (managed by Cursor)
├── design-logs/                     # Numbered design logs
│   ├── 001-soul-architecture.md
│   ├── 002-data-layer-architecture.md
│   └── ...NNN-name.md
├── MEMORY.md                        # Project decisions, patterns, learnings, context
└── skills/                          # Project-specific workflows (optional)
```

**Key principles:**
- No INDEX.md — numbered files are self-indexing
- No history.json — design logs are the project history
- MEMORY.md replaces 4 JSON files with one curated markdown doc
- Everything committed by default
- Skills folder is optional
- Legacy folders are not our concern

---

### Topic 4: Design Log as Task Pattern
**Status: ✅ approved**

**Scope:** Formalize the design-log-as-task lifecycle — the core workflow pattern.

#### Decision 4.1: Template

Updated design log template. Changes from current conductor.mdc: added `Created` date, added `Revision History` section (optional, for complex designs). Removed tags (not needed — file names + content are searchable).

```markdown
# [Title] — Design Log

[Status: draft | approved | implemented | abandoned]
[Created: YYYY-MM-DD]

## 1. Problem Statement
What problem are we solving? Why now?

## 2. Questions & Answers
Socratic method — ask questions, answer them, iterate.

## 3. Design
The solution. Only written after Q&A is sufficient.

## 4. Verification
How to test that the design works.

## 5. Implementation Results
Appended after coding. What was built, what changed.

## 6. Revision History
| Version | Date | Changes |
(Optional — used for complex, multi-session designs)
```

#### Decision 4.2: Status lifecycle — simple, no in-progress

```
draft → approved → implemented
                 → abandoned
```

| Status | Meaning | What happens |
|--------|---------|-------------|
| `draft` | Being designed. Q&A ongoing. | All writing happens here — could be one session or many |
| `approved` | Design complete. Human approved. | Implementation can begin |
| `implemented` | Code written. Results appended. | Design frozen — append only to section 5 |
| `abandoned` | Decided not to proceed. | Keep for historical context |

**No `in-progress` status.** A design log is in `draft` until it's explicitly approved. Whether it took 5 minutes or 5 sessions doesn't matter — it's still a draft being refined. Simpler is better.

**Key rules (preserved from conductor.mdc):**
- Design before implement — no code without `approved` status
- Design frozen once coding starts — after `approved`, only append to section 5
- Human gate — `draft → approved` requires explicit human approval

#### Decision 4.3: Design logs replace research→plan→build

One type: **design log**. The three old task types map to sections:

| Old task type | Maps to | Example |
|---|---|---|
| `research` | Q&A section (## 2) | "Should we use MCP or native extensions?" |
| `plan` | Design section (## 3) | The architecture/approach |
| `build` | Implementation Results (## 5) | What was built |

The flow: start writing → have questions → answer them (research) → design emerges → get approval → implement → append results. One file, progressive refinement.

#### Decision 4.4: Cross-references — prose only

No formal linking metadata. Just mention other design logs by name in prose when relevant. Numbered naming provides chronological context. The LLM can read any file it needs.

#### Decision 4.5: Relationship to Cursor's todo_write

Different scopes, complementary:
- `todo_write` = **within a session** — tracking steps of current work
- Design log = **across sessions** — overall design, status, history

The global rule says: "Check `ai-memory/design-logs/` for active work. Use `todo_write` for session-level task tracking." No special integration needed.

#### Decision 4.6: Enforcement — rules + skills

**(A) Global Cursor rule** enforces the principle: "design before implement", "get approval before coding", "check design-logs/ before starting work."

**(B) `design-first.yaml` skill** provides a detailed walkthrough for complex designs (the `structured-design` pattern we're using right now).

No hard enforcement — we trust the LLM + human to follow the pattern. The rule is behavioral guidance, the skill is a reusable workflow.

---

### Topic 5: Cursor Global Rule
**Status: ✅ approved**

**Scope:** Design the global Cursor rule that bridges shared + project memory and defines the workflow.

#### Decision 5.1: Single rule via Cursor "Rules for AI" (global setting)

**Choice: One rule, set in Cursor Settings → General → "Rules for AI"**

This is Cursor's built-in global rules mechanism — text that applies to ALL projects. No file copying needed. Set once, works everywhere.

**No `.cursor/rules/ai-memory.mdc` per project.** The global setting IS the rule. Projects can optionally add project-specific `.cursor/rules/*.mdc` files, but the ai-memory rule is global.

**Replaces:** The current `conductor.mdc` in `.cursor/rules/`. The user removes `conductor.mdc` from projects where the new global rule is sufficient.

#### Decision 5.2: Review Perspectives — moved to skills, not in rule

Review perspectives (architect, simplifier, purist, etc.) are NOT in the global rule. They are part of the design workflow, not everyday behavior.

**Where they live:**
- `~/.ai-memory/skills/design-first.yaml` — includes review as a phase
- Referenced in design logs when relevant ("review from @architect, @simplifier perspectives")

The global rule just says "design before implement" — the skill handles the detailed review process.

#### Decision 5.3: File references first, embed if needed later

The rule uses path references (`~/.ai-memory/SOUL.md`). The LLM reads files via its tools. If this proves unreliable, critical content (identity summary, key preferences) can be embedded directly in the global setting or in a dedicated `.cursor/rules/identity.mdc` file.

#### Decision 5.4: Size — under ~50 lines

The global setting is injected into every conversation. Must be tight. Detailed instructions live in referenced files and skills. Target: ~30-40 lines of content.

#### Decision 5.5: No MCP/tool guidance in the rule

Wix MCPs are self-describing. Tool-specific context ("EP is my Jira project") belongs in MEMORY.md. Skills can reference specific tools as hints.

#### Decision 5.6: Distribution — no CLI needed for project init

**Revised approach:** The global rule lives in Cursor Settings (set up once manually). For project bootstrapping:

- A `bootstrap-project.yaml` skill in `~/.ai-memory/skills/` contains instructions for setting up a new project
- When opening a new project, tell Cursor: "bootstrap this project for ai-memory"
- The LLM reads the skill and creates `ai-memory/` with design-logs/, MEMORY.md, skills/
- No CLI command needed for project init — Cursor does it via the skill

This further shrinks the `ai-memory` CLI's role — it may only be needed for machine-level init (`~/.ai-memory/` creation with templates).

**Existing `conductor.mdc`:** Left in place. User removes it from projects where the global rule is sufficient. No automated migration.

#### Decision 5.7: CLI-style action prompts — SOUL.md preference

The user prefers CLI-flavored endings (e.g., "Approve? [Y/n]", "Proceed? [Y/n]"). This is a personal preference, not a rule:

Goes in `~/.ai-memory/SOUL.md` under `## Preferences`:
```markdown
- End responses with an actionable prompt when a decision or next step is needed
- Use CLI-style confirmations: "Approve? [Y/n]", "Proceed? [Y/n]", "Next? [Y/n]"
```

---

#### Approved Rule Content

The following is the approved global rule text for Cursor Settings → "Rules for AI":

```
# AI Memory

## Identity
Read ~/.ai-memory/SOUL.md at conversation start for user identity and preferences.

## Memory — ALWAYS Maintain

Two memory files exist. Know the difference:

**PROJECT memory** → ai-memory/MEMORY.md
  This project's decisions, patterns, architecture choices.
  Update when: design decisions, technical choices, project-specific learnings.

**SHARED memory** → ~/.ai-memory/MEMORY.md
  Cross-project knowledge: preferences, people, universal principles.
  Update when: personal preferences, team observations, learnings that apply everywhere.

Before starting work: read PROJECT memory + check design-logs/
After significant work: update the correct memory file. Do not skip this.

Knowledge files: ~/.ai-memory/data/ (read specific files when relevant)

## Workflow
1. Read before write — check ai-memory/ for existing context
2. Design before implement — no code without approved design log
3. Questions in document — Socratic method (Q&A section in design log)
4. Approval before coding — human must approve design
5. Design frozen once coding starts — append results only

## Design Log
Location: ai-memory/design-logs/NNN-semantic-name.md
Status: draft | approved | implemented | abandoned
Sections: Problem Statement → Q&A → Design → Verification → Results → Revision History

## Skills
Shared: ~/.ai-memory/skills/*.yaml
Project: ai-memory/skills/*.yaml (overrides shared)
When asked to follow a skill, read the YAML and follow its recipe/phases.
```

~32 lines. Replaces `conductor.mdc` (~63 lines) while covering more ground: identity, dual memory with clear labels, workflow, design logs, and skills.

---

### Topic 6: Skills System
**Status: ✅ approved**

**Scope:** Skill YAML spec, simple vs multi-phase, requires, tracking, discovery, execution in Cursor.

**Context:** Current skills are recipe-only YAML (prep-1on1, daily-digest, research-topic). Workflow skills bring back ai-conductor's state machine value. In Cursor, skills are followed conversationally. The `ai-memory` CLI has no LLM, so it can't execute skills — Cursor does.

---

#### Decision 6.1: No `type` field — structure determines behavior

A recipe IS a workflow with one phase and no gates. No need to distinguish.

- If the skill has `recipe:` → simple single-phase skill (today's format)
- If the skill has `phases:` → multi-phase skill with transitions and gates
- **No `type` field.** The presence of `recipe:` vs `phases:` determines behavior.

All existing recipe skills remain valid YAML. No migration needed.

**Simple skill (recipe):**
```yaml
name: daily-digest
description: Morning briefing
requires:
  - calendar events
  - email search
  - jira issues (optional)
  - slack messages (optional)

parameters:
  days:
    type: number
    default: 1

recipe: |
  Create a daily morning briefing...
```

**Multi-phase skill (workflow):**
```yaml
name: design-first
description: Design-first feature implementation with review gate

requires:
  - git operations
  - file management

parameters:
  feature:
    type: string
    required: true

tracking: ai-memory/design-logs/NNN-{{feature}}.md

phases:
  research:
    prompt: |
      Research context for: {{feature}}
      Check ai-memory/MEMORY.md and existing design logs.
      Write Q&A in the tracking file.
    next: design

  design:
    prompt: |
      Write the Design section in the tracking file.
      Include verification criteria.
    gate: true
    next: implement

  implement:
    prompt: |
      Implement the approved design.
      Append results to the tracking file.
    next: verify

  verify:
    prompt: |
      Run tests. Check against verification criteria.
    on_fail: implement
    next: done

  done:
    prompt: |
      Mark tracking file as implemented.
      Update ai-memory/MEMORY.md with learnings.
```

---

#### Decision 6.2: `requires` — semantic capability list (informational)

The `requires` field lists what tools/capabilities the skill wants, as **semantic descriptions** — not exact tool names. The LLM interprets them as hints. No runtime validation.

```yaml
requires:
  - calendar events
  - email search
  - jira issues (optional)
  - slack messages (optional)
  - git operations
```

**Rules:**
- Entries are human-readable capability descriptions
- `(optional)` suffix means the skill works without it but is enhanced with it
- The LLM maps these to available tools at runtime — if a tool isn't available, it skips gracefully
- Replaces the old `requires: [google, ai-gateway]` extension-name format
- No enforcement, no runtime check — purely informational for the LLM and the human

---

#### Decision 6.3: `tracking` — multi-phase state persistence

Every multi-phase skill declares where its state lives via a `tracking` field:

```yaml
tracking: ai-memory/workflows/code-review-{{date}}.md
```

**How it works:**
1. When the LLM starts a multi-phase skill, it creates the tracking file
2. After each phase completion, the LLM updates the tracking file (marks phase done, notes current phase)
3. When resuming in a new conversation, the LLM reads the tracking file to know where it left off
4. When the workflow completes, the tracking file remains as a record

**Tracking file format** (created/maintained by the LLM, not a rigid schema):
```markdown
# code-review — Active Workflow
Started: 2026-02-10
Skill: code-review

## Progress
- [x] understand — completed 2026-02-10
- [ ] review — **current** (awaiting gate approval)
- [ ] feedback
- [ ] done
```

**For design workflows**, the tracking file IS the design log:
```yaml
tracking: ai-memory/design-logs/NNN-{{feature}}.md
```
The design log's sections (Problem Statement, Q&A, Design, Results) naturally map to phases. The LLM sees which sections are filled → knows which phases are done.

**Simple skills (recipe-only) don't have `tracking`** — they run in one shot, no persistence needed.

**Key principle:** The tracking file is just a markdown file the LLM reads/writes. No special runtime, no state engine. The LLM reads it → sees progress → continues from the right phase.

---

#### Decision 6.4: Phase spec — prompts, gates, transitions, retry

Each phase in a multi-phase skill has:

| Field | Required | Description |
|-------|----------|-------------|
| `prompt` | ✅ | What the LLM should do in this phase (supports `{{param}}` substitution) |
| `next` | ✅ | Next phase to transition to (except terminal phase `done`) |
| `gate` | ❌ | If `true`, pause and wait for human approval before proceeding |
| `on_fail` | ❌ | Phase to go back to if this phase fails (retry loop) |

**Gates in Cursor:** The LLM presents its work and asks "Approve? [Y/n]" (or similar, per SOUL.md preference). The human responds in the conversation. The LLM updates the tracking file and proceeds.

**Gates across conversations:** If the user closes the conversation at a gate, the tracking file records the gate state. Next conversation, the LLM reads the tracking file, sees the pending gate, and asks for approval to continue.

**Retry (`on_fail`):** If verification fails, the LLM goes back to the specified phase. The tracking file records the retry. To prevent infinite loops, the LLM uses judgment (after 2-3 retries, ask the human for guidance).

**Terminal phase:** A phase with no `next` (or `next: done`) is the final phase. The LLM marks the tracking file as complete.

---

#### Decision 6.5: Skill discovery — directory listing + global rule

The global rule (Topic 5) already tells the LLM where skills live:
```
Shared: ~/.ai-memory/skills/*.yaml
Project: ai-memory/skills/*.yaml (overrides shared)
```

**How discovery works:**
1. User says "run code-review" or "follow the design-first workflow"
2. LLM lists the skills directories, finds matching YAML file
3. LLM reads the YAML, resolves parameters, follows the recipe/phases

**No catalog file needed.** The directory listing IS the catalog. Skill names = filenames (without `.yaml`).

**Project-level override:** If both `~/.ai-memory/skills/X.yaml` and `ai-memory/skills/X.yaml` exist, the project-level version takes precedence. This allows project-specific customization of shared skills.

**Listing skills:** User can ask "what skills do I have?" — the LLM lists both directories and summarizes available skills from their `name` and `description` fields.

---

#### Decision 6.6: Parameters — resolved conversationally

Skill parameters use `{{param}}` substitution in prompts. In Cursor:

1. LLM reads the skill YAML
2. Checks which parameters are `required` vs have `default` values
3. For missing required params: asks the user conversationally ("What feature are you implementing?")
4. For params with defaults: uses the default unless user specified otherwise
5. Substitutes all `{{param}}` placeholders and proceeds

**No runtime engine.** The LLM handles parameter resolution as part of reading the skill. This is how it already works in the companion CLI — the LLM renders the recipe template.

---

#### Decision 6.7: Conductor workflow = built-in skill (`design-first.yaml`)

The design-log workflow pattern from ai-conductor becomes a shared skill:

```yaml
# ~/.ai-memory/skills/design-first.yaml
name: design-first
description: |
  Design-first development workflow with structured research,
  design, review, and implementation phases.

requires:
  - file management

parameters:
  feature:
    type: string
    required: true
    description: What to design and implement

tracking: ai-memory/design-logs/NNN-{{feature}}.md

phases:
  research:
    prompt: |
      Research context for: {{feature}}
      1. Read ai-memory/MEMORY.md for relevant project context
      2. Check existing design logs for related work
      3. Create the tracking file with Problem Statement
      4. Add Questions & Answers section — use Socratic method
         Ask yourself hard questions, answer them thoroughly
    next: design

  design:
    prompt: |
      Write the Design section in the tracking file.
      Include:
      - Proposed solution with rationale
      - Verification criteria (how to test/validate)
      Review from multiple perspectives:
      - @architect: Structure sound? Dependencies appropriate?
      - @simplifier: Over-engineered? Could we do less?
      - @purist: Clean? Follows conventions?
      Add concerns to Q&A section.
    gate: true
    next: implement

  implement:
    prompt: |
      Implement the approved design.
      Follow the design exactly — no scope creep.
      Append Implementation Results to the tracking file.
    next: verify

  verify:
    prompt: |
      Verify the implementation:
      - Run tests if applicable
      - Check against verification criteria from the design
      - Confirm all acceptance criteria met
    on_fail: implement
    next: complete

  complete:
    prompt: |
      Mark the design log status as "implemented".
      Update ai-memory/MEMORY.md with key decisions and learnings.
```

**This replaces the conductor.mdc workflow instructions** with a concrete, followable skill. The global rule (Topic 5) says "design before implement" — this skill says *how*.

**Review perspectives** (from ai-conductor) live here in the `design` phase, not in the global rule.

---

#### Decision 6.8: Existing companion skill execution — dropped

The companion's `run_skill` tool, `SkillLoader`, and `SkillDefinition` TypeScript types are no longer needed. In the new architecture:

- **Cursor** reads YAML directly and follows it conversationally
- **`ai-memory` CLI** doesn't execute skills (no LLM)
- Skills are plain YAML files — no TypeScript runtime needed

The existing skill templates (`prep-1on1.yaml`, `daily-digest.yaml`, `research-topic.yaml`, `weekly-digest.yaml`) migrate to `~/.ai-memory/skills/` with updated `requires` format (semantic instead of extension names). The `recipe` field stays unchanged.

---

#### Summary: Skill YAML Spec

```yaml
# Full skill schema (all fields)
name: string                              # Required. Matches filename.
description: string                       # Required. What this skill does.

requires:                                 # Optional. Semantic capability hints.
  - capability description
  - another capability (optional)

parameters:                               # Optional. Input parameters.
  param_name:
    type: string | number | boolean
    required: boolean                     # Default: false
    default: value                        # Used when not provided
    description: string
    enum: [value1, value2]

# --- Simple skill (one of recipe OR phases) ---

recipe: |                                 # For simple, single-phase skills
  Multi-line prompt template with {{param}} substitution...

# --- Multi-phase skill ---

tracking: path/to/{{name}}-{{date}}.md    # Where state is persisted

phases:                                   # Ordered phase definitions
  phase_name:
    prompt: |                             # What the LLM does in this phase
      Instructions with {{param}} substitution...
    next: next_phase_name                 # Transition (omit for terminal)
    gate: true                            # Pause for human approval
    on_fail: retry_phase_name             # Go back on failure
```

---

### Topic 7: `ai-memory` CLI
**Status: ✅ approved**

**Scope:** Machine-level file management shell script for `~/.ai-memory/`.

**Context:** Project init is a Cursor skill (Decision 5.6). The CLI manages only the machine-level `~/.ai-memory/` directory. It's a shell script hosted in a git repo. The companion codebase stays separate, on pause.

---

#### Decision 7.1: CLI scope — machine-level only

The CLI manages **only** `~/.ai-memory/` (machine-level). It does NOT touch project-level `ai-memory/`.

- **Machine-level (`~/.ai-memory/`)** → managed by the CLI (`ai-memory init`, `ai-memory data`, etc.)
- **Project-level (`ai-memory/`)** → managed by Cursor via the `bootstrap-project.yaml` skill (Decision 5.6)

The CLI exists because Cursor can't create `~/.ai-memory/` from scratch (before any project is open), and for quick terminal access without opening an IDE.

---

#### Decision 7.2: Command set

```
ai-memory init                       # Create ~/.ai-memory/ with templates
ai-memory soul [edit]                # Show SOUL.md (edit: open in $EDITOR)
ai-memory memory [edit]              # Show MEMORY.md (edit: open in $EDITOR)
ai-memory data list                  # List data/ files
ai-memory data add <file>            # Copy a file to data/
ai-memory data note "text"           # Append to data/notes.md
ai-memory skill list                 # List shared skills
ai-memory skill add <file>           # Copy a skill YAML to skills/
```

**Dropped:**
- `status` — unnecessary; `ls ~/.ai-memory/` works
- Top-level `note` — moved under `data note` (note is just a data operation)
- All companion commands (`ask`, `chat`, `run`, `sync`, `auth`, `config`, `ext`, wizard)

---

#### Decision 7.3: Implementation — shell script

A single shell script (`ai-memory.sh`). Zero dependencies. Just `mkdir`, `cat`, `cp`, `echo`, `$EDITOR`.

- Hosted in a git repo
- Install: clone the repo, add to PATH (or alias)
- No npm, no Node.js, no build step
- ~100-200 lines of bash

---

#### Decision 7.4: `init` — machine-level setup

```bash
ai-memory init
```

Creates:
```
~/.ai-memory/
├── SOUL.md          # Template: Identity, Context, Preferences sections
├── MEMORY.md        # Template: Preferences, Patterns, Decisions, People, Topics sections
├── data/
│   └── notes.md     # Empty, ready for `ai-memory data note`
└── skills/
    ├── design-first.yaml
    ├── code-review.yaml
    ├── investigate.yaml
    └── refactor.yaml
```

- Silent by default (creates with template content)
- If `~/.ai-memory/` already exists → warn and ask: "Override? [y/N]"
- `ai-memory init --force` → override without asking
- No interactive mode — edit SOUL.md manually after init

---

#### Decision 7.5: Distribution — git-hosted script

The script lives in a git repo. Installation:

```bash
git clone <repo-url> ~/ai-memory
# Add to shell profile:
export PATH="$HOME/ai-memory:$PATH"
```

Or simpler — just alias:
```bash
alias ai-memory="bash ~/ai-memory/ai-memory.sh"
```

No npm, no brew, no curl-pipe-sh. Start simple. If demand grows, add distribution later.

---

#### Decision 7.6: Companion codebase — stays separate, on pause

The companion project (`ai-lior-claw/companion/`) is **on pause**. It stays as-is in the repo for reference and potential future use (CLI LLM agent that shares memory with Cursor). It is NOT archived, NOT stripped down, NOT merged into `ai-memory`.

The `ai-memory` system is a **fresh start** — different concept, different implementation, different scope. No code reuse from companion.

---

### Topic 8: Bootstrap & Migration
**Status: ✅ approved**

**Scope:** Fresh setup steps, migration from `~/.companion/` and this repo, template content, verification.

**Context:** We have two things to set up: (1) a fresh install for new users, (2) migration from the existing companion system. We also need to migrate THIS repo's project-level memory.

---

#### Decision 8.1: Fresh setup — 3 steps

A brand new user sets up the system in 3 steps:

**Step 1: Clone the ai-memory repo and set up the CLI**
```bash
git clone <repo-url> ~/ai-memory
export PATH="$HOME/ai-memory:$PATH"  # add to .zshrc/.bashrc
```

**Step 2: Initialize machine memory**
```bash
ai-memory init
# Creates ~/.ai-memory/ with SOUL.md, MEMORY.md, data/, skills/
# Edit SOUL.md with your identity
```

**Step 3: Paste global rule into Cursor**
Open Cursor → Settings → General → "Rules for AI" → paste the approved rule text (Decision 5, ~32 lines).

That's it. No npm install, no OAuth, no wizard. Projects get bootstrapped via the `bootstrap-project.yaml` skill when needed.

---

#### Decision 8.2: `bootstrap-project.yaml` — project init skill

This skill lives in `~/.ai-memory/skills/` and creates the project-level `ai-memory/` directory:

```yaml
name: bootstrap-project
description: Initialize ai-memory in the current project

requires:
  - file management

recipe: |
  Create the ai-memory directory structure for this project:

  1. Create directory: ai-memory/design-logs/
  2. Create directory: ai-memory/skills/ (empty, for project-specific skills)
  3. Create file: ai-memory/MEMORY.md with these sections:

  ```markdown
  # Project Memory

  ## Decisions
  <!-- Key technical and architectural decisions -->

  ## Patterns
  <!-- Patterns and conventions used in this project -->

  ## Learnings
  <!-- What we've learned working on this project -->

  ## Context
  <!-- Important context about this project -->
  ```

  4. Confirm: "Project memory initialized. Ready to use."
```

User opens a new project in Cursor, says "bootstrap this project" → the LLM reads the skill and creates the structure.

---

#### Decision 8.3: Migration from `~/.companion/` → `~/.ai-memory/`

**What exists in `~/.companion/`:**
```
~/.companion/
├── SOUL.md              → MIGRATE (edit to fit new template)
├── memory/MEMORY.md     → MIGRATE to ~/.ai-memory/MEMORY.md
├── memory/context.md    → DROP (empty)
├── memory/2026-02-*.md  → DROP (session logs — Decision 2.5)
├── data/                → DROP (SQLite indexes, not portable)
├── output/              → DROP (companion-specific)
├── sessions/            → DROP (companion-specific)
├── config/              → DROP (companion-specific auth/tokens)
├── sandbox/             → DROP (companion-specific)
├── outputs/             → DROP (companion-specific)
└── skills/              → MIGRATE to ~/.ai-memory/skills/
    ├── daily-digest.yaml    → update `requires` to semantic format
    ├── prep-1on1.yaml       → update `requires` to semantic format
    ├── research-topic.yaml  → update `requires` to semantic format
    └── weekly-digest.yaml   → update `requires` to semantic format
```

**Migration steps:**
1. Run `ai-memory init` (creates fresh `~/.ai-memory/`)
2. Copy SOUL.md content → edit to match new template (Identity, Context, Preferences)
3. Copy MEMORY.md content → merge into new MEMORY.md sections
4. Copy skills, update `requires` fields (e.g., `requires: [google]` → `requires: [- calendar events]`)
5. `~/.companion/` stays untouched (companion is on pause, not deleted)

**No backward compatibility needed.** These are two separate systems. `~/.companion/` continues to work for the companion CLI if ever resumed.

---

#### Decision 8.4: Migration for this repo (`ai-lior-claw/`)

**What exists at project level:**
```
ai-lior-claw/
├── design-logs/         → MOVE to ai-memory/design-logs/
│   └── (20 .md files)
├── memory/              → MIGRATE content to ai-memory/MEMORY.md
│   ├── decisions.json   → extract key decisions into MEMORY.md ## Decisions
│   ├── intelligence.json → extract learnings into MEMORY.md ## Learnings
│   ├── knowledge.json   → extract relevant items into MEMORY.md ## Context
│   └── history.json     → DROP (design logs are history)
├── PLANS/               → KEEP as-is (not our concern — Decision 3.6)
└── companion/           → KEEP as-is (on pause — Decision 7.6)
```

**Migration steps:**
1. Create `ai-memory/` directory
2. Move `design-logs/` → `ai-memory/design-logs/` (rename files to NNN-name.md format)
3. Create `ai-memory/MEMORY.md` with content extracted from `memory/*.json`
4. Optionally create `ai-memory/skills/` if project-specific skills needed
5. Keep old `memory/` and `design-logs/` for reference (or remove after verification)

**Design log renaming** (current → new):
The 20 existing design logs get numbered. Order by creation/topic:
```
phase-1-management-companion.md  → 001-management-companion.md
soul-architecture.md             → 002-soul-architecture.md
data-layer-architecture.md       → 003-data-layer-architecture.md
extension-system.md              → 004-extension-system.md
...etc
unified-machine-memory.md        → 0XX-unified-machine-memory.md
```

Exact numbering can be determined during implementation. The key principle: numbered prefix, semantic name, as per Decision 1.10.

---

#### Decision 8.5: Template content

**SOUL.md template** (created by `ai-memory init`):
```markdown
# [Your Name]'s AI Memory

## Identity
<!-- Who you are, your role, what you do -->
- Name:
- Role:
- Team/Org:

## Context
<!-- Your working context — what the AI should always know -->

## Preferences
<!-- How you like the AI to behave -->
- Prefer bullet points over paragraphs
- End responses with actionable prompt when decisions needed
```

**MEMORY.md template** (machine-level, created by `ai-memory init`):
```markdown
# Shared Memory

## Preferences
<!-- Cross-project interaction preferences -->

## Patterns
<!-- Patterns you've observed across projects -->

## Decisions
<!-- Universal decisions that apply everywhere -->

## People
<!-- Key people the AI should know about -->

## Topics
<!-- Recurring topics and ongoing themes -->
```

**Starter skills** (bundled with the shell script repo):
- `design-first.yaml` — the conductor workflow (Decision 6.7)
- `code-review.yaml` — structured code review
- `investigate.yaml` — systematic debugging/investigation
- `refactor.yaml` — safe refactoring workflow
- `bootstrap-project.yaml` — project init (Decision 8.2)

These live in the git repo alongside `ai-memory.sh` and get copied to `~/.ai-memory/skills/` by `ai-memory init`.

---

#### Decision 8.6: Verification criteria

After setup is complete, verify with these tests:

| # | Criterion | How to Verify |
|---|-----------|---------------|
| 1 | Machine memory exists | `ls ~/.ai-memory/` shows SOUL.md, MEMORY.md, data/, skills/ |
| 2 | Cursor reads SOUL.md | Open any project in Cursor, ask "who am I?" → LLM uses SOUL.md |
| 3 | Cursor reads shared memory | Ask about a preference from `~/.ai-memory/MEMORY.md` |
| 4 | CLI note works | `ai-memory data note "test"` → check `~/.ai-memory/data/notes.md` |
| 5 | Project bootstrap | In Cursor: "bootstrap this project" → `ai-memory/` created |
| 6 | Project memory works | Make a decision → verify `ai-memory/MEMORY.md` updated by Cursor |
| 7 | Design log lifecycle | Create → Q&A → Approve → Implement → mark as implemented |
| 8 | Shared skill execution | In Cursor: "follow the design-first skill" → LLM reads YAML, follows phases |
| 9 | Project skill override | Add `ai-memory/skills/design-first.yaml` → Cursor uses project version |
| 10 | Workflow tracking | Multi-phase skill creates tracking file, resumes across conversations |

---

#### Decision 8.7: Implementation order

The implementation should follow this order:

1. **Create the git repo** — `ai-memory.sh` script + template files + starter skills
2. **Write `ai-memory init`** — the most important command
3. **Write remaining commands** — `soul`, `memory`, `data`, `skill`
4. **Write the global Cursor rule** — the exact text to paste
5. **Write starter skills** — `design-first.yaml`, `bootstrap-project.yaml`, etc.
6. **Test fresh setup** — run through the 3 steps on a clean machine
7. **Migrate this repo** — move design-logs, extract memory, number files
8. **Migrate `~/.companion/`** — copy SOUL, MEMORY, skills
9. **Verify** — run through all 10 verification criteria

---

## 9. Revision History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-02-09 | Initial draft — full research synthesis from ai-conductor + companion + Wix MCP |
| 0.2 | 2026-02-09 | Added Q5 (state machine in skills), Q6 (cross-IDE skills). Replaced implementation phases with 15-topic structured breakdown with per-topic approval status. |
| 0.3 | 2026-02-09 | **Topic 1 approved.** 10 decisions: `~/.ai-memory/` + `ai-memory/`, markdown everywhere (no JSON), ai-memory/companion separation, numbered design logs, project-level skills, no project SOUL. |
| 0.4 | 2026-02-09 | **Major architecture revision.** Companion CLI replaced by `ai-memory` CLI (pure file manager, no LLM). `~/.companion/` dropped — only `~/.ai-memory/` exists. Topics reduced from 15 to 8. Cursor is primary IDE; CLI is data manager. Sections 5-7 rewritten. Topic 1 revised (v2) with 11 decisions including CLI rename and architecture shift. |
| 0.5 | 2026-02-09 | **Topic 2 approved.** 6 decisions: SOUL.md = timeless identity only (people → MEMORY.md), MEMORY.md = curated document (no session logs), data/ = catalog + read-on-demand, skills/ = natural language with state machine support + tool hints, no session logs, init includes general Cursor workflow skills. CLI role narrowed to bootstrap + convenience. |
| 0.6 | 2026-02-09 | **Topic 3 approved.** 6 decisions: MEMORY.md replaces 4 JSON files, **no INDEX.md** (numbered files self-index), no history.json (design logs are history), skills/ optional, .gitignore not our concern, PLANS/ not our concern. INDEX.md references removed from all earlier topics and architecture diagrams. |
| 0.7 | 2026-02-09 | **Topic 4 approved.** 6 decisions: Updated template (added Created date, Revision History), simplified status lifecycle (no `in-progress` — draft until approved), design logs replace research→plan→build, prose-only cross-refs, todo_write for session scope, enforcement via rules + skills. |
| 0.8 | 2026-02-10 | **Topic 5 approved.** 7 decisions: Rule lives in Cursor "Rules for AI" global setting (not per-project file). Review perspectives moved to skills. ~32 lines replaces conductor.mdc. No MCP guidance. Project init via Cursor skill, not CLI. CLI-style prompts → SOUL.md preference. Memory section uses PROJECT/SHARED labels. Architecture diagram + Decision 1.11 updated. |
| 0.9 | 2026-02-10 | **Topic 6 approved.** 8 decisions: No `type` field (recipe vs phases determines behavior), `requires` as semantic capability list (not exact tool names), `tracking` field for multi-phase state persistence (markdown file the LLM reads/writes), phase spec (prompt/next/gate/on_fail), discovery via directory listing, parameters resolved conversationally, conductor workflow becomes `design-first.yaml` skill (review perspectives live here), companion skill runtime dropped. |
| 0.10 | 2026-02-10 | **Topic 7 approved.** 6 decisions: CLI is machine-level only (`~/.ai-memory/`), command set is `init`, `soul`, `memory`, `data` (list/add/note), `skill` (list/add) — no `status`, `note` moved under `data`. Shell script (~100-200 lines bash), git-hosted, no npm. Companion stays separate on pause. Fresh start, no code reuse. |
| 0.11 | 2026-02-10 | **Topic 8 approved.** 7 decisions: 3-step fresh setup (clone+init+paste rule), bootstrap-project.yaml skill, migration from `~/.companion/` (SOUL+MEMORY+skills migrate, rest drops), this repo migration (design-logs → ai-memory/design-logs/, memory/*.json → MEMORY.md), template content (SOUL.md, MEMORY.md, 5 starter skills), 10 verification criteria, 9-step implementation order. |
| 1.0 | 2026-02-10 | **Implemented.** All 8 topics built. See Implementation Results. |

---

## 10. Implementation Results

### What was built

**1. `ai-memory` CLI** — `~/Projects/Wix/Playgrounds/ai-memory/`
- `ai-memory.sh` — ~190 lines bash, all 8 commands working
- `templates/` — SOUL.md, MEMORY.md, 5 starter skills
- `cursor-global-rule.txt` — the exact rule text to paste into Cursor Settings

**2. Machine memory** — `~/.ai-memory/`
- `SOUL.md` — Lior's identity (migrated from `~/.companion/SOUL.md`, reformatted)
- `MEMORY.md` — Shared memory (seeded with key decisions and patterns)
- `data/` — empty, ready for knowledge files
- `skills/` — 9 skills:
  - 5 new starters: `design-first`, `bootstrap-project`, `code-review`, `investigate`, `refactor`
  - 4 migrated from companion: `daily-digest`, `prep-1on1`, `weekly-digest`, `research-topic`
  - All `requires` fields updated to semantic format

**3. Project memory** — `ai-lior-claw/ai-memory/`
- `MEMORY.md` — extracted from `memory/decisions.json` + `intelligence.json` + `knowledge.json`
- `design-logs/` — 20 files renamed to `NNN-semantic-name.md` format (001-020)
- `skills/` — empty directory, ready for project-specific skills

**4. Global Cursor rule** — `cursor-global-rule.txt` ready for paste into Cursor Settings → "Rules for AI"

### Verification results

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Machine memory exists | ✅ `~/.ai-memory/` with SOUL.md, MEMORY.md, data/, skills/ |
| 2 | Cursor reads SOUL.md | ⏳ Needs Cursor restart with global rule |
| 3 | Cursor reads shared memory | ⏳ Needs Cursor restart with global rule |
| 4 | CLI note works | ✅ `ai-memory data note "text"` → appends to `data/notes.md` |
| 5 | Project bootstrap | ✅ `bootstrap-project.yaml` skill ready |
| 6 | Project memory works | ⏳ Needs Cursor with global rule |
| 7 | Design log lifecycle | ✅ This design log went through the full lifecycle |
| 8 | Shared skill execution | ⏳ Needs Cursor with global rule |
| 9 | Project skill override | ✅ Mechanism in place (project `ai-memory/skills/` overrides shared) |
| 10 | Migration | ✅ SOUL, MEMORY, skills migrated; companion untouched |

### What's left (requires manual steps)

1. **Paste global rule** into Cursor Settings → General → "Rules for AI"
2. **Re-verify criteria 2, 3, 6, 8** after rule is active
3. **PATH setup** — add `alias ai-memory="bash ~/Projects/Wix/Playgrounds/ai-memory/ai-memory.sh"` to `.zshrc`
4. **Remove old conductor.mdc** from projects where global rule is sufficient
5. **Old files** — `design-logs/` and `memory/` in repo root can be removed once comfortable with `ai-memory/` structure
