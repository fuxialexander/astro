#!/bin/bash
#
# Quick test for approval system
# Starts backend, runs tests, then cleans up
#

set -e

COLORS_CYAN='\033[0;36m'
COLORS_GREEN='\033[0;32m'
COLORS_RED='\033[0;31m'
COLORS_RESET='\033[0m'

echo -e "\n${COLORS_CYAN}Starting Astro backend server...${COLORS_RESET}\n"

# Start backend in background
npm run dev:backend > /tmp/astro-backend.log 2>&1 &
BACKEND_PID=$!

# Cleanup function
cleanup() {
  echo -e "\n${COLORS_CYAN}Stopping backend server...${COLORS_RESET}"
  kill $BACKEND_PID 2>/dev/null || true
  wait $BACKEND_PID 2>/dev/null || true
}

trap cleanup EXIT

# Wait for server to start
echo -e "${COLORS_CYAN}Waiting for server to be ready...${COLORS_RESET}"
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo -e "${COLORS_GREEN}✓ Server is ready!${COLORS_RESET}\n"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  sleep 1
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo -e "${COLORS_RED}✗ Server failed to start within 30 seconds${COLORS_RESET}"
  echo -e "\nBackend logs:"
  cat /tmp/astro-backend.log
  exit 1
fi

# Run automated approval tests
echo -e "${COLORS_CYAN}Running approval system tests...${COLORS_RESET}\n"
npx tsx scripts/test-approval-automated.ts

# Show demo
echo -e "\n${COLORS_CYAN}Running visual demo...${COLORS_RESET}\n"
npm run demo:approval

echo -e "\n${COLORS_GREEN}All tests completed successfully!${COLORS_RESET}\n"
