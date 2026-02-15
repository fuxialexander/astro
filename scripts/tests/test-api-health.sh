#!/bin/bash
# Unit Test: API Health Check

API_BASE="${API_BASE:-http://localhost:3001}"

echo "[test-api-health] Testing API health endpoint..."

# Test health endpoint
RESPONSE=$(curl -s "$API_BASE/api/health" || echo '{"error": "connection failed"}')

if echo "$RESPONSE" | jq -e '.status' > /dev/null 2>&1; then
    echo "✓ API health check passed"
    echo "  Status: $(echo "$RESPONSE" | jq -r '.status')"
    echo "  Mode: $(echo "$RESPONSE" | jq -r '.mode // "unknown"')"
    exit 0
else
    echo "✗ API health check failed"
    echo "$RESPONSE"
    exit 1
fi
