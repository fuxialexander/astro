#!/bin/bash
set -euo pipefail

# Deploy Astro backend + relay to Fly.io
# NOTE: Prefer using `bash scripts/deploy.sh backend` instead (sources env automatically).
# This script is kept for backward compatibility.
#
# Usage: bash scripts/deploy-fly.sh [OPTIONS]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source env files
for f in "$REPO_ROOT/.env" "$REPO_ROOT/.env.local"; do
  if [[ -f "$f" ]]; then set -a; source "$f"; set +a; fi
done

APP="${FLY_APP:-astro-backend-platform}"
PAGES_PROJECT="${CLOUDFLARE_PAGES_PROJECT:-astro-app-3vo}"
FRONTEND_URL=""
STATUS_ONLY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP="$2"; shift 2 ;;
    --frontend-url) FRONTEND_URL="$2"; shift 2 ;;
    --status) STATUS_ONLY=true; shift ;;
    *) APP="$1"; shift ;;  # Backward compat: positional arg = app name
  esac
done

if $STATUS_ONLY; then
  fly status --app "$APP"
  exit 0
fi

# Detect current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "==> Branch: $BRANCH"

# Resolve frontend URL for CORS + WebAuthn
if [[ -n "$FRONTEND_URL" ]]; then
  echo "==> Using explicit frontend URL: $FRONTEND_URL"
elif [[ "$BRANCH" == "main" ]]; then
  echo "==> Main branch — skipping frontend URL update (using existing Fly secrets)"
else
  # Cloudflare Pages preview URL: <branch>.project.pages.dev
  # Sanitize branch name: lowercase, replace non-alphanumeric with hyphens
  SANITIZED_BRANCH=$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
  FRONTEND_URL="https://${SANITIZED_BRANCH}.${PAGES_PROJECT}.pages.dev"
  echo "==> Non-main branch — preview URL: $FRONTEND_URL"
fi

# Update Fly secrets if we have a frontend URL to set
if [[ -n "$FRONTEND_URL" ]]; then
  DOMAIN=$(echo "$FRONTEND_URL" | sed 's|https\?://||' | sed 's|/.*||')
  echo "==> Updating Fly secrets for frontend: $FRONTEND_URL (rpId: $DOMAIN)"
  fly secrets set \
    --app "$APP" \
    FRONTEND_URL="$FRONTEND_URL" \
    CORS_ORIGIN="$FRONTEND_URL" \
    WEBAUTHN_RP_ID="$DOMAIN" \
    WEBAUTHN_ORIGIN="$FRONTEND_URL" \
    ASTRO_BASE_URL="$FRONTEND_URL" \
    --stage
  echo "    Secrets staged (will apply on deploy)"
fi

echo ""
echo "==> Deploying Astro backend to Fly.io..."
echo "    App: $APP"
echo "    Dockerfile: docker/Dockerfile"
echo ""

# Deploy (Fly.io builds remotely using the Dockerfile)
fly deploy --app "$APP" --remote-only

echo ""
echo "==> Deployment complete. Checking status..."
fly status --app "$APP"

echo ""
echo "==> Health check:"
curl -s "https://${APP}.fly.dev/api/health" | head -c 200
echo ""

if [[ -n "$FRONTEND_URL" ]]; then
  echo ""
  echo "==> Frontend URL configured: $FRONTEND_URL"
  echo "    Make sure to deploy frontend to this URL:"
  echo "    npx wrangler pages deploy dist --project-name=$PAGES_PROJECT --branch=$BRANCH"
fi
