# Astro Testing Guide

Comprehensive testing documentation for the Astro platform.

## Overview

Astro uses two testing systems:

1. **Vitest** (primary) — 24 test files, 402 tests, all passing. Run with `npm test`.
2. **Shell scripts** (supplementary) — curl-based API tests and E2E scripts requiring a running server. Run with `./scripts/test-runner.sh`.

## Vitest Test Structure

Config: `vitest.config.ts` — discovers `**/__tests__/**/*.test.ts` and `tests/**/*.test.ts`.

```
tests/                                          # Root-level vitest tests (11 files)
├── relay-protocol-fields.test.ts               # Relay protocol extension (25 tests)
├── sse-parser.test.ts                          # SSE stream parsing
├── chat-api-route.test.ts                      # Chat API route
├── chat-hybrid-resume.test.ts                  # Chat session resume
├── chat-mutations.test.ts                      # Chat mutations
├── chat-session-flow.test.ts                   # Chat session lifecycle
├── chat-session-pool.test.ts                   # Session pool management
├── session-manager.test.ts                     # Session management
├── execution-strategy.test.ts                  # Execution strategies + registry (29 tests)
├── local-server-mode.test.ts                   # App mode detection
├── smoke-trace-viewer.test.ts                  # Trace viewer smoke tests
└── test-local-execution.ts                     # Manual integration (NOT vitest — run with npx tsx)

server/lib/*/__tests__/                         # Co-located server tests (10 files)
├── access/__tests__/user-access-control.test.ts
├── dispatch/__tests__/procedure-executor.test.ts
├── events/__tests__/event-transport.test.ts
├── events/hooks/__tests__/git-pull-hook.test.ts
├── events/hooks/__tests__/merge-queue-hook.test.ts
├── events/hooks/__tests__/pr-creation-hook.test.ts
├── events/hooks/__tests__/usage-metrics-hook.test.ts
├── observability/__tests__/observation-collector.test.ts
├── providers/__tests__/claude-code-adapter.test.ts  # Tool correlation (7 tests)
└── providers/__tests__/mcp-loader.test.ts

src/*/__tests__/                                # Frontend tests (3 files)
├── lib/__tests__/path-utils.test.ts
├── stores/__tests__/session-store.test.ts
└── stores/__tests__/observation-store.test.ts
```

### Running Vitest

```bash
# Run all vitest tests (primary command)
npm test

# Watch mode
npm run test:watch

# With UI
npm run test:ui

# Run a single file
npx vitest run tests/execution-strategy.test.ts

# Run tests matching a pattern
npx vitest run --reporter=verbose chat
```

No server or prerequisites needed — vitest tests are self-contained with mocks.

## Shell Script Tests

These require a running backend and test via HTTP/curl. They are supplementary to vitest.

```
scripts/
├── test-runner.sh              # Orchestrator (parallel/sequential)
└── tests/
    ├── test-api-health.sh           # API health check
    ├── test-database-mode.sh        # Database mode detection
    ├── test-project-crud.sh         # Project CRUD operations
    ├── test-task-crud.sh            # Task node operations
    ├── test-auth-flow.sh            # Authentication flow
    ├── test-relay-connectivity.sh   # Relay server availability
    ├── test-device-auth-flow.sh     # Device authorization flow
    ├── test-task-execution.sh       # Task dispatch and execution
    └── test-realtime-events.sh      # SSE event streaming
```

### Running Shell Tests

```bash
# Start backend first
USE_INDEXEDDB_ONLY=true npm run dev:backend

# Then run tests
./scripts/test-runner.sh           # All tests
./scripts/test-runner.sh --unit    # Unit only (parallel)
./scripts/test-runner.sh --integration  # Integration only (sequential)
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `API_BASE` | Backend API URL | `http://localhost:3001` |
| `FRONTEND_BASE` | Frontend URL | `http://localhost:5173` |
| `RELAY_WS_URL` | Relay WebSocket URL | `ws://localhost:3002` |
| `AUTH_TOKEN` | Authentication token (Supabase mode) | - |

## Server Integration Tests (Manual)

Five integration test files in `server/test/` are NOT discovered by vitest. They require a running server and are run manually:

```bash
npx tsx server/test/relay-server.test.ts
npx tsx server/test/dispatch-engine.test.ts
npx tsx server/test/claude-code-provider.test.ts
npx tsx server/test/claude-code-sdk-integration.test.ts
npx tsx server/test/codex-provider.test.ts
```

## Approval System Testing

See `docs/testing/approval-testing-guide.md` for the complete guide. Quick reference:

```bash
npm run demo:approval              # Visual demo (no server)
npm run test:approval:quick        # Quick unit tests
./scripts/test-e2e-with-approval.sh  # Full E2E integration
```

## Test Coverage by Area

| Area | Vitest | Shell | Manual |
|------|--------|-------|--------|
| Relay protocol | 25 tests | connectivity check | relay-server integration |
| Chat (API, session, resume, mutations) | 5 files | - | - |
| Session management | 1 file | - | - |
| Execution strategies (Direct, Slurm, Docker, K8s, SkyPilot) | 29 tests | - | - |
| Claude Code adapter (tool streaming) | 7 tests | - | provider + SDK integration |
| Event transport + hooks | 5 files | - | - |
| Access control | 1 file | - | - |
| Procedure executor | 1 file | - | - |
| Observation collector | 1 file | - | - |
| MCP loader | 1 file | - | - |
| Frontend (path-utils, stores) | 3 files | - | - |
| App mode detection | 1 file | database-mode check | - |
| API health | - | health check | - |
| Project/Task CRUD | - | CRUD scripts | - |
| Auth flow | - | auth check | - |
| Device auth | - | device-auth flow | - |
| Task execution | - | execution script | - |
| SSE events | SSE parser | realtime-events | - |
| Approval system | - | 10 scripts | - |

## Writing New Tests

Prefer vitest for new tests. Place them either:
- In `tests/` for cross-cutting tests
- In `__tests__/` next to the source file for co-located unit tests

### Vitest Test Template

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('MyFeature', () => {
  it('should do the thing', () => {
    expect(true).toBe(true)
  })
})
```

### Guidelines

1. **Self-contained**: Mock external dependencies, don't require a running server
2. **Fast**: Unit tests should complete in milliseconds
3. **Deterministic**: Same input, same result
4. **Co-located**: Put tests near the code they test (`__tests__/` directory)
5. **Descriptive**: Test names should read as behavior specifications

## Known Issues

- `server/test/` (5 files) is outside vitest's include pattern — should be migrated to `tests/integration/`
- Shell scripts in `scripts/test-*` overlap with vitest coverage — should be consolidated
- 10 approval test scripts (`scripts/test-approval-*`) are redundant — should be consolidated into 2-3

## CI/CD Integration

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
      - run: npm install
      - run: npm test  # Vitest — primary gate
```

## Future Enhancements

- [ ] Consolidate all tests under `tests/` directory
- [ ] Migrate `server/test/` to vitest-discoverable location
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] E2E smoke test (vitest-based)
- [ ] Load/stress testing
- [ ] Visual regression testing (frontend)
- [ ] API contract testing
- [x] Approval system CLI tests
- [x] Execution strategy unit tests
- [x] Event transport tests
- [x] Claude Code adapter tests
