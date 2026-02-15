#!/bin/bash
# Clean Database Setup for Nexus
# Initializes database with single clean migration

set -e

echo "🗄️  Setting up Nexus database..."
echo ""

# Check if Supabase CLI is available
if ! command -v npx &> /dev/null; then
    echo "❌ Error: npx not found. Please install Node.js"
    exit 1
fi

# Start Supabase if not running
echo "📦 Starting Supabase..."
npx supabase start

echo ""
echo "🔄 Applying clean schema migration..."
npx supabase db reset --local

echo ""
echo "✅ Database setup complete!"
echo ""
echo "Schema includes:"
echo "  • All tables and indexes"
echo "  • Row Level Security policies"
echo "  • Dev-user for IndexedDB mode (00000000-0000-0000-0000-000000000000)"
echo ""
echo "Next steps:"
echo "  1. Start backend: npm run dev:backend"
echo "  2. Start frontend: npm run dev:frontend"
echo ""
echo "Or run in IndexedDB-only mode (no auth):"
echo "  USE_INDEXEDDB_ONLY=true npm run dev"
echo ""
