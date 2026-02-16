# Dynamic Approval UI Implementation

## Summary

Implemented the browser UI side of the dynamic approval flow for the `AskUserQuestion` tool. Agents can now request user input during task execution, and users will see a modal dialog to respond.

## What Was Implemented

### 1. Realtime Store Updates (`src/stores/realtime-store.ts`)

**New Types:**
```typescript
export interface DynamicApprovalRequest {
  taskId: string          // Execution ID
  requestId: string       // Unique request ID
  question: string        // Question from agent
  options: string[]       // Available choices
  timestamp: Date
}
```

**New State:**
- `dynamicApprovals: Map<string, DynamicApprovalRequest>` - Pending approval requests keyed by requestId

**New Actions:**
- `getDynamicApproval(requestId)` - Get a specific pending approval
- `respondToDynamicApproval(taskId, requestId, answer)` - Send approval response to server

**New Event Handler:**
Added handler for `task:approval_request` SSE events:
- Receives approval request from relay server
- Stores in `dynamicApprovals` map
- Adds activity feed entry

### 2. Realtime Client Updates (`src/lib/realtime-client.ts`)

**Event Type:**
Added `'task:approval_request'` to `RealtimeEventType` union and registered event listener.

### 3. Dynamic Approval Dialog Component (`src/components/dynamic-approval-dialog.tsx`)

**Features:**
- Displays as a modal dialog (non-dismissible)
- Shows agent's question
- Radio button list for options
- Confirm/Cancel actions
- Error handling for failed responses
- FIFO queue (shows first pending approval)
- Auto-removes from queue after response

**UI/UX:**
- Warning icon and "Agent Question" title
- Large readable text for question
- Hover effects on option selection
- Loading state while responding
- Error message display

### 4. App Layout Integration (`src/components/layout/app-layout.tsx`)

Added `<DynamicApprovalDialog />` to the layout so it's globally available.

## Data Flow

```
Agent calls AskUserQuestion
    ↓ (WebSocket)
Relay Server (handleAgentRunnerTaskApprovalRequest)
    ↓ (Event emitter)
SSE Bridge (onTaskApprovalRequest)
    ↓ (SSE: task:approval_request)
Realtime Store (handleRealtimeEvent)
    ↓ (State update)
DynamicApprovalDialog (renders modal)
    ↓ (User selects option)
respondToDynamicApproval(taskId, requestId, answer)
    ↓ (POST /api/dispatch/approval)
Relay Server (sendApprovalResponse)
    ↓ (WebSocket)
Agent Runner (handleApprovalResponse)
    ↓ (Promise resolves)
Claude SDK continues execution
```

## API Request Format

**POST `/api/dispatch/approval`:**
```json
{
  "taskId": "exec-123",
  "machineId": "runner-abc",
  "requestId": "exec-123-1234567890",
  "answered": true,
  "answer": "blue"
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

## Machine ID Tracking

The implementation retrieves `machineId` from the execution store:
1. Find the node by `executionId` (taskId in approval request)
2. Get the execution from execution store by `nodeId`
3. Extract `machineId` from execution
4. Include in approval response payload

This approach leverages the existing execution tracking without additional state.

## Files Modified

1. **`src/stores/realtime-store.ts`**
   - Added `DynamicApprovalRequest` interface
   - Added `dynamicApprovals` state
   - Added `getDynamicApproval` and `respondToDynamicApproval` actions
   - Added `task:approval_request` event handler

2. **`src/lib/realtime-client.ts`**
   - Added `'task:approval_request'` to event type union
   - Registered event listener

3. **`src/components/layout/app-layout.tsx`**
   - Added `DynamicApprovalDialog` component

## Files Created

1. **`src/components/dynamic-approval-dialog.tsx`**
   - Modal dialog for dynamic approvals
   - Radio button UI for option selection
   - Error handling and loading states

## Testing

### Manual Testing

1. **Start the backend:**
   ```bash
   npm run dev:backend
   ```

2. **Start the frontend:**
   ```bash
   npm run dev:frontend
   ```

3. **Run agent runner (separate terminal):**
   ```bash
   cd packages/agent-runner
   npm run dev
   ```

4. **Dispatch a test task that calls AskUserQuestion**
   - Create a project with a task
   - Execute the task
   - The agent should call the tool
   - Modal should appear in the UI
   - Select an option and click Confirm
   - Check console for approval flow logs

### E2E Testing

Use the existing test script:
```bash
./scripts/test-approval-e2e.sh
```

## Key Design Decisions

### 1. FIFO Queue
Only one approval dialog is shown at a time. If multiple approvals arrive, they queue and are processed sequentially.

### 2. Non-Dismissible Modal
User cannot close the dialog by clicking outside or pressing Escape. This ensures critical agent questions are answered.

### 3. Cancel = "Other"
When user clicks Cancel, sends "Other" as the answer. This allows the agent to handle cancellation gracefully.

### 4. Machine ID Lookup
Rather than storing machine ID in the approval request state, we look it up from the execution store using the executionId. This avoids data duplication and ensures we always use the correct machine ID.

### 5. Global Mounting
Dialog is mounted at the app layout level, not per-page. This ensures it works across all routes without duplication.

## Related Documentation

- **`docs/APPROVAL_FLOW.md`** - Complete architecture documentation
- **`APPROVAL_RELAY_IMPLEMENTATION.md`** - Server-side implementation summary
- **Agent Runner Code:**
  - `packages/agent-runner/src/providers/claude-sdk-adapter.ts` - `canUseTool` callback
  - `packages/agent-runner/src/lib/websocket-client.ts` - WebSocket message handling

## Future Enhancements

1. **Multiple Questions**: Support agents asking multiple questions in sequence
2. **Custom Inputs**: Support text input fields in addition to radio buttons
3. **Timeout Handling**: Show countdown timer and handle 60s timeout gracefully
4. **Approval History**: Track approval decisions for audit trail
5. **Team Routing**: Route approvals to specific team members
6. **Rich Options**: Support option descriptions and icons
7. **Voice/Hotkey**: Allow keyboard shortcuts for common answers
8. **Notification**: Browser notification when approval is requested (if tab is in background)
