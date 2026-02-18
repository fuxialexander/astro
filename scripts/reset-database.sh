#!/usr/bin/env bash
set -euo pipefail

echo "🧹 Astro Database Reset"
echo "======================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Parse options
RESET_SUPABASE=false
RESET_INDEXEDDB=false
FULL_CLEAN=false

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  --supabase       Reset Supabase database only"
  echo "  --indexeddb      Show instructions to reset IndexedDB only"
  echo "  --all            Reset everything (Supabase + show IndexedDB instructions)"
  echo "  --help           Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0 --supabase         # Reset PostgreSQL database"
  echo "  $0 --indexeddb        # Get instructions to clear browser storage"
  echo "  $0 --all              # Reset everything"
  exit 0
fi

while [[ $# -gt 0 ]]; do
  case $1 in
    --supabase)
      RESET_SUPABASE=true
      shift
      ;;
    --indexeddb)
      RESET_INDEXEDDB=true
      shift
      ;;
    --all)
      RESET_SUPABASE=true
      RESET_INDEXEDDB=true
      shift
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --supabase       Reset Supabase database only"
      echo "  --indexeddb      Show instructions to reset IndexedDB only"
      echo "  --all            Reset everything (Supabase + IndexedDB instructions)"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Reset Supabase database
if [[ "$RESET_SUPABASE" == "true" ]]; then
  echo "1️⃣  Resetting Supabase database..."
  echo ""

  if ! command -v supabase &>/dev/null; then
    echo "❌ Supabase CLI not found"
    echo ""
    echo "To install:"
    echo "  macOS: brew install supabase/tap/supabase"
    echo "  Linux: https://supabase.com/docs/guides/cli"
    echo ""
    exit 1
  fi

  # Check if Supabase is running
  if ! supabase status &>/dev/null; then
    echo "⚠️  Supabase is not running. Starting it first..."
    bash "$SCRIPT_DIR/setup-supabase-local.sh"
  fi

  echo "Resetting database (this will drop all tables and re-run migrations)..."
  supabase db reset

  echo ""
  echo "✅ Supabase database reset complete!"
  echo ""
fi

# Show IndexedDB reset instructions
if [[ "$RESET_INDEXEDDB" == "true" ]]; then
  echo "2️⃣  IndexedDB Reset Instructions"
  echo ""
  echo "IndexedDB data is stored in your browser. To reset it:"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Option A: Browser DevTools (Recommended)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "1. Open http://localhost:5173 in your browser"
  echo "2. Open DevTools:"
  echo "   • Chrome/Edge: F12 or Cmd+Option+I (Mac) / Ctrl+Shift+I (Windows/Linux)"
  echo "   • Firefox: F12 or Cmd+Option+I (Mac) / Ctrl+Shift+I (Windows/Linux)"
  echo "   • Safari: Cmd+Option+C (Mac, enable Develop menu first)"
  echo ""
  echo "3. Go to the Application tab (Chrome/Edge) or Storage tab (Firefox)"
  echo "4. In the left sidebar:"
  echo "   • Expand 'IndexedDB'"
  echo "   • Right-click on the Astro database"
  echo "   • Click 'Delete database'"
  echo ""
  echo "5. Expand 'Local Storage' → http://localhost:5173"
  echo "   • Click 'Clear All' or delete individual keys"
  echo ""
  echo "6. Refresh the page (Cmd+R / Ctrl+R)"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Option B: Browser Console (Quick)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "1. Open http://localhost:5173"
  echo "2. Open Console (same shortcuts as above)"
  echo "3. Paste and run this code:"
  echo ""
  echo "   // Delete all IndexedDB databases"
  echo "   indexedDB.databases().then(dbs => {"
  echo "     dbs.forEach(db => {"
  echo "       indexedDB.deleteDatabase(db.name);"
  echo "       console.log('Deleted:', db.name);"
  echo "     });"
  echo "   });"
  echo ""
  echo "   // Clear localStorage"
  echo "   localStorage.clear();"
  echo "   console.log('localStorage cleared');"
  echo ""
  echo "   // Reload page"
  echo "   setTimeout(() => location.reload(), 500);"
  echo ""
  echo "4. The page will refresh automatically"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Option C: Incognito/Private Window (Clean Slate)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "1. Open a new Incognito/Private window"
  echo "2. Navigate to http://localhost:5173"
  echo "3. This starts with completely fresh storage"
  echo ""
fi

if [[ "$RESET_SUPABASE" == "true" ]] && [[ "$RESET_INDEXEDDB" == "true" ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅ Complete Database Reset Instructions"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "✓ Supabase database has been reset"
  echo "→ Follow the IndexedDB instructions above to complete the reset"
  echo ""
  echo "After clearing IndexedDB, you'll have a completely fresh database!"
  echo ""
fi

echo "Done!"
