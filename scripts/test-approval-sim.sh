#!/bin/bash
# Simulate user responding to approval request

LOG_FILE="/tmp/agent-test.log"

echo "=== Approval Response Simulation Test ==="
echo ""

# Extract details from most recent approval request in agent logs
echo "Searching for approval request in agent logs..."

# Try to find from running agent
APPROVAL_LINE=$(tail -100 ~/.astro/logs/*.log 2>/dev/null | grep "Sent approval request" | tail -1)

if [ -z "$APPROVAL_LINE" ]; then
    echo "No recent approval request found in logs."
    echo "Make sure an agent is running and has sent an approval request."
    echo ""
    echo "Try running the e2e test first to trigger an approval:"
    echo "  ./scripts/test-e2e-with-approval.sh"
    exit 1
fi

echo "Found approval request:"
echo "$APPROVAL_LINE"
echo ""

# Extract request ID and task ID
# Format: [ws-client] Sent approval request {requestId} for task {taskId}
REQUEST_ID=$(echo "$APPROVAL_LINE" | sed -n 's/.*Sent approval request \([^ ]*\) for task.*/\1/p')
TASK_ID=$(echo "$APPROVAL_LINE" | sed -n 's/.*for task \([^ ]*\).*/\1/p')

echo "Extracted details:"
echo "  Task ID: $TASK_ID"
echo "  Request ID: $REQUEST_ID"

# Find machine ID from agent logs
MACHINE_ID=$(grep -h "machineId" ~/.astro/logs/*.log 2>/dev/null | grep -o '"machineId":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$MACHINE_ID" ]; then
    echo "  Machine ID: (not found, using 'local')"
    MACHINE_ID="local"
else
    echo "  Machine ID: $MACHINE_ID"
fi

echo ""
echo "=== Sending Simulated User Response ==="
echo "Answer: 'All features'"
echo ""

# Send the approval response
RESPONSE=$(curl -s -X POST http://localhost:3001/api/dispatch/approval \
  -H "Content-Type: application/json" \
  -d "{
    \"taskId\": \"$TASK_ID\",
    \"machineId\": \"$MACHINE_ID\",
    \"requestId\": \"$REQUEST_ID\",
    \"answered\": true,
    \"answer\": \"All features\"
  }")

echo "Server response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"

echo ""
echo "=== Checking Agent Logs for Response ==="
echo "Waiting 3 seconds for agent to process..."
sleep 3

if grep -h "Received approval response for $REQUEST_ID" ~/.astro/logs/*.log 2>/dev/null; then
    echo "✅ Agent received the response!"
else
    echo "⚠️  No confirmation found in logs yet"
    echo ""
    echo "Recent agent logs:"
    tail -20 ~/.astro/logs/*.log 2>/dev/null | grep -i "approval\|response"
fi

echo ""
echo "Test complete!"
