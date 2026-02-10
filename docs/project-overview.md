# ai-memory — Project Overview

## The Problem

Every AI conversation starts from zero. You explain your role, your team, your preferences, your architecture decisions — again and again. Context drifts. Decisions get lost. The AI is powerful but amnesic.

This affects two levels:
- **Within a project** — each Cursor session forgets what was decided yesterday
- **Across projects** — knowledge from one project never reaches another

The result: the developer becomes a "Single Point of Failure" (SPOF) — the only one who holds context, makes decisions, and bridges the gap between what the AI knows and what it needs to know.

## The Vision

Move from **SPOF** to **Strategic Final Approver**.

The AI should:
- **Already know who you are** — your role, your team, your preferences
- **Remember what was decided** — in this project and across projects
- **Follow a consistent workflow** — design before implement, with human gates
- **Build knowledge over time** — every conversation adds to shared memory
- **Work across tools** — same context in Cursor, CLI, future IDEs

The human's job shifts from "explain everything" to "approve, steer, and curate."

## How We Got Here

This system evolved from three separate projects that converged:

### 1. ai-conductor (Cursor rules)
Started as a `.cursor/rules/conductor.mdc` file — a state machine for AI workflow (research → plan → build). Had roles (@architect, @simplifier), memory files (JSON), and a full task lifecycle.

**What worked:** Design-first workflow, review perspectives, persistent memory.
**What didn't:** Too complex for a rules file (~63 lines doing too much). JSON memory was rigid. Task types (research/plan/build) were overkill — one design log covers all three.

**Key takeaway:** The workflow fits in ~30 lines. Skills handle the complex parts.

### 2. companion (CLI AI assistant)
A full TypeScript CLI (`ai-lior-claw/companion/`) — LLM-powered assistant with extensions, RAG, skills, and a SOUL.md identity system. 8 extensions (Google, Slack, GitHub, Jira, AI Gateway, etc.), FTS5 search, configurable providers (Ollama, Claude, Gemini).

**What worked:** SOUL.md identity, skills as YAML workflows, the data/ folder concept, the "companion pattern" (suggest, don't act).
**What didn't:** Building our own tool integrations when Cursor + MCPs already provides them. Maintaining a TypeScript codebase for what's essentially file management.

**Key takeaway:** Don't build what the IDE already provides. Focus on what it lacks: persistent memory.

### 3. Wix MCP-S (external tools)
Discovered that Wix provides 89 tools across 6 MCPs (Jira, GitHub, Slack, Google, DevEx, Docs Schema) via a single OAuth token — directly usable in Cursor. No wrapper code needed.

**Key takeaway:** Cursor + MCPs = the tool layer. We just need the memory layer.

### The Convergence
- From ai-conductor: the design-first workflow and review perspectives → became the global rule + `design-first.yaml` skill
- From companion: SOUL.md, MEMORY.md, data/, skills/ → became the `~/.ai-memory/` structure
- From Wix MCP-S: 89 tools → used directly in Cursor, no code needed

Result: a system with zero runtime dependencies that provides everything the IDE was missing.

## Goals

### Immediate
1. **Persistent context** — AI remembers who you are and what was decided, across sessions
2. **Consistent workflow** — design-first pattern enforced through rules and skills
3. **Shared knowledge** — cross-project memory means learnings travel between projects
4. **Reusable workflows** — skills capture patterns once, use them everywhere

### Medium-term
5. **Team sharing** — skills and patterns that work for one developer can be shared
6. **Content growth** — memory accumulates value organically through daily work
7. **IDE-agnostic** — the memory layer works with any tool that can read files

### Long-term
8. **The developer as curator** — the human curates knowledge, the AI does the heavy lifting
9. **Institutional memory** — decisions, patterns, and context survive across projects and years

## Design Principles

### 1. Files over infrastructure
Everything is a markdown or YAML file. No databases, no servers, no build steps. A developer with `cat` and `ls` can inspect the entire system.

### 2. IDE brings intelligence, memory brings context
The CLI (`ai-memory`) is a dumb file manager (~190 lines of bash). It creates, copies, and appends files. All intelligence comes from the IDE's LLM — Cursor reads the files and acts on them.

### 3. Human gates at decision points
The AI proposes, the human approves. Design logs have an explicit `draft → approved` gate. Multi-phase skills have `gate: true` phases. The human is always the final approver.

### 4. Progressive refinement over upfront design
Start writing. Questions emerge. Answer them (Q&A section). The design crystallizes. This Socratic method produces better designs than trying to get it right in one pass.

### 5. Memory is curated, not accumulated
Memory files are edited, not just appended. The human (or AI, with guidance) prunes, restructures, and refines. A 10-line MEMORY.md with the right content beats a 1000-line dump.

### 6. Convention over configuration
- Machine memory: `~/.ai-memory/`
- Project memory: `ai-memory/`
- Design logs: `NNN-semantic-name.md`
- Skills: `name.yaml` with `recipe:` or `phases:`
- No config files. The conventions ARE the configuration.

## What Success Looks Like

- You open a new project in Cursor. Say "bootstrap this project." Memory structure appears.
- You start a complex feature. Say "follow design-first." A design log is created, Q&A happens, you approve, implementation follows.
- You switch to a different project. The AI already knows your preferences, your team, your patterns.
- A month later, you look at `ai-memory/design-logs/` and see the complete history of every decision, with rationale.
- Your shared memory has grown — patterns from project A inform decisions in project B.
- You never explain who you are or how you like to work. It's in SOUL.md.

## Relationship to Other Tools

| Tool | Role | ai-memory's relationship |
|------|------|-------------------------|
| **Cursor** | IDE with LLM | Primary consumer of memory. Reads/writes all files. |
| **Wix MCP-S** | External tools (Jira, Slack, etc.) | Used directly via Cursor. ai-memory doesn't wrap them. |
| **Git** | Version control | ai-memory files live in git repos. Memory is versioned. |
| **ai-memory CLI** | File manager | Creates and manages `~/.ai-memory/`. No LLM. |
| **companion** | Previous CLI assistant | On pause. Code preserved in `ai-lior-claw/companion/`. |
