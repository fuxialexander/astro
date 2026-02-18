#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "  Astro: Self-Hosted Supabase Setup"
echo "=================================================="
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &>/dev/null; then
  echo "Installing Supabase CLI..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install supabase/tap/supabase
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux installation
    curl -L https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz | tar -xz
    sudo mv supabase /usr/local/bin/
  else
    echo "Error: Unsupported OS. Please install manually: https://supabase.com/docs/guides/cli"
    exit 1
  fi
  echo "✓ Supabase CLI installed"
else
  echo "✓ Supabase CLI already installed"
fi

# Check if Docker is running
if ! docker info &>/dev/null; then
  echo "Error: Docker is not running"
  echo "Please start Docker Desktop and try again"
  exit 1
fi
echo "✓ Docker is running"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Initialize Supabase (idempotent)
if [[ ! -f "supabase/config.toml" ]]; then
  echo ""
  echo "Initializing Supabase..."
  supabase init
  echo "✓ Supabase initialized"
else
  echo "✓ Supabase already initialized"
fi

# Start Supabase services
echo ""
echo "Starting Supabase (this may take a few minutes on first run)..."
echo "Downloading Docker images if needed..."
supabase start

# Get credentials
echo ""
echo "=================================================="
echo "  Supabase is running!"
echo "=================================================="
echo ""

ANON_KEY=$(supabase status --output json | jq -r '.anon_key')
SERVICE_ROLE_KEY=$(supabase status --output json | jq -r '.service_role_key')
STUDIO_URL=$(supabase status --output json | jq -r '.studio_url')
API_URL=$(supabase status --output json | jq -r '.api_url')

echo "Studio (Dashboard): $STUDIO_URL"
echo "API URL: $API_URL"
echo ""
echo "Anon Key (public):"
echo "$ANON_KEY"
echo ""
echo "Service Role Key (secret, backend only):"
echo "$SERVICE_ROLE_KEY"
echo ""

# Create or update .env.local
ENV_FILE="$REPO_ROOT/.env.local"
echo "Updating $ENV_FILE..."

# Backup existing file
if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$ENV_FILE.backup"
  echo "✓ Backed up existing .env.local to .env.local.backup"
fi

# Update or append Supabase vars
update_env_var() {
  local key=$1
  local value=$2
  if grep -q "^$key=" "$ENV_FILE" 2>/dev/null; then
    # Update existing
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|^$key=.*|$key=$value|" "$ENV_FILE"
    else
      sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
    fi
  else
    # Append new
    echo "$key=$value" >> "$ENV_FILE"
  fi
}

touch "$ENV_FILE"
update_env_var "VITE_SUPABASE_URL" "$API_URL"
update_env_var "VITE_SUPABASE_ANON_KEY" "$ANON_KEY"
update_env_var "SUPABASE_URL" "$API_URL"
update_env_var "SUPABASE_ANON_KEY" "$ANON_KEY"
update_env_var "SUPABASE_SERVICE_ROLE_KEY" "$SERVICE_ROLE_KEY"

# WebAuthn config (localhost for now)
update_env_var "WEBAUTHN_RP_NAME" "Astro"
update_env_var "WEBAUTHN_RP_ID" "localhost"
update_env_var "WEBAUTHN_ORIGIN" "http://localhost:5173"

echo "✓ Environment variables updated in .env.local"
echo ""

# Run migrations
echo ""
echo "Running database migrations..."
echo "This will apply all SQL files in supabase/migrations/"
supabase db reset

echo ""
echo "=================================================="
echo "  Setup Complete!"
echo "=================================================="
echo ""
echo "Next steps:"
echo "1. Run 'npm run dev' to start Astro"
echo "2. Visit http://localhost:5173"
echo "3. You'll be redirected to /login - create your first user!"
echo ""
echo "To expose Supabase externally:"
echo "  Run: bash ./scripts/start-tunnel-with-supabase.sh"
echo ""
echo "To stop Supabase:"
echo "  supabase stop"
echo ""
