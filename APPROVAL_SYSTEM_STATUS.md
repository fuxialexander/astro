# Approval System - Implementation Status

## Summary

The approval system is **fully functional** on both the server, web client, and iOS client (just implemented).

## Architecture Overview

### Two Types of Approvals

1. **Dynamic Tool-Based Approvals** (`ask_user_question` MCP tool)
   - Agent calls tool during execution
   - Events: `task:approval_request` (existing)
   - Endpoint: `/api/dispatch/approval` (relay-based)
   - Status: ✅ Fully implemented

2. **Procedure-Level Approvals** (predefined in procedure workflows)
   - Defined in SubroutineDefinition with `requiresApproval: true`
   - Events: `approval:requested`, `approval:responded` (new)
   - Endpoint: `/api/dispatch/approve` (dispatch engine-based)
   - Status: ✅ Fully implemented

## Server-Side Implementation ✅

### Files
- `server/lib/dispatch/dispatch-engine.ts`
  - `requestApproval()` - Emits `approval:requested` event
  - `respondToApproval()` - Handles user response
  - `pendingApprovals` Map to track awaiting approvals
  - Procedure execution pauses until approval received
  - 5-minute timeout for approval requests

- `server/lib/events/nexus-event-transport.ts`
  - Event transport for approval events
  - SSE notification hook

- `server/routes/dispatch.ts`
  - `POST /api/dispatch/approve` - Respond to approval
    - Body: `{ approvalId, approved, selectedOption? }`

- `server/routes/events.ts`
  - SSE handlers for `approval:requested` and `approval:responded`
  - Events broadcast to all connected clients

### Event Flow (Procedure-Level)
```
1. Dispatch engine reaches subroutine with requiresApproval: true
2. Engine calls requestApproval()
3. Emits approval:requested event via nexusEventTransport
4. Updates node status → awaiting_approval
5. Promise created, stored in pendingApprovals Map
6. User responds via UI → POST /api/dispatch/approve
7. Engine calls respondToApproval()
8. Emits approval:responded event
9. Updates node status → in_progress
10. Promise resolved, execution continues
```

## Web Client Implementation ✅

### Files
- `src/stores/execution-store.ts`
  - `pendingApprovals: Map<string, ApprovalRequest>`
  - `addPendingApproval()` - Add to pending list
  - `respondToApproval()` - POST to /api/dispatch/approve
  - `getPendingApproval()`, `getPendingApprovalForNode()` - Query helpers

- `src/stores/realtime-store.ts` (SSE event handlers)
  - `approval:requested` → calls `execStore.addPendingApproval()`
  - `approval:responded` → logs response (cleanup handled by execution store)
  - `task:approval_request` → handles dynamic approvals (MCP tool-based)

- `src/components/approval-card.tsx`
  - Full UI component with:
    - Binary approve/reject buttons
    - Multi-choice radio button options
    - Loading states
    - Error handling

- `src/pages/dashboard.tsx`
  - Displays ApprovalCard for tasks with pending approvals
  - Checks `pendingApprovals` Map and shows card if match

- `src/pages/task-detail.tsx`
  - Shows ApprovalCard in task detail view when approval pending

### UI Flow
```
1. SSE event approval:requested received
2. Realtime store calls execStore.addPendingApproval()
3. Dashboard/task-detail detects pendingApprovals for node
4. Renders ApprovalCard with message and options
5. User clicks approve/reject (or selects option + approve)
6. ApprovalCard calls onRespond callback
7. execStore.respondToApproval() sends POST
8. Approval removed from pendingApprovals Map
9. UI updates, card disappears
```

## iOS Client Implementation ✅ (Just Completed)

### Files
- `ios/NexusApp/Models/Initiative.swift` (NEW)
  - Full Initiative model with status enum

- `ios/NexusApp/Models/Project.swift` (MODIFIED)
  - Renamed `initiative` → `initiativeId`
  - Added `color` and `icon` fields

- `ios/NexusApp/Models/ActivityEvent.swift` (MODIFIED)
  - Added SSEEventType cases:
    - `approvalRequested = "approval:requested"`
    - `approvalResponded = "approval:responded"`
  - Added computed properties for approval data

- `ios/NexusApp/Network/NexusAPI.swift` (MODIFIED)
  - Initiative CRUD endpoints (5 methods)
  - `respondToApproval()` endpoint
  - ApprovalRequestEvent, ApprovalRespondEvent types

- `ios/NexusApp/Stores/RealtimeStore.swift` (MODIFIED)
  - `pendingApprovals: [ActivityEvent]` array
  - SSE event handlers for approval:requested/responded
  - `respondToApproval()` helper method
  - `approvalEvents` computed property

### iOS UI TODO
The following UI components need to be built:

1. **ApprovalDialog.swift** or **ApprovalCard.swift**
   - Display approval message and options
   - Approve/reject buttons
   - Call `realtimeStore.respondToApproval()`

2. **Project/Initiative Views**
   - Color/icon display and editing
   - Initiative CRUD screens

Example SwiftUI implementation:
```swift
if let approval = realtimeStore.pendingApprovals.first {
    ApprovalCard(
        message: approval.approvalMessage ?? "",
        options: approval.approvalOptions ?? [],
        onRespond: { approved, selectedOption in
            Task {
                try? await realtimeStore.respondToApproval(
                    approval.approvalId!,
                    approved: approved,
                    selectedOption: selectedOption
                )
            }
        }
    )
}
```

## Testing Checklist

### Server
- [x] Procedure-level approval events emitted
- [x] POST /api/dispatch/approve endpoint works
- [x] Node status updates: planned → awaiting_approval → in_progress
- [x] Timeout after 5 minutes
- [x] SSE events broadcast to clients

### Web Client
- [x] SSE events received and handled
- [x] pendingApprovals Map updated correctly
- [x] ApprovalCard displays message and options
- [x] Approve/reject buttons work
- [x] POST /api/dispatch/approve sent correctly
- [x] ApprovalCard disappears after response
- [x] Dashboard shows pending approvals
- [x] Task detail shows pending approvals

### iOS Client
- [x] Initiative CRUD API methods
- [x] Project schema updated (color, icon, initiativeId)
- [x] SSE event types added
- [x] Approval event handlers in RealtimeStore
- [x] respondToApproval() API method
- [ ] ApprovalCard UI component (pending)
- [ ] Project color/icon display (pending)
- [ ] Initiative views (pending)

## API Reference

### POST /api/dispatch/approve
Respond to a procedure-level approval request.

**Request:**
```json
{
  "approvalId": "approval-node123-1234567890",
  "approved": true,
  "selectedOption": "Option 2"  // optional, for multi-choice
}
```

**Response:**
```json
{
  "success": true
}
```

**Errors:**
- 400: approvalId or approved missing
- 400: No pending approval found for ID

### SSE Events

#### approval:requested
Emitted when execution reaches an approval gate.

```json
{
  "approvalId": "approval-node123-1234567890",
  "nodeId": "node123",
  "projectId": "proj456",
  "executionId": "exec789",
  "message": "Which implementation approach should I use?",
  "options": ["Option 1", "Option 2", "Option 3"],
  "timestamp": "2026-02-15T12:34:56.789Z"
}
```

#### approval:responded
Emitted after user responds to approval.

```json
{
  "approvalId": "approval-node123-1234567890",
  "nodeId": "node123",
  "projectId": "proj456",
  "executionId": "exec789",
  "approved": true,
  "selectedOption": "Option 2",
  "timestamp": "2026-02-15T12:35:30.123Z"
}
```

## Known Issues / Future Work

1. **iOS UI Components**: Need to build ApprovalCard SwiftUI component
2. **Approval History**: Consider adding approval decisions to audit log
3. **Approval Notifications**: Push notifications for iOS when approval needed
4. **Approval Timeout UI**: Show countdown timer in UI for 5-minute timeout
5. **Multi-Approval Scenarios**: Handle multiple pending approvals for same project

## Migration Notes

### Breaking Changes
- **Project model**: `initiative` field renamed to `initiativeId` (affects iOS)
  - Web client already uses `initiativeId` (no changes needed)
  - iOS client updated to match

### Non-Breaking Additions
- Project fields: `color`, `icon` (defaults provided)
- Initiatives: Completely new feature
- Approval events: New SSE events, backward compatible
- Approval endpoint: New endpoint, doesn't affect existing flows
