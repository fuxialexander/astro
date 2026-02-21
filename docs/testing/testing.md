# Astro Testing Guide

Comprehensive testing documentation for the Astro platform.

## Test Structure

```
scripts/
├── test-runner.sh              # Main test orchestrator (parallel/sequential)
├── test-e2e-workflow.sh        # Complete end-to-end workflow test
└── tests/
    ├── test-api-health.sh           # Unit: API health check
    ├── test-database-mode.sh        # Unit: Database mode detection
    ├── test-project-crud.sh         # Unit: Project CRUD operations
    ├── test-task-crud.sh            # Unit: Task CRUD operations
    ├── test-auth-flow.sh            # Unit: Authentication flow
    ├── test-relay-connectivity.sh   # Unit: Relay server connectivity
    ├── test-device-auth-flow.sh     # Integration: Device authorization
    ├── test-task-execution.sh       # Integration: Task execution
    └── test-realtime-events.sh      # Integration: SSE events
```

## Test Categories

### Unit Tests (Parallel Execution)
Independent tests with no dependencies, can run in parallel:
- **API Health** - Verifies backend is running and responsive
- **Database Mode** - Checks IndexedDB vs Supabase mode detection
- **Project CRUD** - Tests project create/read/update/delete
- **Task CRUD** - Tests task node operations
- **Auth Flow** - Validates authentication behavior per mode
- **Relay Connectivity** - Checks relay server availability

### Integration Tests (Sequential Execution)
Tests that may have dependencies or require specific setup:
- **Device Auth Flow** - Tests OAuth2 device code flow
- **Task Execution** - Tests task dispatch and execution (requires agent runner)
- **Realtime Events** - Tests SSE event streaming

### End-to-End Tests (Sequential Execution)
Complete user workflows:
- **E2E Workflow** - Full journey: registration → device auth → project creation → task execution → cleanup

## Running Tests

### Quick Start

```bash
# Run all tests (recommended)
./scripts/test-runner.sh

# Run only unit tests (fast, parallel)
./scripts/test-runner.sh --unit

# Run only integration tests
./scripts/test-runner.sh --integration

# Run only end-to-end test
./scripts/test-runner.sh --e2e

# Run all tests sequentially (slower but safer)
./scripts/test-runner.sh --sequential

# Run everything in parallel (fastest but may cause race conditions)
./scripts/test-runner.sh --parallel
```

### Prerequisites

#### For IndexedDB Mode (Recommended for Testing)

```bash
# Start backend in IndexedDB-only mode
USE_INDEXEDDB_ONLY=true npm run dev:backend

# Run tests
./scripts/test-runner.sh --unit
```

**No authentication required** - tests use dev-user automatically.

#### For Supabase Mode

```bash
# Setup Supabase
bash ./scripts/setup-supabase-local.sh

# Start backend
npm run dev:backend

# Get auth token (requires manual WebAuthn/passkey interaction)
# Visit http://localhost:5173/login and complete authentication
# Extract token from browser storage or session

# Run tests with token
AUTH_TOKEN="your-token-here" ./scripts/test-runner.sh --unit
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `API_BASE` | Backend API URL | `http://localhost:3001` |
| `FRONTEND_BASE` | Frontend URL | `http://localhost:5173` |
| `RELAY_WS_URL` | Relay WebSocket URL | `ws://localhost:3002` |
| `AUTH_TOKEN` | Authentication token (Supabase mode) | - |
| `TEST_EMAIL` | Test user email (E2E) | Generated |
| `TEST_NAME` | Test user name (E2E) | `E2E Test User` |

### Examples

```bash
# Test against different backend
API_BASE=http://localhost:4000 ./scripts/test-runner.sh --unit

# Test with custom relay URL
RELAY_WS_URL=wss://relay.example.com ./scripts/test-runner.sh

# Run E2E test with auth token
AUTH_TOKEN=$TOKEN ./scripts/test-e2e-workflow.sh
```

## Individual Test Scripts

You can also run individual test scripts directly:

```bash
# Single unit test
./scripts/tests/test-api-health.sh

# Single integration test
./scripts/tests/test-device-auth-flow.sh

# Full E2E workflow
./scripts/test-e2e-workflow.sh
```

## Test Output

### Success Output

```
Running: test-api-health.sh
✓ PASS: test-api-health.sh
Running: test-database-mode.sh
✓ PASS: test-database-mode.sh
...
========================================
Test Summary
========================================
Total:   6
Passed:  6
Failed:  0
Skipped: 0
```

### Failure Output

```
✗ FAIL: test-project-crud.sh
========================================
Failed tests:
  - test-project-crud.sh
    Output:
      [test-project-crud] Testing project CRUD operations...
      ✗ Failed to create project
      {"error": "Unauthorized"}
```

## Writing New Tests

### Unit Test Template

```bash
#!/bin/bash
# Unit Test: Your Test Name

API_BASE="${API_BASE:-http://localhost:3001}"

echo "[test-your-name] Testing something..."

# Your test logic
RESPONSE=$(curl -s "$API_BASE/api/endpoint")

if echo "$RESPONSE" | jq -e '.success' > /dev/null; then
    echo "✓ Test passed"
    exit 0
else
    echo "✗ Test failed"
    echo "$RESPONSE"
    exit 1
fi
```

### Test Guidelines

1. **Exit codes**: `0` for success, `1` for failure
2. **Logging**: Use `echo` for output, prefix with test name
3. **Cleanup**: Clean up any created resources
4. **Isolation**: Don't depend on other tests
5. **Fast**: Keep unit tests under 5 seconds
6. **Deterministic**: Same input should always give same result

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Start backend
        run: |
          USE_INDEXEDDB_ONLY=true npm run dev:backend &
          sleep 5  # Wait for server to start

      - name: Run unit tests
        run: ./scripts/test-runner.sh --unit

      - name: Run integration tests
        run: ./scripts/test-runner.sh --integration
```

## Troubleshooting

### Tests Fail with "Connection Refused"

```bash
# Ensure backend is running
npm run dev:backend

# Check if port is occupied
lsof -i :3001
```

### Tests Fail with "Unauthorized" in Supabase Mode

```bash
# Switch to IndexedDB mode for testing
USE_INDEXEDDB_ONLY=true npm run dev:backend

# Or provide valid auth token
AUTH_TOKEN=$(get-your-token) ./scripts/test-runner.sh
```

### Parallel Tests Cause Race Conditions

```bash
# Run tests sequentially
./scripts/test-runner.sh --sequential

# Or run specific test categories separately
./scripts/test-runner.sh --unit  # Fast and safe for parallel
./scripts/test-runner.sh --integration  # Already sequential
```

### Test Hangs or Times Out

- Check if required services are running (backend, relay, Supabase)
- Verify environment variables are correct
- Try running individual test to isolate issue

## Test Coverage

Current coverage by component:

| Component | Unit | Integration | E2E |
|-----------|------|-------------|-----|
| API Health | ✅ | - | ✅ |
| Auth Flow | ✅ | - | ✅ |
| Database Mode | ✅ | - | ✅ |
| Project CRUD | ✅ | - | ✅ |
| Task CRUD | ✅ | - | ✅ |
| Device Auth | - | ✅ | ✅ |
| Machine Registry | - | - | ✅ |
| Task Execution | - | ⚠️ | ✅ |
| Realtime Events | - | ✅ | ✅ |
| Relay Server | ✅ | - | ✅ |

Legend: ✅ Implemented | ⚠️ Stub | - Not tested

## Approval System Testing

See `docs/testing/approval-testing-guide.md` for the complete approval testing guide, including CLI tests, E2E integration, visual demos, and manual UI testing.

## Future Enhancements

- [ ] Add load/stress testing
- [ ] Add security testing (SQL injection, XSS, etc.)
- [ ] Add performance benchmarking
- [ ] Add mutation testing
- [ ] Add visual regression testing (frontend)
- [ ] Add API contract testing
- [ ] Add database migration testing
- [ ] Add multi-user concurrency testing
- [x] Add approval system CLI tests
