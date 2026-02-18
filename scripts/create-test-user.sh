#!/bin/bash
# Create a proper test user via Supabase and get real JWT tokens
# This mimics production behavior instead of bypassing auth

set -e

SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"
TEST_EMAIL="${TEST_EMAIL:-e2e-test@astro.local}"
TEST_PASSWORD="${TEST_PASSWORD:-TestPassword123}"

echo "Authenticating test user..."

# Try to sign in first
TOKEN_RESPONSE=$(curl -s "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -d "{
    \"email\": \"${TEST_EMAIL}\",
    \"password\": \"${TEST_PASSWORD}\"
  }")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
ERROR=$(echo "$TOKEN_RESPONSE" | jq -r '.error // empty')
ERROR_CODE=$(echo "$TOKEN_RESPONSE" | jq -r '.error_code // empty')

if [ -n "$ACCESS_TOKEN" ]; then
  # Sign-in succeeded
  USER_ID=$(echo "$TOKEN_RESPONSE" | jq -r '.user.id')
  echo "✓ Signed in as existing user: $USER_ID"
elif [ "$ERROR" = "invalid_grant" ] || [ "$ERROR" = "invalid_credentials" ] || [ "$ERROR_CODE" = "invalid_credentials" ]; then
  # User doesn't exist or wrong password - create user
  echo "User doesn't exist, creating via Admin API..."

  USER_RESPONSE=$(curl -s "${SUPABASE_URL}/auth/v1/admin/users" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -d "{
      \"email\": \"${TEST_EMAIL}\",
      \"password\": \"${TEST_PASSWORD}\",
      \"email_confirm\": true,
      \"user_metadata\": {\"name\": \"E2E Test User\"}
    }")

  USER_ID=$(echo "$USER_RESPONSE" | jq -r '.id // .user.id // empty')

  if [ -z "$USER_ID" ]; then
    echo "Error: Failed to create user"
    echo "$USER_RESPONSE" | jq . || echo "$USER_RESPONSE"
    exit 1
  fi

  echo "✓ Created user: $USER_ID"

  # Sign in with new user
  TOKEN_RESPONSE=$(curl -s "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
    -H "Content-Type: application/json" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -d "{
      \"email\": \"${TEST_EMAIL}\",
      \"password\": \"${TEST_PASSWORD}\"
    }")

  ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')

  if [ -z "$ACCESS_TOKEN" ]; then
    echo "Error: Failed to get access token after user creation"
    echo "$TOKEN_RESPONSE" | jq .
    exit 1
  fi
else
  echo "Error: Failed to authenticate"
  echo "$TOKEN_RESPONSE" | jq . || echo "$TOKEN_RESPONSE"
  exit 1
fi

echo "✓ Test user authenticated"
echo ""
echo "Export these for your test:"
echo "export TEST_USER_ID=\"$USER_ID\""
echo "export TEST_AUTH_TOKEN=\"$ACCESS_TOKEN\""
