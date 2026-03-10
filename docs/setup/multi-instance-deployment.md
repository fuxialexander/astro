# Multi-Instance Deployment

> Deploy Astro with 2+ backend instances behind Fly.io's load balancer, using Redis for cross-instance state synchronization.

---

## Overview

Astro's backend runs as a single process that serves both the Hono HTTP API (port 3001) and the WebSocket relay server (port 3002). In single-instance mode, all state lives in process memory and no Redis is needed. For horizontal scaling, multiple instances run behind Fly.io's load balancer with Redis (Upstash) providing cross-instance pub/sub and shared state.

The default configuration runs **2 machines** in the `sjc` region. Each machine runs the identical Docker image and exposes both services.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#dbeafe', 'primaryBorderColor': '#93c5fd', 'primaryTextColor': '#1e293b', 'lineColor': '#64748b', 'textColor': '#334155', 'fontSize': '14px', 'fontFamily': 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'}}}%%
flowchart TD
    classDef blue fill:#dbeafe,stroke:#93c5fd,color:#1e293b
    classDef green fill:#dcfce7,stroke:#86efac,color:#1e293b
    classDef amber fill:#fef3c7,stroke:#fcd34b,color:#1e293b
    classDef slate fill:#f1f5f9,stroke:#cbd5e1,color:#1e293b
    classDef violet fill:#ede9fe,stroke:#c4b5fd,color:#1e293b

    CF["Cloudflare Pages<br/>(static frontend)"]:::slate
    LB["Fly.io Load Balancer<br/>(round-robin HTTP, sticky WS)"]:::amber

    subgraph Fly["Fly.io — sjc region"]
        I1["Instance 1<br/>Hono :3001 + Relay :3002"]:::blue
        I2["Instance 2<br/>Hono :3001 + Relay :3002"]:::blue
    end

    Redis["Upstash Redis<br/>(pub/sub + write-through)"]:::violet
    DB["Supabase Postgres<br/>(source of truth)"]:::green

    CF -->|"/api/*"| LB
    LB -->|"HTTP/SSE"| I1
    LB -->|"HTTP/SSE"| I2
    LB -.->|"WSS :3002"| I1
    LB -.->|"WSS :3002"| I2
    I1 <-->|"pub/sub + KV"| Redis
    I2 <-->|"pub/sub + KV"| Redis
    I1 -->|"Drizzle ORM"| DB
    I2 -->|"Drizzle ORM"| DB
```

---

## Prerequisites

| Service | Purpose | Setup |
|---------|---------|-------|
| **Fly.io** | Backend hosting + load balancer | `brew install flyctl && fly auth login` |
| **Upstash Redis** | Cross-instance pub/sub + shared state | Create at [console.upstash.com](https://console.upstash.com) |
| **Supabase** | Postgres database + auth + realtime | Existing project (see `docs/setup/deployment-and-testing.md`) |
| **Cloudflare Pages** | Frontend hosting | Existing deployment |

---

## How the Load Balancer Works

Fly.io's proxy layer sits in front of all instances and routes traffic based on connection type:

| Traffic | Routing | Reason |
|---------|---------|--------|
| **HTTP API** (port 443 -> 3001) | Round-robin | Any instance can serve API requests; shared state in DB + Redis |
| **SSE streams** (GET /api/events/stream) | Round-robin | Events arrive via Redis pub/sub from any instance |
| **WebSocket relay** (port 3002) | Sticky per connection | Agent runners maintain persistent WS; commands route via Redis |

The critical insight: a browser's SSE connection may land on Instance 1, while the agent runner's WebSocket is on Instance 2. Redis bridges this gap.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#dbeafe', 'primaryBorderColor': '#93c5fd', 'primaryTextColor': '#1e293b', 'lineColor': '#64748b', 'textColor': '#334155', 'fontSize': '14px', 'fontFamily': 'Inter, -apple-system, BlinkMacSystemFont, sans-serif', 'actorBkg': '#f1f5f9', 'actorBorder': '#cbd5e1', 'activationBkgColor': '#dbeafe', 'activationBorderColor': '#93c5fd'}}}%%
sequenceDiagram
    participant B as Browser
    participant LB as Fly.io LB
    participant I1 as Instance 1<br/>(has SSE)
    participant Redis
    participant I2 as Instance 2<br/>(has Agent WS)
    participant A as Agent Runner

    B->>LB: GET /api/events/stream
    LB->>I1: SSE connection (round-robin)

    A->>LB: WSS :3002 connect
    LB->>I2: WebSocket (sticky)

    Note over I2,A: Agent emits task:text event

    A-->>I2: WS: task text
    I2->>I2: Local EventEmitter delivery
    I2->>Redis: PUBLISH relay:task:streaming
    Redis-->>I1: task:streaming message
    I1->>I1: Skip self-instance check
    I1->>I1: userId isolation check
    I1-->>B: SSE: task:stdout

    Note over B,I1: User clicks Approve

    B->>LB: POST /api/dispatch/approve
    LB->>I1: (round-robin, lands on I1)
    I1->>I1: machineRegistry.get() -> null
    I1->>Redis: PUBLISH relay:approval:response
    Redis-->>I2: approval:response message
    I2->>I2: machineRegistry.get() -> socket
    I2->>A: WS: approval_response
```

---

## Redis Channels and Keys

All cross-instance communication flows through these Redis primitives:

### Pub/Sub Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `relay:task:streaming` | Instance -> All | Streaming events (text, tool_use, tool_result, file_change, session_init, progress, result, node_status_changed) |
| `relay:approval:response` | Instance -> Target | Route approval response to machine's instance |
| `relay:task:steer` | Instance -> Target | Route steer message to machine's instance |
| `relay:safety:decision` | Instance -> Target | Route safety decision to machine's instance |
| `relay:task:cancel` | Instance -> Target | Route task cancellation |
| `relay:task:dispatch` | Instance -> Target | Route task dispatch to specific machine |
| `relay:machine:state` | Instance -> All | Machine registry changes (connect/disconnect) |

### Write-Through Keys

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `relay:task:machine:<taskId>` | 24h | Maps task to machine for cross-instance cancel/steer |
| `relay:exec:context:<executionId>` | 4h | Execution context (userId, projectId) for ownership checks |
| `relay:dispatch:active:<executionId>` | 1h | Tracks which instance owns the dispatch SSE bridge |
| `relay:instance:<instanceId>` | 60s | Instance heartbeat for health monitoring |

### Self-Instance Deduplication

Every Redis message includes an `instanceId`. The originating instance skips its own messages because the local EventEmitter already delivered the event in-process:

```typescript
// In events.ts — Redis streaming handler
if (msg.instanceId === redisPubSub.getInstanceId()) return  // skip own
```

---

## Configuration

### `fly.toml`

The production config sets `min_machines_running = 2` for both services:

```toml
# HTTP API — load-balanced across instances
[[services]]
  internal_port = 3001
  min_machines_running = 2
  auto_stop_machines = false

# WebSocket relay — sticky per agent runner
[[services]]
  internal_port = 3002
  min_machines_running = 2
  auto_stop_machines = false

[vm]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 1024
```

Key settings:
- `auto_stop_machines = false` — instances must stay running for WebSocket connections
- `min_machines_running = 2` — ensures load balancer has two targets
- Health check: `GET /api/health` every 15s with 30s grace period

### Secrets

```bash
fly secrets set \
  REDIS_URL="rediss://default:xxx@xxx.upstash.io:6379" \
  SUPABASE_URL="https://xxx.supabase.co" \
  SUPABASE_ANON_KEY="eyJ..." \
  SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
  RELAY_JWT_SECRET="$(openssl rand -hex 32)" \
  DEVICE_AUTH_JWT_SECRET="$(openssl rand -hex 32)" \
  ANTHROPIC_API_KEY="sk-ant-..." \
  ASTRO_BASE_URL="https://your-app.pages.dev" \
  FRONTEND_URL="https://your-app.pages.dev"
```

`REDIS_URL` is the only new secret vs single-instance. Without it, Redis methods are no-ops and the system works as a single instance.

---

## Deploy

```bash
# From repo root
fly deploy

# Verify 2 machines are running
fly status

# Check both instances are healthy
fly machines list
```

Expected output from `fly status`:

```
Machines
ID              STATE   REGION  HEALTH CHECKS
e784e33c965d86  started sjc     1 total, 1 passing
5683d354a24458  started sjc     1 total, 1 passing
```

---

## Verification

### 1. Health Check

```bash
# Both instances should respond (run multiple times to hit both)
for i in {1..5}; do
  curl -s https://astro-backend-deploy.fly.dev/api/health | jq '.status,.relay.connectedRunners'
done
```

### 2. Redis Connection

Check logs for Redis connection on both instances:

```bash
fly logs | grep -E "Redis|redis"
# Expected: [relay] Connected to Redis for horizontal scaling
```

### 3. Cross-Instance SSE

1. Open the Astro frontend in a browser
2. Connect an agent runner
3. Dispatch a task
4. Verify streaming events appear in the browser

The SSE connection and the agent runner's WebSocket will likely land on different instances. If streaming events appear in the browser, cross-instance Redis bridging is working.

### 4. Cross-Instance Approval

1. Dispatch a task that triggers an approval prompt
2. Click Approve in the browser
3. Verify the agent runner receives the approval and continues

If the approval POST lands on a different instance from the one hosting the WebSocket, it routes via `relay:approval:response`.

### 5. Instance-Specific Logs

```bash
# Watch logs from a specific machine
fly logs --instance e784e33c965d86

# Look for cross-instance routing messages
fly logs | grep "cross-instance"
# Expected: [relay] Executing cross-instance approval for task ...
# Expected: [relay] Steer routed via Redis for task ...
```

---

## Graceful Degradation

| Scenario | Behavior |
|----------|----------|
| Redis disconnected (single-instance) | All pub/sub methods are no-ops; local EventEmitter works |
| Redis disconnected (multi-instance) | Cross-instance events lost; each instance only sees local agent events |
| One instance crashes | Fly.io restarts it; agent runners reconnect; pending tasks timeout and reset |
| Redis latency spike | Write-through is fire-and-forget (`.catch()`); local state remains correct |
| Browser SSE reconnects to different instance | SSE catch-up endpoint (`/api/events/catch-up`) hydrates from DB |

---

## Scaling Up / Down

```bash
# Scale to 3 instances
fly scale count 3

# Scale back to 1 (single-instance, Redis optional)
fly scale count 1

# Update min_machines_running in fly.toml for permanent change
```

Scaling up requires no code changes — new instances auto-connect to Redis and join the pub/sub mesh. Each instance registers itself with a unique `instanceId` (generated at startup) and announces presence via the `relay:instance:<id>` key with a 60s TTL heartbeat.

---

## Cost Estimate

| Component | Tier | Monthly Cost |
|-----------|------|-------------|
| Fly.io (2x shared-cpu-1x, 1GB) | Production | ~$10-15 |
| Upstash Redis | Pay-per-request | ~$1-5 |
| Supabase | Pro (8GB, 100k MAU) | $25 |
| Cloudflare Pages | Free | $0 |
| **Total** | | **~$36-45** |

---

## Key Files

| File | Role |
|------|------|
| `fly.toml` | Fly.io deployment config (2 machines, health checks, ports) |
| `docker/Dockerfile` | Multi-stage build for production image |
| `server/lib/redis-pubsub.ts` | Redis channels, keys, pub/sub methods, write-through |
| `server/lib/relay-server.ts` | Cross-instance routing for cancel/approval/steer/safety |
| `server/lib/execution-context-store.ts` | Dual-layer store: local Map + Redis fallback |
| `server/lib/redis-event-bridge.ts` | Centralized executionEventBus -> Redis bridge |
| `server/routes/events.ts` | SSE handler with Redis cross-instance streaming |
| `server/routes/dispatch.ts` | Active dispatch stream Redis tracking |
| `server/index.ts` | Redis init on startup, event handler wiring |

---

*See also: [Deployment & Testing](deployment-and-testing.md) | [Architecture](../deprecated/deployment.md)*
