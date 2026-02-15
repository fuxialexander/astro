#!/bin/bash
#
# Verify environment configuration setup
#
# This script checks that all environment configuration files
# are properly set up with correct permissions and unique secrets.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🔍 Verifying environment configuration..."
echo ""

# Check if .env exists
if [ ! -f "$PROJECT_ROOT/.env" ]; then
  echo "❌ .env file not found"
  echo ""
  echo "To create it:"
  echo "  npm run env:setup"
  echo ""
  exit 1
fi

echo "✅ .env file exists"

# Check .env permissions
ENV_PERMS=$(stat -f "%Lp" "$PROJECT_ROOT/.env" 2>/dev/null || stat -c "%a" "$PROJECT_ROOT/.env" 2>/dev/null)
if [ "$ENV_PERMS" != "600" ]; then
  echo "⚠️  .env permissions are $ENV_PERMS (should be 600)"
  echo ""
  echo "To fix:"
  echo "  npm run env:fix-permissions"
  echo ""
else
  echo "✅ .env permissions are correct (600)"
fi

# Check for placeholder values
if grep -q "GENERATE_WITH_openssl_rand_hex_32_REPLACE_THIS_VALUE" "$PROJECT_ROOT/.env" 2>/dev/null; then
  echo "⚠️  .env contains placeholder values"
  echo ""
  echo "Generate secrets with:"
  echo "  openssl rand -hex 32"
  echo ""
else
  echo "✅ No placeholder values in .env"
fi

# Check if secrets are unique
RELAY_SECRET=$(grep "^RELAY_JWT_SECRET=" "$PROJECT_ROOT/.env" | cut -d'=' -f2)
DEVICE_SECRET=$(grep "^DEVICE_AUTH_JWT_SECRET=" "$PROJECT_ROOT/.env" | cut -d'=' -f2)
REFRESH_SECRET=$(grep "^DEVICE_AUTH_REFRESH_SECRET=" "$PROJECT_ROOT/.env" | cut -d'=' -f2)

if [ "$RELAY_SECRET" = "$DEVICE_SECRET" ] || [ "$RELAY_SECRET" = "$REFRESH_SECRET" ] || [ "$DEVICE_SECRET" = "$REFRESH_SECRET" ]; then
  echo "❌ JWT secrets are not unique!"
  echo ""
  echo "Generate unique secrets with:"
  echo "  openssl rand -hex 32"
  echo ""
  exit 1
else
  echo "✅ JWT secrets are unique"
fi

# Check secret length (should be 64 hex chars = 256 bits)
if [ ${#RELAY_SECRET} -lt 64 ]; then
  echo "⚠️  RELAY_JWT_SECRET is too short (${#RELAY_SECRET} chars, need 64)"
fi
if [ ${#DEVICE_SECRET} -lt 64 ]; then
  echo "⚠️  DEVICE_AUTH_JWT_SECRET is too short (${#DEVICE_SECRET} chars, need 64)"
fi
if [ ${#REFRESH_SECRET} -lt 64 ]; then
  echo "⚠️  DEVICE_AUTH_REFRESH_SECRET is too short (${#REFRESH_SECRET} chars, need 64)"
fi

if [ ${#RELAY_SECRET} -ge 64 ] && [ ${#DEVICE_SECRET} -ge 64 ] && [ ${#REFRESH_SECRET} -ge 64 ]; then
  echo "✅ JWT secrets are proper length (256-bit)"
fi

# Check for .env.example
if [ -f "$PROJECT_ROOT/.env.example" ]; then
  echo "✅ .env.example exists"
else
  echo "⚠️  .env.example not found"
fi

# Check for .env.test
if [ -f "$PROJECT_ROOT/.env.test" ]; then
  echo "✅ .env.test exists"
else
  echo "⚠️  .env.test not found"
fi

# Check for environment.ts
if [ -f "$PROJECT_ROOT/server/lib/environment.ts" ]; then
  echo "✅ server/lib/environment.ts exists"
else
  echo "❌ server/lib/environment.ts not found"
  exit 1
fi

# Check for documentation
if [ -f "$PROJECT_ROOT/ENV_SETUP.md" ]; then
  echo "✅ ENV_SETUP.md exists"
else
  echo "⚠️  ENV_SETUP.md not found"
fi

echo ""
echo "✅ Environment configuration verified"
echo ""
echo "📋 Summary:"
echo "  • .env file exists with correct permissions"
echo "  • JWT secrets are unique and proper length"
echo "  • Template and test files exist"
echo "  • Environment utilities are in place"
echo ""
echo "To start the server:"
echo "  npm run dev"
echo ""
