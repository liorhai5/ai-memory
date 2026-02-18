# 022 — Local ai-memory + Self-Contained ai-gh

**Status**: implemented
**Date**: 2026-02-18
**Context**: We initially tried to generalize ai-memory so it could discover project knowledge in arbitrary paths (`knowledge/`, `docs/`, etc.). After discussion, we chose a cleaner split: ai-memory is the local/personal workflow layer, while project knowledge remains self-contained in each project's own rules and files.

---

## Problem Statement

ai-memory and ai-gh-pipeline were being treated as if they should share one path model. That created unnecessary complexity:

- Fuzzy path discovery in the global rule
- Skills that had to guess where project knowledge lives
- Unclear ownership between personal workflow memory and team-shared project knowledge

The goal is to keep ai-memory simple and deterministic while allowing projects to stay self-contained.

---

## Questions & Answers

**Q1: Should ai-memory discover project knowledge paths automatically?**

No. Discovery adds ambiguity and inconsistent behavior across models. ai-memory should use stable local conventions.

**Q2: Where should design logs for personal workflow live?**

In local project `ai-memory/design-logs/`. This is part of personal methodology and does not need to be committed by default.

**Q3: What if design/knowledge should persist for a team?**

Move relevant outputs into the project's committed knowledge area (for example `knowledge/` or `docs/`) and let project rules define how agents should use them.

**Q4: Should project-level `ai-memory/skills/` exist?**

No. Skills are machine-level in `~/.ai-memory/skills/`. If a project needs special behavior, it should define project rules in `.cursor/rules/*.mdc`.

**Q5: Does this impact ai-gh-pipeline behavior?**

No runtime or CI impact. ai-gh remains self-contained. The change only clarifies personal IDE workflow boundaries.

---

## Design

### D1: Keep machine memory fixed

`~/.ai-memory/` remains the shared machine-level layer:

- `SOUL.md`
- `MEMORY.md`
- `data/`
- `skills/`

### D2: Keep local project workflow memory fixed

Each project can have local workflow memory at:

- `ai-memory/MEMORY.md`
- `ai-memory/design-logs/`

Default posture: local and gitignored. For personal repos, user may choose to commit it.

### D3: Keep project knowledge self-contained and project-owned

Committed project knowledge (`knowledge/`, `docs/`, or other paths) is not managed by ai-memory global rule. The project can define explicit behavior via `.cursor/rules/*.mdc`.

### D4: Keep global rule explicit (no discovery logic)

The shared global rule should directly reference local ai-memory paths and workflow expectations. It should not attempt to discover project-specific committed knowledge paths.

### D5: Keep bootstrap simple

Bootstrap creates local `ai-memory/` structure only (no project-level `skills/`) and asks whether to add `ai-memory/` to `.gitignore` (default yes).

---

## Scope Changes from v0.1 Draft

Superseded from the original draft:

- Discovery-based global rule
- Generic path tokens in skills
- Bootstrap presets for pipeline/custom knowledge paths

Kept and implemented:

- Skills are machine-level only
- No `ai-memory/skills/` at project level
- Clear separation between personal workflow artifacts and project-owned knowledge

---

## Verification

1. Global rule references explicit local ai-memory paths and no discovery instructions
2. Bootstrap creates local `ai-memory/` only and does not create `ai-memory/skills/`
3. README and project-overview describe the separation clearly
4. Existing ai-memory project workflow remains unchanged (`ai-memory/MEMORY.md` + `ai-memory/design-logs/`)
5. Guidance exists for project-specific behavior via `.cursor/rules/*.mdc`

---

## Implementation Results

- Updated `cursor-global-rule.txt` to explicit local model
- Updated bootstrap and skill templates to remove project-level skills and align wording
- Updated docs (`README.md`, `docs/project-overview.md`) for local-vs-project ownership
- Updated `ai-memory/MEMORY.md` decision entry to final model

---

## Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1 | 2026-02-18 | Initial draft with discovery-based coexistence model |
| 0.2 | 2026-02-18 | Direction changed: ai-memory is local workflow layer; ai-gh/project knowledge is self-contained |
| 1.0 | 2026-02-18 | Implemented docs/rule/template updates for the local workflow model |
