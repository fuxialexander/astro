#!/bin/bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# deploy.sh — Deploy Astro backend (Fly.io) + frontend (Cloudflare Pages)
#
# Sources all config from .env + .env.local (prod profile).
# Each developer's credentials and URLs live in their own env files.
#
# Usage:
#   bash scripts/deploy.sh              # Deploy backend + frontend
#   bash scripts/deploy.sh backend      # Backend only
#   bash scripts/deploy.sh frontend     # Frontend only
#   bash scripts/deploy.sh --status     # Show Fly.io status
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Source env files ──────────────────────────────────────────────────
# .env has shared secrets, .env.local points to the active profile
for f in "$REPO_ROOT/.env" "$REPO_ROOT/.env.local"; do
  if [[ -f "$f" ]]; then
    set -a
    source "$f"
    set +a
  fi
done

# ── Resolve config ────────────────────────────────────────────────────
APP="${FLY_APP:-astro-backend-platform}"
PAGES_PROJECT="${CLOUDFLARE_PAGES_PROJECT:-astro-app-3vo}"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Validate required vars for prod deploy
check_required() {
  local missing=()
  [[ -z "${VITE_API_BASE_URL:-}" ]] && missing+=("VITE_API_BASE_URL")
  [[ -z "${VITE_SUPABASE_URL:-}" ]] && missing+=("VITE_SUPABASE_URL")
  [[ -z "${VITE_SUPABASE_ANON_KEY:-}" ]] && missing+=("VITE_SUPABASE_ANON_KEY")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Error: Missing required env vars for deployment:"
    for v in "${missing[@]}"; do
      echo "  - $v"
    done
    echo ""
    echo "These should be set in .env.prod. Run:"
    echo "  npm run env:init    # Generate profiles"
    echo "  npm run env:prod    # Switch to prod"
    echo "  Then edit .env.prod with your credentials"
    exit 1
  fi
}

# ── Deploy backend ────────────────────────────────────────────────────
deploy_backend() {
  echo "╔══════════════════════════════════════════╗"
  echo "║  Deploying Backend to Fly.io             ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""
  echo "  App:    $APP"
  echo "  Branch: $BRANCH"

  # Resolve frontend URL for CORS + WebAuthn on Fly.io
  local frontend_url="${FRONTEND_URL:-}"
  if [[ -z "$frontend_url" ]]; then
    if [[ "$BRANCH" == "main" ]]; then
      echo "  Main branch — skipping Fly secret update (using existing secrets)"
    else
      local sanitized
      sanitized=$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
      frontend_url="https://${sanitized}.${PAGES_PROJECT}.pages.dev"
      echo "  Non-main branch — preview URL: $frontend_url"
    fi
  fi

  # Push CORS/WebAuthn secrets to Fly.io
  if [[ -n "$frontend_url" ]]; then
    local domain
    domain=$(echo "$frontend_url" | sed 's|https\?://||' | sed 's|/.*||')
    echo "  Updating Fly secrets (rpId: $domain)"
    fly secrets set \
      --app "$APP" \
      FRONTEND_URL="$frontend_url" \
      CORS_ORIGIN="$frontend_url" \
      WEBAUTHN_RP_ID="$domain" \
      WEBAUTHN_ORIGIN="$frontend_url" \
      ASTRO_BASE_URL="$frontend_url" \
      --stage
  fi

  echo ""
  fly deploy --app "$APP" --remote-only

  echo ""
  echo "==> Health check:"
  curl -s "https://${APP}.fly.dev/api/health" | head -c 200
  echo ""
}

# ── Deploy frontend ───────────────────────────────────────────────────
deploy_frontend() {
  check_required

  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║  Deploying Frontend to Cloudflare Pages  ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""
  echo "  Project: $PAGES_PROJECT"
  echo "  Branch:  $BRANCH"
  echo "  API:     $VITE_API_BASE_URL"
  echo "  Supa:    $VITE_SUPABASE_URL"
  echo ""

  # Build with VITE_* vars (already in env from sourcing .env.local)
  npm run build

  # Deploy to Cloudflare Pages
  npx wrangler pages deploy dist \
    --project-name="$PAGES_PROJECT" \
    --branch="$BRANCH"

  echo ""
  if [[ "$BRANCH" == "main" ]]; then
    echo "==> Deployed to: https://${PAGES_PROJECT}.pages.dev"
  else
    local sanitized
    sanitized=$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
    echo "==> Deployed to: https://${sanitized}.${PAGES_PROJECT}.pages.dev"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────
case "${1:-all}" in
  backend)
    deploy_backend
    ;;
  frontend)
    deploy_frontend
    ;;
  all)
    deploy_backend
    deploy_frontend
    ;;
  --status)
    fly status --app "${FLY_APP:-astro-backend-platform}"
    ;;
  *)
    echo "Usage: bash scripts/deploy.sh [backend|frontend|all|--status]"
    exit 1
    ;;
esac
