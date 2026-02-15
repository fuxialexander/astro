#!/bin/bash
# Simple test to verify --preserve-worktrees flag

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Testing --preserve-worktrees flag${NC}\n"

# Authenticate
echo "Step 1: Authenticating..."
AUTH_RESPONSE=$(bash scripts/create-test-user.sh 2>&1)
TEST_AUTH_TOKEN=$(echo "$AUTH_RESPONSE" | grep "export TEST_AUTH_TOKEN" | cut -d'"' -f2)
echo "✓ Authenticated"

# Create or reuse device
echo -e "\nStep 2: Setting up device..."
DEVICE_CODE=$(curl -s -X POST http://localhost:3001/api/device/authorize \
  -H "Content-Type: application/json" \
  -d '{"environmentType":"local"}' | jq -r '.device_code')

# Auto-approve
curl -s -X POST "http://localhost:3001/api/device/authorize/$DEVICE_CODE/approve" \
  -H "Authorization: Bearer $TEST_AUTH_TOKEN" > /dev/null

# Get tokens
TOKEN_RESPONSE=$(curl -s -X POST http://localhost:3001/api/device/token \
  -H "Content-Type: application/json" \
  -d "{\"device_code\":\"$DEVICE_CODE\"}")

WS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.ws_token')
MACHINE_ID=$(echo "$TOKEN_RESPONSE" | jq -r '.machine_id')

# Configure agent runner
cd packages/agent-runner
node dist/cli.js config --set wsToken="$WS_TOKEN"
node dist/cli.js config --set machineId="$MACHINE_ID"
echo "✓ Device configured: $MACHINE_ID"

# Start agent runner with --preserve-worktrees
echo -e "\nStep 3: Starting agent runner with --preserve-worktrees..."
node dist/cli.js connect --log-level info --preserve-worktrees > /tmp/agent-preserve-test.log 2>&1 &
AGENT_PID=$!
sleep 5
echo "✓ Agent runner started (PID: $AGENT_PID)"

# Create project and task
cd ../..
echo -e "\nStep 4: Creating test project and task..."
PROJECT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
TASK_ID="task-preserve-$(date +%s)"

curl -s -X POST http://localhost:3001/api/data/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_AUTH_TOKEN" \
  -d "{\"id\":\"$PROJECT_ID\",\"name\":\"Preserve Test\",\"workingDirectory\":\"/tmp/preserve-test\"}" > /dev/null

curl -s -X POST http://localhost:3001/api/data/plan-nodes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_AUTH_TOKEN" \
  -d "{\"id\":\"$TASK_ID\",\"projectId\":\"$PROJECT_ID\",\"title\":\"Test Task\",\"prompt\":\"Create a file hello.txt with content 'Hello World'\"}" > /dev/null

echo "✓ Project created: $PROJECT_ID"
echo "✓ Task created: $TASK_ID"

# Dispatch task
echo -e "\nStep 5: Dispatching task..."
EXECUTION_ID=$(curl -s -X POST http://localhost:3001/api/dispatch/task \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_AUTH_TOKEN" \
  -d "{
    \"taskId\":\"$TASK_ID\",
    \"projectId\":\"$PROJECT_ID\",
    \"targetMachineId\":\"$MACHINE_ID\",
    \"preferredProvider\":\"claude-sdk\",
    \"prompt\":\"Create a file hello.txt with content 'Hello World'\",
    \"title\":\"Test Task\",
    \"description\":\"Testing worktree preservation\"
  }" 2>&1 | grep -o 'exec-[^"]*' | head -1)

echo "✓ Task dispatched: $EXECUTION_ID"

# Wait for execution
echo -e "\nStep 6: Waiting for execution (30s)..."
sleep 30

# Check for worktrees
echo -e "\nStep 7: Checking for preserved worktrees..."
if [ -d "$HOME/.nexus/worktrees" ]; then
  echo -e "${GREEN}✓ Worktrees directory exists!${NC}"
  echo ""
  find "$HOME/.nexus/worktrees" -type d -maxdepth 3
  echo ""

  # Find any worktree for this project
  WORKTREE=$(find "$HOME/.nexus/worktrees" -type d -name "exec-*" | head -1)
  if [ -n "$WORKTREE" ]; then
    echo -e "${GREEN}✓ Found preserved worktree: $WORKTREE${NC}"
    echo ""
    echo "Files:"
    ls -la "$WORKTREE"
    echo ""
    if [ -f "$WORKTREE/hello.txt" ]; then
      echo "Content of hello.txt:"
      cat "$WORKTREE/hello.txt"
      echo ""
      echo -e "${GREEN}SUCCESS! Worktree was preserved with files!${NC}"
    fi
  else
    echo -e "${YELLOW}No exec-* worktrees found${NC}"
  fi
else
  echo -e "${YELLOW}Worktrees directory not created${NC}"
fi

# Cleanup
echo -e "\nStep 8: Cleanup..."
kill $AGENT_PID 2>/dev/null || true
curl -s -X DELETE "http://localhost:3001/api/data/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $TEST_AUTH_TOKEN" > /dev/null

echo "✓ Done"
echo ""
echo "Agent runner log: /tmp/agent-preserve-test.log"
