#!/bin/bash
# Integration Test: Device Auth Flow

API_BASE="${API_BASE:-http://localhost:3001}"

echo "[test-device-auth-flow] Testing device authorization flow..."

# Request device code
echo "Requesting device authorization code..."
DEVICE_RESPONSE=$(curl -s -X POST "$API_BASE/api/device/authorize" \
    -H "Content-Type: application/json" \
    -d '{
        "clientId": "test-client",
        "scopes": ["machine:register"]
    }')

DEVICE_CODE=$(echo "$DEVICE_RESPONSE" | jq -r '.deviceCode // empty')
USER_CODE=$(echo "$DEVICE_RESPONSE" | jq -r '.userCode // empty')

if [ -z "$DEVICE_CODE" ]; then
    echo "✗ Failed to get device code"
    echo "$DEVICE_RESPONSE"
    exit 1
fi

echo "✓ Device code obtained: $DEVICE_CODE"
echo "✓ User code: $USER_CODE"

# Poll for token (should get authorization_pending)
echo "Testing token polling (should be pending)..."
TOKEN_RESPONSE=$(curl -s -X POST "$API_BASE/api/device/token" \
    -H "Content-Type: application/json" \
    -d "{
        \"deviceCode\": \"$DEVICE_CODE\",
        \"grantType\": \"urn:ietf:params:oauth:grant-type:device_code\"
    }")

ERROR=$(echo "$TOKEN_RESPONSE" | jq -r '.error // empty')

if [ "$ERROR" = "authorization_pending" ]; then
    echo "✓ Device auth flow working (authorization pending as expected)"
    exit 0
else
    echo "✗ Unexpected response: $ERROR"
    echo "$TOKEN_RESPONSE"
    exit 1
fi
