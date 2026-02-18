#!/bin/bash
# Test approval response flow - simulate user answering the approval request

set -e

echo "=== Approval Response Test ==="
echo ""

# Kill any existing processes
pkill -f "astro-agent" 2>/dev/null || true
sleep 2

# Clean up
rm -rf ~/.astro/logs /tmp/agent-approval.log

echo "Starting agent runner..."
cd /Users/xf2217/Repos/nexus/packages/agent-runner
ASTRO_LOG_LEVEL=debug npx tsx src/index.ts start > /tmp/agent-approval.log 2>&1 &
AGENT_PID=$!
echo "Agent PID: $AGENT_PID"
sleep 8

# Monitor agent logs in background, looking for approval request
tail -f /tmp/agent-approval.log | while read line; do
    echo "$line"

    # When we see an approval request, extract the details and respond
    if echo "$line" | grep -q "Sent approval request"; then
        echo ""
        echo "=== APPROVAL REQUEST DETECTED ==="

        # Extract task ID and request ID from the log line
        # Format: [ws-client] Sent approval request {requestId} for task {taskId}
        TASK_ID=$(echo "$line" | grep -o "for task [^ ]*" | cut -d' ' -f3)
        REQUEST_ID=$(echo "$line" | grep -o "approval request [^ ]*" | awk '{print $3}')

        echo "Task ID: $TASK_ID"
        echo "Request ID: $REQUEST_ID"

        # Get machine ID from earlier logs
        MACHINE_ID=$(grep "machineId" /tmp/agent-approval.log | grep -o '"machineId":"[^"]*"' | head -1 | cut -d'"' -f4)
        echo "Machine ID: $MACHINE_ID"

        # Wait a bit to ensure the request is fully processed
        sleep 2

        echo ""
        echo "=== SIMULATING USER RESPONSE ==="
        echo "Sending approval response with answer: 'All features'"

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

        echo "Response: $RESPONSE"
        echo ""
        echo "=== Waiting for agent to receive response... ==="
        sleep 5

        # Check if agent received the response
        if grep -q "Received approval response" /tmp/agent-approval.log; then
            echo "✅ Agent received approval response!"
            grep "Received approval response" /tmp/agent-approval.log | tail -1
        else
            echo "⚠️ Agent did not receive response yet"
        fi

        # Check if agent continued execution
        sleep 5
        if grep -q "allow.*updatedInput" /tmp/agent-approval.log; then
            echo "✅ Agent continued with answer!"
        else
            echo "⚠️ Agent did not continue with answer"
        fi

        # Kill the tail process to stop monitoring
        pkill -P $$ tail 2>/dev/null || true
        break
    fi
done &
TAIL_PID=$!

echo ""
echo "Waiting for approval request (up to 120 seconds)..."
echo "Press Ctrl+C to stop"
echo ""

# Wait for the tail process to finish or timeout
timeout 120 wait $TAIL_PID 2>/dev/null || {
    echo ""
    echo "Timeout or completed"
}

echo ""
echo "=== Final Agent Logs (approval-related) ==="
grep -i "approval\|AskUserQuestion\|updatedInput\|answer" /tmp/agent-approval.log | tail -30 || echo "No approval messages"

# Cleanup
kill $AGENT_PID 2>/dev/null || true
pkill -f "tail -f /tmp/agent-approval.log" 2>/dev/null || true

echo ""
echo "Test complete. Full logs at: /tmp/agent-approval.log"
