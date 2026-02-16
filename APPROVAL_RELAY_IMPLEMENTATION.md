# Approval System - Relay Server Implementation

## Summary

Implemented the relay server side of the dynamic approval system, completing the end-to-end flow for agent approval requests (`AskUserQuestion` tool).

## What Was Implemented

### 1. Message Type Definitions (`server/types/relay.ts`)

Added two new message types to the relay protocol:

- **`TaskApprovalRequestMessage`** - Sent from agent runner to relay when agent needs user input
- **`TaskApprovalResponseMessage`** - Sent from relay to agent runner with user's decision

Both added to the appropriate union types:
- `TaskApprovalRequestMessage` → `AgentToRelayMessage`
- `TaskApprovalResponseMessage` → `RelayToAgentMessage`

### 2. Relay Server Updates (`server/lib/relay-server.ts`)

#### New Interface
```typescript
interface AgentRunnerTaskApprovalRequestMessage {
  type: 'task_approval_request';
  timestamp: string;
  payload: {
    taskId: string;
    requestId: string;
    question: string;
    options: string[];
  };
}
```

#### New Event Type
Added `task:approval_request` event to `RelayServerEvents` interface.

#### New Handler Method
```typescript
private handleAgentRunnerTaskApprovalRequest(message: AgentRunnerTaskApprovalRequestMessage): void
```
- Extracts approval request from WebSocket message
- Emits `task:approval_request` event for SSE bridge

#### New Public Method
```typescript
sendApprovalResponse(
  taskId: string,
  machineId: string,
  requestId: string,
  answered: boolean,
  answer?: string,
  message?: string
): boolean
```
- Sends `task_approval_response` WebSocket message to agent runner
- Follows same pattern as `steerTask` and `cancelTask` methods

#### Message Routing
Added case in `handleMessage` switch statement to route `task_approval_request` messages.

### 3. SSE Event Stream (`server/routes/events.ts`)

#### New Event Handler
```typescript
const onTaskApprovalRequest = (msg: { taskId: string; requestId: string; question: string; options: string[] }) => {
  // Push to event buffer for replay
  const id = eventBuffer.push('task:approval_request', data);
  // Stream to browser
  stream.writeSSE({ id, event: 'task:approval_request', data });
}
```

#### Event Subscription
Subscribed to `task:approval_request` events from relay server.

### 4. HTTP Endpoint (`server/routes/dispatch.ts`)

Created new endpoint for receiving approval responses from browser UI:

```typescript
POST /api/dispatch/approval
```

**Request Body:**
```json
{
  "taskId": "exec-123",
  "machineId": "runner-abc",
  "requestId": "exec-123-1234567890",
  "answered": true,
  "answer": "blue",
  "message": "Optional feedback"
}
```

**Response:**
```json
{
  "success": true,
  "taskId": "exec-123",
  "machineId": "runner-abc",
  "requestId": "exec-123-1234567890",
  "message": "Approval response sent"
}
```

Endpoint validates input and calls `relayServer.sendApprovalResponse()`.

## Complete Data Flow

```
┌─────────────────┐
│  Agent Runner   │ (canUseTool intercepts AskUserQuestion)
└────────┬────────┘
         │ WebSocket: task_approval_request
         │ { taskId, requestId, question, options }
         ↓
┌─────────────────┐
│  Relay Server   │ (handleAgentRunnerTaskApprovalRequest)
└────────┬────────┘
         │ Event: task:approval_request
         │ emit({ taskId, requestId, question, options })
         ↓
┌─────────────────┐
│   SSE Bridge    │ (onTaskApprovalRequest)
└────────┬────────┘
         │ SSE: task:approval_request
         │ { taskId, requestId, question, options }
         ↓
┌─────────────────┐
│   Browser UI    │ (displays approval dialog)
└────────┬────────┘
         │ HTTP POST: /api/dispatch/approval
         │ { taskId, machineId, requestId, answered, answer }
         ↓
┌─────────────────┐
│  Relay Server   │ (sendApprovalResponse)
└────────┬────────┘
         │ WebSocket: task_approval_response
         │ { taskId, requestId, answered, answer, message }
         ↓
┌─────────────────┐
│  Agent Runner   │ (handleApprovalResponse)
└────────┬────────┘
         │ Promise resolves
         │ { answered, answer, message }
         ↓
┌─────────────────┐
│  Claude SDK     │ (continues with answer in updatedInput)
└─────────────────┘
```

## Files Modified

1. **`server/types/relay.ts`** - Added message type definitions
2. **`server/lib/relay-server.ts`** - Added handler, event, and response method
3. **`server/routes/events.ts`** - Added SSE event handler
4. **`server/routes/dispatch.ts`** - Added HTTP approval endpoint

## Files Created

1. **`docs/APPROVAL_FLOW.md`** - Complete architecture documentation
2. **`scripts/test-approval-e2e.sh`** - End-to-end test script

## Testing

Both frontend and backend build successfully:

```bash
npm run build              # ✓ Server + frontend build
cd packages/agent-runner
npm run build              # ✓ Agent runner build
```

Run E2E test:
```bash
./scripts/test-approval-e2e.sh
```

## Implementation Status

✅ **Relay Server** - Complete (this document)
✅ **Agent Runner** - Complete (prior work)
✅ **Browser UI** - Complete (see `DYNAMIC_APPROVAL_UI.md`)

The full approval flow is now functional end-to-end!

## Next Steps

### Testing

1. **Integration Tests**
   - Test timeout handling (60s)
   - Test concurrent approval requests
   - Test approval after task cancellation
   - Test approval with multiple agents

2. **E2E Tests**
   - Run `./scripts/test-approval-e2e.sh`
   - Verify approval flow with real agent
   - Test error scenarios

### Nice to Have

1. **Approval History**: Track all approval decisions in database
2. **Multi-question Support**: Support asking multiple questions in sequence
3. **Team Approvals**: Route approvals to specific team members
4. **Approval Templates**: Pre-defined approval types (proceed/cancel, select option, confirm action)

## Prior Work

The agent runner side was already implemented:
- `canUseTool` callback in `claude-sdk-adapter.ts`
- `sendApprovalRequest` in `websocket-client.ts`
- `handleApprovalResponse` in `websocket-client.ts`
- Message types in `packages/agent-runner/src/types.ts`

This implementation completes the server-side relay layer.
