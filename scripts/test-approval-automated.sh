#!/bin/bash
# Automated approval system test

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Automated Approval System Test ==="
echo ""

# Cleanup
echo "Step 1: Cleanup..."
rm -rf ~/.astro/logs ~/.Library/Preferences/astro-agent-nodejs /tmp/astro-*.log
pkill -f "npm run dev:backend" 2>/dev/null || true
pkill -f "astro-agent" 2>/dev/null || true
sleep 2

# Start server
echo "Step 2: Starting backend server..."
cd /Users/xf2217/Repos/nexus
npm run dev:backend > /tmp/astro-server.log 2>&1 &
SERVER_PID=$!
echo "  Server PID: $SERVER_PID"
sleep 5

# Check if server is running
if ! curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "ERROR: Server failed to start"
    cat /tmp/astro-server.log
    exit 1
fi
echo "  ✓ Server running on http://localhost:3001"

# Configure agent runner
echo "Step 3: Configuring agent runner..."
mkdir -p ~/.astro
cat > ~/.astro/config.json <<'EOF'
{
  "runnerId": "test-runner",
  "machineId": "test-machine",
  "relayUrl": "ws://localhost:3002",
  "providers": ["claude-sdk"],
  "autoStart": false,
  "logLevel": "debug"
}
EOF
echo "  ✓ Config written to ~/.astro/config.json"

# Build agent runner
echo "Step 4: Building agent runner..."
cd /Users/xf2217/Repos/nexus/packages/agent-runner
npm run build > /dev/null 2>&1
echo "  ✓ Agent runner built"

# Start agent runner
echo "Step 5: Starting agent runner..."
ASTRO_LOG_LEVEL=debug npx tsx src/index.ts start > /tmp/astro-agent.log 2>&1 &
AGENT_PID=$!
echo "  Agent PID: $AGENT_PID"
sleep 8

# Check agent runner logs for connection
if grep -q "Connected to relay server" /tmp/astro-agent.log; then
    echo "  ✓ Agent runner connected to relay"
else
    echo "  WARNING: Agent runner may not be connected"
fi

# Dispatch test task
echo ""
echo "Step 6: Dispatching test task with approval trigger..."
cd /Users/xf2217/Repos/nexus

# Create a simple task that will ask a question
TASK_PROMPT='Please use the AskUserQuestion tool to ask me: "Which color do you prefer?" with options: red, blue, green'

RESPONSE=$(curl -s -X POST http://localhost:3001/api/dispatch/task \
  -H "Content-Type: application/json" \
  -d "{
    \"nodeId\": \"test-approval-$(date +%s)\",
    \"projectId\": \"test-project\",
    \"title\": \"Test Approval Flow\",
    \"description\": \"$TASK_PROMPT\",
    \"environment\": \"remote\",
    \"verification\": \"human\",
    \"preferredProvider\": \"claude-sdk\"
  }" 2>&1)

if echo "$RESPONSE" | grep -q '"success":true'; then
    echo "  ✓ Task dispatched successfully"
    EXECUTION_ID=$(echo "$RESPONSE" | grep -o '"executionId":"[^"]*"' | cut -d'"' -f4)
    echo "  Execution ID: $EXECUTION_ID"
else
    echo "  ✗ Task dispatch failed: $RESPONSE"
fi

echo ""
echo "Step 7: Monitoring logs for 45 seconds..."
echo "  Looking for approval request flow..."
echo ""

# Monitor for specific patterns
sleep 15

echo "=== Checking Results ==="
echo ""

# Check agent runner logs
echo "Agent Runner Logs:"
if grep -q "Intercepted AskUserQuestion" /tmp/astro-agent.log; then
    echo "  ✓ AskUserQuestion intercepted"
else
    echo "  ✗ AskUserQuestion NOT intercepted"
fi

if grep -q "Sent approval request" /tmp/astro-agent.log; then
    echo "  ✓ Approval request sent to relay"
else
    echo "  ✗ Approval request NOT sent"
fi

if grep -q "task_approval_request" /tmp/astro-agent.log; then
    echo "  ✓ WebSocket message type correct"
fi

echo ""
echo "Relay Server Logs:"
if grep -q "Approval request from task" /tmp/astro-server.log; then
    echo "  ✓ Relay received approval request"
    grep "Approval request from task" /tmp/astro-server.log | tail -1
else
    echo "  ✗ Relay did NOT receive approval request"
fi

if grep -q "task:approval_request" /tmp/astro-server.log; then
    echo "  ✓ Event emitted to SSE"
fi

echo ""
echo "=== Full Agent Runner Log (last 50 lines) ==="
tail -50 /tmp/astro-agent.log | grep -E "approval|AskUserQuestion|Intercepted|canUseTool" || echo "No approval-related messages"

echo ""
echo "=== Full Server Log (approval-related) ==="
grep -i "approval" /tmp/astro-server.log | tail -20 || echo "No approval-related messages"

# Cleanup
echo ""
echo "Cleaning up..."
kill $SERVER_PID 2>/dev/null || true
kill $AGENT_PID 2>/dev/null || true

echo ""
echo "=== Test Complete ==="
echo "Logs saved to:"
echo "  - /tmp/astro-server.log"
echo "  - /tmp/astro-agent.log"
