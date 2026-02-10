# ai-memory

Persistent, shared context layer for AI-assisted development. Works with Cursor (or any LLM-powered IDE) and a simple CLI.

## What It Does

- **Shared memory** (`~/.ai-memory/`) — your identity, cross-project knowledge, reusable skills
- **Project memory** (`ai-memory/`) — per-project decisions, design logs, project-specific skills
- **Global Cursor rule** — tells the LLM how to read/write memory and follow the design-first workflow

Every AI conversation starts with context and ends by updating memory. No more repeating yourself.

## Setup (3 Steps)

### 1. Install the CLI

```bash
git clone <repo-url> ~/Projects/ai-memory   # or wherever you keep repos
```

Add to your `~/.zshrc` (or `~/.bashrc`):

```bash
alias ai-memory="bash ~/Projects/ai-memory/ai-memory.sh"
```

Reload your shell:

```bash
source ~/.zshrc
```

### 2. Initialize machine memory

```bash
ai-memory init
```

This creates `~/.ai-memory/` with:
- `SOUL.md` — your identity template (edit this!)
- `MEMORY.md` — shared memory (starts empty)
- `data/` — knowledge files
- `skills/` — 9 starter workflow skills

Edit your identity:

```bash
ai-memory soul edit
```

### 3. Set up Cursor global rule

Open Cursor → **Settings** → **General** → **Rules for AI**

Paste the contents of [`cursor-global-rule.txt`](cursor-global-rule.txt).

Done. Every Cursor conversation now reads your memory and follows the design-first workflow.

## Using in a Project

Open any project in Cursor and say:

> "Bootstrap this project for ai-memory"

The LLM reads `~/.ai-memory/skills/bootstrap-project.yaml` and creates:

```
your-project/
└── ai-memory/
    ├── MEMORY.md           # Project decisions, patterns, learnings
    ├── design-logs/        # Design log files (NNN-name.md)
    └── skills/             # Optional project-specific skills
```

### Design-First Workflow

For non-trivial features, say:

> "Follow the design-first skill for [feature name]"

This walks through: Research → Design (with review gate) → Implement → Verify → Complete.

Each step updates a design log in `ai-memory/design-logs/`.

## CLI Commands

```
ai-memory init [--force]       Create ~/.ai-memory/ with templates
ai-memory soul [edit]          Show SOUL.md (edit: open in $EDITOR)
ai-memory memory [edit]        Show MEMORY.md (edit: open in $EDITOR)
ai-memory data list            List data/ files
ai-memory data add <file>      Copy a file to data/
ai-memory data note "text"     Append to data/notes.md
ai-memory skill list           List shared skills
ai-memory skill add <file>     Copy a skill YAML to skills/
```

The CLI manages only `~/.ai-memory/` (machine level). Project-level `ai-memory/` is managed by Cursor.

## Included Skills

| Skill | Type | Description |
|-------|------|-------------|
| `design-first` | workflow | Design-first development with research, design, review gate, implementation |
| `bootstrap-project` | recipe | Initialize `ai-memory/` in a new project |
| `code-review` | recipe | Structured code review with systematic analysis |
| `investigate` | recipe | Systematic bug investigation with root cause analysis |
| `refactor` | workflow | Safe refactoring with verification at each step |
| `daily-digest` | recipe | Morning briefing from calendar, email, Slack, Jira, GitHub |
| `weekly-digest` | recipe | Comprehensive weekly summary across all data sources |
| `prep-1on1` | recipe | 1:1 meeting prep with data from all sources |
| `research-topic` | recipe | Web research with structured summary |

## File Structure

```
ai-memory/                          # This repo
├── ai-memory.sh                    # The CLI script
├── cursor-global-rule.txt          # Rule text to paste into Cursor Settings
├── README.md                       # This file
├── design-logs/                    # Design history of ai-memory itself
│   └── 001-unified-machine-memory.md
└── templates/                      # Templates copied by `ai-memory init`
    ├── SOUL.md
    ├── MEMORY.md
    └── skills/
        ├── bootstrap-project.yaml
        ├── code-review.yaml
        ├── design-first.yaml
        ├── investigate.yaml
        └── refactor.yaml
```

## How Memory Works

| Level | Location | Who writes | What's in it |
|-------|----------|-----------|--------------|
| **Shared** | `~/.ai-memory/` | CLI + Cursor | Identity, cross-project knowledge, shared skills |
| **Project** | `ai-memory/` | Cursor | Project decisions, design logs, project skills |

The Cursor global rule tells the LLM:
- Read `SOUL.md` at conversation start
- Check project memory before starting work
- Update the correct memory file after significant work
- Follow skills when asked

## Design Principles

1. **Markdown everywhere** — no JSON, no databases, no binary formats
2. **No LLM in the CLI** — the CLI is a file manager, the IDE brings intelligence
3. **Design before implement** — no code without an approved design log
4. **Skills are just YAML** — no runtime needed, any LLM reads and follows them
5. **Zero dependencies** — bash script, works on any Mac/Linux
