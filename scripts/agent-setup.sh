#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: ./scripts/agent-setup.sh <domain>"
  echo "Example: ./scripts/agent-setup.sh fuxialexander.work"
  exit 1
fi

API_URL="https://nexus-api.$DOMAIN"
RELAY_URL="wss://nexus-relay.$DOMAIN"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER_DIR="$REPO_ROOT/packages/agent-runner"

# Check Node.js is available
if ! command -v node &>/dev/null; then
  echo "Error: node is not installed"
  exit 1
fi

# Build agent runner
echo "Building agent runner..."
cd "$RUNNER_DIR"
npm install
npm run build
cd "$REPO_ROOT"

# Run interactive setup (device auth flow)
echo ""
echo "Starting agent setup..."
echo "  API:   $API_URL"
echo "  Relay: $RELAY_URL"
echo ""
echo "You will be prompted to approve the device in your browser."
echo ""
node "$RUNNER_DIR/dist/cli.js" setup --api "$API_URL" --relay "$RELAY_URL" --type remote

# Start the agent runner
echo ""
echo "Starting agent runner..."
node "$RUNNER_DIR/dist/cli.js" start --foreground
