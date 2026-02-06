# Information Flow Reference

## Layer-by-Layer Data Flow

### 1. Agent Runner → Relay Server (WebSocket)

**Connection**: `ws://localhost:3002` (dev) or `wss://app.fly.dev:3002` (prod)

**Data passed**:
- Machine registration (capabilities, resources, providers)
- Task execution results (status, output, artifacts)
- Streaming stdout/stderr
- Progress updates (0-100%)
- Tool call traces (tool name, input, result, duration)
- File change notifications (path, action, diff)
- Steering acknowledgments
- Heartbeat pongs

### 2. Relay Server → Server Core (EventEmitter)

**Events emitted by `relayServer`**:
| Event | Data | Consumer |
|-------|------|----------|
| `task:result` | `TaskResultMessage` | dispatch engine, SSE bridge |
| `task:stdout` | `TaskStdoutMessage` | SSE bridge (via throttle) |
| `task:progress` | `TaskProgressMessage` | SSE bridge |
| `task:tool_trace` | `TaskToolTraceMessage` | SSE bridge |
| `task:file_change` | `TaskFileChangeMessage` | SSE bridge |
| `task:steer_ack` | `TaskSteerAckMessage` | SSE bridge |
| `machine:connected` | machineId: string | Redis pub/sub, SSE bridge |
| `machine:disconnected` | machineId, reason | Redis pub/sub, SSE bridge |

### 3. Server Core → Browser (SSE)

**Endpoint**: `GET /api/events/stream`

**SSE events**:
| Event | Data fields | Purpose |
|-------|-------------|---------|
| `machines:snapshot` | Array of machine info | Initial machine list on connect |
| `task:result` | taskId, status, output, error | Task completion |
| `task:stdout` | taskId, data | Streaming output (throttled) |
| `task:progress` | taskId, progress, message | Progress updates |
| `task:steer_ack` | taskId, accepted, message | Steer confirmation |
| `task:tool_trace` | taskId, toolName, input, result | Tool usage |
| `task:file_change` | taskId, path, action, lines | File modifications |
| `machine:connected` | machineId, name, providers | New machine |
| `machine:disconnected` | machineId, reason | Machine lost |
| `heartbeat` | (empty) | Keepalive (15s) |

**Reconnection**: `Last-Event-ID` header replays missed events from event buffer.

### 4. Browser → Realtime Store (Zustand)

**`useRealtimeStore` state**:
| Field | Type | Updated by |
|-------|------|-----------|
| `connected` | boolean | EventSource connection state |
| `machines` | Map<string, MachineEntry> | machines:snapshot, machine:connected/disconnected |
| `activityFeed` | ActivityEvent[] | All events (last 50) |
| `taskStreams` | Map<string, TaskStream> | task:* events |

### 5. Browser → Backend (HTTP POST)

**Steering**: `POST /api/dispatch/steer`
```json
{
  "taskId": "exec-node1-123",
  "machineId": "machine-abc",
  "message": "Focus on the auth module first",
  "action": "guidance"
}
```

**Cancellation**: `POST /api/dispatch/cancel`
```json
{
  "executionId": "exec-node1-123"
}
```

### 6. Backend → Agent Runner (WebSocket)

**Steering flow**:
1. Browser POST → `/api/dispatch/steer`
2. Server calls `relayServer.steerTask()`
3. Relay sends `task.steer` WS message to agent runner
4. Agent runner injects guidance into session
5. Agent runner sends `task.steer.ack` back
6. Relay emits `task:steer_ack` event
7. SSE bridge forwards to browser
8. Realtime store updates steer message status

## Dual Dispatch Paths

### Local Dispatch (no relay)
```
Browser → POST /api/agent/dispatch → Provider → SSE stream → Browser
```
Direct provider execution, streaming via SSE from the dispatch endpoint.

### Relay Dispatch (remote machines)
```
Browser → POST /api/dispatch/task → Relay → WS → Agent Runner
Agent Runner → WS → Relay → SSE bridge → Browser
```
Task dispatched via relay, results flow back through SSE event stream.
