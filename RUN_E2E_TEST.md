# Running E2E Tests After Security Fixes

## Quick Start

The security fixes require the backend to run in test mode to bypass rate limiting. Follow these steps:

### 1. Stop Current Backend

```bash
# Kill all running backend processes
pkill -f "tsx watch.*server/index.ts" || true
```

### 2. Start Backend in Test Mode

```bash
# Set test mode environment variables
export NODE_ENV=test
export ALLOW_E2E_BYPASS=true

# Start backend
npm run dev:backend
```

**Important:** The backend will now:
- Bypass rate limiting (allow unlimited requests for testing)
- Allow test token bypass with `test-e2e-token`
- Use test-specific JWT secrets from `.env.test`

### 3. Run E2E Test (in new terminal)

```bash
# The test script automatically sets NODE_ENV=test and ALLOW_E2E_BYPASS=true
./scripts/test-e2e-comprehensive.sh
```

## Alternative: Use Test Script Wrapper

Or use this one-liner wrapper:

```bash
# Create test wrapper
cat > /tmp/run-e2e-with-backend.sh <<'EOF'
#!/bin/bash
set -e

echo "Starting backend in test mode..."
export NODE_ENV=test
export ALLOW_E2E_BYPASS=true

# Kill existing backend
pkill -f "tsx watch.*server/index.ts" 2>/dev/null || true
sleep 2

# Start backend in background
npm run dev:backend &
BACKEND_PID=$!
sleep 5

# Run test
./scripts/test-e2e-comprehensive.sh
TEST_EXIT=$?

# Cleanup
kill $BACKEND_PID 2>/dev/null || true

exit $TEST_EXIT
EOF

chmod +x /tmp/run-e2e-with-backend.sh
/tmp/run-e2e-with-backend.sh
```

## What Changed?

The security fixes added rate limiting that blocks rapid requests:
- **Global**: 100 requests per 15 minutes per IP
- **Auth endpoints**: 5 requests per 15 minutes per IP
- **Device endpoints**: 5 requests per 15 minutes per IP

In **test mode** (`NODE_ENV=test`), rate limiting is automatically bypassed to allow tests to run.

## Verification

After the test completes, you should see:

```
✅ COMPREHENSIVE E2E TEST COMPLETE
```

And verify:
- ✅ Authentication works
- ✅ Device authorization flow works
- ✅ Machine registration works
- ✅ Project CRUD works
- ✅ Task execution works
- ✅ All security fixes are active (JWT validation, IDOR protection, etc.)
