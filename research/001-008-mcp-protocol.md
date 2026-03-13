# MCP Protocol — What It Provides vs What We Build Around

- **Source**: MCP specification + ai-memory codebase
- **Type**: analysis
- **Accessed**: 2026-03-13

## Findings

### What MCP Already Provides

MCP (Model Context Protocol) is a stdio JSON-RPC protocol for IDE-to-tool communication. It provides:
- **Tool registration** — tools declare their schemas, IDEs discover them
- **Tool invocation** — IDEs call tools with validated parameters
- **Stdio transport** — universal, works across all IDEs that support MCP

ai-memory uses MCP for 5 tools: search, conversations, conversation, summarize, status.

### What MCP Does NOT Provide

MCP is a **request-response** protocol. It does NOT provide:
1. **Lifecycle hooks** — no session start/end events
2. **Passive observation** — tools only run when explicitly called
3. **Context injection** — no mechanism to inject context into prompts
4. **Conversation awareness** — MCP tools don't know about the IDE's conversation state

### The Gap

This is exactly the gap that IDE hooks fill:
- **Hooks** = passive observation + injection (session-start, prompt-submit, stop)
- **MCP tools** = on-demand retrieval (search, browse, summarize)

If MCP had a "session lifecycle" extension (onSessionStart, onTurnComplete), the entire hook system would be unnecessary. The MCP server could register for lifecycle events and handle both capture AND injection through a single integration point.

### Could MCP Replace Hooks?

**Not today.** MCP's design is tool-centric (client calls server). Adding lifecycle events would require:
- New event types in the protocol (server-initiated notifications)
- IDE implementations to emit these events
- All IDEs to agree on event semantics

MCP does have a `notifications` mechanism (server → client), but no IDE uses it for conversation lifecycle.

### What a Pure-MCP Future Looks Like

If MCP added lifecycle events:
```
MCP Server registers:
  - onSessionStart → inject context
  - onTurnComplete → capture turn
  - tools: search, conversations, summarize, status
```

**One integration point** instead of hooks.json + settings.json + config.toml + MCP registration.

This would eliminate:
- IDE-specific hook config generation
- Stdin parsing adapters
- Phantom hook detection
- Per-IDE output formatting
- The entire init-config.ts

### Current Reality

Today, ai-memory needs BOTH:
1. **MCP** — for LLM-callable tools (search, summarize)
2. **IDE hooks** — for passive capture and injection

This dual integration is the primary source of complexity.
