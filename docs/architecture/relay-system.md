# Relay System Architecture

## Overview

The relay system is a WebSocket hub that brokers communication between the Nexus platform (browser + backend) and agent runners on user machines. It enables multi-environment task dispatch across local machines, HPC clusters, and cloud instances.

## Components

### WebSocket Relay Server (`server/lib/relay-server.ts`)
- Listens on port 3002 (configurable via `RELAY_PORT`)
- Accepts connections from agent runners
- Routes task dispatch, cancel, and steer messages
- Emits events for task results, stdout, progress, tool traces, and file changes
- JWT authentication (optional in dev mode)
- Rate limiting per machine (1000 req/min, 1MB/s stdout)

### Machine Registry (`server/lib/machine-registry.ts`)
- In-memory registry of connected machines
- Tracks capabilities, load, providers, and connection status
- Heartbeat mechanism (30s interval, 90s timeout)
- Best-machine selection based on environment type and provider availability

### Event Buffer (`server/lib/event-buffer.ts`)
- Ring buffer (500 events, 5-min TTL) with sequential IDs
- Supports `Last-Event-ID` replay for SSE reconnection
- Ensures no events are lost during brief disconnections

### Stdout Throttle (`server/lib/stdout-throttle.ts`)
- Buffers high-frequency stdout chunks per task
- Flushes every 100ms to prevent SSE stream overload
- Auto-cleanup on task completion

### SSE Event Stream (`server/routes/events.ts`)
- `GET /api/events/stream` - browser subscribes to real-time events
- Forwards relay events as SSE to browser clients
- Optional `?projectId=X` filter
- 15s heartbeat keepalive
- `Last-Event-ID` reconnection support

### Redis Pub/Sub (`server/lib/redis-pubsub.ts`)
- Optional horizontal scaling across multiple relay instances
- Cross-instance machine registry and task routing
- Configured via `REDIS_URL` environment variable

## Information Flow

```
Agent Runner (user machine)
    |
    | WebSocket (port 3002)
    v
Relay Server ──> Machine Registry
    |
    | EventEmitter
    v
Server Index ──> Dispatch Engine
    |              |
    | Events       | Results
    v              v
SSE Endpoint ──> Event Buffer
    |
    | Server-Sent Events
    v
Browser (EventSource API)
    |
    v
Realtime Store ──> UI Components
```

## Message Types

### Agent Runner → Relay
| Type | Description |
|------|-------------|
| `machine.register` | Register machine with capabilities |
| `machine.unregister` | Graceful disconnect |
| `machine.status` | Load and provider updates |
| `provider.status` | Individual provider status |
| `task.result` | Task completion (success/failure) |
| `task.stdout` | Streaming stdout/stderr |
| `task.progress` | Progress percentage (0-100) |
| `task.steer.ack` | Acknowledge steering message |
| `task.tool_trace` | Tool call details |
| `task.file_change` | File modification details |
| `heartbeat.pong` | Heartbeat response |

### Relay → Agent Runner
| Type | Description |
|------|-------------|
| `task.dispatch` | Execute a task |
| `task.cancel` | Cancel a running task |
| `task.steer` | Inject guidance into running agent |
| `heartbeat.ping` | Connection health check |
| `machine.register.ack` | Registration acknowledgment |
| `error` | Error message |

## Security

- JWT authentication for production (optional in dev)
- Rate limiting per machine connection
- Stdout byte rate limiting (1MB/s)
- Connection-level isolation (one machine per WebSocket)

## Scaling

With Redis enabled:
1. Multiple relay server instances can run behind a load balancer
2. Machine registry is shared via Redis pub/sub
3. Task dispatch is routed to the instance holding the target machine's connection
4. Cross-instance events are forwarded transparently
