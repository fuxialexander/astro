# Approval System - Complete Testing Guide

This document provides a complete testing strategy for the approval system, from quick unit tests to comprehensive end-to-end integration.

## Testing Levels

### Level 1: Visual Demo (No Server Required)
**Purpose:** Understand how the approval flow works
**Time:** 10 seconds
**Prerequisites:** None

```bash
npm run demo:approval
```

Shows an animated walkthrough of the complete approval flow with no server required.

### Level 2: Unit Tests (Quick)
**Purpose:** Verify components work independently
**Time:** ~30 seconds
**Prerequisites:** Backend running

```bash
npm run test:approval:quick
```

Automatically:
1. Starts backend server
2. Tests MCP server tool listing
3. Tests HTTP approval endpoint
4. Tests interactive flow
5. Tests MCP tool call
6. Cleans up

### Level 3: Comprehensive E2E (Gold Standard)
**Purpose:** Verify full integration with real agent execution
**Time:** 2-3 minutes
**Prerequisites:** Backend + Agent runner

```bash
# Terminal 1: Backend
npm run dev:backend

# Terminal 2: Agent runner
cd packages/agent-runner
node dist/cli.js connect

# Terminal 3: Run test
./scripts/test-e2e-with-approval.sh
```

Tests the complete flow:
1. ✅ Authentication and device registration
2. ✅ Machine registration
3. ✅ Project creation
4. ✅ Task creation with approval requirement
5. ✅ Task dispatch to agent runner
6. ✅ SSE event monitoring
7. ✅ Agent calls `ask_user_question` during execution
8. ✅ Approval request detected via SSE
9. ✅ Auto-response sent to approval
10. ✅ Agent continues with user's selection
11. ✅ File created based on user's choice
12. ✅ Worktree capture and verification
13. ✅ Cleanup

### Level 4: Manual UI Testing
**Purpose:** Test with real browser interface
**Time:** 5 minutes
**Prerequisites:** Full stack

```bash
npm run dev
```

Then:
1. Create a project in the UI
2. Create a task with description: "Ask user to choose between options A, B, C using ask_user_question"
3. Dispatch the task
4. Watch for ApprovalCard to appear in Dashboard or Task Detail
5. Select option and click Confirm
6. Verify agent continues

## Quick Reference

| Test Type | Command | Time | Server Needed | Agent Needed | Best For |
|-----------|---------|------|---------------|--------------|----------|
| Demo | `npm run demo:approval` | 10s | No | No | Learning the flow |
| Unit | `npm run test:approval:quick` | 30s | Auto-start | No | Quick validation |
| E2E | `./scripts/test-e2e-with-approval.sh` | 2-3m | Yes | Yes | Full integration |
| UI | `npm run dev` + manual | 5m | Yes | Yes | User experience |

## What Each Test Verifies

### Demo (Visual)
- [x] Understanding of approval flow architecture
- [x] Event flow visualization
- [x] Component interactions

### Unit Tests
- [x] MCP server starts correctly
- [x] `ask_user_question` tool is exposed
- [x] HTTP endpoint accepts requests
- [x] Approval flow initiates

### E2E Integration
- [x] Real agent execution
- [x] MCP tool call from agent
- [x] HTTP request to dispatch engine
- [x] Approval event emission
- [x] SSE streaming to clients
- [x] Approval response processing
- [x] Promise resolution in dispatch engine
- [x] Tool result returned to agent
- [x] Agent continues with selection
- [x] Correct file/code generated based on choice

### Manual UI
- [x] ApprovalCard renders correctly
- [x] Options display properly
- [x] User can select options
- [x] Confirm/Cancel buttons work
- [x] Real-time updates via SSE
- [x] Task status changes correctly

## Recommended Testing Workflow

### During Development
```bash
# Quick feedback loop
npm run test:approval:quick
```

Run after changes to approval system code to catch regressions quickly.

### Before Committing
```bash
# Full validation
./scripts/test-e2e-with-approval.sh
```

Ensure the complete flow works with real agent execution.

### For Demos/Documentation
```bash
# Visual explanation
npm run demo:approval
```

Shows stakeholders how the system works.

### For User Acceptance
```bash
# Manual UI testing
npm run dev
```

Let users test the actual interface.

## Troubleshooting

### Unit Tests Fail

**"Server not running"**
- The quick test auto-starts backend, so this shouldn't happen
- If it does: `pkill -f "tsx.*server/index.ts"` then retry

**"MCP server failed to start"**
- Check Node.js version: `node --version` (need 18+)
- Check TypeScript compilation: `npm run build`
- Check MCP server directly: `node --import=tsx/esm server/lib/mcp/nexus-tools-server.ts`

### E2E Test Fails

**"No approval request detected"**
- Check agent runner logs: `tail -f /tmp/nexus-e2e-logs-*/agent-runner.log`
- Verify MCP server is loaded: grep for "Nexus MCP Tools Server" in logs
- Check agent has access to tool: Look for tool listing in logs

**"Approval response failed"**
- Verify SSE connection: `curl -N http://localhost:3001/api/events/stream`
- Check approval ID matches: Compare in approval events log
- Verify dispatch engine has pending approval: Check server logs

**"Execution timeout"**
- Agent may have hit an error
- Check agent logs for exceptions
- Verify working directory is accessible
- Check git initialization succeeded

### Manual UI Test Issues

**ApprovalCard doesn't appear**
- Open browser console, check for errors
- Verify SSE connection in Network tab
- Check React DevTools → Zustand → execution-store → pendingApprovals
- Look for approval:requested events in console

**Selection doesn't work**
- Check network tab for failed POST to /api/dispatch/approve
- Verify auth token is valid
- Check approval ID matches pending approval

## Test Coverage Summary

| Component | Unit | Integration | E2E | UI |
|-----------|------|-------------|-----|-----|
| MCP Server | ✅ | - | ✅ | ✅ |
| HTTP Endpoint | ✅ | - | ✅ | ✅ |
| Dispatch Engine | ⚠️ | - | ✅ | ✅ |
| Event System | - | - | ✅ | ✅ |
| SSE Streaming | - | - | ✅ | ✅ |
| ApprovalCard UI | - | - | - | ✅ |
| Agent Integration | - | - | ✅ | ✅ |
| End-to-End Flow | - | - | ✅ | ✅ |

Legend:
- ✅ Full coverage
- ⚠️ Partial coverage
- - Not tested at this level

## Adding New Approval Tests

### For New Approval Features

1. Add unit test to `scripts/test-approval-system.ts`
2. Add scenario to E2E test if it involves agent execution
3. Update demo script if it changes the user-facing flow
4. Document in this file

### Example: Testing Timeout Behavior

```bash
# In test-approval-system.ts
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

## Documentation

- `APPROVAL_SYSTEM.md` - Architecture and implementation details
- `docs/APPROVAL_QUICKSTART.md` - Developer guide for using approvals
- `scripts/README.md` - All test scripts documentation
- `TESTING.md` - Overall testing strategy
- This file - Approval testing specifically

## Next Steps

After running tests, you should:

1. ✅ Review test reports in `/tmp/nexus-e2e-logs-*/`
2. ✅ Check approval events log for SSE flow
3. ✅ Examine worktree snapshot to see generated files
4. ✅ Review agent logs for tool calls
5. ✅ Verify cleanup completed successfully

## Questions?

Check the detailed docs:
- How approvals work: `APPROVAL_SYSTEM.md`
- How to use in code: `docs/APPROVAL_QUICKSTART.md`
- Troubleshooting: `scripts/README.md`
