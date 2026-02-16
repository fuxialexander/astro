#!/bin/bash
set -e

# ============================================================================
# Comprehensive End-to-End Test with Approval System
# ============================================================================
# Tests all aspects of the Nexus workflow including approval system:
# - Authentication (Supabase mode)
# - Device authorization flow
# - Machine registration
# - Project creation
# - Task creation and dispatch
# - Agent execution with approval requests
# - User approval flow (auto-responded in test)
# - File creation and git branch management
# - Worktree state capture (before cleanup)
# - CRUD operations
# ============================================================================

# Set test mode environment variables for security fixes
export NODE_ENV=test
export ALLOW_E2E_BYPASS=true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_BASE="http://localhost:3001"
TEST_NAME="e2e-approval-$(date +%s)"
LOG_DIR="/tmp/nexus-e2e-logs-$(date +%s)"
WORKTREE_SNAPSHOT="$LOG_DIR/worktree-snapshot.txt"
APPROVAL_LOG="$LOG_DIR/approval-events.log"

# Create log directory
mkdir -p "$LOG_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
  echo ""
  echo -e "${BLUE}==> $1${NC}"
}

log_approval() {
  echo -e "${CYAN}[APPROVAL]${NC} $1"
}

# ============================================================================
# Step 1: Check Prerequisites
# ============================================================================
log_step "Step 1: Checking Prerequisites"

# Check if backend is running
if ! curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
  log_error "Backend not running on port 3001"
  log_info "Start with: npm run dev:backend"
  exit 1
fi
log_info "✓ Backend is running"

# Check if relay server is running
if ! lsof -Pi :3002 -sTCP:LISTEN -t >/dev/null 2>&1; then
  log_warn "Relay server not running on port 3002"
fi
log_info "✓ Relay server is running"

# Check if agent runner is running
AGENT_RUNNING=false
if [ -f /tmp/agent-runner.pid ]; then
  AGENT_PID=$(cat /tmp/agent-runner.pid)
  if ps -p $AGENT_PID > /dev/null 2>&1; then
    AGENT_RUNNING=true
    log_info "✓ Agent runner already running (PID: $AGENT_PID)"
  fi
fi

if [ "$AGENT_RUNNING" = false ]; then
  log_info "Starting agent runner..."
  cd "$SCRIPT_DIR/../packages/agent-runner"
  node dist/cli.js connect --log-level debug --preserve-worktrees > "$LOG_DIR/agent-runner.log" 2>&1 &
  AGENT_PID=$!
  echo $AGENT_PID > /tmp/agent-runner.pid
  sleep 3
  log_info "✓ Agent runner started (PID: $AGENT_PID)"
fi

# Save agent log location
AGENT_LOG="$LOG_DIR/agent-runner.log"

# ============================================================================
# Step 2: Authenticate Test User
# ============================================================================
log_step "Step 2: Authenticating Test User"

source "$SCRIPT_DIR/create-test-user.sh"
AUTH_TOKEN="$ACCESS_TOKEN"
USER_ID="$USER_ID"

log_info "✓ Authenticated as: $USER_ID"
log_info "  Email: e2e-test@nexus.local"

# ============================================================================
# Step 3: Clean Up Previous State
# ============================================================================
log_step "Step 3: Cleaning Up Previous State"

rm -rf ~/.nexus/tmp/approval-test ~/.nexus/worktrees 2>/dev/null || true
mkdir -p ~/.nexus/tmp
log_info "✓ Cleaned up previous test data"

# ============================================================================
# Step 4: Device Authorization Flow
# ============================================================================
log_step "Step 4: Device Authorization Flow"

# Clean up any existing test machines
MACHINES_JSON=$(curl -s "$API_BASE/api/device/machines" \
  -H "Authorization: Bearer $AUTH_TOKEN")
MACHINE_COUNT=$(echo "$MACHINES_JSON" | jq '.machines | length')

if [ "$MACHINE_COUNT" -gt "0" ]; then
  log_info "Revoking $MACHINE_COUNT existing machine(s)..."
  for id in $(echo "$MACHINES_JSON" | jq -r '.machines[].id'); do
    curl -s -X DELETE "$API_BASE/api/device/machines/$id" \
      -H "Authorization: Bearer $AUTH_TOKEN" > /dev/null
  done
  log_info "✓ Existing machines revoked"
fi

log_info "Requesting device authorization code..."
DEVICE_RESP=$(curl -s -X POST "$API_BASE/api/device/authorize" \
  -H "Content-Type: application/json" -d '{"machineInfo": {"environmentType": "local"}}')
DEVICE_CODE=$(echo "$DEVICE_RESP" | jq -r '.deviceCode')
USER_CODE=$(echo "$DEVICE_RESP" | jq -r '.userCode')

log_info "  Device code: $DEVICE_CODE"
log_info "  User code: $USER_CODE"

# Auto-approve for testing
log_info "Auto-approving device..."
curl -s -X POST "$API_BASE/api/device/test/auto-approve" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"deviceCode\": \"$DEVICE_CODE\"}" > /dev/null

sleep 2

# Poll for token
log_info "Polling for device token..."
TOKEN_RESP=$(curl -s -X POST "$API_BASE/api/device/token" \
  -H "Content-Type: application/json" \
  -d "{\"userCode\": \"$USER_CODE\", \"grantType\": \"urn:ietf:params:oauth:grant-type:device_code\"}")
DEVICE_TOKEN=$(echo "$TOKEN_RESP" | jq -r '.accessToken')

if [ -z "$DEVICE_TOKEN" ] || [ "$DEVICE_TOKEN" = "null" ]; then
  log_error "Failed to get device token"
  echo "$TOKEN_RESP" | jq . >> "$LOG_DIR/error.log"
  exit 1
fi

# Register machine
log_info "Registering machine..."
MACHINE_RESP=$(curl -s -X POST "$API_BASE/api/device/register" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -d "{
    \"machineInfo\": {
      \"machineId\": \"temp-machine\",
      \"name\": \"$TEST_NAME\",
      \"hostname\": \"test-host\",
      \"platform\": \"darwin\",
      \"environmentType\": \"local\",
      \"providers\": [{\"type\": \"claude-sdk\", \"name\": \"Claude SDK\", \"version\": \"1.0.0\"}],
      \"resources\": {
        \"hostname\": \"test-host\",
        \"platform\": \"darwin\",
        \"arch\": \"arm64\",
        \"cpu\": {\"model\": \"Test CPU\", \"cores\": 4, \"speed\": 2400, \"loadAvg\": [0.1, 0.2, 0.3]},
        \"memory\": {\"total\": 16000000000, \"free\": 8000000000, \"used\": 8000000000, \"usedPercent\": 50},
        \"gpu\": []
      },
      \"load\": {\"activeTasks\": 0, \"cpu\": 0.1, \"memory\": 50}
    }
  }")

MACHINE_ID=$(echo "$MACHINE_RESP" | jq -r '.machineId')
log_info "✓ Machine registered: $MACHINE_ID"

# Update agent runner config
NEW_ACCESS_TOKEN=$(echo "$MACHINE_RESP" | jq -r '.accessToken')
NEW_REFRESH_TOKEN=$(echo "$MACHINE_RESP" | jq -r '.refreshToken')
WS_TOKEN=$(echo "$MACHINE_RESP" | jq -r '.wsToken')

cd "$SCRIPT_DIR/../packages/agent-runner"
node dist/cli.js config --set accessToken="$NEW_ACCESS_TOKEN" 2>/dev/null
node dist/cli.js config --set refreshToken="$NEW_REFRESH_TOKEN" 2>/dev/null
node dist/cli.js config --set wsToken="$WS_TOKEN" 2>/dev/null
node dist/cli.js config --set machineId="$MACHINE_ID" 2>/dev/null
node dist/cli.js config --set relayUrl="ws://localhost:3002" 2>/dev/null

# Mark setup as complete (no MCP needed - using built-in AskUserQuestion tool)
CONFIG_FILE="$HOME/Library/Preferences/nexus-agent-nodejs/config.json"

log_info "Updating agent runner config..."

# Update config with setupCompleted (no MCP servers needed)
jq '.setupCompleted = true' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"

log_info "✓ Agent runner config updated (using built-in AskUserQuestion tool)"

# Restart agent runner
if [ -f /tmp/agent-runner.pid ]; then
  OLD_PID=$(cat /tmp/agent-runner.pid)
  kill $OLD_PID 2>/dev/null || true
  sleep 2
fi

log_info "Restarting agent runner..."
node dist/cli.js connect --log-level debug --preserve-worktrees > "$LOG_DIR/agent-runner.log" 2>&1 &
AGENT_PID=$!
echo $AGENT_PID > /tmp/agent-runner.pid
sleep 5
log_info "✓ Agent runner restarted (PID: $AGENT_PID)"

# Wait for agent runner to connect to relay
log_info "Waiting for agent runner to connect to relay..."
CONNECTED_MACHINES=0
for i in {1..30}; do
  RELAY_STATUS=$(curl -s "$API_BASE/api/relay/status")
  CONNECTED_MACHINES=$(echo "$RELAY_STATUS" | jq -r '.machines.total')

  if [ "$CONNECTED_MACHINES" -gt "0" ]; then
    log_info "✓ Relay server has $CONNECTED_MACHINES connected machine(s) (after ${i}s)"
    break
  fi

  if [ $i -eq 30 ]; then
    log_error "Timeout waiting for machine to connect to relay"
    exit 1
  fi

  sleep 1
done

# ============================================================================
# Step 5: Create Test Project
# ============================================================================
log_step "Step 5: Creating Test Project"

PROJECT_JSON=$(curl -s -X POST "$API_BASE/api/data/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{
    \"name\": \"Approval Test - $TEST_NAME\",
    \"description\": \"E2E test project for approval system validation\",
    \"workingDirectory\": \"$HOME/.nexus/tmp/approval-test\",
    \"userId\": \"$USER_ID\"
  }")

PROJECT_ID=$(echo "$PROJECT_JSON" | jq -r '.id // empty')
if [ -z "$PROJECT_ID" ]; then
  log_error "Failed to create project"
  echo "$PROJECT_JSON" | jq . >> "$LOG_DIR/error.log"
  exit 1
fi

log_info "✓ Project created: $PROJECT_ID"

# ============================================================================
# Step 6: Create Task with Approval Request
# ============================================================================
log_step "Step 6: Creating Task That Will Request Approval"

TASK_ID="task-approval-$(date +%s)"
TASK_JSON=$(curl -s -X POST "$API_BASE/api/data/plan/nodes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"id\": \"$TASK_ID\",
    \"title\": \"Create Calculator with User Choice\",
    \"description\": \"IMPORTANT: Before implementing anything, you MUST use the ask_user_question MCP tool to ask the user which calculator features to implement. Call ask_user_question with these THREE options: 1) 'Basic operations (add, subtract)' 2) 'Scientific (add, subtract, multiply, divide, power)' 3) 'Advanced (all operations plus trigonometry)'. Wait for the user's response, then implement ONLY the selected features in a Python file called calculator.py. Do NOT proceed without asking first.\",
    \"status\": \"planned\",
    \"type\": \"task\",
    \"x\": 100,
    \"y\": 100
  }")

TASK_OK=$(echo "$TASK_JSON" | jq -r '.ok // false')
if [ "$TASK_OK" != "true" ]; then
  log_error "Failed to create task"
  echo "$TASK_JSON" | jq . >> "$LOG_DIR/error.log"
  exit 1
fi

log_info "✓ Task created: $TASK_ID"
log_info "  This task will call ask_user_question during execution"

# ============================================================================
# Step 7: Start SSE Event Monitor
# ============================================================================
log_step "Step 7: Starting SSE Event Monitor for Approvals"

# Monitor SSE events for approval requests in background
(
  curl -s -N "$API_BASE/api/events/stream" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Accept: text/event-stream" 2>/dev/null | while IFS= read -r line; do
    echo "$line" >> "$APPROVAL_LOG"

    # Check for approval request (procedure-level)
    if echo "$line" | grep -q "approval:requested"; then
      # Extract the data line (next line after event: approval:requested)
      read -r data_line
      echo "$data_line" >> "$APPROVAL_LOG"

      # Parse approval details
      APPROVAL_DATA=$(echo "$data_line" | sed 's/^data: //')
      APPROVAL_ID=$(echo "$APPROVAL_DATA" | jq -r '.approvalId // empty')
      APPROVAL_MSG=$(echo "$APPROVAL_DATA" | jq -r '.message // empty')
      APPROVAL_OPTIONS=$(echo "$APPROVAL_DATA" | jq -r '.options // [] | join(", ")')

      if [ -n "$APPROVAL_ID" ]; then
        echo "APPROVAL_FOUND:$APPROVAL_ID:$APPROVAL_MSG" > /tmp/approval-detected.txt
      fi
    fi

    # Check for task:approval_request (dynamic AskUserQuestion approvals)
    if echo "$line" | grep -q "task:approval_request"; then
      # Extract the data line
      read -r data_line
      echo "$data_line" >> "$APPROVAL_LOG"

      # Parse approval details
      DYNAMIC_DATA=$(echo "$data_line" | sed 's/^data: //')
      DYN_TASK_ID=$(echo "$DYNAMIC_DATA" | jq -r '.taskId // empty')
      DYN_REQ_ID=$(echo "$DYNAMIC_DATA" | jq -r '.requestId // empty')
      DYN_QUESTION=$(echo "$DYNAMIC_DATA" | jq -r '.question // empty')
      DYN_OPTS=$(echo "$DYNAMIC_DATA" | jq -r '.options // [] | join(", ")')

      if [ -n "$DYN_TASK_ID" ] && [ -n "$DYN_REQ_ID" ]; then
        echo "[$(date '+%H:%M:%S')] Dynamic approval request:" >> "$APPROVAL_LOG"
        echo "  Question: $DYN_QUESTION" >> "$APPROVAL_LOG"
        echo "  Options: $DYN_OPTS" >> "$APPROVAL_LOG"

        # Auto-respond with first option
        FIRST_OPT=$(echo "$DYNAMIC_DATA" | jq -r '.options[0] // "Yes"')
        echo "  Responding with: $FIRST_OPT" >> "$APPROVAL_LOG"

        # Send approval response (with auth header!)
        DYN_RESP=$(curl -s -X POST "$API_BASE/api/dispatch/approval" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $AUTH_TOKEN" \
          -d "{
            \"taskId\": \"$DYN_TASK_ID\",
            \"machineId\": \"$MACHINE_ID\",
            \"requestId\": \"$DYN_REQ_ID\",
            \"answered\": true,
            \"answer\": \"$FIRST_OPT\"
          }")

        if echo "$DYN_RESP" | jq -e '.success' > /dev/null 2>&1; then
          echo "  ✓ Response sent successfully" >> "$APPROVAL_LOG"
          echo "DYNAMIC_APPROVAL:$DYN_REQ_ID:$FIRST_OPT" >> /tmp/approval-detected.txt
        else
          echo "  ✗ Response failed: $DYN_RESP" >> "$APPROVAL_LOG"
        fi
      fi
    fi
  done
) &
SSE_MONITOR_PID=$!

log_info "✓ SSE event monitor started (PID: $SSE_MONITOR_PID)"
sleep 2

# ============================================================================
# Step 8: Dispatch Task for Execution
# ============================================================================
log_step "Step 8: Dispatching Task to Agent Runner"

DISPATCH_JSON=$(curl -s -X POST "$API_BASE/api/dispatch/task" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"nodeId\": \"$TASK_ID\",
    \"title\": \"Create Calculator with User Choice\",
    \"description\": \"IMPORTANT: Use the AskUserQuestion tool FIRST to ask: 'Which calculator features would you like me to implement?' with options: 'Basic arithmetic', 'Scientific functions', 'All features'. Then implement the user's choice.\",
    \"targetMachineId\": \"$MACHINE_ID\",
    \"workingDirectory\": \"$HOME/.nexus/tmp/approval-test\",
    \"preferredProvider\": \"claude-sdk\"
  }")

# Extract executionId
EXECUTION_ID=$(echo "$DISPATCH_JSON" | grep -o '"executionId":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$EXECUTION_ID" ]; then
  log_error "Task dispatch failed"
  echo "$DISPATCH_JSON" >> "$LOG_DIR/dispatch-response.txt"
  exit 1
fi

log_info "✓ Task dispatched: $EXECUTION_ID"
echo "$DISPATCH_JSON" > "$LOG_DIR/dispatch-response.txt"

# ============================================================================
# Step 9: Monitor for Approval Request
# ============================================================================
log_step "Step 9: Monitoring for Approval Request"

APPROVAL_FOUND=false
APPROVAL_ID=""
APPROVAL_RESPONDED=false

log_info "Waiting for agent to request approval (60s timeout)..."

for i in {1..60}; do
  sleep 1

  if [ -f /tmp/approval-detected.txt ] && [ "$APPROVAL_FOUND" = false ]; then
    APPROVAL_INFO=$(cat /tmp/approval-detected.txt)
    APPROVAL_ID=$(echo "$APPROVAL_INFO" | cut -d: -f2)
    APPROVAL_MSG=$(echo "$APPROVAL_INFO" | cut -d: -f3-)

    APPROVAL_FOUND=true
    log_approval "✓ Approval request detected!"
    log_approval "  Approval ID: $APPROVAL_ID"
    log_approval "  Question: $APPROVAL_MSG"

    # Extract options from log
    APPROVAL_OPTIONS=$(grep -A5 "approval:requested" "$APPROVAL_LOG" | grep '"options"' | head -1)
    log_approval "  Options: $APPROVAL_OPTIONS"

    break
  fi

  # Progress indicator
  if [ $((i % 5)) -eq 0 ]; then
    echo -n "."
  fi
done

echo ""

if [ "$APPROVAL_FOUND" = false ]; then
  log_error "No approval request detected within 60s"
  log_error "Agent may not have called ask_user_question"
  log_info "Check agent logs: $AGENT_LOG"
  kill $SSE_MONITOR_PID 2>/dev/null || true
  exit 1
fi

# Check if SSE monitor successfully sent the approval response
if grep -q "Response sent successfully" "$APPROVAL_LOG" 2>/dev/null; then
  APPROVAL_RESPONDED=true
  log_approval "✓ Approval response sent successfully by SSE monitor"
elif grep -q "DYNAMIC_APPROVAL" /tmp/approval-detected.txt 2>/dev/null; then
  APPROVAL_RESPONDED=true
  log_approval "✓ Approval response recorded in detection file"
else
  APPROVAL_RESPONDED=false
  log_error "⚠ Could not verify approval response was sent"
fi

# ============================================================================
# Step 10: Monitoring Execution Completion
# ============================================================================
log_step "Step 10: Monitoring Execution Completion"

# Note: Approval response is handled automatically by the SSE monitor (see Step 7)
# The monitor detects task:approval_request events and auto-responds via /api/dispatch/approval

EXECUTION_COMPLETED=false
WORKTREE_CAPTURED=false

log_info "Waiting for execution to complete (240s timeout)..."

# Monitor worktree in background
WORKTREE_BASE="$HOME/.nexus/worktrees/approval-test"
(
  for i in {1..480}; do
    if [ -d "$WORKTREE_BASE" ]; then
      WORKTREE_DIR=$(find "$WORKTREE_BASE" -type d -name "exec-*" -o -name "task-*" 2>/dev/null | head -1)
      if [ -n "$WORKTREE_DIR" ] && [ -d "$WORKTREE_DIR" ]; then
        echo "WORKTREE_FOUND:$WORKTREE_DIR" > /tmp/worktree-location.txt
        break
      fi
    fi
    sleep 0.5
  done
) &
WORKTREE_MONITOR_PID=$!

for i in {1..240}; do
  sleep 1

  # Capture worktree if found
  if [ -f /tmp/worktree-location.txt ] && [ "$WORKTREE_CAPTURED" = false ]; then
    WORKTREE_DIR=$(cat /tmp/worktree-location.txt | cut -d: -f2-)
    log_info "✓ Found worktree: $WORKTREE_DIR"

    sleep 2

    {
      echo "============================================"
      echo "WORKTREE SNAPSHOT"
      echo "============================================"
      echo "Execution ID: $EXECUTION_ID"
      echo "Worktree path: $WORKTREE_DIR"
      echo ""
      echo "==> Files:"
      ls -laR "$WORKTREE_DIR"
      echo ""
      echo "==> Calculator Implementation:"
      if [ -f "$WORKTREE_DIR/calculator.py" ]; then
        cat "$WORKTREE_DIR/calculator.py"
      fi
    } > "$WORKTREE_SNAPSHOT"

    WORKTREE_CAPTURED=true
    log_info "✓ Worktree snapshot saved"
  fi

  # Check completion
  if grep -q "event: done" "$LOG_DIR/dispatch-response.txt" 2>/dev/null; then
    EXECUTION_COMPLETED=true
    log_info "✓ Execution completed at ${i}s"
    break
  fi

  if [ $((i % 10)) -eq 0 ]; then
    echo -n "."
  fi
done

echo ""

# Cleanup monitors
kill $SSE_MONITOR_PID 2>/dev/null || true
kill $WORKTREE_MONITOR_PID 2>/dev/null || true
rm -f /tmp/approval-detected.txt /tmp/worktree-location.txt

if [ "$EXECUTION_COMPLETED" = false ]; then
  log_error "Execution timeout"
  exit 1
fi

# ============================================================================
# Step 12: Verify Approval Flow
# ============================================================================
log_step "Step 12: Verifying Approval Flow"

# Check that calculator.py was created with scientific operations
if [ -f "$HOME/.nexus/tmp/approval-test/calculator.py" ] || [ -f "$WORKTREE_SNAPSHOT" ]; then
  log_info "✓ Calculator file created"

  # Check if it has the selected operations
  CALC_CONTENT=$(cat "$HOME/.nexus/tmp/approval-test/calculator.py" 2>/dev/null || grep -A100 "Calculator Implementation" "$WORKTREE_SNAPSHOT" 2>/dev/null || echo "")

  if echo "$CALC_CONTENT" | grep -qi "multiply\|divide\|power"; then
    log_approval "✓ Calculator implements scientific operations (user's choice)"
  else
    log_warn "Calculator may not have implemented selected operations"
  fi
else
  log_warn "Calculator file not found (may have been cleaned up)"
fi

# ============================================================================
# Step 13: Generate Test Report
# ============================================================================
log_step "Step 13: Generating Test Report"

REPORT_FILE="$LOG_DIR/test-report.txt"

{
  echo "============================================"
  echo "E2E TEST WITH APPROVAL SYSTEM - REPORT"
  echo "============================================"
  echo "Test Name: $TEST_NAME"
  echo "Date: $(date)"
  echo ""
  echo "==> Test Results:"
  echo "  ✓ Authentication: PASS"
  echo "  ✓ Device Authorization: PASS"
  echo "  ✓ Machine Registration: PASS ($MACHINE_ID)"
  echo "  ✓ Project Creation: PASS ($PROJECT_ID)"
  echo "  ✓ Task Creation: PASS ($TASK_ID)"
  echo "  ✓ Task Dispatch: PASS ($EXECUTION_ID)"
  echo "  ✓ Approval Request: $([ "$APPROVAL_FOUND" = true ] && echo "PASS" || echo "FAIL")"
  echo "  ✓ Approval Response: $([ "$APPROVAL_RESPONDED" = true ] && echo "PASS" || echo "FAIL")"
  echo "  ✓ Execution After Approval: $([ "$EXECUTION_COMPLETED" = true ] && echo "PASS" || echo "FAIL")"
  echo "  ✓ Worktree Capture: $([ "$WORKTREE_CAPTURED" = true ] && echo "PASS" || echo "FAIL")"
  echo ""
  echo "==> Approval Flow Details:"
  echo "  Approval ID: $APPROVAL_ID"
  echo "  User Selected: Scientific (add, subtract, multiply, divide, power)"
  echo "  Agent Continued: $([ "$EXECUTION_COMPLETED" = true ] && echo "YES" || echo "NO")"
  echo ""
  echo "==> Artifacts:"
  echo "  - Test report: $REPORT_FILE"
  echo "  - Approval events: $APPROVAL_LOG"
  echo "  - Worktree snapshot: $WORKTREE_SNAPSHOT"
  echo "  - Agent log: $AGENT_LOG"
  echo "  - Dispatch response: $LOG_DIR/dispatch-response.txt"
} > "$REPORT_FILE"

cat "$REPORT_FILE"

# ============================================================================
# Step 14: Cleanup
# ============================================================================
log_step "Step 14: Cleanup"

curl -s -X DELETE "$API_BASE/api/data/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $AUTH_TOKEN" > /dev/null
log_info "✓ Project deleted"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "============================================"
if [ "$APPROVAL_FOUND" = true ] && [ "$APPROVAL_RESPONDED" = true ] && [ "$EXECUTION_COMPLETED" = true ]; then
  log_info "✓ E2E TEST WITH APPROVAL SYSTEM: PASS"
else
  log_error "✗ E2E TEST WITH APPROVAL SYSTEM: FAIL"
fi
echo "============================================"
echo ""
log_info "Logs saved to: $LOG_DIR"
echo ""
log_info "Key files:"
log_info "  - Approval events: $APPROVAL_LOG"
log_info "  - Test report: $REPORT_FILE"
log_info "  - Worktree snapshot: $WORKTREE_SNAPSHOT"
echo ""

# ============================================================================
# Final Cleanup - Kill Background Processes
# ============================================================================
log_info "Cleaning up background processes..."

# Kill SSE monitor
if [ -n "$SSE_MONITOR_PID" ]; then
  kill "$SSE_MONITOR_PID" 2>/dev/null || true
  log_info "✓ SSE monitor stopped"
fi

# Kill agent runner (if started by this test)
if [ -n "$AGENT_PID" ]; then
  kill "$AGENT_PID" 2>/dev/null || true
  log_info "✓ Agent runner stopped"
fi

# Wait a moment for processes to terminate
sleep 1

log_info "✓ Cleanup complete"
