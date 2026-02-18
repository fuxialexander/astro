# Relay Server

WebSocket hub that brokers communication between the Astro platform (plan graph, dispatch engine) and agent runners on user machines.

## Overview

The relay server enables multi-environment task dispatch by:
1. Accepting persistent WebSocket connections from agent runners
2. Maintaining a live registry of connected machines and their capabilities
3. Routing task dispatch messages to the correct agent runner
4. Forwarding task results, output, and status updates back to the platform

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Astro Platform                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Plan Graph  │  │  Dispatch   │  │      HTTP API           │  │
│  │             │──│   Engine    │──│  /api/relay/*           │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                          │                      │                │
│                          ▼                      ▼                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Relay Server                           │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────┐  │   │
│  │  │ WebSocket Hub  │  │ Machine        │  │ Redis      │  │   │
│  │  │ (port 3002)    │──│ Registry       │──│ Pub/Sub    │  │   │
│  │  └────────────────┘  └────────────────┘  └────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
     ┌────────────┐    ┌────────────┐    ┌────────────┐
     │ Agent      │    │ Agent      │    │ Agent      │
     │ Runner     │    │ Runner     │    │ Runner     │
     │ (local)    │    │ (HPC)      │    │ (cloud)    │
     └────────────┘    └────────────┘    └────────────┘
```

## Components

### WebSocket Server (`relay-server.ts`)

The core WebSocket server that handles:
- Connection authentication (JWT validation)
- Message routing between platform and agent runners
- Heartbeat mechanism (30s ping, 90s timeout)
- Rate limiting per machine
- Task dispatch and cancellation

### Machine Registry (`machine-registry.ts`)

In-memory registry tracking:
- Connected machines with unique IDs
- Environment type (local, HPC, cloud)
- Provider inventory (claude-code, slurm, aws, gcp)
- Resources (CPU, memory, GPU)
- Current load and active tasks
- Connection status and health

### Redis Pub/Sub (`redis-pubsub.ts`)

Enables horizontal scaling by:
- Synchronizing machine registry across instances
- Routing task dispatch to correct instance
- Publishing machine/task state changes
- Maintaining task-to-machine mappings

### HTTP API (`routes/relay.ts`)

REST endpoints for:
- Machine registry queries
- Task dispatch and cancellation
- Health and status checks

## Protocol

### Message Types

All messages are JSON objects with a `type` field and `timestamp`.

#### Agent Runner → Relay

| Type | Description |
|------|-------------|
| `machine.register` | Register machine with capabilities |
| `machine.unregister` | Graceful disconnect |
| `machine.status` | Load and resource update |
| `provider.status` | Provider availability update |
| `task.result` | Task completion with result |
| `task.stdout` | Streaming stdout/stderr |
| `task.progress` | Progress percentage update |
| `heartbeat.pong` | Response to ping |

#### Relay → Agent Runner

| Type | Description |
|------|-------------|
| `machine.register.ack` | Registration confirmation |
| `task.dispatch` | New task to execute |
| `task.cancel` | Cancel running task |
| `heartbeat.ping` | Connection health check |
| `error` | Error notification |

### Example: Machine Registration

```typescript
// Agent Runner sends:
{
  "type": "machine.register",
  "timestamp": "2026-02-06T04:00:00Z",
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
      "memoryMB": 16384
    },
    "load": {
      "cpuPercent": 20,
      "memoryPercent": 45,
      "activeTasks": 0,
      "queuedTasks": 0
    }
  }
}

// Relay responds:
{
  "type": "machine.register.ack",
  "timestamp": "2026-02-06T04:00:00Z",
  "machineId": "machine-abc123",
  "sessionId": "sess-1234567890-abcdef",
  "success": true
}
```

### Example: Task Dispatch

```typescript
// Platform dispatches via HTTP:
POST /api/relay/dispatch
{
  "task": {
    "taskId": "task-xyz789",
    "projectId": "project-123",
    "nodeId": "node-456",
    "title": "Run unit tests",
    "description": "Execute pytest on the test suite",
    "environment": "local",
    "visionDoc": "Project vision context..."
  },
  "targetMachineId": "machine-abc123"
}

// Relay forwards to agent runner via WebSocket:
{
  "type": "task.dispatch",
  "timestamp": "2026-02-06T04:01:00Z",
  "correlationId": "task-xyz789",
  "task": { ... }
}

// Agent runner reports completion:
{
  "type": "task.result",
  "timestamp": "2026-02-06T04:05:00Z",
  "result": {
    "taskId": "task-xyz789",
    "status": "completed",
    "exitCode": 0,
    "output": "All 42 tests passed",
    "duration": 240000
  }
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_PORT` | 3002 | WebSocket server port |
| `REDIS_URL` | - | Redis connection URL (enables scaling) |
| `RELAY_JWT_SECRET` | - | JWT secret for auth (optional in dev) |

### Default Settings

```typescript
{
  heartbeatIntervalMs: 30000,   // Ping every 30 seconds
  heartbeatTimeoutMs: 90000,    // Disconnect after 3 missed pings
  maxConnectionsPerMachine: 1,  // One connection per machine ID
  rateLimit: {
    windowMs: 60000,            // 1 minute window
    maxRequests: 1000,          // Max requests per window
    maxTasksPerMinute: 100,     // Max task dispatches
    maxStdoutBytesPerSecond: 1048576  // 1MB/s stdout limit
  }
}
```

## Security

1. **JWT Authentication**: Machine connections require valid JWT token (production)
2. **Rate Limiting**: Per-machine limits prevent abuse
3. **No Credential Transit**: User credentials and API keys never pass through relay
4. **TLS**: WSS (WebSocket Secure) required in production

## Horizontal Scaling

With Redis enabled:

1. **Stateless Relay Processes**: All state stored in Redis
2. **Sticky Sessions**: Machine-to-instance mapping ensures consistent routing
3. **Cross-Instance Dispatch**: Tasks route to correct instance via pub/sub
4. **Automatic Failover**: Machines can reconnect to any instance

## Testing

```bash
# Start the server
npm run dev:backend

# Run integration tests
npx tsx server/test/relay-server.test.ts

# Manual WebSocket test (requires wscat)
wscat -c ws://localhost:3002
> {"type":"machine.register","timestamp":"2026-02-06T00:00:00Z","machineId":"test","machineInfo":{...}}
```

## Future Enhancements

- [ ] Metrics and observability (Prometheus)
- [ ] Connection quality monitoring
- [ ] Task queue prioritization
- [ ] Machine affinity for related tasks
- [ ] Automatic load balancing
