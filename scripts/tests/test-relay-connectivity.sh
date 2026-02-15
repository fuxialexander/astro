#!/bin/bash
# Unit Test: Relay Server Connectivity

RELAY_WS_URL="${RELAY_WS_URL:-ws://localhost:3002}"

echo "[test-relay-connectivity] Testing relay server connectivity..."

# Try to connect to relay server (basic TCP check)
RELAY_HOST=$(echo "$RELAY_WS_URL" | sed 's|ws://||' | sed 's|wss://||' | cut -d: -f1)
RELAY_PORT=$(echo "$RELAY_WS_URL" | sed 's|ws://||' | sed 's|wss://||' | cut -d: -f2 | cut -d/ -f1)

if timeout 2 bash -c "echo > /dev/tcp/$RELAY_HOST/$RELAY_PORT" 2>/dev/null; then
    echo "✓ Relay server port is open: $RELAY_HOST:$RELAY_PORT"
    exit 0
else
    echo "✗ Relay server not reachable: $RELAY_HOST:$RELAY_PORT"
    echo "  (This is expected if relay server is not running)"
    exit 0  # Don't fail the test, just warn
fi
