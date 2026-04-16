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
- Built-in Claude SDK tool `AskUserQuestion`, intercepted in `packages/agent-runner/src/providers/claude-sdk-adapter.ts` via the `canUseTool` callback
- The adapter forwards the question to the relay, which surfaces it as an approval card in the Astro UI
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

### Dynamic Approval Implementation

The Claude SDK's built-in `AskUserQuestion` tool is intercepted by the agent-runner adapter; it does not rely on MCP.

```
Agent → Claude SDK (AskUserQuestion) → canUseTool hook → Relay (approvalRequest event)
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
                                                         Relay delivers answer
                                                                ↓
                                                         canUseTool returns updatedInput
                                                                ↓
                                                         Tool result reaches agent
```

**Key Files:**
- `packages/agent-runner/src/providers/claude-sdk-adapter.ts` - Intercepts `AskUserQuestion` via `canUseTool`
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

See `docs/testing/approval-testing-guide.md` for the complete approval testing guide, including unit tests, E2E integration, and manual UI testing.
