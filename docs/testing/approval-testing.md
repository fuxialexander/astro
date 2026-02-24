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

Tests the complete flow:
1. Authentication and device registration
2. Machine registration
3. Project creation
4. Task creation with approval requirement
5. Task dispatch to agent runner
6. SSE event monitoring
7. Agent calls `ask_user_question` during execution
8. Approval request detected via SSE
9. Auto-response sent to approval
10. Agent continues with user's selection
11. File created based on user's choice
12. Worktree capture and verification
13. Cleanup

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
| End-to-End Flow | - | Yes | Yes |

Legend:
- Yes / Full coverage
- Partial / Some coverage
- `-` / Not tested at this level

## What Each Test Verifies

### Demo (Visual)
- Understanding of approval flow architecture
- Event flow visualization
- Component interactions

### Unit Tests
- MCP server starts correctly
- `ask_user_question` tool is exposed
- HTTP endpoint accepts requests
- Approval flow initiates

### E2E Integration
- Real agent execution
- MCP tool call from agent
- HTTP request to dispatch engine
- Approval event emission
- SSE streaming to clients
- Approval response processing
- Promise resolution in dispatch engine
- Tool result returned to agent
- Agent continues with selection
- Correct file/code generated based on choice

### Manual UI
- ApprovalCard renders correctly
- Options display properly
- User can select options
- Confirm/Cancel buttons work
- Real-time updates via SSE
- Task status changes correctly

## Troubleshooting

### Unit Tests

| Issue | Fix |
|-------|-----|
| "Server not running" | `pkill -f "tsx.*server/index.ts"` then retry |
| "MCP server failed" | Check Node.js 18+, run `npm run build` |
| "MCP server failed to start" | Check directly: `node --import=tsx/esm server/lib/mcp/astro-tools-server.ts` |

### E2E Tests

| Issue | Fix |
|-------|-----|
| "No approval detected" | Check agent runner logs in `/tmp/astro-e2e-logs-*/` |
| "Approval response failed" | Verify SSE: `curl -N http://localhost:3001/api/events/stream` |
| "Timeout" | Check agent logs for exceptions |
| "Execution timeout" | Verify working directory is accessible, check git init |

### Manual UI

| Issue | Fix |
|-------|-----|
| ApprovalCard missing | Check console errors, verify SSE in Network tab |
| Selection doesn't work | Check POST to `/api/dispatch/approve` in Network tab |
| Dialog doesn't appear | Check React DevTools -> Zustand -> execution-store -> pendingApprovals |

## Test Artifacts

E2E test logs saved to `/tmp/astro-e2e-logs-<timestamp>/`:
- `test-report.txt` - Summary
- `approval-events.log` - SSE events
- `worktree-snapshot.txt` - Generated files
- `agent-runner.log` - Agent output

## CI/CD Integration

### GitHub Actions

```yaml
name: Approval System Tests

on: [push, pull_request]

jobs:
  approval-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Run approval system tests
        run: npm run test:approval:quick
```

### Pre-commit Hook

```bash
# .husky/pre-commit
npm run test:approval:quick
```

## Adding New Approval Tests

1. Add unit test to `scripts/test-approval-system.ts`
2. Add scenario to E2E test if it involves agent execution
3. Update demo script if it changes the user-facing flow

### Example: Testing Timeout Behavior

```typescript
// In test-approval-system.ts
async function testApprovalTimeout(): Promise<boolean> {
  info('Test: Approval Timeout')

  // Send approval request but don't respond
  // Wait for timeout (5 minutes)
  // Verify error is returned

  return true
}
```

```bash
# In test-e2e-with-approval.sh
log_step "Testing Approval Timeout Handling"

# Dispatch task that asks question
# Don't respond to approval
# Wait for timeout
# Verify agent receives error
```

## Related Docs

- [Approval System Architecture](../features/approval-system.md)
- [Approval Quickstart (Developer Guide)](./approval-quickstart.md)
- [Testing Guide](./testing.md)
