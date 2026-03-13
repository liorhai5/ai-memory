# Alternative: Terminal-Level Capture

- **Source**: Analysis — PTY/shell-level integration
- **Type**: analysis
- **Accessed**: 2026-03-13

## Findings

### The Idea

Capture AI conversations at the terminal level — intercept stdin/stdout of AI CLI tools (claude, cursor CLI, codex) or wrap them in a PTY (pseudo-terminal) that records I/O.

### Approaches

1. **Shell wrapper/alias** — `alias claude='ai-memory-wrap claude'` where `ai-memory-wrap` is a PTY proxy that records I/O and passes through
2. **Shell hooks** — zsh `preexec`/`precmd` hooks to detect AI tool invocations and capture output
3. **script(1) variant** — run AI tools under `script` or a custom recorder
4. **Terminal multiplexer plugin** — tmux/screen plugin that records panes running AI tools

### Advantages

1. **Works for any CLI tool** — not IDE-specific, captures claude CLI, codex CLI, any future tool
2. **No IDE configuration** — pure terminal integration
3. **Full I/O capture** — sees everything including tool calls, errors, streaming output
4. **Single integration point** — one mechanism for all tools

### Problems

1. **Only works for CLI tools** — Cursor, VSCode, and other GUI IDEs don't use the terminal for AI interactions. This immediately excludes the primary use case (IDE-embedded AI).

2. **Streaming output parsing** — AI CLI tools stream output with ANSI escape codes, progress indicators, tool call formatting. Parsing this into clean turns is non-trivial.

3. **PTY overhead** — adds latency to every keystroke. AI tools are already slow; adding a proxy layer is noticeable.

4. **No structured metadata** — terminal I/O is unstructured text. No session IDs, workspace context, or conversation boundaries. Would need heuristic parsing to detect conversation starts/ends.

5. **Multi-tool confusion** — if the user runs `claude` inside a tmux pane while also having other commands, separating AI output from other output is hard.

6. **Security concerns** — recording all terminal I/O could capture passwords, API keys, and other sensitive data typed in the same terminal.

7. **No injection** — same as file watching, passive capture cannot inject context into session start.

### Who Does This

- **Warp terminal** — captures command history with AI context, but doesn't capture AI conversation content
- **asciinema** — records terminal sessions, but as replay files, not structured data
- **script(1)** — Unix tool for recording terminal sessions, but produces raw typescript files

### Verdict

Terminal capture is poorly suited for this problem:
- Doesn't work for IDE-embedded AI (the main use case)
- Produces unstructured data that requires complex parsing
- Cannot do injection
- Security concerns with broad I/O recording

This approach makes sense for a different product (CLI-only AI usage analytics) but not for conversation memory.
