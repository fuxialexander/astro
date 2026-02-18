# Astro Scripts

This directory contains utility and test scripts for the Astro platform.

## Testing Scripts

### Approval System Tests

#### `demo-approval-flow.ts`
A visual demonstration of how the approval system works. Shows the complete flow from agent tool call to user response.

```bash
npm run demo:approval
```

**What it shows:**
- How an agent calls `ask_user_question` via MCP
- How the approval request flows through the system
- How the user responds via UI
- How the agent receives the response and continues

**Purpose:** Educational - understand the approval system architecture without needing a running server.

#### `test-approval-system.ts`
Comprehensive CLI test suite for the approval system. Tests all components independently.

**Option 1: Quick test (automatic)** - Starts backend, runs tests, cleans up:
```bash
npm run test:approval:quick
```

**Option 2: Manual test** - You control the backend:
```bash
# Terminal 1: Start backend
npm run dev:backend

# Terminal 2: Run tests
npm run test:approval
```

**What it tests:**
1. **MCP Server Tool Listing** - Verifies the MCP server exposes `ask_user_question` tool
2. **HTTP Endpoint** - Tests `/api/dispatch/request-dynamic-approval` endpoint
3. **Interactive Flow** - Simulates user selection in CLI
4. **End-to-End** - Tests MCP server calling HTTP endpoint

**Expected output:**
```
✓ MCP server lists ask_user_question tool
✓ Dynamic approval endpoint accepted request
✓ User selected: [option]
✓ MCP server accepted tool call and made HTTP request

✓ All tests passed (4/4)
```

### Comprehensive E2E Test

#### `test-e2e-with-approval.sh`
Complete end-to-end test including the approval system.

**Prerequisites:**
```bash
# Terminal 1: Start backend
npm run dev:backend

# Terminal 2: Start agent runner
cd packages/agent-runner
node dist/cli.js connect
```

**Run test:**
```bash
./scripts/test-e2e-with-approval.sh
```

**What it tests:**
1. Authentication and device registration
2. Project and task creation
3. Task dispatch to agent runner
4. Agent calls `ask_user_question` during execution
5. SSE event monitoring for approval requests
6. Auto-response to approval (simulates user selection)
7. Agent continues with user's choice
8. File creation based on user's selection
9. Worktree capture and verification
10. Cleanup

**Expected flow:**
```
✓ Backend is running
✓ Agent runner started
✓ Authenticated as: [user-id]
✓ Machine registered: [machine-id]
✓ Project created: [project-id]
✓ Task created: [task-id]
✓ SSE event monitor started
✓ Task dispatched: [execution-id]
✓ Approval request detected!
  Question: Which operations should the calculator implement?
  Options: Basic, Scientific, Advanced
✓ Approval response sent successfully
✓ Execution completed
✓ Calculator implements scientific operations (user's choice)

✓ E2E TEST WITH APPROVAL SYSTEM: PASS
```

This is the **most comprehensive test** - it exercises the entire stack including approval flow.

### Other Test Scripts

#### `verify-setup.sh`
Verifies the local development environment is correctly configured.

```bash
npm run verify
```

#### `verify-environment-setup.sh`
Checks environment variables and configuration.

```bash
npm run verify:env
```

## Testing the Approval System End-to-End

To test the full approval flow with the UI:

1. **Start the full stack:**
   ```bash
   npm run dev
   ```

2. **Create a project** and navigate to the plan view

3. **Dispatch a task** that would benefit from user input

4. **In the agent execution context**, it can call:
   ```typescript
   ask_user_question({
     question: "Which approach should we use?",
     options: [
       "Approach A: Minimal changes",
       "Approach B: Full refactor",
       "Approach C: Incremental migration"
     ]
   })
   ```

5. **Check the Dashboard** or **Task Detail page** - you'll see an `ApprovalCard` with:
   - The question
   - Radio buttons for each option
   - Confirm/Cancel buttons

6. **Select an option** and click Confirm

7. **The agent continues** with the selected option returned from the tool call

## Approval System Architecture

```
Agent (Claude SDK)
    ↓ calls ask_user_question tool
MCP Server (astro-tools-server.ts)
    ↓ HTTP POST /api/dispatch/request-dynamic-approval
Dispatch Engine (dispatch-engine.ts)
    ↓ emits approval.requested event
Event System (astroEventTransport)
    ↓ SSE bridge
Browser (EventSource)
    ↓ updates UI
User (ApprovalCard component)
    ↓ selects option & clicks Confirm
Frontend (POST /api/dispatch/approve)
    ↓ resolves approval promise
Dispatch Engine
    ↓ returns selected option
MCP Server
    ↓ tool result
Agent continues with user's choice
```

## Troubleshooting

### Test failures

**"Astro server is not running"**
- Solution: Start backend with `npm run dev:backend`

**"MCP server did not start"**
- Check Node.js version (requires Node 18+)
- Verify tsx is installed: `npx tsx --version`

**"Request timeout"**
- Expected for some tests that don't provide responses
- Indicates the system is correctly waiting for user input

### Integration issues

**Approval not appearing in UI**
- Check browser console for SSE connection errors
- Verify SSE endpoint is running: `curl http://localhost:3001/api/events/stream`
- Check execution store has pending approval: React DevTools → Zustand

**MCP tool not available to agent**
- Verify Claude Code provider auto-loads MCP server
- Check `server/lib/providers/adapters/claude-code.ts` includes astro-tools config
- Look for "Astro MCP Tools Server running" in agent logs

## Related Documentation

- `APPROVAL_SYSTEM.md` - Complete approval system documentation
- `CLAUDE.md` - Project setup and architecture
- `vision.md` - Product vision and context
