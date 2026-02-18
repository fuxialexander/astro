#!/bin/bash
# Start Astro in IndexedDB-only mode (no Supabase required)

echo "🚀 Starting Astro in IndexedDB-only mode..."
echo "   - No authentication required"
echo "   - All data stored in browser IndexedDB"
echo "   - Backend: localhost:3001"
echo "   - Frontend: localhost:5173"
echo ""

export USE_INDEXEDDB_ONLY=true
export VITE_USE_INDEXEDDB_ONLY=true

npm run dev
