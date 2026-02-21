# Relay Protocol Specification

WebSocket message protocol for agent runner <-> relay server communication.

## Message Format

All messages are JSON objects with a `type` field:

```typescript
{
  type: string          // Message type identifier
  timestamp: string     // ISO 8601 timestamp
  // ... type-specific fields
}
```

## Message Types

### Machine → Relay

#### machine.register

Register machine with capabilities.

**Payload:**
```json
{
  "type": "machine.register",
  "timestamp": "2026-02-21T12:00:00Z",
  "machineId": "machine-abc123",
  "machineInfo": {
    "name": "Dev Laptop",
    "environmentType": "local",
    "providers": [{
      "type": "claude-code",
      "status": "available",
      "maxConcurrentTasks": 3,
      "currentTasks": 0
    }],
    "resources": {
      "cpuCores": 8,
      "memoryMB": 16384,
      "gpuDevices": []
    },
    "load": {
      "cpuPercent": 20,
      "memoryPercent": 45,
      "activeTasks": 0,
      "queuedTasks": 0
    }
  }
}
```

#### machine.unregister

Graceful disconnect.

```json
{
  "type": "machine.unregister",
  "timestamp": "2026-02-21T12:00:00Z",
  "machineId": "machine-abc123",
  "reason": "shutdown"  // Optional
}
```

#### machine.status

Load and resource update.

```json
{
  "type": "machine.status",
  "timestamp": "2026-02-21T12:00:00Z",
  "machineId": "machine-abc123",
  "load": {
    "cpuPercent": 35,
    "memoryPercent": 52,
    "activeTasks": 2,
    "queuedTasks": 1
  }
}
```

#### provider.status

Provider availability update.

```json
{
  "type": "provider.status",
  "timestamp": "2026-02-21T12:00:00Z",
  "machineId": "machine-abc123",
  "providerId": "claude-code",
  "status": "available" | "busy" | "unavailable",
  "currentTasks": 2,
  "maxConcurrentTasks": 3
}
```

#### task.result

Task completion with result.

```json
{
  "type": "task.result",
  "timestamp": "2026-02-21T12:00:00Z",
  "result": {
    "taskId": "exec-xyz789",
    "status": "success" | "failure" | "cancelled",
    "exitCode": 0,
    "output": "All tests passed",
    "error": null,
    "duration": 120000,
    "metrics": {
      "inputTokens": 1500,
      "outputTokens": 800,
      "estimatedCostUsd": 0.015
    }
  }
}
```

#### task.stdout

Streaming stdout/stderr.

```json
{
  "type": "task.stdout",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "output": "Running tests...\n",
  "stream": "stdout" | "stderr"
}
```

#### task.progress

Progress percentage update.

```json
{
  "type": "task.progress",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "progress": 65,  // 0-100
  "message": "Processing file 65/100"
}
```

#### heartbeat.pong

Response to ping.

```json
{
  "type": "heartbeat.pong",
  "timestamp": "2026-02-21T12:00:00Z",
  "machineId": "machine-abc123"
}
```

### Relay → Machine

#### machine.register.ack

Registration confirmation.

```json
{
  "type": "machine.register.ack",
  "timestamp": "2026-02-21T12:00:00Z",
  "machineId": "machine-abc123",
  "sessionId": "sess-1234567890-abcdef",
  "success": true
}
```

#### task.dispatch

New task to execute.

```json
{
  "type": "task.dispatch",
  "timestamp": "2026-02-21T12:00:00Z",
  "correlationId": "exec-xyz789",
  "task": {
    "taskId": "exec-xyz789",
    "projectId": "550e8400-e29b-41d4-a716-446655440000",
    "nodeId": "node-456",
    "title": "Run unit tests",
    "description": "Execute pytest on the test suite",
    "environment": "local",
    "visionDoc": "Project vision context...",
    "dependencies": [
      {
        "nodeId": "node-123",
        "output": "Setup completed"
      }
    ],
    "context": {
      "repository": "https://github.com/user/repo",
      "branch": "main",
      "workingDirectory": "/path/to/repo"
    }
  }
}
```

#### task.cancel

Cancel running task.

```json
{
  "type": "task.cancel",
  "timestamp": "2026-02-21T12:00:00Z",
  "taskId": "exec-xyz789",
  "reason": "user_requested" | "timeout" | "branch_pruned"
}
```

#### heartbeat.ping

Connection health check.

```json
{
  "type": "heartbeat.ping",
  "timestamp": "2026-02-21T12:00:00Z"
}
```

#### error

Error notification.

```json
{
  "type": "error",
  "timestamp": "2026-02-21T12:00:00Z",
  "code": "INVALID_MESSAGE" | "RATE_LIMIT" | "UNAUTHORIZED",
  "message": "Human-readable error message",
  "details": {}
}
```

## Connection Lifecycle

```
1. Machine opens WebSocket connection
   └─ wss://astro-relay.fuxialexander.work

2. Machine sends machine.register
   └─ Relay validates JWT, registers machine

3. Relay sends machine.register.ack
   └─ Machine is now active

4. Relay starts heartbeat.ping (every 30s)
   └─ Machine responds with heartbeat.pong

5. Relay dispatches tasks via task.dispatch
   └─ Machine executes and streams task.stdout

6. Machine sends task.result on completion

7. On disconnect:
   - If graceful: machine.unregister
   - If abrupt: Relay detects missing pongs → marks disconnected
```

## Heartbeat Mechanism

**Interval:** 30 seconds

**Timeout:** 90 seconds (3 missed pongs)

**Purpose:** Detect dead connections, clean up stale machines

**Example:**
```
t=0s:   Relay → machine.register.ack
t=30s:  Relay → heartbeat.ping
t=30.5s: Machine → heartbeat.pong
t=60s:  Relay → heartbeat.ping
t=60.5s: Machine → heartbeat.pong
t=90s:  Relay → heartbeat.ping
t=120s: No pong → Relay marks machine disconnected
```

## Rate Limiting

Per-machine limits:

| Action | Limit |
|--------|-------|
| Messages/min | 1000 |
| Task dispatch acks/min | 100 |
| Stdout bytes/sec | 1 MB |
| Heartbeat pongs | 1/30s |

**Exceeded:** Relay sends `error` message with `RATE_LIMIT` code, may disconnect repeat offenders.

## Error Handling

### Invalid Message

Machine sends malformed JSON or missing required fields:

```json
{
  "type": "error",
  "code": "INVALID_MESSAGE",
  "message": "Missing required field: machineId",
  "details": { "field": "machineId" }
}
```

### Unauthorized

Machine not authenticated or token expired:

```json
{
  "type": "error",
  "code": "UNAUTHORIZED",
  "message": "Invalid or expired token"
}
```

### Task Not Found

Machine sends task.result for unknown task:

```json
{
  "type": "error",
  "code": "TASK_NOT_FOUND",
  "message": "Task exec-xyz789 not found or already completed"
}
```

## Compression

**Protocol:** Per-message deflate (WebSocket extension)

**Enabled by default** for messages >1KB

**Threshold:** Compress if message size > 1024 bytes

## Reconnection

Machines should implement exponential backoff:

```
Attempt 1: Reconnect immediately
Attempt 2: Wait 1 second
Attempt 3: Wait 2 seconds
Attempt 4: Wait 4 seconds
...
Max wait: 60 seconds
```

**Persistent state:** Relay remembers machine registration across reconnects (24-hour TTL).

**Re-registration:** If machine reconnects with same machineId, Relay restores previous state.

## Protocol Versioning

**Current version:** `v1`

**Negotiation:** Via WebSocket subprotocol:

```javascript
const ws = new WebSocket('wss://astro-relay.fuxialexander.work', 'astro-relay-v1')
```

**Future versions:** `astro-relay-v2`, etc.

## Related Documentation

- [Relay Overview](./overview.md) - Architecture and components
- [Machine Registry](./machine-registry.md) - How machines are tracked
- [Dispatch System](./dispatch-system.md) - Task routing
- [Agent Runner Protocol](../guides/agent-runner-protocol.md) - Client implementation guide
