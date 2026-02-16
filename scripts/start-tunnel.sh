#!/usr/bin/env bash
set -euo pipefail

# Load CLOUDFLARED_DOMAIN from .env
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DOMAIN=""
if [[ -f "$REPO_ROOT/.env" ]]; then
  DOMAIN=$(grep -E '^CLOUDFLARED_DOMAIN=' "$REPO_ROOT/.env" | cut -d= -f2- || true)
fi
if [[ -z "$DOMAIN" ]]; then
  echo "Error: CLOUDFLARED_DOMAIN is not set in .env"
  echo "Add CLOUDFLARED_DOMAIN=yourdomain.com to $REPO_ROOT/.env"
  exit 1
fi

# Check cloudflared is installed
if ! command -v cloudflared &>/dev/null; then
  echo "Error: cloudflared is not installed"
  echo "Install: brew install cloudflared (macOS) or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

TUNNEL_NAME="nexus"
APP_SUBDOMAIN="nexus.$DOMAIN"          # Frontend (user-facing app)
API_SUBDOMAIN="nexus-api.$DOMAIN"      # Backend API
RELAY_SUBDOMAIN="nexus-relay.$DOMAIN"  # WebSocket relay

# Get tunnel ID (create if it doesn't exist)
TUNNEL_ID=$(cloudflared tunnel list --output json | python3 -c "
import json, sys
tunnels = json.load(sys.stdin)
for t in tunnels:
    if t['name'] == '$TUNNEL_NAME':
        print(t['id'])
        break
" 2>/dev/null || true)

if [[ -z "$TUNNEL_ID" ]]; then
  echo "Creating tunnel '$TUNNEL_NAME'..."
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_ID=$(cloudflared tunnel list --output json | python3 -c "
import json, sys
tunnels = json.load(sys.stdin)
for t in tunnels:
    if t['name'] == '$TUNNEL_NAME':
        print(t['id'])
        break
")
else
  echo "Tunnel '$TUNNEL_NAME' already exists"
fi

if [[ -z "$TUNNEL_ID" ]]; then
  echo "Error: could not determine tunnel ID"
  exit 1
fi

echo "Tunnel ID: $TUNNEL_ID"

# Add DNS routes (idempotent — skips if already set)
for subdomain in "$APP_SUBDOMAIN" "$API_SUBDOMAIN" "$RELAY_SUBDOMAIN"; do
  if cloudflared tunnel route dns "$TUNNEL_NAME" "$subdomain" 2>&1 | grep -q "already exists"; then
    echo "DNS route $subdomain already exists, skipping"
  else
    echo "Added DNS route: $subdomain"
  fi
done

# Write cloudflared config
CONFIG_DIR="$HOME/.cloudflared"
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_DIR/config.yml" <<EOF
tunnel: $TUNNEL_ID
credentials-file: $CONFIG_DIR/$TUNNEL_ID.json

ingress:
  - hostname: $APP_SUBDOMAIN
    service: http://localhost:5173
    originRequest:
      noTLSVerify: true
  - hostname: $API_SUBDOMAIN
    service: http://localhost:3001
  - hostname: $RELAY_SUBDOMAIN
    service: http://localhost:3002
  - service: http_status:404
EOF

echo "Wrote $CONFIG_DIR/config.yml"

# Update .env.local with external URLs
ENV_FILE="$REPO_ROOT/.env.local"
if [[ -f "$ENV_FILE" ]]; then
  update_env_var() {
    local key=$1
    local value=$2
    if grep -q "^$key=" "$ENV_FILE" 2>/dev/null; then
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^$key=.*|$key=$value|" "$ENV_FILE"
      else
        sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
      fi
    else
      echo "$key=$value" >> "$ENV_FILE"
    fi
  }

  echo "Updating .env.local with external URLs..."
  update_env_var "WEBAUTHN_RP_ID" "$APP_SUBDOMAIN"
  update_env_var "WEBAUTHN_ORIGIN" "https://$APP_SUBDOMAIN"
  echo "✓ Updated environment variables for external access"
fi

# Warn if backend isn't running
if ! curl -sf http://localhost:3001/api/health &>/dev/null; then
  echo "WARNING: Backend not running on localhost:3001"
  echo "Run 'npm run dev:backend' in another terminal first."
  echo ""
fi

echo "Starting tunnel..."
echo "  App:   https://$APP_SUBDOMAIN -> localhost:5173 (Frontend)"
echo "  API:   https://$API_SUBDOMAIN -> localhost:3001 (Backend)"
echo "  Relay: https://$RELAY_SUBDOMAIN -> localhost:3002 (WebSocket)"
echo ""
echo "=================================================="
echo "  Access your app at:"
echo "  👉 https://$APP_SUBDOMAIN"
echo "=================================================="
echo ""
cloudflared tunnel run "$TUNNEL_NAME"
