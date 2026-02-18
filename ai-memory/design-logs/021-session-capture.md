# Session Capture — Design Log

[Status: implemented]
[Created: 2026-02-11]

## 1. Problem Statement

Every conversation with an AI agent contains signal about **how I think, decide, research, and work**. Right now that signal is lost when the session ends.

Specific types of signal being lost:
- **Decision patterns** — why I chose X over Y, what I weigh
- **Corrections** — every time I correct the AI, I'm expressing an un-codified preference
- **Research methods** — how I scope, evaluate, compare, synthesize
- **Workflow sequences** — the order I naturally do things in
- **Quality standards** — what "good enough" means to me
- **Reusable artifacts** — prompts, templates, frameworks I built mid-session
- **Meta-learnings** — insights about the process itself

**Why now:** The ai-memory system (design log 020) is implemented and working. SOUL.md captures identity, MEMORY.md captures learnings — but both are updated reactively. There's no systematic capture of *how I work*, only *what I decided*. With enough textual AI interactions, this becomes a rich data source for self-learning and future automation.

**The goal:** Build a knowledge base about "how I research" and "how I work" by systematically capturing session signal, then periodically analyzing it to improve skills, memory, and workflows.

## 2. Questions & Answers

**Q1: What's the simplest thing that works today?**

A YAML skill (`session-capture.yaml`) that I invoke at the end of a session. The agent reflects on the conversation and produces a structured capture file. Fits within the existing ai-memory system — no new tooling, no new infrastructure.

**Q2: Where should captures be stored?**

`~/.ai-memory/data/sessions/YYYY-MM-DD-topic.md`

This is the first subdirectory in `data/`. Decision 2.3 (design log 020) defined `data/` as flat with descriptive names. A `sessions/` subdirectory is a reasonable evolution — session captures are a distinct category of knowledge, and there will be many of them. The alternative (flat in `data/`) would pollute the knowledge catalog.

**Q3: What's the capture format?**

Structured markdown with consistent sections that enable later analysis:

```markdown
# Session Capture — YYYY-MM-DD — [Topic]

**Duration:** ~X min (estimate)
**Type:** Research | Design | Implementation | Exploration | Management | Review
**Context:** [project name or "cross-project"]

## What Was Done
- Bullet summary of actions and outcomes

## Decisions Made
- Decision and rationale (if any)

## Corrections & Preferences Expressed
- What I corrected the AI on, and what it reveals

## Patterns Observed
- How I approached the work (method, sequence, priorities)

## Reusable Artifacts
- Prompts, templates, frameworks created during the session
- Link to files if they were saved

## Open Questions
- Things left unresolved or worth revisiting

## Meta-Learnings
- Insights about the process itself
- What worked well, what didn't
```

Not every section needs content in every capture. The agent fills what's relevant.

**Q4: What about long sessions where the agent lost early context?**

Real limitation of option 1 (in-session skill). For very long sessions, the agent may not recall the beginning. Mitigations:
- Trigger the capture **before** the conversation gets too long (whenever practical)
- Accept that early-session signal may be lost — partial capture > no capture
- The path to option 3 (conversation export + post-processing) solves this fully

**Q5: Should the skill update MEMORY.md/SOUL.md automatically?**

Yes — but carefully. The capture is raw material, and most of it stays in the capture file. However, waiting for a separate analysis phase means genuinely important learnings sit unused. The skill should distill and apply *significant* updates inline, with guardrails to prevent overflow.

**Guardrails:**
1. **Threshold test** — only update if the session revealed something *new*: a preference not yet in SOUL.md, a decision not yet in MEMORY.md, a pattern not yet documented. If the session just applied existing knowledge, skip the update.
2. **Replace over append** — if the new insight refines or supersedes an existing bullet, *replace* it rather than adding a new one. Memory stays curated.
3. **Size awareness** — before writing, read the target file. If it's getting long (>100 lines for SOUL.md, >60 lines for project MEMORY.md, >120 lines for shared MEMORY.md), consolidate related bullets rather than appending.
4. **One-liner rule** — each memory update is a single bullet point. No paragraphs, no multi-line entries. If it can't fit in one bullet, it belongs in `data/` instead.

**Q6: How does this connect to the feedback flywheel?**

```
Work → Capture → Accumulate → Analyze → Distill → Improve
  ↑                                                   |
  └───────────────────────────────────────────────────┘
```

- **Phase 1 (this design):** `session-capture.yaml` — manual trigger, produces structured captures
- **Phase 2 (future):** `analyze-sessions.yaml` — reads accumulated captures, finds patterns, proposes memory/skill updates
- **Phase 3 (future):** Conversation export pipeline — full conversation → post-processing with a separate LLM call, no context window limitation

Phase 2 is a natural follow-up skill once 10-20 captures exist. Phase 3 requires investigating where Cursor stores conversations and building a lightweight extraction pipeline.

**Q7: Why skip option 2 (automatic rule trigger)?**

Option 2 (adding a rule: "when I say 'wrap up', capture the session") sounds convenient but adds overhead without real benefit:
- It's just a rule that triggers the same skill — the user still has to say something
- Adding it to the global rule consumes always-on token budget for something used occasionally
- The skill invocation ("follow session-capture") is equally easy and more explicit
- Rules are for behavioral constraints; skills are for on-demand workflows

When the habit is established, a rule shortcut could be added. But starting with an explicit skill is cleaner.

**Q8: What categories of "how I work" knowledge will emerge?**

Based on the types of sessions I have:

| Session type | What it reveals | Example capture signal |
|---|---|---|
| Research | Evaluation methods, comparison frameworks, quality bars | "I always check implementation vs. intention gap" |
| Design | Decision process, tradeoff analysis, Socratic method | "I break complex topics into numbered sub-decisions" |
| Implementation | Coding patterns, review habits, testing philosophy | "I verify edge cases before happy path" |
| Management | Communication patterns, 1:1 prep method, delegation style | "I prefer async decisions documented in writing" |
| Exploration | How I scope new ideas, brainstorming patterns | "I start with 'what's the simplest thing that works'" |

This is essentially **personal process mining** — using AI interactions as a trace of cognitive work.

## 3. Design

### 3.1 Session Capture Skill

A new shared skill at `~/.ai-memory/skills/session-capture.yaml`:

```yaml
name: session-capture
description: |
  Capture key insights, decisions, and patterns from the current session.
  Produces a structured markdown file for later analysis.

requires:
  - file management

parameters:
  topic:
    type: string
    required: true
    description: Brief topic or title for the session

recipe: |
  Reflect on this conversation and create a structured session capture.

  ## Instructions

  1. Review the conversation from the beginning
  2. Create a file at ~/.ai-memory/data/sessions/{{date}}-{{topic}}.md
     where {{date}} is today's date (YYYY-MM-DD) and {{topic}} is a
     kebab-case version of the topic parameter
  3. Fill in the following template — skip sections that aren't relevant:

  ```
  # Session Capture — {{date}} — {{topic}}

  **Duration:** ~X min (estimate based on conversation length)
  **Type:** Research | Design | Implementation | Exploration | Management | Review
  **Context:** [project name or "cross-project"]

  ## What Was Done
  - Bullet summary of actions taken and outcomes achieved

  ## Decisions Made
  - Each significant decision with its rationale

  ## Corrections & Preferences Expressed
  - Things the user corrected or redirected
  - What these corrections reveal about preferences or standards

  ## Patterns Observed
  - How the user approached the work
  - Recurring methods, sequences, or priorities visible in the conversation

  ## Reusable Artifacts
  - Any prompts, templates, or frameworks created
  - Reference file paths if artifacts were saved

  ## Open Questions
  - Things left unresolved or flagged for follow-up

  ## Meta-Learnings
  - Insights about the working process itself
  - What approach worked well and what didn't
  ```

  4. Distill memory updates (apply guardrails from Q5):
     a. Read ~/.ai-memory/MEMORY.md (shared), project ai-memory/MEMORY.md,
        and ~/.ai-memory/SOUL.md
     b. Identify what's genuinely NEW from this session — skip anything
        already captured in those files
     c. For each candidate update, decide:
        - Which file it belongs in (SOUL.md for identity/preferences,
          shared MEMORY.md for cross-project learnings,
          project MEMORY.md for project-specific decisions)
        - Whether it replaces an existing bullet or adds a new one
        - Whether the target file needs consolidation (too long)
     d. Apply the updates — one bullet per insight, replace over append

  5. After creating the capture and applying updates, summarize:
     - Number of decisions captured
     - Number of corrections/preferences found
     - Memory updates applied (file, what changed, why)
     - Any candidates for new skills (list but don't apply)
```

### 3.2 Storage

- Location: `~/.ai-memory/data/sessions/`
- Naming: `YYYY-MM-DD-topic.md` (e.g., `2026-02-11-session-capture-design.md`)
- Multiple captures per day use different topics as disambiguator
- The `sessions/` subdirectory is a new convention within `data/` — first subdirectory

### 3.3 Future: Analysis Skill (Phase 2)

Not part of this design, but the intended follow-up once ~10 captures exist:

```yaml
name: analyze-sessions
description: Analyze accumulated session captures to find patterns and improvement opportunities
# ... reads ~/.ai-memory/data/sessions/*.md, produces analysis
```

### 3.4 Future: Conversation Export Pipeline (Phase 3)

Not part of this design, but the long-term path:
- Investigate where Cursor stores conversation data
- Build a lightweight script that exports raw conversations
- Feed to an LLM (via API or Cursor) for structured extraction
- Produces the same capture format, but from full conversation — no context window limitation
- Could be triggered post-session (doesn't require the agent to be active)

## 4. Verification

| # | Criterion | How to Verify |
|---|-----------|---------------|
| 1 | Skill file exists | `~/.ai-memory/skills/session-capture.yaml` is valid YAML |
| 2 | Sessions directory | `~/.ai-memory/data/sessions/` exists after first use |
| 3 | Capture produced | After running the skill, a file exists at the expected path |
| 4 | Format correct | The capture file follows the template structure |
| 5 | Content meaningful | The capture contains specific, actionable observations — not generic summaries |
| 6 | Corrections captured | If corrections happened in the session, they appear in the capture |
| 7 | Memory updates applied | Summary shows memory updates that were applied (file, what, why) |
| 8 | No overflow | Memory files don't grow unboundedly — replace over append, consolidation when needed |
| 9 | Threshold respected | Sessions with no new signal skip memory updates entirely |
| 10 | Summary useful | The skill's closing summary identifies concrete candidates for new skills |

## 5. Implementation Results

- Created `~/.ai-memory/data/sessions/` directory
- Created `~/.ai-memory/skills/session-capture.yaml` (shared skill)
- Created `templates/skills/session-capture.yaml` (ships with `ai-memory init`)
- Status changed to implemented

## 6. Revision History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-02-11 | Initial draft — brainstorm distilled into design. Options 1 (skill) and 3 (export pipeline) chosen. Option 2 (rule trigger) deferred. |
| 0.2 | 2026-02-11 | Added auto-updating MEMORY.md/SOUL.md with guardrails (Q5 revised, recipe step 4 added, verification criteria 7-9 added). |
| 1.0 | 2026-02-11 | Implemented — skill file created, sessions directory created, template added. |
