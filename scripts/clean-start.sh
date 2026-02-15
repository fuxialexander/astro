#!/usr/bin/env bash
set -euo pipefail

echo "🧹 Starting clean setup for Nexus..."
echo ""

# 1. Stop any running processes
echo "1️⃣  Stopping any running processes..."
pkill -f "npm run dev" || true
pkill -f "vite" || true
pkill -f "tsx.*server/index" || true
pkill -f "nexus-agent" || true
sleep 2

# 2. Clean agent runner cache
echo "2️⃣  Cleaning agent runner cache..."
rm -rf ~/.nexus-agent
echo "   ✓ Removed ~/.nexus-agent"

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
echo "  3. Run agent auth:  bash scripts/agent-setup.sh fuxialexander.work"
echo ""
