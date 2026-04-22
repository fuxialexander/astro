#!/usr/bin/env bash
# Build the AstroCalendar Swift helper binary.
# Usage: npm run build:calendar-helper
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/electron/swift/AstroCalendar.swift"
OUT_DIR="$REPO_ROOT/electron/resources/binaries"
OUT="$OUT_DIR/astro-calendar"

mkdir -p "$OUT_DIR"

echo "► Compiling AstroCalendar.swift → arm64..."
swiftc \
  -O \
  -target arm64-apple-macosx13.0 \
  -framework Foundation \
  -framework EventKit \
  -framework AppKit \
  -o "$OUT" \
  "$SRC"

# Sign with app identity when credentials are available
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "► Signing with $APPLE_SIGNING_IDENTITY..."
  codesign --force --sign "$APPLE_SIGNING_IDENTITY" \
    --entitlements "$REPO_ROOT/electron/entitlements.calendar-helper.plist" \
    --options runtime \
    "$OUT"
  echo "► Signed."
else
  echo "► Skipping signing (APPLE_SIGNING_IDENTITY not set)"
fi

echo "✓ Built: $OUT ($(du -sh "$OUT" | cut -f1))"
