#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# dev-with-tunnel.sh — Start everything for dev mode in one command
#
# Runs: Supabase (Docker) + Frontend + Backend + Agent + Cloudflare Tunnel
# All output is interleaved with colored labels via concurrently.
#
# Usage:
#   npm run env:dev && npm run dev:tunnel
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── 1. Ensure env is set to dev ─────────────────────────────────────
if [[ -L "$REPO_ROOT/.env.local" ]]; then
  target=$(readlink "$REPO_ROOT/.env.local")
  if [[ "$target" != *".local.dev" ]]; then
    echo "Error: .env.local is not pointing to dev profile (currently → $target)"
    echo "Run: npm run env:dev"
    exit 1
  fi
elif [[ ! -f "$REPO_ROOT/.env.local" ]]; then
  echo "Error: No .env.local found. Run: npm run env:dev"
  exit 1
fi

# ── 2. Ensure Supabase is running ───────────────────────────────────
if ! nc -z 127.0.0.1 54321 &>/dev/null; then
  echo "Starting Supabase (Docker)..."

  if ! command -v supabase &>/dev/null; then
    echo "Error: supabase CLI not installed"
    echo "Install: brew install supabase/tap/supabase"
    exit 1
  fi

  if ! docker info &>/dev/null; then
    echo "Error: Docker is not running. Please start Docker Desktop."
    exit 1
  fi

  supabase start
  echo "Supabase is running"
else
  echo "Supabase already running on :54321"
fi

# ── 3. Ensure tunnel config exists ──────────────────────────────────
# Run the tunnel setup (creates DNS routes, writes cloudflared config)
# but DON'T start the tunnel yet — concurrently will do that
if ! command -v cloudflared &>/dev/null; then
  echo "Error: cloudflared not installed"
  echo "Install: brew install cloudflared"
  exit 1
fi

# Load domain from .env
DOMAIN=""
if [[ -f "$REPO_ROOT/.env" ]]; then
  DOMAIN=$(grep -E '^CLOUDFLARED_DOMAIN=' "$REPO_ROOT/.env" | cut -d= -f2- || true)
fi
if [[ -z "$DOMAIN" ]]; then
  echo "Error: CLOUDFLARED_DOMAIN not set in .env"
  exit 1
fi

TUNNEL_NAME="astro"
APP_SUBDOMAIN="astro.$DOMAIN"
API_SUBDOMAIN="astro-api.$DOMAIN"
RELAY_SUBDOMAIN="astro-relay.$DOMAIN"
SUPABASE_SUBDOMAIN="astro-supabase.$DOMAIN"

# Get or create tunnel
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
fi

# Add DNS routes (idempotent)
for subdomain in "$APP_SUBDOMAIN" "$API_SUBDOMAIN" "$RELAY_SUBDOMAIN" "$SUPABASE_SUBDOMAIN"; do
  cloudflared tunnel route dns "$TUNNEL_NAME" "$subdomain" 2>&1 | grep -q "already exists" && true
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
      http2Origin: false
      connectTimeout: 30s
      tcpKeepAlive: 30s
      keepAliveConnections: 100
      keepAliveTimeout: 90s
  - hostname: $API_SUBDOMAIN
    service: http://localhost:3001
  - hostname: $RELAY_SUBDOMAIN
    service: http://localhost:3002
  - hostname: $SUPABASE_SUBDOMAIN
    service: http://localhost:54321
  - service: http_status:404
EOF

# ── 4. Kill stale port processes (opt-in to avoid killing prod runners) ──
if [[ "${KILL_PORTS:-0}" == "1" ]]; then
  for port in 5173 3001 3002; do
    pids=$(lsof -ti ":$port" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
      echo "Killing stale process on port $port"
      echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
  done
fi

# ── 5. Start everything with concurrently ───────────────────────────
echo ""
echo "Starting dev mode:"
echo "  Frontend:  http://localhost:5173  →  https://$APP_SUBDOMAIN"
echo "  Backend:   http://localhost:3001  →  https://$API_SUBDOMAIN"
echo "  Relay:     http://localhost:3002  →  https://$RELAY_SUBDOMAIN"
echo "  Supabase:  http://localhost:54321 →  https://$SUPABASE_SUBDOMAIN"
echo ""

exec npx concurrently \
  -n fe,be,agent,tunnel \
  -c blue,green,yellow,magenta \
  "vite" \
  "tsx watch --env-file-if-exists=.env --env-file-if-exists=.env.local server/index.ts" \
  "sleep 2 && npm run dev:agent" \
  "cloudflared tunnel run $TUNNEL_NAME"
