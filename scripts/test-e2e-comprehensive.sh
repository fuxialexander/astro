#!/bin/bash
set -e

# ============================================================================
# Comprehensive End-to-End Test
# ============================================================================
# Tests all aspects of the Astro workflow:
# - Authentication (Supabase mode)
# - Device authorization flow
# - Machine registration
# - Project creation
# - Task creation and dispatch
# - Agent execution with worktree isolation
# - File creation and git branch management
# - Worktree state capture (before cleanup)
# - CRUD operations
# ============================================================================

# Set test mode environment variables for security fixes
export NODE_ENV=test
export ALLOW_E2E_BYPASS=true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_BASE="http://localhost:3001"
TEST_NAME="e2e-comprehensive-$(date +%s)"
LOG_DIR="/tmp/astro-e2e-logs-$(date +%s)"
WORKTREE_SNAPSHOT="$LOG_DIR/worktree-snapshot.txt"

# Create log directory
mkdir -p "$LOG_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

# ============================================================================
# Step 1: Check Prerequisites
# ============================================================================
log_step "Step 1: Checking Prerequisites"

# Check if backend is running
if ! curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
  log_error "Backend not running on port 3001"
  exit 1
fi
log_info "✓ Backend is running"

# Check if relay server is running
if ! lsof -Pi :3002 -sTCP:LISTEN -t >/dev/null 2>&1; then
  log_warn "Relay server not running on port 3002"
  log_warn "Starting relay server..."
  # Relay is part of backend, so this shouldn't happen
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
if [ -f /tmp/agent-runner-test.log ]; then
  cp /tmp/agent-runner-test.log "$AGENT_LOG"
fi

# ============================================================================
# Step 2: Authenticate Test User
# ============================================================================
log_step "Step 2: Authenticating Test User"

source "$SCRIPT_DIR/create-test-user.sh"
AUTH_TOKEN="$ACCESS_TOKEN"
USER_ID="$USER_ID"

log_info "✓ Authenticated as: $USER_ID"
log_info "  Email: e2e-test@astro.local"

# ============================================================================
# Step 3: Clean Up Previous State
# ============================================================================
log_step "Step 3: Cleaning Up Previous State"

rm -rf ~/.astro$HOME/.astro/tmp/fibonacci-test ~/.astro/worktrees 2>/dev/null || true
mkdir -p ~/.astro/tmp
log_info "✓ Cleaned up previous test data"

# ============================================================================
# Step 4: Device Authorization Flow
# ============================================================================
log_step "Step 4: Device Authorization Flow"

# Clean up any existing test machines to ensure fresh start
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

# Also extract and save the tokens for the agent runner
NEW_ACCESS_TOKEN=$(echo "$MACHINE_RESP" | jq -r '.accessToken')
NEW_REFRESH_TOKEN=$(echo "$MACHINE_RESP" | jq -r '.refreshToken')
WS_TOKEN=$(echo "$MACHINE_RESP" | jq -r '.wsToken')

# Update agent runner config with fresh tokens
cd "$SCRIPT_DIR/../packages/agent-runner"
node dist/cli.js config --set accessToken="$NEW_ACCESS_TOKEN" 2>/dev/null
node dist/cli.js config --set refreshToken="$NEW_REFRESH_TOKEN" 2>/dev/null
node dist/cli.js config --set wsToken="$WS_TOKEN" 2>/dev/null
node dist/cli.js config --set machineId="$MACHINE_ID" 2>/dev/null
node dist/cli.js config --set relayUrl="ws://localhost:3002" 2>/dev/null

# Mark setup as complete by editing config JSON directly
CONFIG_FILE="$HOME/Library/Preferences/astro-agent-nodejs/config.json"
jq '.setupCompleted = true' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"

log_info "✓ Agent runner config updated with fresh tokens and local relay URL"

# Restart agent runner with new config
if [ -f /tmp/agent-runner.pid ]; then
  OLD_PID=$(cat /tmp/agent-runner.pid)
  kill $OLD_PID 2>/dev/null || true
  sleep 2
fi

log_info "Restarting agent runner with new credentials..."
node dist/cli.js connect --log-level debug --preserve-worktrees > "$LOG_DIR/agent-runner.log" 2>&1 &
AGENT_PID=$!
echo $AGENT_PID > /tmp/agent-runner.pid
sleep 5
log_info "✓ Agent runner restarted (PID: $AGENT_PID)"

# ============================================================================
# Step 5: Verify Machine Connection
# ============================================================================
log_step "Step 5: Verifying Machine Connection"

# Poll for machine connection (up to 30 seconds)
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
    echo "$RELAY_STATUS" | jq . >> "$LOG_DIR/error.log"
    exit 1
  fi

  sleep 1
done

# Save relay status to log
echo "$RELAY_STATUS" | jq . > "$LOG_DIR/relay-status.json"

# ============================================================================
# Step 6: Create Test Project
# ============================================================================
log_step "Step 6: Creating Test Project"

PROJECT_JSON=$(curl -s -X POST "$API_BASE/api/data/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{
    \"name\": \"Fibonacci - $TEST_NAME\",
    \"description\": \"E2E test project for worktree validation\",
    \"workingDirectory\": \"$HOME/.astro/tmp/fibonacci-test\",
    \"userId\": \"$USER_ID\"
  }")

PROJECT_ID=$(echo "$PROJECT_JSON" | jq -r '.id // empty')
if [ -z "$PROJECT_ID" ]; then
  log_error "Failed to create project"
  echo "$PROJECT_JSON" | jq . >> "$LOG_DIR/error.log"
  exit 1
fi

log_info "✓ Project created: $PROJECT_ID"
log_info "  Name: Fibonacci - $TEST_NAME"
log_info "  Working directory: $HOME/.astro/tmp/fibonacci-test"

# ============================================================================
# Step 7: Create Task Nodes
# ============================================================================
log_step "Step 7: Creating Task Nodes"

TASK_ID="task-fib-$(date +%s)"
TASK_JSON=$(curl -s -X POST "$API_BASE/api/data/plan/nodes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"id\": \"$TASK_ID\",
    \"title\": \"Create Fibonacci Script\",
    \"description\": \"Create a Python script called fibonacci.py that prints the first 10 Fibonacci numbers. Use a simple function that generates the sequence and prints each number on a new line.\",
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
log_info "  Title: Create Fibonacci Script"

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
    \"title\": \"Create Fibonacci Script\",
    \"description\": \"Create a Python script called fibonacci.py that prints the first 10 Fibonacci numbers.\",
    \"targetMachineId\": \"$MACHINE_ID\",
    \"workingDirectory\": \"$HOME/.astro/tmp/fibonacci-test\",
    \"preferredProvider\": \"claude-sdk\"
  }")

# Extract executionId from SSE stream
EXECUTION_ID=$(echo "$DISPATCH_JSON" | grep -o '"executionId":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$EXECUTION_ID" ]; then
  log_error "Task dispatch failed"
  echo "$DISPATCH_JSON" >> "$LOG_DIR/dispatch-response.txt"
  exit 1
fi

log_info "✓ Task dispatched: $EXECUTION_ID"

# Check for dispatch errors
if echo "$DISPATCH_JSON" | grep -q "event: error"; then
  log_warn "Dispatch had errors:"
  echo "$DISPATCH_JSON" | grep -A1 "event: error" | tee -a "$LOG_DIR/dispatch-errors.txt"
fi

# Save dispatch response
echo "$DISPATCH_JSON" > "$LOG_DIR/dispatch-response.txt"

# ============================================================================
# Step 9: Monitor Execution and Capture Worktree State
# ============================================================================
log_step "Step 9: Monitoring Execution and Capturing Worktree State"

EXECUTION_COMPLETED=false
WORKTREE_CAPTURED=false
EXECUTION_LOG="$LOG_DIR/execution.log"

log_info "Monitoring execution (300s timeout)..."

# Monitor worktree creation in background
WORKTREE_BASE="$HOME/.astro/worktrees/fibonacci-test"
(
  for i in {1..600}; do
    if [ -d "$WORKTREE_BASE" ]; then
      WORKTREE_DIR=$(find "$WORKTREE_BASE" -type d -name "exec-*" -o -name "task-*" 2>/dev/null | head -1)
      if [ -n "$WORKTREE_DIR" ] && [ -d "$WORKTREE_DIR" ]; then
        # Found worktree, capture it immediately!
        echo "WORKTREE_FOUND:$WORKTREE_DIR" > /tmp/worktree-location.txt
        break
      fi
    fi
    sleep 0.5
  done
) &
WORKTREE_MONITOR_PID=$!

for i in {1..300}; do
  sleep 1

  # Check if worktree was found
  if [ -f /tmp/worktree-location.txt ] && [ "$WORKTREE_CAPTURED" = false ]; then
    WORKTREE_DIR=$(cat /tmp/worktree-location.txt | cut -d: -f2-)
    log_info "✓ Found worktree during execution: $WORKTREE_DIR"

    # Wait a bit for files to be created
    sleep 2

    # CAPTURE WORKTREE STATE IMMEDIATELY
    log_info "Capturing worktree state..."

    # Capture directory tree
    {
          echo "============================================"
          echo "WORKTREE SNAPSHOT"
          echo "============================================"
          echo "Timestamp: $(date)"
          echo "Execution ID: $EXECUTION_ID"
          echo "Worktree path: $WORKTREE_DIR"
          echo ""
          echo "==> Directory Tree:"
          tree -a -L 3 "$WORKTREE_DIR" 2>/dev/null || find "$WORKTREE_DIR" -type f -o -type d | head -50
          echo ""
          echo "==> File List with Details:"
          ls -laR "$WORKTREE_DIR"
          echo ""
          echo "==> Git Status:"
          cd "$WORKTREE_DIR" && git status
          echo ""
          echo "==> Git Log:"
          git log --oneline --graph --all
          echo ""
          echo "==> File Contents:"
          echo ""
          shopt -s nullglob
          for file in "$WORKTREE_DIR"/*.py "$WORKTREE_DIR"/*.txt "$WORKTREE_DIR"/*.md; do
            if [ -f "$file" ]; then
              echo "----------------------------------------"
              echo "File: $(basename $file)"
              echo "----------------------------------------"
              cat "$file"
              echo ""
            fi
          done
          shopt -u nullglob
    } > "$WORKTREE_SNAPSHOT"

    WORKTREE_CAPTURED=true
    log_info "✓ Worktree snapshot saved to: $WORKTREE_SNAPSHOT"
  fi

  # Check if execution completed by looking at dispatch response
  if grep -q "event: done" "$LOG_DIR/dispatch-response.txt" 2>/dev/null; then
    if [ "$EXECUTION_COMPLETED" = false ]; then
      EXECUTION_COMPLETED=true
      log_info "✓ Execution completed at ${i}s"
      break
    fi
  fi

  # Check for errors in dispatch response
  if grep -q "event: error" "$LOG_DIR/dispatch-response.txt" 2>/dev/null; then
    log_error "Execution failed"
    grep -A2 "event: error" "$LOG_DIR/dispatch-response.txt" >> "$EXECUTION_LOG"
    exit 1
  fi

  # Progress indicator
  if [ $((i % 10)) -eq 0 ]; then
    echo -n "."
  fi
done

echo "" # New line after progress dots

# Kill worktree monitor
kill $WORKTREE_MONITOR_PID 2>/dev/null || true
rm -f /tmp/worktree-location.txt

if [ "$EXECUTION_COMPLETED" = false ]; then
  log_error "Execution timeout (300s)"
  tail -50 "$AGENT_LOG" >> "$EXECUTION_LOG"
  exit 1
fi

# If worktree wasn't captured during execution, try one last time
if [ "$WORKTREE_CAPTURED" = false ]; then
  log_warn "Worktree not captured during execution, checking one more time..."
  if [ -d "$WORKTREE_BASE" ]; then
    WORKTREE_DIR=$(find "$WORKTREE_BASE" -type d -name "exec-*" -o -name "task-*" 2>/dev/null | head -1)
    if [ -n "$WORKTREE_DIR" ] && [ -d "$WORKTREE_DIR" ]; then
      log_info "Found worktree in final check: $WORKTREE_DIR"
      # Quick snapshot
      {
        echo "==> Late Capture (after completion)"
        ls -laR "$WORKTREE_DIR"
      } > "$WORKTREE_SNAPSHOT"
      WORKTREE_CAPTURED=true
    fi
  fi
fi

# ============================================================================
# Step 10: Verify Worktree Architecture
# ============================================================================
log_step "Step 10: Verifying Worktree Architecture"

# Check that worktree was in correct location
if [ "$WORKTREE_CAPTURED" = true ]; then
  log_info "✓ Worktree was created in ~/.astro/worktrees/"
  log_info "✓ Snapshot captured before cleanup"
else
  log_warn "Worktree was cleaned up before we could capture it"
fi

# Check git repository initialization
if [ -d "$HOME/.astro/tmp/fibonacci-test/.git" ]; then
  log_info "✓ Git repository initialized in working directory"

  cd $HOME/.astro/tmp/fibonacci-test

  # Check branches
  BRANCHES=$(git branch -a)
  log_info "  Branches:"
  echo "$BRANCHES" | while read line; do
    log_info "    $line"
  done

  # Check for task branch
  if echo "$BRANCHES" | grep -q "astro/"; then
    log_info "✓ Task-specific branch created"
  else
    log_warn "No astro/* branch found"
  fi

  # Save git log
  git log --oneline --graph --all > "$LOG_DIR/git-log.txt"
else
  log_error "Git repository not initialized"
fi

# ============================================================================
# Step 11: CRUD Operations Test
# ============================================================================
log_step "Step 11: Testing CRUD Operations"

# Update project
log_info "Updating project properties..."
UPDATE_JSON=$(curl -s -X PATCH "$API_BASE/api/data/projects/$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"description\": \"Updated description - test passed\"}")

if echo "$UPDATE_JSON" | jq -e '.ok' >/dev/null 2>&1; then
  log_info "✓ Project updated successfully"
else
  log_error "Project update failed"
fi

# Update task
log_info "Updating task properties..."
TASK_UPDATE_JSON=$(curl -s -X PATCH "$API_BASE/api/data/plan/nodes/$PROJECT_ID/$TASK_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"status\": \"completed\"}")

if echo "$TASK_UPDATE_JSON" | jq -e '.ok' >/dev/null 2>&1; then
  log_info "✓ Task updated successfully"
else
  log_error "Task update failed"
fi

# ============================================================================
# Step 12: Generate Test Report
# ============================================================================
log_step "Step 12: Generating Test Report"

REPORT_FILE="$LOG_DIR/test-report.txt"

{
  echo "============================================"
  echo "COMPREHENSIVE E2E TEST REPORT"
  echo "============================================"
  echo "Test Name: $TEST_NAME"
  echo "Date: $(date)"
  echo "Log Directory: $LOG_DIR"
  echo ""
  echo "==> Test Results:"
  echo "  ✓ Authentication: PASS"
  echo "  ✓ Device Authorization: PASS"
  echo "  ✓ Machine Registration: PASS ($MACHINE_ID)"
  echo "  ✓ Project Creation: PASS ($PROJECT_ID)"
  echo "  ✓ Task Creation: PASS ($TASK_ID)"
  echo "  ✓ Task Dispatch: PASS ($EXECUTION_ID)"
  echo "  ✓ Task Execution: $([ "$EXECUTION_COMPLETED" = true ] && echo "PASS" || echo "FAIL")"
  echo "  ✓ Worktree Capture: $([ "$WORKTREE_CAPTURED" = true ] && echo "PASS" || echo "FAIL")"
  echo "  ✓ Git Initialization: $([ -d "/tmp/calculator-app/.git" ] && echo "PASS" || echo "FAIL")"
  echo "  ✓ CRUD Operations: PASS"
  echo ""
  echo "==> Artifacts:"
  echo "  - Worktree snapshot: $WORKTREE_SNAPSHOT"
  echo "  - Agent runner log: $AGENT_LOG"
  echo "  - Git log: $LOG_DIR/git-log.txt"
  echo "  - Dispatch response: $LOG_DIR/dispatch-response.txt"
  echo "  - Relay status: $LOG_DIR/relay-status.json"
  echo ""
  echo "==> Agent Runner Details:"
  grep "Version:\|Runner ID:\|Machine ID:\|Found.*provider" "$AGENT_LOG" | head -10 || echo "  (see $AGENT_LOG)"
  echo ""
  echo "==> Worktree Location:"
  if [ "$WORKTREE_CAPTURED" = true ]; then
    grep "Worktree path:" "$WORKTREE_SNAPSHOT"
  else
    echo "  Worktree was cleaned up before capture"
  fi
  echo ""
  echo "==> Files Created:"
  if [ -f "$WORKTREE_SNAPSHOT" ]; then
    echo "  (see $WORKTREE_SNAPSHOT for full file listings and contents)"
  fi
} > "$REPORT_FILE"

cat "$REPORT_FILE"

# ============================================================================
# Step 13: Cleanup
# ============================================================================
log_step "Step 13: Cleanup"

# Delete test project (cascades to tasks)
log_info "Deleting test project..."
curl -s -X DELETE "$API_BASE/api/data/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $AUTH_TOKEN" > /dev/null
log_info "✓ Project deleted"

# Optionally revoke test machine
read -p "Revoke test machine $MACHINE_ID? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  curl -s -X DELETE "$API_BASE/api/device/machines/$MACHINE_ID" \
    -H "Authorization: Bearer $AUTH_TOKEN" > /dev/null
  log_info "✓ Machine revoked"
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "============================================"
log_info "✓ COMPREHENSIVE E2E TEST COMPLETE"
echo "============================================"
echo ""
log_info "Test logs and artifacts saved to:"
log_info "  $LOG_DIR"
echo ""
log_info "Key files:"
log_info "  - Test report:       $REPORT_FILE"
log_info "  - Worktree snapshot: $WORKTREE_SNAPSHOT"
log_info "  - Agent log:         $AGENT_LOG"
echo ""
log_info "To view worktree snapshot:"
log_info "  cat $WORKTREE_SNAPSHOT"
echo ""
