#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER_DIR="$REPO_ROOT/packages/agent-runner"

# Load env files (.env then .env.local, later values override)
for f in "$REPO_ROOT/.env" "$REPO_ROOT/.env.local" "$REPO_ROOT/.env.prod"; do
  if [[ -f "$f" ]]; then
    set -a
    source "$f"
    set +a
  fi
done

# Parse flags
WITH_SSH_CONFIG=""
MACHINE_NAME=""
AUTO_START="false"
while [[ $# -gt 0 ]]; do
  case $1 in
    --with-ssh-config)
      WITH_SSH_CONFIG="--with-ssh-config"
      shift
      ;;
    --hostname|--machine-name)
      MACHINE_NAME="$2"
      shift 2
      ;;
    --auto-start)
      AUTO_START="true"
      shift
      ;;
    --api)
      ASTRO_BASE_URL="$2"
      shift 2
      ;;
    --relay)
      ASTRO_RELAY_URL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Resolve API URL: explicit flag > env vars > Fly.io default
API_URL="${ASTRO_BASE_URL:-${FRONTEND_URL:-}}"
if [[ -z "$API_URL" ]]; then
  FLY_APP="${FLY_APP:-astro-backend-platform}"
  API_URL="https://${FLY_APP}.fly.dev"
  echo "No ASTRO_BASE_URL or FRONTEND_URL set, using Fly.io default: $API_URL"
fi

# Resolve Relay URL: explicit flag > env var > derive from API URL
RELAY_URL="${ASTRO_RELAY_URL:-}"
if [[ -z "$RELAY_URL" ]]; then
  FLY_APP="${FLY_APP:-astro-backend-platform}"
  RELAY_URL="wss://${FLY_APP}.fly.dev:3002"
  echo "No ASTRO_RELAY_URL set, using Fly.io default: $RELAY_URL"
fi

# Auto-detect machine name if not provided
if [[ -z "$MACHINE_NAME" ]]; then
  MACHINE_NAME="$(uname -n)"
  echo "Auto-detected machine hostname: $MACHINE_NAME"
fi

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

# Build setup command with flags
SETUP_FLAGS="--api $API_URL --relay $RELAY_URL --type remote --hostname $MACHINE_NAME --install-mcp"
if [[ "$AUTO_START" == "true" ]]; then
  SETUP_FLAGS="$SETUP_FLAGS --auto-start"
fi
if [[ -n "$WITH_SSH_CONFIG" ]]; then
  SETUP_FLAGS="$SETUP_FLAGS --with-ssh-config"
fi

# Run setup (device auth flow)
echo ""
echo "Starting agent setup..."
echo "  API:        $API_URL"
echo "  Relay:      $RELAY_URL"
echo "  Hostname:   $MACHINE_NAME"
echo "  Auto-start: $AUTO_START"
echo ""
echo "You will be prompted to approve the device in your browser."
echo ""
node "$RUNNER_DIR/dist/cli.js" setup $SETUP_FLAGS

# Start the agent runner
echo ""
echo "Starting agent runner..."
node "$RUNNER_DIR/dist/cli.js" start --foreground
