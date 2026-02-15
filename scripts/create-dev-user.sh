#!/bin/bash
# Create dev user via Supabase Admin API (instead of direct SQL insert)

set -e

SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"

echo "Creating dev user via Admin API..." >&2

# Create user via Admin API
RESPONSE=$(curl -s "${SUPABASE_URL}/auth/v1/admin/users" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "dev@localhost",
    "email_confirm": true,
    "user_metadata": {"name": "Dev User"},
    "password": "devpassword123"
  }')

echo "Response: $RESPONSE" >&2

# Now generate a session token
echo "Generating session token..." >&2
TOKEN_RESPONSE=$(curl -s "${SUPABASE_URL}/auth/v1/admin/generate_link" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"type": "magiclink", "email": "dev@localhost"}')

# Extract access_token
ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.properties.access_token // empty')

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Failed to generate token. Response:" >&2
  echo "$TOKEN_RESPONSE" | jq . >&2
  exit 1
fi

echo "$ACCESS_TOKEN"
