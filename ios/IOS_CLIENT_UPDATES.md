# iOS Client Updates - Server Sync

This document summarizes the iOS client changes made to sync with the latest server-side updates.

## Summary

Updated the iOS client to support:
1. ✅ Initiatives CRUD operations
2. ✅ Project schema changes (color, icon, initiativeId)
3. ✅ Approval system (SSE events + API endpoint)
4. ✅ **Custom animation system** (NexusAnimations.swift - Feb 15, 2026)

## Files Changed

### 1. Models

#### `ios/NexusApp/Models/Initiative.swift` (NEW)
- New model for initiatives with full CRUD support
- Fields: id, name, description, goal, status, startDate, targetDate, lead, color, icon, createdAt, updatedAt
- InitiativeStatus enum: active, onHold, completed, cancelled

#### `ios/NexusApp/Models/Project.swift` (MODIFIED)
- **Breaking change**: Renamed `initiative` → `initiativeId`
- Added `color: String` (default: "#3b82f6")
- Added `icon: String` (default: "📋")
- Added explicit `CodingKeys` enum for proper serialization

#### `ios/NexusApp/Models/ActivityEvent.swift` (MODIFIED)
- Added SSEEventType cases:
  - `approvalRequested = "approval:requested"`
  - `approvalResponded = "approval:responded"`
- Added approval-specific computed properties:
  - `approvalId`, `nodeId`, `projectId`, `executionId`
  - `approvalMessage`, `approvalOptions`
  - `approvalApproved`, `approvalSelectedOption`

### 2. Network Layer

#### `ios/NexusApp/Network/NexusAPI.swift` (MODIFIED)

**New Initiatives Endpoints:**
```swift
func getInitiatives() async throws -> [Initiative]
func createInitiative(_ initiative: Initiative) async throws -> Initiative
func getInitiative(_ id: String) async throws -> Initiative
func updateInitiative(_ id: String, patch: [String: AnyCodable]) async throws -> Initiative
func deleteInitiative(_ id: String) async throws
```

**New Approval Endpoint:**
```swift
func respondToApproval(approvalId: String, approved: Bool, selectedOption: String?) async throws
```

**New Response Types:**
```swift
struct ApprovalRequestEvent: Codable { ... }
struct ApprovalRespondEvent: Codable { ... }
```

### 3. Stores

#### `ios/NexusApp/Stores/RealtimeStore.swift` (MODIFIED)
- Added `pendingApprovals: [ActivityEvent]` array to track active approval requests
- Updated `handleSSEMessage()` to process approval events:
  - `approvalRequested` → adds to `pendingApprovals`
  - `approvalResponded` → removes from `pendingApprovals`
- Added helper method:
  ```swift
  func respondToApproval(_ approvalId: String, approved: Bool, selectedOption: String?) async throws
  ```
- Added `approvalEvents` computed property for filtering approval-related events

## API Endpoints Added

### Initiatives
- `GET /api/data/initiatives` - List all initiatives
- `POST /api/data/initiatives` - Create initiative
- `GET /api/data/initiatives/:id` - Get initiative
- `PATCH /api/data/initiatives/:id` - Update initiative
- `DELETE /api/data/initiatives/:id` - Delete initiative

### Approvals
- `POST /api/dispatch/approve` - Respond to approval request
  - Body: `{ approvalId, approved, selectedOption? }`

## SSE Events Added

### `/api/events/stream` Events
- `approval:requested` - Agent requests user approval
  - Data: approvalId, nodeId, projectId, executionId, message, options[], timestamp
- `approval:responded` - User responds to approval
  - Data: approvalId, nodeId, projectId, executionId, approved, selectedOption?, timestamp

## Migration Notes

### Breaking Changes
1. **Project model**: `initiative` field renamed to `initiativeId`
   - Old code using `project.initiative` must update to `project.initiativeId`
   - This matches the server schema change

### Non-Breaking Additions
2. **Project fields**: `color` and `icon` added with defaults
   - Existing projects will receive defaults: `color: "#3b82f6"`, `icon: "📋"`
3. **Initiatives**: Completely new feature, no migration needed

## UI Integration TODO

The following UI integration work is recommended:

### High Priority
1. **Approval UI Component**
   - Create `ApprovalDialog.swift` or `ApprovalCard.swift`
   - Display when `RealtimeStore.pendingApprovals` has items
   - Show approval message and options
   - Call `realtimeStore.respondToApproval()` on user choice

2. **Project Color/Icon Display**
   - Update project list views to show icon with color
   - Add color/icon picker in project detail/edit screens

3. **Initiatives Views**
   - Create initiatives list view
   - Create initiative detail/edit view
   - Link projects to initiatives

### Low Priority
4. **Project Migration UI**
   - Handle any projects still using old `initiative` field
   - Provide UI to migrate to `initiativeId` if needed

## Testing Checklist

- [ ] Create new initiative via API
- [ ] Update initiative color/icon
- [ ] Create new project (verify color/icon assigned)
- [ ] Update project color/icon
- [ ] Link project to initiative
- [ ] Receive approval:requested SSE event
- [ ] Display approval UI to user
- [ ] Respond to approval (approve/deny)
- [ ] Verify approval:responded event received
- [ ] Verify approval removed from pendingApprovals

## Example Usage

### Respond to Approval in SwiftUI
```swift
@Environment(RealtimeStore.self) private var realtimeStore

var body: some View {
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
}
```

### Create Initiative
```swift
let initiative = Initiative(
    id: UUID().uuidString,
    name: "Q1 2026 Goals",
    description: "Strategic initiatives for Q1",
    goal: "Launch v2.0",
    status: .active,
    startDate: "2026-01-01",
    targetDate: "2026-03-31",
    lead: "Jane Doe",
    color: "#10b981",
    icon: "🎯",
    createdAt: Date(),
    updatedAt: Date()
)

let created = try await NexusAPI.shared.createInitiative(initiative)
```

## Notes

- All changes are backward compatible except the `initiative` → `initiativeId` rename
- Approval system is fully functional on the client side, pending UI implementation
- SSE reconnection and event replay are handled automatically by `SSEClient`
- Pre-existing lint errors in iOS project are not addressed (as per project guidelines)
