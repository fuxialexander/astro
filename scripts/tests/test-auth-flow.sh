#!/bin/bash
# Unit Test: Auth Flow

API_BASE="${API_BASE:-http://localhost:3001}"

echo "[test-auth-flow] Testing authentication flow..."

# Check mode
MODE=$(curl -s "$API_BASE/api/health" | jq -r '.mode // "unknown"')

if [ "$MODE" = "indexeddb" ] || [ "$MODE" = "development" ]; then
    echo "Testing IndexedDB mode (no auth)..."

    # Should get dev-user session without auth
    SESSION=$(curl -s "$API_BASE/api/auth/session")

    if echo "$SESSION" | jq -e '.user.id == "00000000-0000-0000-0000-000000000000"' > /dev/null 2>&1; then
        echo "✓ Dev mode auth working correctly"
        exit 0
    else
        echo "✗ Dev mode auth failed"
        echo "$SESSION"
        exit 1
    fi
else
    echo "Testing Supabase mode (auth required)..."

    # Without token, should be unauthorized
    SESSION=$(curl -s "$API_BASE/api/auth/session")

    if echo "$SESSION" | jq -e '.authenticated == false' > /dev/null 2>&1; then
        echo "✓ Unauthorized access correctly denied"
    else
        echo "✗ Expected unauthorized, got: $SESSION"
        exit 1
    fi

    # With token (if provided), should be authorized
    if [ -n "$AUTH_TOKEN" ]; then
        SESSION_AUTHED=$(curl -s "$API_BASE/api/auth/session" \
            -H "Authorization: Bearer $AUTH_TOKEN")

        if echo "$SESSION_AUTHED" | jq -e '.authenticated == true' > /dev/null 2>&1; then
            echo "✓ Authorized access working"
            exit 0
        else
            echo "✗ Authorized access failed"
            echo "$SESSION_AUTHED"
            exit 1
        fi
    else
        echo "✓ Auth requirement verified (no token provided for full test)"
        exit 0
    fi
fi
