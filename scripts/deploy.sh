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
APP="${FLY_APP:-astro-backend-deploy}"
PAGES_PROJECT="${CLOUDFLARE_PAGES_PROJECT:-astro-app}"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Show active env profile and branch
echo ""
echo "  Branch:  $BRANCH"
if [[ -L "$REPO_ROOT/.env.local" ]]; then
  _target=$(readlink "$REPO_ROOT/.env.local")
  if [[ "$_target" == *".prod" ]]; then
    echo "  Profile: prod (.env.local → .env.prod)"
  elif [[ "$_target" == *".local.dev" ]]; then
    echo "  Profile: dev (.env.local → .env.local.dev)"
  else
    echo "  Profile: custom (.env.local → $_target)"
  fi
elif [[ ! -e "$REPO_ROOT/.env.local" ]]; then
  echo "  Profile: local (no .env.local)"
else
  echo "  Profile: unknown (.env.local is a regular file)"
fi

# Warn if deploying from a non-main branch
if [[ "$BRANCH" != "main" ]]; then
  echo ""
  echo "  Warning: You are deploying from branch '$BRANCH', not 'main'."
  echo "  Production deploys should typically be from the main branch."
  echo "  Frontend will be deployed as a branch preview, not production."
  echo ""
  read -r -p "  Continue anyway? [y/N] " _confirm
  if [[ "${_confirm:-n}" != [yY] ]]; then
    echo "  Aborted. Switch to main first: git checkout main && git pull"
    exit 0
  fi
fi
echo ""

# Diagnose env profile and validate required vars for prod deploy
check_required() {
  local missing=()
  [[ -z "${VITE_API_BASE_URL:-}" ]] && missing+=("VITE_API_BASE_URL")
  [[ -z "${VITE_SUPABASE_URL:-}" ]] && missing+=("VITE_SUPABASE_URL")
  [[ -z "${VITE_SUPABASE_ANON_KEY:-}" ]] && missing+=("VITE_SUPABASE_ANON_KEY")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo ""
    echo "Error: Missing required env vars for frontend deployment:"
    for v in "${missing[@]}"; do
      echo "  - $v"
    done
    echo ""

    # Diagnose the root cause
    local env_local="$REPO_ROOT/.env.local"
    local env_prod="$REPO_ROOT/.env.prod"

    if [[ ! -e "$env_local" ]]; then
      # No .env.local → user is in local mode
      echo "Cause: No active env profile (.env.local does not exist)."
      echo "  You are in local mode — deploy requires the prod profile."
      echo ""
      if [[ -f "$env_prod" ]]; then
        echo "Fix: Your .env.prod already exists. Activate it and redeploy:"
        echo "  npm run env:prod     # Activate prod profile"
        echo "  npm run deploy       # Redeploy (backend is already up)"
      else
        echo "Fix: Create and activate a prod profile:"
        echo "  1. npm run env:init    # Create .env.prod template"
        echo "  2. Edit .env.prod      # Fill in your Supabase + API credentials"
        echo "  3. npm run env:prod    # Activate prod profile"
        echo "  4. npm run deploy      # Deploy"
      fi
    elif [[ -L "$env_local" ]]; then
      local target
      target=$(readlink "$env_local")
      if [[ "$target" == *".local.dev" ]]; then
        echo "Cause: You are in dev mode (.env.local → .env.local.dev)."
        echo "  Dev mode uses local Supabase — deploy requires the prod profile."
        echo ""
        if [[ -f "$env_prod" ]]; then
          echo "Fix: Switch to prod and redeploy:"
          echo "  npm run env:prod     # Switch to prod profile"
          echo "  npm run deploy       # Redeploy"
        else
          echo "Fix: Create a prod profile first:"
          echo "  1. npm run env:init    # Create .env.prod template"
          echo "  2. Edit .env.prod      # Fill in your credentials"
          echo "  3. npm run env:prod    # Activate prod profile"
          echo "  4. npm run deploy      # Deploy"
        fi
      else
        echo "Cause: .env.local → $target, but required VITE_* vars are not set in it."
        echo ""
        echo "Fix: Edit $target and add the missing variables, then redeploy."
      fi
    else
      echo "Cause: .env.local exists but is missing the required VITE_* variables."
      echo ""
      echo "Fix: Edit .env.local (or .env.prod) and add the missing variables."
    fi
    echo ""
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
    domain=$(echo "$frontend_url" | sed -E 's|https?://||' | sed 's|/.*||')
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
  CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}" npx wrangler pages deploy dist \
    --project-name="$PAGES_PROJECT" \
    --branch="$BRANCH" \
    --commit-dirty=true

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
    check_required
    deploy_backend
    deploy_frontend
    ;;
  --status)
    fly status --app "${FLY_APP:-astro-backend-deploy}"
    ;;
  *)
    echo "Usage: bash scripts/deploy.sh [backend|frontend|all|--status]"
    exit 1
    ;;
esac
