#!/bin/bash
# End-to-end test for approval system
# Tests the full flow: agent runner → relay → browser UI → relay → agent runner

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Approval System E2E Test ==="
echo ""

# Clean up previous test artifacts
echo "Cleaning up..."
rm -rf ~/.astro/logs/test-approval-*.log
rm -rf ~/.Library/Preferences/astro-agent-nodejs

# Start the backend server
echo "Starting backend server..."
cd "$REPO_ROOT"
npm run dev:backend > /tmp/astro-server.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server to be ready
echo "Waiting for server..."
sleep 3

# Start the agent runner
echo "Starting agent runner..."
cd "$REPO_ROOT/packages/agent-runner"
npm run build > /dev/null 2>&1

# Create a test config with MCP tools
mkdir -p ~/.astro
cat > ~/.astro/config.json <<EOF
{
  "runnerId": "test-runner-$(date +%s)",
  "machineId": "test-machine",
  "relayUrl": "ws://localhost:3002",
  "providers": ["claude-sdk"],
  "autoStart": false,
  "logLevel": "debug",
  "mcpServers": {
    "ask-test": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"],
      "env": {}
    }
  }
}
EOF

# Start agent runner with verbose logging
ASTRO_LOG_LEVEL=debug npx tsx src/index.ts start > /tmp/astro-agent.log 2>&1 &
AGENT_PID=$!
echo "Agent runner PID: $AGENT_PID"

# Wait for agent runner to connect
echo "Waiting for agent runner to connect..."
sleep 5

# Monitor logs for approval flow
echo ""
echo "=== Test Flow ==="
echo "1. Agent runner should call AskUserQuestion tool"
echo "2. This gets intercepted and sent to relay as approval request"
echo "3. Relay emits event to SSE stream"
echo "4. (Manual) User would respond via UI"
echo "5. Response sent back to agent via relay"
echo ""

# Dispatch a test task that will trigger an approval
echo "Dispatching test task..."
TASK_RESPONSE=$(curl -s -X POST http://localhost:3001/api/dispatch/task \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "test-approval-node",
    "projectId": "test-approval-project",
    "title": "Test Approval Flow",
    "description": "Please ask me: Which color do you prefer? Options: red, blue, green",
    "environment": "remote",
    "verification": "human"
  }')

echo "Task response: $TASK_RESPONSE"

# Wait and check logs
echo ""
echo "Monitoring logs for 30 seconds..."
sleep 30

# Check agent runner logs for approval flow
echo ""
echo "=== Agent Runner Logs ==="
grep -i "approval\|AskUserQuestion" /tmp/astro-agent.log || echo "No approval messages found in agent logs"

# Check server logs for approval flow
echo ""
echo "=== Server Logs ==="
grep -i "approval" /tmp/astro-server.log || echo "No approval messages found in server logs"

# Cleanup
echo ""
echo "Cleaning up..."
kill $AGENT_PID 2>/dev/null || true
kill $SERVER_PID 2>/dev/null || true

echo ""
echo "=== Test Complete ==="
echo "Check logs above to verify:"
echo "1. Agent intercepted AskUserQuestion"
echo "2. Sent task_approval_request to relay"
echo "3. Relay logged approval request"
echo "4. SSE event emitted"
