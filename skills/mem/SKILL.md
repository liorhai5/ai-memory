---
name: mem
description: Search and browse AI conversation history. Requires ai-memory MCP server.
argument-hint: "status | search <query> | conversations | summarize"
disable-model-invocation: true
---

# mem

Requires the ai-memory MCP server. If tools are unavailable, run:
`npx add-mcp "ai-memory mcp" -g -n ai-memory -y`

## Commands

Based on $ARGUMENTS, read and follow the relevant command file:

| Command | File | Purpose |
|---|---|---|
| status | commands/status.md | Health check — conversation count, turn count, tool usage |
| search <query> | commands/search.md | Full-text search over conversation history |
| conversations | commands/conversations.md | Last 10 conversations with titles and summaries |
| summarize | commands/summarize.md | Summarize this conversation and save to ai-memory |

If no command matches, show this table and ask what the user needs.
