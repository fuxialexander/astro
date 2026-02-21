# Dynamic Approval System - Quick Start

## Overview

Agents running tasks can now request user input during execution using the `AskUserQuestion` tool. Users see a modal dialog in the browser and can respond with their choice.

## End-to-End Flow

```
Agent → Relay Server → SSE → Browser UI → User Response → Relay Server → Agent
```

## How It Works

### For Users

1. **Execute a task** - Dispatch any task that includes agent execution
2. **Agent asks a question** - A modal dialog appears with the question and options
3. **Select an option** - Choose from radio button options
4. **Confirm or Cancel** - Click Confirm to send response, Cancel to abort
5. **Agent continues** - The agent receives your answer and continues execution

### For Developers

**Agent Side (already implemented):**
```typescript
// In agent task prompt or tool usage
// The agent calls AskUserQuestion tool automatically when needed
```

**Browser Side (newly implemented):**
- `DynamicApprovalDialog` component listens for `task:approval_request` events
- Modal appears automatically when approval is needed
- User selection is sent via `POST /api/dispatch/approval`

## Testing

### Local Development

1. Start backend:
   ```bash
   npm run dev:backend
   ```

2. Start frontend:
   ```bash
   npm run dev:frontend
   ```

3. Run agent runner (separate terminal):
   ```bash
   cd packages/agent-runner
   npm run dev
   ```

4. Dispatch a test task:
   - Create a task with instructions that would trigger agent questions
   - Execute the task
   - Wait for the approval dialog to appear
   - Select an option and confirm

### E2E Test

```bash
./scripts/test-approval-e2e.sh
```

## UI Features

- **Modal Dialog**: Non-dismissible, ensures user responds
- **Radio Buttons**: Clear option selection
- **FIFO Queue**: One approval at a time, queues multiple requests
- **Error Handling**: Shows error if response fails
- **Loading States**: Disables buttons while responding
- **Activity Feed**: Logs approval requests in activity feed

## API Endpoint

**POST `/api/dispatch/approval`**

Request:
```json
{
  "taskId": "exec-123",
  "machineId": "runner-abc",
  "requestId": "exec-123-1234567890",
  "answered": true,
  "answer": "blue"
}
```

Response:
```json
{
  "success": true,
  "message": "Approval response sent"
}
```

## Files to Know

### Implementation
- `src/stores/realtime-store.ts` - Approval state and response handler
- `src/components/dynamic-approval-dialog.tsx` - Modal UI component
- `src/lib/realtime-client.ts` - SSE event type registration
- `src/components/layout/app-layout.tsx` - Global dialog mount

### Server
- `server/routes/dispatch.ts` - `/api/dispatch/approval` endpoint
- `server/routes/events.ts` - SSE bridge for `task:approval_request` events
- `server/lib/relay-server.ts` - WebSocket message routing

### Agent Runner
- `packages/agent-runner/src/providers/claude-sdk-adapter.ts` - `canUseTool` callback
- `packages/agent-runner/src/lib/websocket-client.ts` - WebSocket approval request

## Documentation

- `docs/features/approval-system.md` - Complete architecture
- `scripts/TESTING_APPROVAL.md` - Testing guide

## Common Issues

### Approval dialog not appearing
- Check browser console for SSE connection errors
- Verify relay server is running (`npm run dev:backend`)
- Check that agent runner is connected

### Response not reaching agent
- Verify `machineId` is set on the execution
- Check relay server logs for WebSocket messages
- Ensure agent runner is still connected

### Multiple dialogs stacking
- Only one dialog shows at a time (FIFO queue)
- Check `dynamicApprovals` state in realtime store

## Next Steps

- Add timeout countdown (60s)
- Track approval history in database
- Support custom text input fields
- Add browser notifications for background approvals
