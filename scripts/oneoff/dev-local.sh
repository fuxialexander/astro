#!/bin/bash
# Start Astro in local mode (no Supabase required)

echo "🚀 Starting Astro in local mode..."
echo "   - No authentication required"
echo "   - All data stored in PGlite (local Postgres)"
echo "   - Backend: localhost:3001"
echo "   - Frontend: localhost:5173"
echo ""

export ASTRO_LOCAL_MODE=true
export VITE_ASTRO_LOCAL_MODE=true

npm run dev
