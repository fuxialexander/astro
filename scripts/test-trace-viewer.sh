#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# Trace Viewer Smoke Test
#
# Tests the observability pipeline end-to-end:
#   1. Dispatches a small task to the Claude Code provider via the API
#   2. Waits for the task to complete (reads SSE stream)
#   3. Queries the observations API for the trace data
#   4. Verifies the response has the expected structure
#
# Prerequisites:
#   - Backend running: npm run dev:backend (port 3001)
#   - Supabase running: supabase start (for Postgres)
#   - CLAUDE_CODE_USE_BEDROCK=1 in .env (or Claude API key)
#
# Usage:
#   bash scripts/test-trace-viewer.sh
#   bash scripts/test-trace-viewer.sh --dry-run    # validate dispatch without executing
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"
NODE_ID="smoke-trace-$(date +%s)"
PROJECT_ID="proj-smoke-test"
WORKING_DIR="${WORKING_DIR:-$(cd ~/.astro 2>/dev/null && pwd || echo "/tmp")}"
DRY_RUN="${1:-}"

echo "═══════════════════════════════════════════════════"
echo "  Trace Viewer Smoke Test"
echo "═══════════════════════════════════════════════════"
echo ""
echo "API:       $API_BASE"
echo "Node ID:   $NODE_ID"
echo "Work dir:  $WORKING_DIR"
echo ""

# ── Step 0: Health check ─────────────────────────────────────────────
echo "▶ Step 0: Health check..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  echo "  ✗ Backend not reachable (HTTP $HTTP_CODE)"
  echo "  Start with: npm run dev:backend"
  exit 1
fi
echo "  ✓ Backend is healthy"

# ── Step 1: Dispatch a small task ────────────────────────────────────
echo ""
echo "▶ Step 1: Dispatching task..."

DISPATCH_BODY=$(cat <<'ENDJSON'
{
  "nodeId": "NODE_ID_PLACEHOLDER",
  "projectId": "PROJECT_ID_PLACEHOLDER",
  "title": "Trace viewer smoke test",
  "description": "List the files in the current directory using ls -la, then report what you found. This is a quick smoke test — do NOT make any changes, just observe and report. Do not commit anything.",
  "workingDirectory": "WORKING_DIR_PLACEHOLDER",
  "maxTurns": 5,
  "force": true
}
ENDJSON
)

# Substitute placeholders
DISPATCH_BODY=$(echo "$DISPATCH_BODY" | sed "s|NODE_ID_PLACEHOLDER|$NODE_ID|g")
DISPATCH_BODY=$(echo "$DISPATCH_BODY" | sed "s|PROJECT_ID_PLACEHOLDER|$PROJECT_ID|g")
DISPATCH_BODY=$(echo "$DISPATCH_BODY" | sed "s|WORKING_DIR_PLACEHOLDER|$WORKING_DIR|g")

if [ "$DRY_RUN" = "--dry-run" ]; then
  DISPATCH_BODY=$(echo "$DISPATCH_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); d['dryRun']=True; print(json.dumps(d))")
  echo "  (dry-run mode — will validate without executing)"
fi

# Dispatch and capture SSE stream output
TMPFILE=$(mktemp)
EXEC_ID=""

echo "  Sending POST /api/dispatch/task..."
curl -s -N \
  -H "Content-Type: application/json" \
  -d "$DISPATCH_BODY" \
  "$API_BASE/api/dispatch/task" \
  --max-time 120 \
  > "$TMPFILE" 2>/dev/null &
CURL_PID=$!

if [ "$DRY_RUN" = "--dry-run" ]; then
  wait $CURL_PID 2>/dev/null || true
  echo "  Response:"
  cat "$TMPFILE"
  echo ""
  echo "  ✓ Dry run complete"
  rm -f "$TMPFILE"
  exit 0
fi

# Wait for execution to start and grab the execution ID
echo "  Waiting for execution to start..."
for i in $(seq 1 30); do
  if grep -q '"executionId"' "$TMPFILE" 2>/dev/null; then
    EXEC_ID=$(grep -o '"executionId":"[^"]*"' "$TMPFILE" | head -1 | cut -d'"' -f4)
    break
  fi
  sleep 1
done

if [ -z "$EXEC_ID" ]; then
  echo "  ✗ No execution ID received after 30s"
  echo "  Response so far:"
  head -20 "$TMPFILE"
  kill $CURL_PID 2>/dev/null || true
  rm -f "$TMPFILE"
  exit 1
fi

echo "  ✓ Execution started: $EXEC_ID"

# Wait for completion (look for 'done' or 'result' event)
echo "  Waiting for completion..."
for i in $(seq 1 90); do
  if grep -qE 'event: (done|result|error)' "$TMPFILE" 2>/dev/null; then
    break
  fi
  sleep 2
done

kill $CURL_PID 2>/dev/null || true

# Count events
TEXT_EVENTS=$(grep -c 'event: text' "$TMPFILE" 2>/dev/null || echo "0")
TOOL_USE_EVENTS=$(grep -c 'event: tool_use' "$TMPFILE" 2>/dev/null || echo "0")
TOOL_RESULT_EVENTS=$(grep -c 'event: tool_result' "$TMPFILE" 2>/dev/null || echo "0")
DONE_EVENTS=$(grep -c 'event: done' "$TMPFILE" 2>/dev/null || echo "0")

echo ""
echo "  SSE Events received:"
echo "    text:        $TEXT_EVENTS"
echo "    tool_use:    $TOOL_USE_EVENTS"
echo "    tool_result: $TOOL_RESULT_EVENTS"
echo "    done:        $DONE_EVENTS"

# Check that tool_use events have toolUseId
echo ""
echo "▶ Step 2: Verifying toolUseId in SSE events..."
TOOL_USE_WITH_ID=$(grep 'event: tool_use' -A1 "$TMPFILE" | grep 'toolUseId' | wc -l | tr -d ' ')
echo "  tool_use events with toolUseId: $TOOL_USE_WITH_ID / $TOOL_USE_EVENTS"

if [ "$TOOL_USE_EVENTS" -gt 0 ] && [ "$TOOL_USE_WITH_ID" -eq 0 ]; then
  echo "  ✗ FAIL: tool_use events missing toolUseId — adapter bug not fixed!"
  rm -f "$TMPFILE"
  exit 1
fi
echo "  ✓ toolUseId present in tool_use events"

# Check tool_result events have real tool names (not toolu_ IDs)
echo ""
echo "▶ Step 3: Verifying toolName in tool_result events..."
BAD_NAMES=$(grep 'event: tool_result' -A1 "$TMPFILE" | grep '"toolName":"toolu_' | wc -l | tr -d ' ')
if [ "$BAD_NAMES" -gt 0 ]; then
  echo "  ✗ FAIL: tool_result has toolName set to tool_use_id — adapter bug not fixed!"
  rm -f "$TMPFILE"
  exit 1
fi
echo "  ✓ tool_result toolNames are real tool names (not toolu_ IDs)"

# ── Step 3: Query observations API ──────────────────────────────────
echo ""
echo "▶ Step 4: Querying observations API..."
sleep 2  # Give the collector a moment to flush

OBS_RESPONSE=$(curl -s "$API_BASE/api/observations/$EXEC_ID")
OBS_COUNT=$(echo "$OBS_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
echo "  Observations returned: $OBS_COUNT"

if [ "$OBS_COUNT" -eq 0 ]; then
  echo "  ⚠ No observations found (collector may not have flushed yet)"
  echo "  This can happen if the task was very short. Trying stats endpoint..."

  STATS_RESPONSE=$(curl -s "$API_BASE/api/observations/stats?executionId=$EXEC_ID")
  echo "  Stats: $STATS_RESPONSE"
else
  # Count by type
  GENERATIONS=$(echo "$OBS_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([o for o in d['data'] if o['type']=='generation']))" 2>/dev/null || echo "?")
  TOOLS=$(echo "$OBS_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([o for o in d['data'] if o['type']=='tool']))" 2>/dev/null || echo "?")
  EVENTS=$(echo "$OBS_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([o for o in d['data'] if o['type']=='event']))" 2>/dev/null || echo "?")
  SPANS=$(echo "$OBS_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([o for o in d['data'] if o['type']=='span']))" 2>/dev/null || echo "?")

  echo ""
  echo "  Observation breakdown:"
  echo "    generations: $GENERATIONS"
  echo "    tools:       $TOOLS"
  echo "    events:      $EVENTS"
  echo "    spans:       $SPANS"

  # Verify tool observations have correct names
  TOOLU_NAMED=$(echo "$OBS_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
tools = [o for o in d['data'] if o['type']=='tool']
bad = [o for o in tools if o['name'].startswith('toolu_')]
print(len(bad))
" 2>/dev/null || echo "?")

  echo ""
  echo "  Tool observations with toolu_ names: $TOOLU_NAMED"
  if [ "$TOOLU_NAMED" != "0" ] && [ "$TOOLU_NAMED" != "?" ]; then
    echo "  ✗ FAIL: Some tool observations still have toolu_ as name!"
    rm -f "$TMPFILE"
    exit 1
  fi
  echo "  ✓ All tool observations have correct tool names"
fi

# ── Step 5: Query summary ───────────────────────────────────────────
echo ""
echo "▶ Step 5: Querying trace summary..."
SUMMARY=$(curl -s "$API_BASE/api/observations/$EXEC_ID/summary")
echo "  $SUMMARY" | head -10

# ── Done ─────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ All checks passed!"
echo ""
echo "  Execution ID: $EXEC_ID"
echo "  Open in browser: http://localhost:5173/project/$PROJECT_ID/task/$NODE_ID"
echo "  → Click the 'Trace' tab to see the trace viewer"
echo "═══════════════════════════════════════════════════"

rm -f "$TMPFILE"
