#!/bin/bash
set -euo pipefail

# Deploy Astro backend + relay to Fly.io
# Usage: bash scripts/deploy-fly.sh [APP_NAME] [--status]

APP="${1:-astro-backend-platform}"

if [[ "$APP" == "--status" ]] || [[ "${2:-}" == "--status" ]]; then
  fly status --app "$APP"
  exit 0
fi

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
