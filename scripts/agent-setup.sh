#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR_TMP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$(cd "$SCRIPT_DIR_TMP/.." && pwd)/.env"

# Parse flags
WITH_SSH_CONFIG=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --with-ssh-config)
      WITH_SSH_CONFIG="--with-ssh-config"
      shift
      ;;
    *)
      DOMAIN="$1"
      shift
      ;;
  esac
done

# Use argument, or fall back to CLOUDFLARED_DOMAIN from .env
if [[ -z "$DOMAIN" && -f "$ENV_FILE" ]]; then
  DOMAIN="$(grep -E '^CLOUDFLARED_DOMAIN=' "$ENV_FILE" | cut -d= -f2- | tr -d '[:space:]')"
fi

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: ./scripts/agent-setup.sh [domain] [--with-ssh-config]"
  echo "If no domain is given, reads CLOUDFLARED_DOMAIN from .env"
  echo "Example: ./scripts/agent-setup.sh fuxialexander.work"
  echo ""
  echo "Options:"
  echo "  --with-ssh-config    Discover and configure remote hosts from SSH config"
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
node "$RUNNER_DIR/dist/cli.js" setup --api "$API_URL" --relay "$RELAY_URL" --type remote $WITH_SSH_CONFIG

# Start the agent runner
echo ""
echo "Starting agent runner..."
node "$RUNNER_DIR/dist/cli.js" start --foreground
