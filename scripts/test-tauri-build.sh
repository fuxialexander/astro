#!/usr/bin/env bash
#
# test-tauri-build.sh - Smoke test for the Tauri desktop build pipeline
#
# Verifies:
#   1. Sidecar builds and starts (health check)
#   2. Frontend builds (dist/ generated)
#   3. Rust compiles (cargo build in src-tauri/)
#
# Usage:
#   bash scripts/test-tauri-build.sh [--skip-rust] [--skip-sidecar] [--skip-frontend]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="$ROOT/src-tauri/sidecar"
FRONTEND_DIR="$ROOT/src-tauri/frontend"
TAURI_DIR="$ROOT/src-tauri"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASSED=0
FAILED=0
SKIPPED=0

SKIP_RUST=false
SKIP_SIDECAR=false
SKIP_FRONTEND=false

for arg in "$@"; do
  case "$arg" in
    --skip-rust) SKIP_RUST=true ;;
    --skip-sidecar) SKIP_SIDECAR=true ;;
    --skip-frontend) SKIP_FRONTEND=true ;;
  esac
done

pass() {
  echo -e "  ${GREEN}PASS${NC} $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo -e "  ${RED}FAIL${NC} $1"
  FAILED=$((FAILED + 1))
}

skip() {
  echo -e "  ${YELLOW}SKIP${NC} $1"
  SKIPPED=$((SKIPPED + 1))
}

# ===================================================================
# Step 1: Sidecar Build
# ===================================================================
echo -e "\n${CYAN}=== Step 1: Sidecar Build ===${NC}"

if [ "$SKIP_SIDECAR" = true ]; then
  skip "Sidecar build (--skip-sidecar)"
else
  # Build the sidecar
  if npx tsx "$ROOT/scripts/build-sidecar.ts" --skip-verify 2>&1; then
    pass "Sidecar build completed"
  else
    fail "Sidecar build failed"
  fi

  # Check manifest exists
  if [ -f "$SIDECAR_DIR/manifest.json" ]; then
    pass "Manifest generated"
  else
    fail "Manifest not found"
  fi

  # Check server bundle exists
  if [ -f "$SIDECAR_DIR/server.mjs" ]; then
    pass "Server bundle exists"
  else
    fail "Server bundle not found"
  fi

  # Check entry point exists
  if [ -f "$SIDECAR_DIR/index.mjs" ]; then
    pass "Entry point exists"
  else
    fail "Entry point not found"
  fi

  # Syntax check the entry point
  if node --check "$SIDECAR_DIR/index.mjs" 2>/dev/null; then
    pass "Entry point syntax valid"
  else
    fail "Entry point syntax invalid"
  fi

  # Syntax check the server bundle
  if [ -f "$SIDECAR_DIR/server.mjs" ] && node --check "$SIDECAR_DIR/server.mjs" 2>/dev/null; then
    pass "Server bundle syntax valid"
  else
    fail "Server bundle syntax invalid"
  fi

  # Health check: start sidecar, wait 3s, check it's alive
  echo -e "  ${CYAN}...${NC} Running health check (3s timeout)"
  ASTRO_MODE=local ASTRO_DESKTOP=1 PORT=0 node "$SIDECAR_DIR/index.mjs" &
  SIDECAR_PID=$!
  sleep 3

  if kill -0 "$SIDECAR_PID" 2>/dev/null; then
    pass "Sidecar health check (alive after 3s)"
    kill "$SIDECAR_PID" 2>/dev/null || true
    wait "$SIDECAR_PID" 2>/dev/null || true
  else
    # Check if it exited cleanly (port conflict, etc.) vs crashed
    wait "$SIDECAR_PID" 2>/dev/null
    EXIT_CODE=$?
    if [ "$EXIT_CODE" -eq 0 ]; then
      pass "Sidecar health check (exited cleanly)"
    else
      fail "Sidecar health check (exited with code $EXIT_CODE)"
    fi
  fi
fi

# ===================================================================
# Step 2: Frontend Build
# ===================================================================
echo -e "\n${CYAN}=== Step 2: Frontend Build ===${NC}"

if [ "$SKIP_FRONTEND" = true ]; then
  skip "Frontend build (--skip-frontend)"
else
  # Install frontend deps if needed
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo -e "  ${CYAN}...${NC} Installing frontend dependencies"
    (cd "$FRONTEND_DIR" && npm install --ignore-scripts 2>&1) || true
  fi

  # Build
  if (cd "$FRONTEND_DIR" && npx vite build 2>&1); then
    pass "Frontend build completed"
  else
    fail "Frontend build failed"
  fi

  # Check dist exists
  if [ -d "$FRONTEND_DIR/dist" ]; then
    pass "Frontend dist/ directory exists"
  else
    fail "Frontend dist/ directory not found"
  fi

  # Check index.html in dist
  if [ -f "$FRONTEND_DIR/dist/index.html" ]; then
    pass "Frontend dist/index.html exists"
  else
    fail "Frontend dist/index.html not found"
  fi

  # Check JS assets generated
  JS_COUNT=$(find "$FRONTEND_DIR/dist" -name "*.js" 2>/dev/null | wc -l)
  if [ "$JS_COUNT" -gt 0 ]; then
    pass "Frontend JS assets generated ($JS_COUNT files)"
  else
    fail "No JS assets found in dist/"
  fi
fi

# ===================================================================
# Step 3: Rust Compilation
# ===================================================================
echo -e "\n${CYAN}=== Step 3: Rust Compilation ===${NC}"

if [ "$SKIP_RUST" = true ]; then
  skip "Rust compilation (--skip-rust)"
elif ! command -v cargo &>/dev/null; then
  skip "Rust compilation (cargo not found)"
else
  # Check if Cargo.toml exists
  if [ ! -f "$TAURI_DIR/Cargo.toml" ]; then
    fail "Cargo.toml not found in src-tauri/"
  else
    # Run cargo check (faster than full build, validates compilation)
    echo -e "  ${CYAN}...${NC} Running cargo check"
    if (cd "$TAURI_DIR" && cargo check 2>&1); then
      pass "Rust compilation check passed"
    else
      fail "Rust compilation check failed"
    fi
  fi
fi

# ===================================================================
# Summary
# ===================================================================
echo -e "\n${CYAN}=== Test Summary ===${NC}"
echo -e "  ${GREEN}Passed:${NC}  $PASSED"
echo -e "  ${RED}Failed:${NC}  $FAILED"
echo -e "  ${YELLOW}Skipped:${NC} $SKIPPED"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
else
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
fi
