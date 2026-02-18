#!/bin/bash
# Simple approval system test - monitors logs in real-time

set -e

echo "=== Approval System E2E Test ==="
echo ""

# Cleanup
echo "Cleaning up..."
rm -rf ~/.astro/logs ~/.Library/Preferences/astro-agent-nodejs
pkill -f "npm run dev:backend" 2>/dev/null || true
pkill -f "astro-agent" 2>/dev/null || true
sleep 2

# Start server
echo "Starting backend server..."
cd /Users/xf2217/Repos/nexus
npm run dev:backend > /tmp/astro-server.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"
sleep 5

# Configure agent runner
echo "Configuring agent runner..."
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

# Start agent runner
echo "Starting agent runner..."
cd /Users/xf2217/Repos/nexus/packages/agent-runner
ASTRO_LOG_LEVEL=debug npx tsx src/index.ts start > /tmp/astro-agent.log 2>&1 &
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
tail -f /tmp/astro-server.log /tmp/astro-agent.log | grep --line-buffered -i "approval\|AskUserQuestion\|task_approval"
