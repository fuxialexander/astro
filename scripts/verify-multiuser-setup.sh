#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "  Astro: Multi-User Setup Verification"
echo "=================================================="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ERRORS=0
WARNINGS=0

check_ok() {
  echo "✓ $1"
}

check_fail() {
  echo "✗ $1"
  ((ERRORS++))
}

check_warn() {
  echo "⚠ $1"
  ((WARNINGS++))
}

echo "Checking prerequisites..."
echo ""

# Check Docker
if docker info &>/dev/null; then
  check_ok "Docker is running"
else
  check_fail "Docker is not running - start Docker Desktop"
fi

# Check cloudflared
if command -v cloudflared &>/dev/null; then
  check_ok "cloudflared installed"
else
  check_fail "cloudflared not installed - run: brew install cloudflared"
fi

# Check Supabase CLI
if command -v supabase &>/dev/null; then
  check_ok "Supabase CLI installed"
else
  check_warn "Supabase CLI not installed - will be installed during setup"
fi

# Check jq
if command -v jq &>/dev/null; then
  check_ok "jq installed"
else
  check_fail "jq not installed - run: brew install jq"
fi

# Check CLOUDFLARED_DOMAIN
if [[ -f "$REPO_ROOT/.env" ]] && grep -q "^CLOUDFLARED_DOMAIN=" "$REPO_ROOT/.env"; then
  DOMAIN=$(grep -E '^CLOUDFLARED_DOMAIN=' "$REPO_ROOT/.env" | cut -d= -f2-)
  check_ok "CLOUDFLARED_DOMAIN set to: $DOMAIN"
else
  check_fail "CLOUDFLARED_DOMAIN not set in .env"
  echo "  → Add: echo 'CLOUDFLARED_DOMAIN=yourdomain.com' >> .env"
fi

echo ""
echo "Checking Supabase..."
echo ""

# Check if Supabase is initialized
if [[ -f "$REPO_ROOT/supabase/config.toml" ]]; then
  check_ok "Supabase initialized"
else
  check_warn "Supabase not initialized - will be done during setup"
fi

# Check if Supabase is running
if curl -sf http://localhost:54321/health &>/dev/null; then
  check_ok "Supabase is running"

  # Check API URL
  if command -v supabase &>/dev/null; then
    API_URL=$(supabase status --output json 2>/dev/null | jq -r '.api_url' || echo "")
    if [[ -n "$API_URL" ]]; then
      check_ok "Supabase API available at: $API_URL"
    fi
  fi
else
  check_warn "Supabase not running - start with: supabase start"
fi

echo ""
echo "Checking environment variables..."
echo ""

ENV_FILE="$REPO_ROOT/.env.local"
if [[ -f "$ENV_FILE" ]]; then
  check_ok ".env.local exists"

  # Check required vars
  if grep -q "^VITE_SUPABASE_URL=" "$ENV_FILE"; then
    check_ok "VITE_SUPABASE_URL configured"
  else
    check_warn "VITE_SUPABASE_URL not set - run setup script"
  fi

  if grep -q "^SUPABASE_SERVICE_ROLE_KEY=" "$ENV_FILE"; then
    check_ok "SUPABASE_SERVICE_ROLE_KEY configured"
  else
    check_warn "SUPABASE_SERVICE_ROLE_KEY not set - run setup script"
  fi

  if grep -q "^WEBAUTHN_RP_ID=" "$ENV_FILE"; then
    WEBAUTHN_RP_ID=$(grep -E '^WEBAUTHN_RP_ID=' "$ENV_FILE" | cut -d= -f2-)
    check_ok "WEBAUTHN_RP_ID set to: $WEBAUTHN_RP_ID"
  else
    check_warn "WEBAUTHN_RP_ID not set - run setup script"
  fi
else
  check_warn ".env.local does not exist - will be created during setup"
fi

echo ""
echo "Checking services..."
echo ""

# Check backend
if curl -sf http://localhost:3001/api/health &>/dev/null; then
  check_ok "Backend running on port 3001"
else
  check_warn "Backend not running - start with: npm run dev:backend"
fi

# Check frontend
if curl -sf http://localhost:5173 &>/dev/null; then
  check_ok "Frontend running on port 5173"
else
  check_warn "Frontend not running - start with: npm run dev:frontend"
fi

# Check relay
if nc -z localhost 3002 &>/dev/null; then
  check_ok "Relay running on port 3002"
else
  check_warn "Relay not running (starts with backend)"
fi

echo ""
echo "=================================================="
echo "  Verification Summary"
echo "=================================================="
echo ""

if [[ $ERRORS -eq 0 ]] && [[ $WARNINGS -eq 0 ]]; then
  echo "✅ All checks passed! You're ready to go."
  echo ""
  echo "Next steps:"
  echo "  1. Visit http://localhost:5173"
  echo "  2. Create your first user with passkey"
  echo "  3. Start creating projects!"
elif [[ $ERRORS -eq 0 ]]; then
  echo "⚠️  Setup incomplete but no errors"
  echo ""
  echo "Run the setup:"
  echo "  bash ./scripts/setup-supabase-local.sh"
  echo "  npm run dev:backend"
  echo "  npm run dev:frontend"
  echo "  bash ./scripts/start-tunnel-with-supabase.sh"
else
  echo "❌ Found $ERRORS error(s) and $WARNINGS warning(s)"
  echo ""
  echo "Fix the errors above before proceeding."
  exit 1
fi

echo ""
