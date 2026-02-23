#!/usr/bin/env bash
set -euo pipefail

# Clean Start Script
# - Stops processes, cleans caches, reinstalls deps, rebuilds, resets DB schema
# - For just clearing user data without full reinstall, use: npm run clear-data

echo "🧹 Starting clean setup for Astro..."
echo ""

# 1. Stop any running processes
echo "1️⃣  Stopping any running processes..."
pkill -f "npm run dev" || true
pkill -f "vite" || true
pkill -f "tsx.*server/index" || true
pkill -f "astro-agent" || true
sleep 2

# 2. Clean agent runner cache and config
echo "2️⃣  Cleaning agent runner cache and config..."
rm -rf ~/.astro-agent
echo "   ✓ Removed ~/.astro-agent"

# Reset agent config (removes config.json across all platforms)
if command -v astro-agent &>/dev/null || [ -f ./packages/agent-runner/dist/cli.js ]; then
  if [ -f ./packages/agent-runner/dist/cli.js ]; then
    node ./packages/agent-runner/dist/cli.js config --reset
  else
    astro-agent config --reset
  fi
  echo "   ✓ Reset agent configuration"
fi

# 3. Clean node modules and reinstall
echo "3️⃣  Cleaning and reinstalling dependencies..."
cd "$(dirname "$0")/.."
rm -rf node_modules package-lock.json
rm -rf packages/agent-runner/node_modules packages/agent-runner/package-lock.json
npm install
echo "   ✓ Dependencies reinstalled"

# 4. Clean build artifacts
echo "4️⃣  Cleaning build artifacts..."
rm -rf dist
rm -rf packages/agent-runner/dist
npm run build
echo "   ✓ Fresh build complete"

# 5. Reset Supabase database
echo "5️⃣  Resetting Supabase database..."
if command -v supabase &>/dev/null; then
  supabase db reset || echo "   ⚠️  Supabase reset skipped (not available)"
else
  echo "   ⚠️  Supabase CLI not found, skipping database reset"
fi

echo ""
echo "✅ Clean setup complete!"
echo ""
echo "Next steps:"
echo "  1. Start backend:  npm run dev:backend"
echo "  2. Start frontend: npm run dev:frontend"
echo "  3. Run agent auth:  bash scripts/agent-setup.sh"
echo ""
