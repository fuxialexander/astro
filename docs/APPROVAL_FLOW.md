# Approval Flow Architecture

This document describes the end-to-end flow for dynamic task approvals (AskUserQuestion tool) in the Nexus platform.

## Overview

When an agent running a task needs user input, it can call the `AskUserQuestion` tool. This triggers an approval request that flows from the agent runner through the relay server to the browser UI, then back again with the user's response.

## Architecture

```
Agent Runner (canUseTool)
    ↓ (WebSocket)
Relay Server (event emitter)
    ↓ (SSE)
Browser UI (EventSource)
    ↓ (HTTP POST)
Relay Server (sendApprovalResponse)
    ↓ (WebSocket)
Agent Runner (Promise resolves)
```

## Message Flow

### 1. Agent Calls AskUserQuestion

When the Claude SDK agent calls `AskUserQuestion`:

```typescript
// claude-sdk-adapter.ts
canUseTool: async (toolName, input, options) => {
  if (toolName === 'AskUserQuestion') {
    // Extract question and options from input
    const question = input.questions[0];
    const optionLabels = question.options.map(opt => opt.label);

    // Request approval via WebSocket
    const result = await stream.approvalRequest(question.question, optionLabels);

    // Return answer to SDK
    return {
      behavior: 'allow',
      updatedInput: {
        questions: input.questions,
        answers: { [question.question]: result.answer },
      },
    };
  }
}
```

### 2. Agent Runner → Relay Server

The WebSocket client sends an approval request message:

```typescript
// websocket-client.ts
sendApprovalRequest(taskId: string, question: string, options: string[]): Promise<...> {
  const requestId = `${taskId}-${Date.now()}`;

  return new Promise((resolve, reject) => {
    this.pendingApprovals.set(requestId, { resolve, reject });

    const msg: TaskApprovalRequestMessage = {
      type: 'task_approval_request',
      timestamp: new Date().toISOString(),
      payload: { taskId, requestId, question, options },
    };
    this.send(msg);

    // 60s timeout
    setTimeout(() => {
      const pending = this.pendingApprovals.get(requestId);
      if (pending) {
        this.pendingApprovals.delete(requestId);
        pending.resolve({ answered: false, message: 'Approval request timed out' });
      }
    }, 60000);
  });
}
```

### 3. Relay Server Processes Request

The relay server receives the WebSocket message and emits an event:

```typescript
// relay-server.ts
private handleAgentRunnerTaskApprovalRequest(message: AgentRunnerTaskApprovalRequestMessage): void {
  const { payload } = message;
  console.log(`[relay] Approval request from task ${payload.taskId}: ${payload.question}`);

  this.emit('task:approval_request', {
    taskId: payload.taskId,
    requestId: payload.requestId,
    question: payload.question,
    options: payload.options,
  });
}
```

### 4. SSE Stream → Browser UI

The SSE event handler forwards the approval request to connected browsers:

```typescript
// events.ts
const onTaskApprovalRequest = (msg: { taskId: string; requestId: string; question: string; options: string[] }) => {
  if (!alive) return;
  const data = JSON.stringify({
    taskId: msg.taskId,
    requestId: msg.requestId,
    question: msg.question,
    options: msg.options,
  });
  const id = eventBuffer.push('task:approval_request', data);
  stream.writeSSE({ id, event: 'task:approval_request', data });
}

// Subscribe to relay events
relayServer.on('task:approval_request', onTaskApprovalRequest);
```

### 5. Browser UI Responds (HTTP POST)

The browser receives the SSE event and displays approval UI to the user. When the user responds:

```typescript
// src/components/dynamic-approval-dialog.tsx
// Displays modal dialog with question and radio button options
// On user confirmation:
respondToDynamicApproval: async (taskId: string, requestId: string, answer: string) => {
  // Find node and execution to get machineId
  const node = usePlanStore.getState().nodes.find(n => n.executionId === taskId)
  const execution = useExecutionStore.getState().getExecution(node.id)

  await fetch('/api/dispatch/approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskId,
      machineId: execution.machineId,
      requestId,
      answered: true,
      answer,
    }),
  });
}
```

### 6. Relay Server → Agent Runner

The HTTP endpoint sends the response back to the agent runner:

```typescript
// dispatch.ts
dispatchRoute.post('/approval', async (c) => {
  const { taskId, machineId, requestId, answered, answer, message } = await c.req.json();

  const sent = relayServer.sendApprovalResponse(
    taskId,
    machineId,
    requestId,
    answered,
    answer,
    message
  );

  return c.json({ success: true });
});

// relay-server.ts
sendApprovalResponse(
  taskId: string,
  machineId: string,
  requestId: string,
  answered: boolean,
  answer?: string,
  message?: string
): boolean {
  const connection = machineRegistry.getConnection(machineId);

  const responseMsg = {
    type: 'task_approval_response',
    timestamp: new Date().toISOString(),
    payload: { taskId, requestId, answered, answer, message },
  };

  connection.socket.send(JSON.stringify(responseMsg));
  return true;
}
```

### 7. Agent Runner Receives Response

The WebSocket client receives the response and resolves the pending promise:

```typescript
// websocket-client.ts
private handleApprovalResponse(message: TaskApprovalResponseMessage): void {
  const { requestId, answered, answer, message: responseMessage } = message.payload;
  const pending = this.pendingApprovals.get(requestId);

  if (pending) {
    this.pendingApprovals.delete(requestId);
    pending.resolve({ answered, answer, message: responseMessage });
  }
}
```

### 8. Claude SDK Continues Execution

The promise resolution causes the `canUseTool` callback to return, and the SDK continues with the user's answer injected into the tool input.

## Message Types

### Agent Runner → Relay Server

```typescript
interface TaskApprovalRequestMessage {
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

### Relay Server → Agent Runner

```typescript
interface TaskApprovalResponseMessage {
  type: 'task_approval_response';
  timestamp: string;
  payload: {
    taskId: string;
    requestId: string;
    answered: boolean;
    answer?: string;
    message?: string;
  };
}
```

### SSE Event (Relay → Browser)

```json
{
  "event": "task:approval_request",
  "data": {
    "taskId": "exec-123",
    "requestId": "exec-123-1234567890",
    "question": "Which color do you prefer?",
    "options": ["red", "blue", "green"]
  }
}
```

### HTTP Request (Browser → Relay)

```
POST /api/dispatch/approval
Content-Type: application/json

{
  "taskId": "exec-123",
  "machineId": "runner-abc",
  "requestId": "exec-123-1234567890",
  "answered": true,
  "answer": "blue"
}
```

## Key Files

### Agent Runner
- `packages/agent-runner/src/providers/claude-sdk-adapter.ts` - `canUseTool` callback implementation
- `packages/agent-runner/src/lib/websocket-client.ts` - WebSocket message handling
- `packages/agent-runner/src/types.ts` - Message type definitions

### Relay Server
- `server/lib/relay-server.ts` - WebSocket message routing and approval response sending
- `server/types/relay.ts` - Server-side message type definitions
- `server/routes/events.ts` - SSE event streaming
- `server/routes/dispatch.ts` - HTTP approval response endpoint

## Testing

Run the end-to-end test:

```bash
./scripts/test-approval-e2e.sh
```

This will:
1. Start the backend server
2. Start the agent runner
3. Dispatch a test task that triggers an approval
4. Monitor logs to verify the flow

## Implementation Status

✅ **Relay Server** - Complete
✅ **Agent Runner** - Complete
✅ **Browser UI** - Complete (see `DYNAMIC_APPROVAL_UI.md` for details)

## Future Enhancements

1. **Timeout Handling**: Show countdown timer and handle 60s timeout gracefully in UI
2. **Multiple Questions**: Support asking multiple questions in sequence
3. **Approval History**: Track approval decisions for audit trail in database
4. **Team Approvals**: Support routing approvals to specific team members
5. **Rich Options**: Support option descriptions and icons in approval dialog
6. **Notification**: Browser notification when approval is requested (if tab is in background)
