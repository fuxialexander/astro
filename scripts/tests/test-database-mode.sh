#!/bin/bash
# Unit Test: Database Mode Detection

API_BASE="${API_BASE:-http://localhost:3001}"

echo "[test-database-mode] Testing database mode detection..."

HEALTH=$(curl -s "$API_BASE/api/health")
MODE=$(echo "$HEALTH" | jq -r '.mode // "unknown"')

case $MODE in
    indexeddb|development)
        echo "✓ IndexedDB mode detected"
        echo "  No authentication required"
        ;;
    supabase|production)
        echo "✓ Supabase mode detected"
        echo "  Authentication required"
        ;;
    *)
        echo "✗ Unknown database mode: $MODE"
        exit 1
        ;;
esac

# Verify mode is consistent across endpoints
AUTH_SESSION=$(curl -s "$API_BASE/api/auth/session" || echo '{}')

if [ "$MODE" = "indexeddb" ] || [ "$MODE" = "development" ]; then
    # Should get dev-user session (UUID: 00000000-0000-0000-0000-000000000000)
    if echo "$AUTH_SESSION" | jq -e '.user.id == "00000000-0000-0000-0000-000000000000"' > /dev/null 2>&1; then
        echo "✓ Mode consistency verified (dev-user in IndexedDB mode)"
        exit 0
    else
        echo "✗ Mode inconsistency: expected dev-user UUID in IndexedDB mode"
        exit 1
    fi
else
    # Should require auth
    if echo "$AUTH_SESSION" | jq -e '.authenticated == false' > /dev/null 2>&1; then
        echo "✓ Mode consistency verified (auth required in Supabase mode)"
        exit 0
    elif echo "$AUTH_SESSION" | jq -e '.authenticated == true' > /dev/null 2>&1; then
        echo "✓ Mode consistency verified (user authenticated in Supabase mode)"
        exit 0
    else
        echo "✗ Unexpected auth response"
        exit 1
    fi
fi
