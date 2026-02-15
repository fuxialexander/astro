#!/bin/bash
#
# Fix .env file permissions
#
# This script sets proper permissions (600 = owner read/write only)
# for all environment files to protect secrets from unauthorized access.
#
# Usage:
#   ./scripts/fix-env-permissions.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🔒 Fixing .env file permissions..."
echo ""

# Find all .env files (including .env.local, .env.production, etc.)
# Exclude .env.example and .env.test (those are safe to have looser permissions)
ENV_FILES=$(find "$PROJECT_ROOT" -maxdepth 1 -type f \( -name ".env" -o -name ".env.*" \) ! -name ".env.example" ! -name ".env.test")

if [ -z "$ENV_FILES" ]; then
  echo "⚠️  No .env files found"
  echo ""
  echo "To create your .env file:"
  echo "  cp .env.example .env"
  echo "  # Edit .env and replace placeholder values"
  echo ""
  exit 0
fi

# Set permissions for each file
for file in $ENV_FILES; do
  filename=$(basename "$file")

  # Get current permissions
  current_perms=$(stat -f "%Lp" "$file" 2>/dev/null || stat -c "%a" "$file" 2>/dev/null)

  if [ "$current_perms" = "600" ]; then
    echo "✅ $filename (already 600)"
  else
    chmod 600 "$file"
    echo "🔧 $filename ($current_perms → 600)"
  fi
done

echo ""
echo "✅ Environment file permissions fixed"
echo ""
echo "📋 Security checklist:"
echo "  • .env files are now read/write by owner only (600)"
echo "  • .env files are excluded from git (.gitignore)"
echo "  • Never commit .env files to version control"
echo "  • Rotate secrets every 90 days"
echo "  • Use different secrets for dev/test/production"
echo ""
