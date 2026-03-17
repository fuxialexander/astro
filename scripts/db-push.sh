#!/usr/bin/env bash
set -euo pipefail

# Push Supabase migrations to the remote database.
# Reads DATABASE_URL from .env.prod (direct connection, not pooler).
#
# Usage:
#   scripts/db-push.sh              # Push pending migrations
#   scripts/db-push.sh --dry-run    # Preview what would be pushed
#   scripts/db-push.sh --status     # Show migration history (local vs remote)
#   scripts/db-push.sh --repair     # Interactive repair of migration history
#
# Requires: npx supabase (installed via package.json devDependencies)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Extract DB connection from .env.prod ─────────────────────────────
ENV_FILE="$REPO_ROOT/.env.prod"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env.prod not found. Run 'npm run env:init' first."
  exit 1
fi

# Read DATABASE_URL from .env.prod
DATABASE_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d'=' -f2-)

if [[ -z "$DATABASE_URL" ]]; then
  echo "Error: DATABASE_URL not set in .env.prod"
  exit 1
fi

# Convert pooler URL (port 6543) to direct URL (port 5432) for DDL operations.
# Supabase pooler (PgBouncer) doesn't support DDL statements needed for migrations.
# Pooler format:  postgresql://postgres.REF:PASS@aws-N-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true
# Direct format:  postgresql://postgres:PASS@db.REF.supabase.co:5432/postgres
extract_direct_url() {
  local pooler_url="$1"

  # Extract project ref from user field (postgres.REF)
  local ref
  ref=$(echo "$pooler_url" | sed -n 's|.*://postgres\.\([^:]*\):.*|\1|p')

  # Extract password (between : and @)
  local pass
  pass=$(echo "$pooler_url" | sed -n 's|.*://postgres\.[^:]*:\([^@]*\)@.*|\1|p')

  if [[ -z "$ref" || -z "$pass" ]]; then
    # Not a pooler URL, use as-is
    echo "$pooler_url"
    return
  fi

  echo "postgresql://postgres:${pass}@db.${ref}.supabase.co:5432/postgres"
}

DB_URL=$(extract_direct_url "$DATABASE_URL")

# ── Parse command ────────────────────────────────────────────────────
ACTION="${1:-push}"

case "$ACTION" in
  --dry-run|dry-run)
    echo "Checking pending migrations (dry run)..."
    echo ""
    npx supabase db push --db-url "$DB_URL" --dry-run
    ;;
  --status|status)
    echo "Migration history (local vs remote):"
    echo ""
    npx supabase migration list --db-url "$DB_URL"
    ;;
  --repair|repair)
    if [[ -z "${2:-}" || -z "${3:-}" ]]; then
      echo "Usage: scripts/db-push.sh --repair <applied|reverted> <version>"
      echo ""
      echo "Example: scripts/db-push.sh --repair reverted 20260305110000"
      exit 1
    fi
    echo "Repairing migration $3 -> $2..."
    npx supabase migration repair --status "$2" "$3" --db-url "$DB_URL"
    ;;
  push|"")
    echo "Pushing migrations to production Supabase..."
    echo ""
    npx supabase db push --db-url "$DB_URL" --include-all
    ;;
  *)
    echo "Usage: scripts/db-push.sh [--dry-run | --status | --repair <status> <version> | push]"
    exit 1
    ;;
esac
