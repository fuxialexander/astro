# Approval System Testing

Complete testing strategy for the approval system, from quick unit tests to comprehensive end-to-end integration.

## Quick Reference

| Test | Command | Time | Server | Agent | Best For |
|------|---------|------|--------|-------|----------|
| Demo | `npm run demo:approval` | 10s | No | No | Learning the flow |
| Unit | `npm run test:approval:quick` | 30s | Auto | No | Quick validation |
| E2E | `./scripts/test-e2e-with-approval.sh` | 2-3m | Yes | Yes | Full integration |
| UI | `npm run dev` + manual | 5m | Yes | Yes | User experience |

**Recommended workflow:**
```
Development → npm run test:approval:quick
Commit      → ./scripts/test-e2e-with-approval.sh
Demo        → npm run demo:approval
UAT         → npm run dev (manual UI)
```

## Testing Levels

### Level 1: Visual Demo (No Server)

```bash
npm run demo:approval
```

Animated walkthrough of the complete approval flow. No prerequisites needed.

### Level 2: Unit Tests (Quick)

```bash
npm run test:approval:quick
```

Auto-starts backend, then tests: MCP server startup, tool listing, HTTP endpoint, approval flow initiation, MCP tool call, cleanup.

### Level 3: E2E Integration (Gold Standard)

```bash
# Terminal 1: Backend
npm run dev:backend

# Terminal 2: Agent runner
cd packages/agent-runner && node dist/cli.js connect

# Terminal 3: Run test
./scripts/test-e2e-with-approval.sh
```

Tests the complete flow: authentication, machine registration, project/task creation, task dispatch, SSE monitoring, agent `ask_user_question` call, approval response, file generation, worktree verification, cleanup.

### Level 4: Manual UI Testing

```bash
npm run dev
```

1. Create a project in the UI
2. Create a task: "Ask user to choose between options A, B, C using ask_user_question"
3. Dispatch the task
4. Watch for ApprovalCard in Dashboard or Task Detail
5. Select option and click Confirm
6. Verify agent continues

## Test Coverage

| Component | Unit | E2E | UI |
|-----------|------|-----|-----|
| MCP Server | Yes | Yes | Yes |
| HTTP Endpoint | Yes | Yes | Yes |
| Dispatch Engine | Partial | Yes | Yes |
| Event System | - | Yes | Yes |
| SSE Streaming | - | Yes | Yes |
| ApprovalCard UI | - | - | Yes |
| Agent Integration | - | Yes | Yes |

## Troubleshooting

### Unit Tests
| Issue | Fix |
|-------|-----|
| "Server not running" | `pkill -f "tsx.*server/index.ts"` then retry |
| "MCP server failed" | Check Node.js 18+, run `npm run build` |

### E2E Tests
| Issue | Fix |
|-------|-----|
| "No approval detected" | Check agent runner logs in `/tmp/astro-e2e-logs-*/` |
| "Approval response failed" | Verify SSE: `curl -N http://localhost:3001/api/events/stream` |
| "Timeout" | Check agent logs for exceptions |

### Manual UI
| Issue | Fix |
|-------|-----|
| ApprovalCard missing | Check console errors, verify SSE in Network tab |
| Selection doesn't work | Check POST to `/api/dispatch/approve` in Network tab |

## Test Artifacts

E2E test logs saved to `/tmp/astro-e2e-logs-<timestamp>/`:
- `test-report.txt` - Summary
- `approval-events.log` - SSE events
- `worktree-snapshot.txt` - Generated files
- `agent-runner.log` - Agent output

## CI/CD Integration

```yaml
# GitHub Actions
- name: Run approval tests
  run: npm run test:approval:quick
```

## Adding New Approval Tests

1. Add unit test to `scripts/test-approval-system.ts`
2. Add scenario to E2E test if it involves agent execution
3. Update demo script if it changes the user-facing flow

## Related Docs

- [Approval System](../features/approval-system.md) - Architecture
- [Approval Quickstart](./approval-quickstart.md) - Developer guide
- [Testing Guide](./testing.md) - Overall testing strategy
