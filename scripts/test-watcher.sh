#!/usr/bin/env bash
# test-watcher.sh — smoke test for the D044 file-watch capture system
# Uses an isolated DB and a synthetic transcript. Your real DB is never touched.
set -euo pipefail

WORKTREE="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DB="/tmp/ai-memory-test-$$.db"
PROBE_DIR="$HOME/.claude/projects/-test-watcher-probe-$$"
PROBE_SESSION="probe-session-$$"
PROBE_FILE="$PROBE_DIR/$PROBE_SESSION.jsonl"
MCP_PID=""

cleanup() {
  echo ""
  echo "--- Cleanup ---"
  if [[ -n "$MCP_PID" ]] && kill -0 "$MCP_PID" 2>/dev/null; then
    kill "$MCP_PID" 2>/dev/null && echo "MCP server stopped (pid $MCP_PID)"
  fi
  rm -f "$TEST_DB" "${MCP_LOG:-}" && echo "Removed test DB: $TEST_DB"
  rm -rf "$PROBE_DIR" && echo "Removed probe transcript: $PROBE_DIR"
}
trap cleanup EXIT

CLI="node $WORKTREE/dist/cli.js"
export AI_MEMORY_DB_PATH="$TEST_DB"

echo "=== ai-memory file-watcher smoke test ==="
echo "Worktree : $WORKTREE"
echo "Test DB  : $TEST_DB"
echo "Probe dir: $PROBE_DIR"
echo ""

# ── 1. Build ─────────────────────────────────────────────────────────────────
echo "--- Step 1: Build (backend only — dashboard not needed) ---"
cd "$WORKTREE"
npm run build --silent
echo "Build OK"

# ── 2. Init fresh DB ─────────────────────────────────────────────────────────
echo ""
echo "--- Step 2: Init ---"
$CLI init --json | jq -r '"Init: " + if .ok then "OK" else "FAILED: " + .error end'

# ── 3. Start MCP server (file watcher lives here) ────────────────────────────
echo ""
echo "--- Step 3: Start MCP server (background) ---"
MCP_LOG="/tmp/mcp-test-$$.log"
# Redirect stdin from a kept-open pipe so the process isn't suspended by SIGTTIN
# Redirect stdout to log (MCP protocol traffic) and stderr to log (our diagnostics)
$CLI mcp < <(cat) >"$MCP_LOG" 2>&1 &
MCP_PID=$!
echo "MCP server started (pid $MCP_PID), log: $MCP_LOG"
sleep 3  # wait for watcher setup + startup catch-up to complete

# ── 4. Verify server is alive ────────────────────────────────────────────────
echo ""
echo "--- Step 4: Verify server started ---"
if kill -0 "$MCP_PID" 2>/dev/null; then
  echo "OK — MCP server is running (pid $MCP_PID)"
else
  echo "✗ FAIL — MCP server died at startup"
  [[ -f "$MCP_LOG" ]] && echo "Log:" && cat "$MCP_LOG"
  exit 1
fi

# ── 5. Write synthetic transcript ────────────────────────────────────────────
echo ""
echo "--- Step 5: Write synthetic transcript ---"
mkdir -p "$PROBE_DIR"
cat > "$PROBE_FILE" <<EOF
{"type":"user","timestamp":"2026-03-14T10:00:00Z","message":{"content":[{"type":"text","text":"test the file watcher — probe $$"}]}}
{"type":"assistant","timestamp":"2026-03-14T10:00:05Z","message":{"content":[{"type":"text","text":"captured via fs.watch, not hooks"}]}}
EOF
echo "Wrote: $PROBE_FILE"

# ── 6. Wait for watcher to fire (debounce is 500ms) ──────────────────────────
echo ""
echo "--- Step 6: Wait 2s for watcher debounce + import ---"
sleep 2

# ── 7. Verify capture (search for probe by unique title) ─────────────────────
echo ""
echo "--- Step 7: Search for probe conversation ---"
SEARCH_RESULT=$($CLI search "test the file watcher" --json)
PROBE_FOUND=$(echo "$SEARCH_RESULT" | jq '[.conversations[] | select(.title | test("probe"))] | length')

if [[ "$PROBE_FOUND" -gt 0 ]]; then
  echo "✓ PASS — probe conversation found via search"
  echo "$SEARCH_RESULT" | jq '[.conversations[] | select(.title | test("probe"))][0] | {id, title, workspace, ide}'
else
  echo "✗ FAIL — probe not found in search, watcher did not capture the file"
  exit 1
fi

# ── 8. Verify turns ───────────────────────────────────────────────────────────
echo ""
echo "--- Step 8: Check turns ---"
CONV_ID=$(echo "$SEARCH_RESULT" | jq -r '[.conversations[] | select(.title | test("probe"))][0].id')
if [[ -z "$CONV_ID" || "$CONV_ID" == "null" ]]; then
  echo "✗ FAIL — could not find probe conversation ID"
  exit 1
fi

TURNS=$($CLI conversation "$CONV_ID" --json | jq '.turns | length')
if [[ "$TURNS" -eq 2 ]]; then
  echo "✓ PASS — 2 turns captured (user + assistant)"
else
  echo "✗ FAIL — expected 2 turns, got $TURNS"
  exit 1
fi

# ── 9. Verify has_more in search ──────────────────────────────────────────────
echo ""
echo "--- Step 9: Search + has_more field ---"
SEARCH=$($CLI search "probe" --json)
HAS_MORE=$(echo "$SEARCH" | jq '.has_more')
if [[ "$HAS_MORE" == "false" || "$HAS_MORE" == "true" ]]; then
  echo "✓ PASS — has_more field present: $HAS_MORE"
else
  echo "✗ FAIL — has_more field missing from search response"
  exit 1
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== ALL CHECKS PASSED ==="
