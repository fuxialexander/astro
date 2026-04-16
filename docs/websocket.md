# WebSocket: Backend ↔ Frontend Real-Time Roadmap

> **Status: Planned.** This document describes how to add a client-facing WebSocket alongside (and eventually replacing) the current SSE-based real-time channel. The primary driver is mobile support (iOS/Android), but it also solves long-standing SSE limitations for web and desktop clients.

## Why WebSocket?

### Current Architecture

Astro has three real-time systems, none of which provide a bidirectional browser/mobile channel:

```
┌──────────┐   EventSource (SSE)    ┌────────────────┐   WebSocket (ws)    ┌──────────┐
│  Browser  │ ◄──────────────────── │  Hono :3001     │ ◄────────────────► │  Machine  │
│           │ ─── fetch POST ──────►│  (HTTP only)    │                    │  (agent)  │
└──────────┘                        └────────────────┘                    └──────────┘
                                           │
                                    Supabase Realtime
                                    (DB change sync)
```

- **SSE (`/api/events/stream`)** — Server → browser only. Fan-in bridge from relay EventEmitter + executionEventBus. ~25 event types.
- **Fetch-based SSE** — One-shot AI streams (generate-plan, chat, dispatch) parsed via `ReadableStream` from `fetch()` response.
- **WebSocket relay (:3002)** — Machine ↔ server only. `ws` library. JWT auth. Not accessible to browsers.
- **Supabase Realtime** — DB CDC for multi-device state sync (projects, plan_nodes, edges). Server mode only.

### SSE Pain Points

| Problem | Impact | WebSocket Fix |
|---------|--------|---------------|
| `EventSource` can't send custom headers | JWT exposed in URL query params (`?token=`), visible in logs/Referer/history | Auth in upgrade handshake or first message |
| One-way (server → client) | Approvals, steering, cancellation require separate `fetch()` POST calls | Bidirectional on single connection |
| 6 connections per origin (HTTP/1.1) | Multiple tabs compete with API calls | Single multiplexed connection |
| No binary support | Can't stream file previews, images | Binary frames supported |
| Reconnection is primitive | `Last-Event-ID` + DB catch-up works but requires separate HTTP endpoint | Protocol-level `resume` message on same connection; DB catch-up as fallback |
| Mobile background handling | iOS kills long-lived HTTP connections in background; `EventSource` has no lifecycle hooks | WebSocket has clear close/reconnect lifecycle; iOS `URLSessionWebSocketTask` integrates with background modes |
| No heartbeat negotiation | Fixed 15s server-side interval, no client ACK | Ping/pong with configurable interval |

### Mobile-Specific Drivers

- **iOS `URLSessionWebSocketTask`** is the native WebSocket API; there is no native `EventSource` equivalent
- **Android `OkHttp` WebSocket** is mature and well-supported; SSE requires a custom `EventSource` implementation
- **Background execution**: mobile OSes aggressively kill idle HTTP connections; WebSocket ping/pong keeps connections alive within OS limits
- **Push notifications + WebSocket reconnect** is the standard mobile pattern for real-time apps

## Target Architecture

```
┌──────────┐                         ┌────────────────┐                    ┌──────────┐
│  Browser  │ ◄─── WebSocket ──────► │  Hono :3001    │ ◄── WebSocket ──► │  Machine  │
│  Mobile   │      /api/ws           │  (HTTP + WS)   │     :3002         │  (agent)  │
│  Desktop  │                        └────────────────┘                    └──────────┘
└──────────┘                                │
                                     Supabase Realtime
                                     (DB CDC, unchanged)
```

A single WebSocket endpoint at `GET /api/ws` (upgrade on port 3001) replaces both:
1. `GET /api/events/stream` (global SSE bridge)
2. Fetch-based SSE streams for AI endpoints (generate-plan, chat, dispatch)

SSE remains available as a fallback for environments where WebSocket is blocked (corporate proxies, some CDNs).

## Protocol Design

### Connection Lifecycle

```
Client                                    Server
  │                                          │
  │─── GET /api/ws (Upgrade: websocket) ───►│
  │◄── 101 Switching Protocols ─────────────│
  │                                          │
  │─── { type: "auth", token: "jwt" } ────►│  ← First message must be auth
  │◄── { type: "auth:ok", sessionId } ─────│  ← Server assigns session ID
  │                                          │
  │◄── { type: "machines:snapshot" } ───────│  ← Initial state
  │                                          │
  │◄── { type: "ping" } ───────────────────│  ← Server ping
  │─── { type: "pong" } ──────────────────►│  ← Client pong
  │                                          │
  │    ... bidirectional messages ...         │
  │                                          │
  │─── close(1000, "bye") ────────────────►│
```

### Message Envelope

All messages are JSON with a consistent envelope:

```typescript
interface WsMessage {
  type: string        // Dotted namespace: "task:text", "dispatch:steer", "auth", etc.
  id?: string         // Server-assigned monotonic ID (for replay)
  ts?: string         // ISO 8601 timestamp
  payload?: unknown   // Type-specific data
}
```

### Message Types — Server → Client

These map 1:1 from existing SSE events, preserving the current event names:

| Type | Payload | Current SSE Equivalent |
|------|---------|----------------------|
| `auth:ok` | `{ sessionId }` | N/A (new) |
| `auth:error` | `{ error }` | N/A (new) |
| `machines:snapshot` | `Machine[]` | `machines:snapshot` |
| `machine:connected` | `Machine` | `machine:connected` |
| `machine:disconnected` | `{ machineId }` | `machine:disconnected` |
| `task:text` | `{ taskId, text, seq }` | `task:text` |
| `task:result` | `{ taskId, result, usage }` | `task:result` |
| `task:progress` | `{ taskId, percent }` | `task:progress` |
| `task:tool_trace` | `{ taskId, tool, input, output }` | `task:tool_trace` |
| `task:file_change` | `{ taskId, path, action }` | `task:file_change` |
| `task:session_init` | `{ taskId, sessionId, model }` | `task:session_init` |
| `task:stdout` | `{ taskId, data }` | `task:stdout` |
| `task:approval_request` | `{ taskId, question, options }` | `task:approval_request` |
| `task:safety_prompt` | `{ taskId, prompt }` | `task:safety_prompt` |
| `task:steer_ack` | `{ taskId }` | `task:steer_ack` |
| `task:ready` | `{ nodeId, projectId }` | `task:ready` |
| `approval:requested` | `{ nodeId, type }` | `approval:requested` |
| `approval:responded` | `{ nodeId, decision }` | `approval:responded` |
| `merge_queue:failed` | `{ nodeId, error }` | `merge_queue:failed` |
| `merge_queue:succeeded` | `{ nodeId }` | `merge_queue:succeeded` |
| `session:attached` | `{ sessionId }` | `session:attached` |
| `session:detached` | `{ sessionId }` | `session:detached` |
| `session:event` | `{ sessionId, event }` | `session:event` |
| `ping` | — | `heartbeat` |
| `error` | `{ code, message }` | N/A (new) |

### Message Types — Client → Server (New)

These replace the current `fetch()` POST calls for real-time actions:

| Type | Payload | Replaces |
|------|---------|----------|
| `auth` | `{ token }` | `?token=` query param |
| `pong` | — | N/A |
| `dispatch:steer` | `{ taskId, message }` | `POST /api/dispatch/steer` |
| `dispatch:approval` | `{ taskId, decision, message }` | `POST /api/dispatch/approval` |
| `dispatch:safety` | `{ taskId, decision }` | `POST /api/dispatch/safety-decision` |
| `dispatch:cancel` | `{ taskId }` | `POST /api/dispatch/cancel` |
| `dispatch:approve` | `{ taskId }` | `POST /api/dispatch/approve` |
| `subscribe` | `{ topics: string[] }` | N/A (new — topic-based filtering) |
| `unsubscribe` | `{ topics: string[] }` | N/A |
| `resume` | `{ sessionId, lastId }` | `Last-Event-ID` header / `lastSeq` param |

### Reconnection Protocol

```
Client                                    Server
  │                                          │
  │─── (connection lost) ──────────────────►│
  │                                          │
  │    [exponential backoff: 1s, 2s, 4s...] │
  │                                          │
  │─── GET /api/ws (Upgrade) ──────────────►│
  │◄── 101 ─────────────────────────────────│
  │                                          │
  │─── { type: "auth", token: "jwt" } ────►│
  │─── { type: "resume",                   │
  │      sessionId: "prev-session",         │
  │      lastId: "1234" } ────────────────►│
  │                                          │
  │◄── { type: "auth:ok" } ────────────────│
  │◄── (replayed missed messages) ─────────│  ← From EventBuffer + DB
  │◄── { type: "resume:complete" } ────────│
```

Server maintains a per-session `EventBuffer` (ring buffer, already exists for SSE) plus `streaming_events` DB table for durable replay. The `resume` message triggers the same catch-up logic currently in `GET /api/events/catch-up`.

## Implementation Roadmap

### Phase 1: Server-Side WebSocket Endpoint

**Goal:** Add `GET /api/ws` upgrade handler alongside existing SSE. No client changes yet — test with `wscat` or a simple script.

**Files to create/modify:**

| File | Action | Description |
|------|--------|-------------|
| `server/lib/ws-server.ts` | Create | `ClientWebSocketServer` class — manages browser/mobile WebSocket connections, auth, session tracking, message routing |
| `server/routes/ws.ts` | Create | Hono route: `GET /api/ws` with `upgradeWebSocket()` from `hono/ws` |
| `server/index.ts` | Modify | Wire up `createNodeWebSocket()` from `@hono/node-server/ws` to the Hono app and Node HTTP server |
| `server/lib/ws-protocol.ts` | Create | Message type definitions, envelope serialization/deserialization, validation |

**Key implementation details:**

```typescript
// server/index.ts — add WebSocket upgrade support
import { createNodeWebSocket } from '@hono/node-server/ws'

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

// After createServer:
const server = serve({ fetch: app.fetch, port: 3001 })
injectWebSocket(server) // enables upgrade handling on same port

// server/routes/ws.ts
import { upgradeWebSocket } from '../index' // or pass via context

export const wsRoute = new Hono()
wsRoute.get('/ws', upgradeWebSocket((c) => ({
  onOpen(evt, ws) { /* register client, await auth message */ },
  onMessage(evt, ws) { /* route by message type */ },
  onClose(evt, ws) { /* cleanup */ },
})))
```

**Relationship to relay server:**

The new `ClientWebSocketServer` subscribes to the same `relayServer` EventEmitter and `executionEventBus` events that `events.ts` currently subscribes to. It is a parallel consumer, not a replacement for the relay.

```
relayServer (EventEmitter)
    ├── events.ts (SSE bridge — existing, kept as fallback)
    └── ws-server.ts (WebSocket bridge — new)
```

**Auth flow:**
1. Client connects to `GET /api/ws` — upgrade succeeds with no auth (connection established)
2. Client sends `{ type: "auth", token: "<jwt>" }` as first message within 5 seconds
3. Server validates JWT using same logic as `requireAuth` middleware (Supabase JWT, device token, local mode)
4. Server responds with `{ type: "auth:ok", sessionId: "<uuid>" }` or `{ type: "auth:error" }` and closes
5. If no auth message within 5s, server closes with code `4001`

**Testing:** Use `wscat -c ws://localhost:3001/api/ws` then send `{"type":"auth","token":"..."}`.

### Phase 2: Client-Side WebSocket Transport

**Goal:** Replace `RealtimeClient` (EventSource) with a WebSocket-based client. Keep SSE as fallback.

**Files to create/modify:**

| File | Action | Description |
|------|--------|-------------|
| `src/lib/ws-client.ts` | Create | `WsRealtimeClient` — WebSocket transport implementing same `on(type, handler)` interface as `RealtimeClient` |
| `src/lib/realtime-client.ts` | Modify | Add transport abstraction: try WebSocket first, fall back to EventSource |
| `src/lib/sse-parser.ts` | Keep | Still needed for one-shot AI streams (Phase 3 replaces these) |
| `src/stores/realtime-store.ts` | Modify (minor) | Wire in `dispatch:steer`, `dispatch:approval` etc. as WebSocket sends instead of `fetch()` |

**Transport abstraction:**

```typescript
// src/lib/realtime-client.ts
interface RealtimeTransport {
  connect(url: string, token: string): Promise<void>
  send(message: WsMessage): void
  on(type: string, handler: (data: unknown) => void): () => void
  disconnect(): void
  readonly connected: boolean
}

class WsTransport implements RealtimeTransport { /* WebSocket */ }
class SseTransport implements RealtimeTransport { /* EventSource — current code */ }

export class RealtimeClient {
  private transport: RealtimeTransport

  async connect() {
    try {
      this.transport = new WsTransport()
      await this.transport.connect(wsUrl, token)
    } catch {
      // Fallback to SSE (corporate proxy, CDN blocking, etc.)
      this.transport = new SseTransport()
      await this.transport.connect(sseUrl, token)
    }
  }
}
```

**Bidirectional actions:** Once connected via WebSocket, user actions that currently go through `fetch()` can optionally be sent as WebSocket messages for lower latency:

```typescript
// Before (current):
await fetch('/api/dispatch/steer', { method: 'POST', body: JSON.stringify({ taskId, message }) })

// After (WebSocket):
realtimeClient.send({ type: 'dispatch:steer', payload: { taskId, message } })
```

The `fetch()` endpoints remain functional — the WebSocket path is an optimization, not a replacement. This allows gradual migration.

### Phase 3: Multiplex AI Streams Over WebSocket

**Goal:** Route one-shot AI streams (generate-plan, chat, dispatch) through the WebSocket connection instead of separate `fetch()` + SSE responses.

**Current flow:**
```
Browser → POST /api/agent/chat → Response: text/event-stream → parseSSEStream()
```

**New flow:**
```
Browser → WS: { type: "agent:chat", payload: { projectId, messages } }
Server  → WS: { type: "agent:chat:text", id: "req-1", payload: { text } }
Server  → WS: { type: "agent:chat:tool_use", id: "req-1", payload: { tool } }
...
Server  → WS: { type: "agent:chat:done", id: "req-1" }
```

**Request-response correlation:** Each client request includes a `requestId`. Server responses for that stream include the same `requestId`, allowing multiplexing multiple concurrent AI streams.

**Files to modify:**

| File | Action | Description |
|------|--------|-------------|
| `server/routes/ws.ts` | Modify | Add handlers for `agent:*` message types that call the same underlying `streamChatViaRelay()` logic |
| `server/routes/agent.ts` | Keep | HTTP SSE endpoints stay for backward compat and non-WebSocket clients |
| `src/lib/api-client.ts` | Modify | AI functions check if WebSocket is connected; if yes, use WS; otherwise fall back to `fetch()` + SSE |
| `src/lib/sse-parser.ts` | Keep | Fallback parsing for non-WebSocket clients |

### Phase 4: Mobile Client SDK

**Goal:** Provide a reusable client library for iOS and Android.

**iOS (Swift):**
```swift
// Uses URLSessionWebSocketTask (iOS 13+)
let task = URLSession.shared.webSocketTask(with: URL(string: "wss://app.astro.dev/api/ws")!)
task.resume()
task.send(.string("{\"type\":\"auth\",\"token\":\"\(jwt)\"}")) { error in ... }
```

**Android (Kotlin):**
```kotlin
// Uses OkHttp WebSocket
val client = OkHttpClient()
val request = Request.Builder().url("wss://app.astro.dev/api/ws").build()
client.newWebSocket(request, object : WebSocketListener() { ... })
```

**Shared protocol:** The JSON message envelope is identical across all platforms. Consider auto-generating type definitions from `server/lib/ws-protocol.ts`:
- TypeScript types → generated from source
- Swift `Codable` structs → generated from JSON Schema
- Kotlin `@Serializable` data classes → generated from JSON Schema

**Files to create:**

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/ws-protocol.ts` | Move from `server/lib/ws-protocol.ts` | Shared types in `@astro/core` so CLI, web, and SDKs share definitions |
| `packages/sdk/` | Create | `@astroanywhere/sdk` — TypeScript WebSocket client, publishable to npm |

### Phase 5: Deprecate SSE

**Goal:** Remove SSE code paths after all clients have migrated.

**Only do this when:**
- WebSocket has been stable in production for 3+ months
- Mobile clients are live and using WebSocket exclusively
- CLI uses WebSocket (or device-token + REST is sufficient)
- No analytics show SSE connections from active users

**Files to remove/modify:**

| File | Action |
|------|--------|
| `server/routes/events.ts` | Remove (SSE bridge) |
| `src/lib/realtime-client.ts` | Remove `SseTransport` class |
| `src/lib/sse-parser.ts` | Remove if no longer used by AI streams |

## Server Configuration

### Hono + Node WebSocket Setup

`@hono/node-server` (already at `^1.19.9`) exports `createNodeWebSocket` which wraps the `ws` library for Hono route integration. No new dependencies needed.

```typescript
// server/index.ts — required changes
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-server/ws'

const app = new Hono()
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

// ... existing route registration ...

// Add WebSocket route
import { createWsRoute } from './routes/ws'
app.route('/api', createWsRoute(upgradeWebSocket))

// Start server and inject WebSocket handling
const server = serve({ fetch: app.fetch, port: 3001 })
injectWebSocket(server)
```

### Fly.io Considerations

- Fly.io supports WebSocket natively on standard ports
- No special configuration needed beyond what's already in `fly.toml`
- The existing `X-Accel-Buffering: no` header (set for SSE) is not needed for WebSocket but doesn't hurt
- Fly.io's internal proxy handles the `Upgrade: websocket` header correctly
- Health checks should remain HTTP-based (`GET /api/health`)

### Cloudflare Pages / Tunnel

- Cloudflare Tunnel supports WebSocket passthrough by default
- Cloudflare Pages (frontend hosting) doesn't handle WebSocket — connections go directly to the Fly.io backend, which is the correct behavior since `/api/ws` routes to the backend anyway
- The Vite dev proxy (`/api → localhost:3001`) supports WebSocket upgrade via `server.proxy.ws: true` in `vite.config.ts`

### Connection Limits and Scaling

| Concern | Approach |
|---------|----------|
| Max connections per instance | `ws` library handles thousands; Fly.io machine memory is the limit |
| Horizontal scaling | Same constraints as current SSE — see note below |
| Connection draining on deploy | Fly.io sends `SIGTERM`; close WebSockets with code `1001` (Going Away), clients reconnect to new instance |
| Memory per connection | ~20KB per WebSocket (ws library) + session state; budget 50K connections per 256MB instance |

**Scaling note:** WebSocket has the same horizontal scaling story as the current SSE architecture. Both depend on instance-local state: `ExecutionEventBus` (EventEmitter), `relayServer` event subscriptions, `activeDispatchStreams` (Set), and `executionContextStore` (Map). Multi-instance deployment requires the same Redis pub/sub or Postgres `LISTEN/NOTIFY` solution regardless of transport. The persistence layer (`streaming_events` table, catch-up endpoint, hydrator, merge logic) is fully transport-agnostic and works unchanged with both SSE and WebSocket. See [ARCHITECTURE.md §13.3](./design/ARCHITECTURE.md) for the current scaling status.

## Migration Checklist

### Phase 1 Prerequisites
- [ ] Read `@hono/node-server/ws` docs and verify `createNodeWebSocket` API
- [ ] Decide on auth timeout (recommended: 5s) and close codes (4001 = no auth, 4003 = forbidden)
- [ ] Define message types in `ws-protocol.ts` with Zod validation
- [ ] Add `ws` connection metrics to health endpoint

### Phase 2 Prerequisites
- [ ] Implement exponential backoff (1s → 2s → 4s → 8s → 30s cap) in `WsTransport`
- [ ] Add connection state to devtools (visible in React DevTools via Zustand store)
- [ ] Test with browser DevTools WebSocket inspector
- [ ] Test SSE fallback by blocking WebSocket upgrade (e.g., corporate proxy simulation)

### Phase 3 Prerequisites
- [ ] Define request-response correlation protocol (requestId)
- [ ] Handle concurrent AI streams (multiple generate-plan / chat / dispatch)
- [ ] Test abort semantics — closing WebSocket mid-stream should cancel agent execution

### Phase 4 Prerequisites
- [ ] Generate JSON Schema from `ws-protocol.ts` types
- [ ] Set up CI to generate Swift/Kotlin types from schema
- [ ] Test with iOS `URLSessionWebSocketTask` and Android `OkHttp`

## Trade-off Analysis

### Advantages

| Advantage | Detail |
|-----------|--------|
| **Security** | JWT moves from URL query param to first WS message — no longer in server logs, Referer headers, browser history |
| **Lower action latency** | Steer/approval/cancel sent on existing connection (~0ms setup) vs separate `fetch()` POST (~50-100ms TCP+TLS) |
| **Connection efficiency** | Single multiplexed connection vs HTTP/1.1's 6-connection limit (1 EventSource + N fetch-SSE + API calls) |
| **Stream multiplexing** | Concurrent AI streams (plan chat + task execution + playground) on one connection via `requestId` correlation |
| **Mobile native support** | iOS `URLSessionWebSocketTask` (built-in), Android `OkHttp` WebSocket (mature); no native `EventSource` on either |
| **Lifecycle management** | Explicit close/open events + ping/pong; mobile OS keeps WS alive longer than idle HTTP connections |
| **Bidirectional by design** | Eliminates dual-path architecture (dispatch SSE + `activeDispatchStreams` dedup + `ExecutionEventBus` bridge) |

### Disadvantages

| Disadvantage | Detail |
|--------------|--------|
| **Migration complexity** | Must maintain SSE + WS code paths simultaneously during transition; two server-side consumers of the same EventEmitter |
| **Corporate proxy/CDN issues** | Some proxies strip `Upgrade: websocket` headers; SSE works everywhere over plain HTTP |
| **Server-side session state** | WS requires per-connection session tracking and auth state; SSE is stateless per request |
| **Debugging** | SSE is readable in Network tab as plain text; WS frames require dedicated inspector, binary frames are opaque |
| **Memory overhead** | ~20KB per WS connection (ws library) + session state vs lighter SSE response streams |
| **No gain for some flows** | Plan chat (simple fetch-SSE) and one-turn summaries (REST) don't meaningfully benefit |

### What is NOT a disadvantage

**Horizontal scaling** — WebSocket has the same scaling constraints as the current SSE architecture. Both depend on instance-local `EventEmitter` state (`ExecutionEventBus`, `relayServer`). Multi-instance requires Redis pub/sub regardless of transport. The persistence layer (`streaming_events`, catch-up, hydration) is transport-agnostic.

**Recovery/robustness** — The three-layer recovery system from PR #510 (live stream → `streaming_events` DB catch-up → observation fallback) works unchanged with WebSocket. The `resume` message adds a faster first-pass before falling back to the same HTTP catch-up endpoint.

### When to migrate

The strongest arguments for WS are **mobile support** and **JWT-in-URL elimination**. If mobile is not imminent and JWT exposure is acceptable, the current SSE design with PR #510's robustness layer is already solid. Migrate when mobile becomes a real requirement.

## Related Documentation

- [API Surface & Roadmap](./api.md) — Full endpoint inventory, conventions, multi-platform roadmap
- [Relay Protocol](./relay/protocol.md) — Machine ↔ server WebSocket message types
- [Realtime Sync](./features/realtime-sync.md) — Supabase Realtime (DB CDC, separate from this)
- [ARCHITECTURE](./design/ARCHITECTURE.md) — System structure and protocols
- [ELECTRON_APP](./design/ELECTRON_APP.md) — Electron desktop app, which will also benefit from WebSocket
- [Refresh Robustness](./design/REFRESH_ROBUSTNESS.md) — Three-layer recovery architecture (transport-agnostic)
- [GitHub Issue #513](https://github.com/fuxialexander/astro/issues/513) — WebSocket migration tracking with flow diagrams
