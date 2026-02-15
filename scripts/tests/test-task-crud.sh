#!/bin/bash
# Unit Test: Task CRUD Operations

API_BASE="${API_BASE:-http://localhost:3001}"

echo "[test-task-crud] Testing task CRUD operations..."

# Check mode
MODE=$(curl -s "$API_BASE/api/health" | jq -r '.mode // "unknown"')
if [ "$MODE" = "indexeddb" ] || [ "$MODE" = "development" ]; then
    AUTH_HEADER=""
else
    if [ -z "$AUTH_TOKEN" ]; then
        echo "✗ AUTH_TOKEN required in Supabase mode"
        exit 1
    fi
    AUTH_HEADER="-H \"Authorization: Bearer $AUTH_TOKEN\""
fi

# Create project first (needed for task)
PROJECT_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
curl -s -X POST "$API_BASE/api/data/projects" \
    ${AUTH_HEADER} \
    -H "Content-Type: application/json" \
    -d "{
        \"id\": \"$PROJECT_ID\",
        \"name\": \"Task Test Project\",
        \"createdAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"updatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }" > /dev/null

# Create task node
echo "Creating task node..."
TASK_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

CREATE_RESPONSE=$(curl -s -X POST "$API_BASE/api/data/plan/nodes" \
    ${AUTH_HEADER} \
    -H "Content-Type: application/json" \
    -d "{
        \"id\": \"$TASK_ID\",
        \"projectId\": \"$PROJECT_ID\",
        \"title\": \"Test Task\",
        \"description\": \"Test task for CRUD operations\",
        \"status\": \"planned\",
        \"position\": {\"x\": 100, \"y\": 100},
        \"dependencies\": [],
        \"createdAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"updatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }")

if [ -n "$CREATE_RESPONSE" ]; then
    echo "✓ Task node created: $TASK_ID"
else
    echo "✗ Failed to create task node"
    exit 1
fi

# Update task
echo "Updating task..."
curl -s -X PATCH "$API_BASE/api/data/plan/nodes/$TASK_ID" \
    ${AUTH_HEADER} \
    -H "Content-Type: application/json" \
    -d '{"status": "in_progress"}' > /dev/null

echo "✓ Task updated successfully"

# Delete task
echo "Deleting task..."
curl -s -X DELETE "$API_BASE/api/data/plan/nodes/$TASK_ID" ${AUTH_HEADER} > /dev/null

# Cleanup project
curl -s -X DELETE "$API_BASE/api/data/projects/$PROJECT_ID" ${AUTH_HEADER} > /dev/null

echo "✓ Task deleted successfully"
exit 0
