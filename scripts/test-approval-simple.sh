#!/bin/bash
# Simple approval system test - monitors logs in real-time

set -e

echo "=== Approval System E2E Test ==="
echo ""

# Cleanup
echo "Cleaning up..."
rm -rf ~/.nexus/logs ~/.Library/Preferences/nexus-agent-nodejs
pkill -f "npm run dev:backend" 2>/dev/null || true
pkill -f "nexus-agent" 2>/dev/null || true
sleep 2

# Start server
echo "Starting backend server..."
cd /Users/xf2217/Repos/nexus
npm run dev:backend > /tmp/nexus-server.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"
sleep 5

# Configure agent runner
echo "Configuring agent runner..."
mkdir -p ~/.nexus
cat > ~/.nexus/config.json <<'EOF'
{
  "runnerId": "test-runner",
  "machineId": "test-machine",
  "relayUrl": "ws://localhost:3002",
  "providers": ["claude-sdk"],
  "autoStart": false,
  "logLevel": "debug"
}
EOF

# Start agent runner
echo "Starting agent runner..."
cd /Users/xf2217/Repos/nexus/packages/agent-runner
NEXUS_LOG_LEVEL=debug npx tsx src/index.ts start > /tmp/nexus-agent.log 2>&1 &
AGENT_PID=$!
echo "Agent PID: $AGENT_PID"
sleep 5

echo ""
echo "=== System Started ==="
echo "Server: http://localhost:3001"
echo "Relay: ws://localhost:3002"
echo ""
echo "Monitoring logs for approval flow..."
echo "Press Ctrl+C to stop"
echo ""

# Monitor logs in real-time
tail -f /tmp/nexus-server.log /tmp/nexus-agent.log | grep --line-buffered -i "approval\|AskUserQuestion\|task_approval"
