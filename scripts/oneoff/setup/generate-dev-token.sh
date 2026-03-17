#!/bin/bash
# Generate a session token for the dev user (for e2e testing)

set -e

API_BASE="${API_BASE:-http://localhost:3001}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"

echo "Generating session token for dev@localhost..." >&2

# Use Supabase Admin API to generate a magic link session
RESPONSE=$(curl -s "${SUPABASE_URL}/auth/v1/admin/generate_link" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"type\": \"magiclink\", \"email\": \"dev@localhost\"}")

# Extract access_token from the response
# The structure is { "properties": { "access_token": "...", ... } }
ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.properties.access_token // empty')

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Failed to generate token. Response:" >&2
  echo "$RESPONSE" | jq . >&2
  exit 1
fi

# Output just the token (so it can be captured)
echo "$ACCESS_TOKEN"
