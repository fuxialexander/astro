#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEV_PID=""

cleanup() {
  echo ""
  echo "Shutting down..."
  if [[ -n "$DEV_PID" ]]; then
    kill $DEV_PID 2>/dev/null || true
    wait $DEV_PID 2>/dev/null || true
  fi
  exit
}
trap cleanup SIGINT SIGTERM

# Start the app (frontend + backend) in the background
echo "Starting dev server (frontend + backend)..."
npm run dev &
DEV_PID=$!

# Wait for backend
echo "Waiting for backend..."
for i in $(seq 1 60); do
  if curl -sf --connect-timeout 1 --max-time 2 http://localhost:3001/api/health -o /dev/null 2>/dev/null; then
    echo "Backend is ready"
    break
  fi
  if [[ $i -eq 60 ]]; then
    echo "WARNING: Backend did not respond within 60s, continuing anyway..."
  fi
  sleep 1
done

# Wait for Vite
echo "Waiting for Vite..."
for i in $(seq 1 30); do
  if curl -sf --connect-timeout 1 --max-time 2 http://localhost:5173 -o /dev/null 2>/dev/null; then
    echo "Vite is ready"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "WARNING: Vite did not respond within 30s, continuing anyway..."
  fi
  sleep 1
done

# Pre-warm critical routes
echo "Pre-warming critical routes..."
curl -sf --max-time 5 http://localhost:5173/src/main.tsx -o /dev/null 2>/dev/null || true
curl -sf --max-time 5 http://localhost:5173/src/app.tsx -o /dev/null 2>/dev/null || true
curl -sf --max-time 5 http://localhost:5173/src/pages/login.tsx -o /dev/null 2>/dev/null || true
curl -sf --max-time 5 http://localhost:5173/src/pages/dashboard.tsx -o /dev/null 2>/dev/null || true
echo "Pre-warming done"

# Start the cloudflare tunnel (this blocks)
echo "Starting Cloudflare tunnel..."
bash "$SCRIPT_DIR/start-tunnel.sh" &
TUNNEL_PID=$!

# Wait for either process to exit
wait $DEV_PID $TUNNEL_PID
