#!/bin/bash
set -euo pipefail

# Deploy Astro backend + relay to Fly.io
# Usage: bash scripts/deploy-fly.sh [--status]

if [[ "${1:-}" == "--status" ]]; then
  fly status --app astro-backend-platform
  exit 0
fi

echo "==> Deploying Astro backend to Fly.io..."
echo "    App: astro-backend-platform"
echo "    Dockerfile: docker/Dockerfile"
echo ""

# Deploy (Fly.io builds remotely using the Dockerfile)
fly deploy --app astro-backend-platform --remote-only

echo ""
echo "==> Deployment complete. Checking status..."
fly status --app astro-backend-platform

echo ""
echo "==> Health check:"
curl -s https://astro-backend-platform.fly.dev/api/health | head -c 200
echo ""
