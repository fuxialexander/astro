#!/bin/bash
# Unit Test: Project CRUD Operations

API_BASE="${API_BASE:-http://localhost:3001}"
TEST_PROJECT_NAME="Test Project $(date +%s)"

echo "[test-project-crud] Testing project CRUD operations..."

# Check mode and set auth
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

# Create project
echo "Creating project..."
PROJECT_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

CREATE_RESPONSE=$(curl -s -X POST "$API_BASE/api/data/projects" \
    ${AUTH_HEADER} \
    -H "Content-Type: application/json" \
    -d "{
        \"id\": \"$PROJECT_ID\",
        \"name\": \"$TEST_PROJECT_NAME\",
        \"description\": \"Test project for CRUD operations\",
        \"createdAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"updatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }")

if echo "$CREATE_RESPONSE" | jq -e ".id == \"$PROJECT_ID\"" > /dev/null 2>&1; then
    echo "✓ Project created: $PROJECT_ID"
else
    echo "✗ Failed to create project"
    echo "$CREATE_RESPONSE"
    exit 1
fi

# Read project
echo "Reading project..."
READ_RESPONSE=$(curl -s "$API_BASE/api/data/projects/$PROJECT_ID" ${AUTH_HEADER})

if echo "$READ_RESPONSE" | jq -e ".name == \"$TEST_PROJECT_NAME\"" > /dev/null 2>&1; then
    echo "✓ Project read successfully"
else
    echo "✗ Failed to read project"
    exit 1
fi

# Update project
echo "Updating project..."
UPDATE_RESPONSE=$(curl -s -X PATCH "$API_BASE/api/data/projects/$PROJECT_ID" \
    ${AUTH_HEADER} \
    -H "Content-Type: application/json" \
    -d '{"description": "Updated test description"}')

if echo "$UPDATE_RESPONSE" | jq -e '.description == "Updated test description"' > /dev/null 2>&1; then
    echo "✓ Project updated successfully"
else
    echo "✗ Failed to update project"
    exit 1
fi

# Delete project
echo "Deleting project..."
curl -s -X DELETE "$API_BASE/api/data/projects/$PROJECT_ID" ${AUTH_HEADER} > /dev/null

# Verify deletion
DELETE_CHECK=$(curl -s "$API_BASE/api/data/projects/$PROJECT_ID" ${AUTH_HEADER} 2>&1 || echo '{"error": "not found"}')

if echo "$DELETE_CHECK" | jq -e '.error' > /dev/null 2>&1; then
    echo "✓ Project deleted successfully"
    exit 0
else
    echo "✗ Failed to delete project"
    exit 1
fi
