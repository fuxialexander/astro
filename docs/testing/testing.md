# Astro Testing Guide

Comprehensive testing documentation for the Astro platform.

## Overview

Astro uses two testing systems:

1. **Vitest** (primary) — 29 test files, all passing. Run with `npm test`.
2. **Shell scripts** (supplementary) — curl-based API tests and E2E scripts requiring a running server. Run with `./scripts/test-runner.sh`.

## Vitest Test Structure

Config: `vitest.config.ts` — discovers `**/__tests__/**/*.test.ts` and `tests/**/*.test.ts`.

```
tests/                                          # Root-level vitest tests (16 files)
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
├── dispatch-engine.test.ts                     # Dispatch queue, context assembler, result router, branch manager
├── codex-provider.test.ts                      # Codex provider adapter (capabilities, context, detection)
├── claude-code-provider.test.ts                # Claude Code provider (dotenv, cache utils, session logger, config)
├── claude-code-sdk-integration.test.ts         # SDK integration (skipped without API key)
├── relay-server-integration.test.ts            # Relay server integration (skipped without running server)
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

No server or prerequisites needed — vitest tests are self-contained with mocks. Integration tests that require external services (API keys, running server) use `describe.skipIf()` guards and auto-skip gracefully.

## Shell Script Tests

These require a running backend and test via HTTP/curl. They are supplementary to vitest.

```
scripts/
├── test-runner.sh              # Orchestrator (parallel/sequential)
├── test-approval-automated.ts  # Approval system automated tests (npm run test:approval)
├── test-approval-integration.ts # Approval integration tests (npm run test:approval:integration, test:approval:interactive)
├── test-approval-quick.sh      # Quick approval unit tests (npm run test:approval:quick)
├── test-approval-e2e.sh        # Comprehensive E2E approval tests
├── test-e2e-with-approval.sh   # Full E2E superset
├── test-github-oauth.ts        # GitHub OAuth testing
├── test-injection-fixes.js     # Security injection validation
├── test-preserve-worktrees.sh  # Worktree preservation tests
├── test-security-fixes.sh      # Security posture validation
├── test-token-validation.sh    # Token validation tests
├── test-trace-viewer.sh        # Observability pipeline tests
└── tests/
    ├── test-api-health.sh           # API health check
    ├── test-database-mode.sh        # Database mode detection
    ├── test-project-crud.sh         # Project CRUD operations
    ├── test-task-crud.sh            # Task node operations
    ├── test-auth-flow.sh            # Authentication flow
    ├── test-relay-connectivity.sh   # Relay server availability
    ├── test-device-auth-flow.sh     # Device authorization flow
    └── test-realtime-events.sh      # SSE event streaming
```

### Running Shell Tests

```bash
# Start backend first
ASTRO_LOCAL_MODE=true npm run dev:backend

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

## Approval System Testing

See `docs/testing/approval-testing-guide.md` for the complete guide. Quick reference:

```bash
npm run demo:approval              # Visual demo (no server)
npm run test:approval:quick        # Quick unit tests
./scripts/test-e2e-with-approval.sh  # Full E2E integration
```

## Test Coverage by Area

| Area | Vitest | Shell |
|------|--------|-------|
| Relay protocol | 25 tests | connectivity check |
| Relay server integration | integration test (skipIf) | - |
| Chat (API, session, resume, mutations) | 5 files | - |
| Session management | 1 file | - |
| Execution strategies (Direct, Slurm, Docker, K8s, SkyPilot) | 29 tests | - |
| Dispatch engine (queue, context, routing, branches) | 1 file | - |
| Claude Code adapter (tool streaming) | 7 tests | - |
| Claude Code provider (dotenv, cache, logger, config) | 1 file | - |
| Claude Code SDK integration | 1 file (skipIf) | - |
| Codex provider | 1 file | - |
| Event transport + hooks | 5 files | - |
| Access control | 1 file | - |
| Procedure executor | 1 file | - |
| Observation collector | 1 file | - |
| MCP loader | 1 file | - |
| Frontend (path-utils, stores) | 3 files | - |
| App mode detection | 1 file | database-mode check |
| API health | - | health check |
| Project/Task CRUD | - | CRUD scripts |
| Auth flow | - | auth check |
| Device auth | - | device-auth flow |
| SSE events | SSE parser | realtime-events |
| Approval system | - | 4 scripts |

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
6. **Guard external deps**: Use `describe.skipIf()` for tests needing API keys or running servers

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

- [ ] CI/CD pipeline (GitHub Actions)
- [ ] E2E smoke test (vitest-based)
- [ ] Load/stress testing
- [ ] Visual regression testing (frontend)
- [ ] API contract testing
- [x] Consolidate server/test/ into tests/ directory (vitest)
- [x] Clean up redundant scripts/test-* files
- [x] Approval system CLI tests
- [x] Execution strategy unit tests
- [x] Event transport tests
- [x] Claude Code adapter tests
