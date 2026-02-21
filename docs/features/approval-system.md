# User Approval & Choice System

## Overview

Astro now has a user approval system similar to Cyrus, allowing agents to pause execution and present choices to users. This document explains how it works and how to use it.

## Architecture

### Three Approaches to User Choices

#### 1. **Dynamic Tool-Based Questions** (Implemented) ✅
The agent can call `ask_user_question` tool during execution to present choices dynamically.

**When to use:**
- Agent discovers a decision point during execution (not predefined)
- Multiple approaches are equally valid
- User preferences or priorities determine the best choice

**How it works:**
```typescript
// Agent calls the tool during execution:
ask_user_question({
  question: "Which database should we use for caching?",
  options: [
    "Redis (fast, in-memory, requires separate service)",
    "SQLite (embedded, simple, slower at scale)",
    "PostgreSQL (consistent with main DB, more overhead)"
  ]
})

// Execution pauses → User sees approval card → Selects option → Execution resumes
// Tool returns: "User selected: Redis (fast, in-memory, requires separate service)"
```

**Implementation:**
- Custom MCP server: `server/lib/mcp/astro-tools-server.ts`
- Auto-loaded by Claude Code provider
- Communicates with dispatch engine via HTTP
- Same approval UI as procedure-level approvals

#### 2. **Procedure-Level Approvals** (Implemented) ✅
Predefined approval gates in procedure workflows where execution pauses and waits for user input.

**When to use:**
- Structured workflows with known decision points (e.g., "deploy to production?")
- Multi-step procedures where certain steps need approval
- Critical operations that should never be automated

**Example:**
```typescript
{
  name: 'feature-implementation',
  subroutines: [
    {
      name: 'plan',
      promptTemplate: 'Analyze and identify 2-3 implementation approaches.',
      singleTurn: true,
    },
    {
      name: 'choose-approach',
      promptTemplate: 'Implement using: {{approvalResult}}',
      requiresApproval: true,
      approvalMessage: 'Which implementation approach should I use?',
      approvalOptions: [
        'Approach 1: Minimal change to existing code',
        'Approach 2: Refactor for cleaner architecture',
        'Approach 3: Build new abstraction',
      ],
    },
    {
      name: 'implement',
      promptTemplate: 'Implement with tests.',
      usesValidationLoop: true,
      validationCommand: 'npm test',
    },
  ],
}
```

#### 3. **Agent-Driven Decisions** (System Prompt Guidance) ✅
The agent is instructed to note decision points in its output and proceed with a recommended approach.

**System prompt guidance added:**
- Tells agent when to proceed independently vs. when to note user input would be valuable
- Agent presents options + recommendation in output
- User can review reasoning and provide guidance in response

**Benefits:**
- Works without pausing execution
- Agent uses judgment to proceed
- User can course-correct if needed
- No special tooling required

## User Experience

### Dashboard ("Pulse Page")

When an approval is pending:
- Shows in "Needs Attention" count
- Displays `ApprovalCard` with:
  - **Binary approvals**: "Approve" / "Reject" buttons
  - **Multi-choice approvals**: Radio button list with options + "Confirm" / "Cancel"
- Real-time updates when user responds

### Task Detail Page

When viewing a task with pending approval:
- Shows `ApprovalCard` at top of page (before Activity/Files tabs)
- Same UI as Dashboard
- Updates immediately when user responds

## Technical Flow

### Procedure Approval Flow

1. **Dispatch engine executes procedure**
   ```typescript
   const approvalResult = await this.requestApproval(node, subroutine)
   ```

2. **Request emits approval event**
   ```typescript
   await astroEventTransport.emitEvent({
     type: 'approval.requested',
     approvalId: 'approval-node123-1234567890',
     nodeId: 'node123',
     projectId: 'proj456',
     executionId: 'exec-node123-1234567890',
     message: 'Which implementation approach should I use?',
     options: ['Approach 1: ...', 'Approach 2: ...', 'Approach 3: ...'],
     timestamp: new Date(),
   })
   ```

3. **Node status updated**
   ```typescript
   await nodeUpdateCallback(node.id, { status: 'awaiting_approval' })
   ```

4. **Promise waits for response** (5-minute timeout)
   ```typescript
   return new Promise<boolean | string>((resolve, reject) => {
     this.pendingApprovals.set(approvalId, { resolve, reject, ... })
   })
   ```

5. **SSE event forwarded to browser**
   - `server/routes/events.ts` listens to astroEventTransport
   - Forwards `approval:requested` event via SSE
   - Browser receives and updates UI

6. **User responds via UI**
   ```typescript
   await respondToApproval(approvalId, true, 'Approach 2: Refactor...')
   ```

7. **API endpoint processes response**
   ```http
   POST /api/dispatch/approve
   {
     "approvalId": "approval-node123-1234567890",
     "approved": true,
     "selectedOption": "Approach 2: Refactor for cleaner architecture"
   }
   ```

8. **Response emitted and promise resolved**
   ```typescript
   await astroEventTransport.emitEvent({
     type: 'approval.responded',
     approvalId,
     approved: true,
     selectedOption: 'Approach 2: ...',
   })

   pending.resolve(selectedOption) // Execution resumes
   ```

9. **Node status updated back to in_progress**
   ```typescript
   await nodeUpdateCallback(node.id, { status: 'in_progress' })
   ```

10. **Procedure continues with user's choice**
    ```typescript
    // approvalResult is now available in subsequent prompts
    state.approvalResult = selectedOption
    // Next subroutine can use {{approvalResult}} in its prompt
    ```

## Components

### Backend

- **Types**: `server/lib/events/types.ts`
  - `ApprovalRequestedEvent`
  - `ApprovalRespondedEvent`

- **Dispatch Engine**: `server/lib/dispatch/dispatch-engine.ts`
  - `requestApproval()` - emits event, waits for response
  - `respondToApproval()` - processes user response
  - `pendingApprovals` Map - tracks waiting approvals

- **API Route**: `server/routes/dispatch.ts`
  - `POST /api/dispatch/approve` - endpoint for user responses

- **SSE Bridge**: `server/routes/events.ts`
  - Forwards approval events from astroEventTransport to browser
  - Events: `approval:requested`, `approval:responded`

- **Procedure Types**: `server/lib/dispatch/procedure-types.ts`
  - `requiresApproval?: boolean`
  - `approvalMessage?: string`
  - `approvalOptions?: string[]`
  - `approvalResult?: boolean | string`

### Frontend

- **UI Component**: `src/components/approval-card.tsx`
  - Displays approval requests with options
  - Handles user selection and submission

- **Stores**:
  - `execution-store.ts`: Manages pending approvals, API calls
  - `realtime-store.ts`: Listens to SSE approval events

- **Pages**:
  - `dashboard.tsx`: Shows pending approvals in "My Attention" section
  - `task-detail.tsx`: Shows approval card at top when pending

- **Types**: `src/types/index.ts`
  - Added `awaiting_approval` to status union type

## Comparison to Cyrus

| Feature | Cyrus | Astro |
|---------|-------|-------|
| **Approval UI** | Linear select signal | ApprovalCard component |
| **Integration** | Linear issue timeline | Dashboard + Task Detail |
| **Tool Call** | `AskUserQuestion` tool | ✅ `ask_user_question` tool (MCP) |
| **Dynamic Questions** | ✅ Yes (agent calls tool) | ✅ Yes (agent calls tool) |
| **Procedure Gates** | Unknown | ✅ Yes (predefined in procedures) |
| **Agent Guidance** | Tool available in SDK | ✅ Tool + system prompt |
| **Multi-choice** | Yes (2-5 options) | Yes (2-5 options) |
| **Binary Approval** | Yes | Yes |
| **Timeout** | Configurable | 5 minutes |
| **Implementation** | Linear API integration | MCP server + HTTP |

## Architecture Details

### MCP Server Implementation

The `ask_user_question` tool is provided via a custom MCP server that runs alongside the agent:

```
Agent → Claude SDK → MCP Server (astro-tools) → HTTP POST /api/dispatch/request-dynamic-approval
                                                      ↓
                                               Dispatch Engine
                                                      ↓
                                               Emit approval.requested event
                                                      ↓
                                               Browser via SSE
                                                      ↓
                                               User selects option
                                                      ↓
                                               POST /api/dispatch/approve
                                                      ↓
                                               Promise resolves
                                                      ↓
                                               HTTP response with selected option
                                                      ↓
                                               Tool returns result to agent
```

**Key Files:**
- `server/lib/mcp/astro-tools-server.ts` - MCP server providing the tool
- `server/lib/providers/adapters/claude-code.ts` - Auto-loads MCP server
- `server/routes/dispatch.ts` - `/api/dispatch/request-dynamic-approval` endpoint
- `server/lib/dispatch/dispatch-engine.ts` - `requestDynamicApproval()` method

## Usage Examples

### Example 1: Deployment Approval

```typescript
{
  name: 'deploy',
  promptTemplate: 'Create and merge PR for production deployment.',
  requiresApproval: true,
  approvalMessage: 'Approve deployment to production?',
  // No options = binary approve/reject
}
```

User sees:
```
Approval Required
Approve deployment to production?
[Reject] [Approve]
```

### Example 2: Multi-choice Architecture Decision

```typescript
{
  name: 'choose-architecture',
  promptTemplate: 'Implement using: {{approvalResult}}',
  requiresApproval: true,
  approvalMessage: 'Which database should we use?',
  approvalOptions: [
    'PostgreSQL (relational, ACID compliance)',
    'MongoDB (flexible schema, horizontal scaling)',
    'SQLite (embedded, zero-config)',
  ],
}
```

User sees:
```
Approval Required
Which database should we use?
○ PostgreSQL (relational, ACID compliance)
○ MongoDB (flexible schema, horizontal scaling)
○ SQLite (embedded, zero-config)
[Cancel] [Confirm]
```

### Example 3: Agent Notes Decision (No Pause)

Agent output:
```
I need to choose a state management solution for the new feature.

Options:
1. Zustand - Lightweight (2KB), already used in the project, simple API
2. Redux Toolkit - More structured, better DevTools, steeper learning curve
3. React Context - Native, no dependencies, but requires more boilerplate

Recommendation: I recommend Zustand since it's already used elsewhere in the
codebase (see src/stores/), has a simpler API, and will maintain consistency.

Proceeding with Zustand implementation unless you'd like me to use a different
approach.
```

User can:
- Let it proceed (do nothing)
- Send steering message: "Actually, let's use Redux Toolkit for better debugging"
- Agent adjusts and continues

## Status Types

- `planned` - Ready to execute
- `dispatched` - Sent to agent
- `in_progress` - Agent actively working
- `awaiting_approval` - ⭐ NEW: Paused, waiting for user choice
- `awaiting_judgment` - Completed, needs human review
- `auto_verified` - Completed, tests passed
- `completed` - Done
- `pruned` - Branch pruned, won't execute

## Summary

The approval system provides a flexible way to incorporate user decisions into agent workflows:

1. **Procedure approvals** for predefined decision points that always need user input
2. **System prompt guidance** for dynamic decisions where the agent should note options but proceed with a recommendation
3. **Clean UI** in Dashboard and Task Detail pages for presenting choices
4. **Real-time flow** via SSE events for immediate feedback

This gives users control over critical decisions while letting agents use their judgment for routine choices.

## Testing

The approval system has comprehensive testing at multiple levels:

### Quick Reference

```bash
# Fastest: Visual demo (no server)
npm run demo:approval

# Quick: Unit tests (auto-starts server)
npm run test:approval:quick

# Comprehensive: Full E2E integration (requires backend + agent)
./scripts/test-e2e-with-approval.sh
```

### Testing Levels

#### Level 1: Visual Demo (10 seconds)
```bash
npm run demo:approval
```
Shows animated walkthrough of the complete approval flow. No server required.

#### Level 2: Unit Tests (30 seconds)
```bash
npm run test:approval:quick
```
Automatically starts backend and tests:
- MCP server tool listing
- HTTP endpoint availability
- Interactive approval simulation
- MCP tool call flow

#### Level 3: E2E Integration (2-3 minutes) - **Gold Standard**
```bash
# Prerequisites
npm run dev:backend  # Terminal 1
cd packages/agent-runner && node dist/cli.js connect  # Terminal 2

# Run test
./scripts/test-e2e-with-approval.sh  # Terminal 3
```

Tests complete flow:
1. Authentication and device registration
2. Project/task creation
3. Agent execution with real `ask_user_question` call
4. SSE event monitoring
5. Approval request detection
6. Auto-response to approval
7. Agent continues with user's selection
8. File generation based on choice
9. Worktree verification
10. Cleanup

**This is the most thorough test** - verifies the entire stack works together.

#### Level 4: Manual UI Testing (5 minutes)
```bash
npm run dev
```

Then manually:
1. Create a project
2. Dispatch task that calls `ask_user_question`
3. See ApprovalCard in Dashboard/Task Detail
4. Select option and confirm
5. Verify agent continues

### Test Coverage

| Component | Unit | E2E | UI |
|-----------|------|-----|-----|
| MCP Server | ✅ | ✅ | ✅ |
| HTTP Endpoint | ✅ | ✅ | ✅ |
| Dispatch Engine | ⚠️ | ✅ | ✅ |
| Event System | - | ✅ | ✅ |
| SSE Streaming | - | ✅ | ✅ |
| ApprovalCard UI | - | - | ✅ |
| Agent Integration | - | ✅ | ✅ |
| Full Flow | - | ✅ | ✅ |

### Documentation

- `scripts/TESTING_APPROVAL.md` - Complete testing guide
- `scripts/README.md` - All test scripts documentation
- `APPROVAL_TESTING_CHEATSHEET.md` - Quick reference
- `APPROVAL_QUICKSTART.md` - Usage guide
