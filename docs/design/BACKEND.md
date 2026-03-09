# Astro Backend -- Design Document

## What Is the Backend?

The Astro platform has two main halves that work together: the **Frontend** (what you see in your browser -- buttons, graphs, chat panels) and the **Backend** (a program running on a server that the browser talks to behind the scenes). This document describes the Backend.

Think of the Backend as a **receptionist and filing clerk combined**. When you do something in the browser -- create a project, start a task, chat with the AI -- the browser sends a request to the Backend. The Backend validates the request (is it well-formed? is this user allowed to do this?), looks up or saves data (in a database), and coordinates with other systems (the Relay for remote machines, AI providers for intelligence). The Backend never runs AI itself -- it delegates that work to **Agent Runners**, which are separate programs running on your machines, coordinated through the Relay WebSocket server.

Here is a quick vocabulary primer for concepts used throughout this document:

- **HTTP API**: The browser sends a message (called a "request") to the Backend, and the Backend sends back a reply (called a "response"). This is like sending a letter and getting a letter back. Every interaction between the browser and the Backend works this way.
- **SSE (Server-Sent Events)**: A one-way channel where the server keeps sending updates to the browser in real time, like a news ticker or a live sports score feed. The browser opens the channel once, and the server pushes updates through it as they happen. This is how you see live output from a running task.
- **Middleware**: Checkpoints that every request passes through before reaching its destination -- like security guards checking IDs at a building entrance. Middleware can reject bad requests, add information, or enforce rules.
- **Routes**: Different "departments" that handle different types of requests -- like a hospital has an ER, radiology, and pharmacy. Each route handles a specific kind of work (AI requests go to the agent route, data storage goes to the data route, etc.).
- **Event system**: An internal announcement system. When something happens (a task completes, a machine connects, an error occurs), it is announced to all interested parties so they can react.

Key technologies used by the Backend:

- **Hono**: A lightweight web framework -- think of it as the scaffolding that lets us define routes, middleware, and request handling. It is like Express.js (a very popular Node.js framework) but faster and smaller.
- **Drizzle**: A database toolkit that lets us talk to our database using TypeScript code instead of writing raw SQL queries. It handles translating our TypeScript into database operations.
- **PostgreSQL (Postgres)**: A database that stores all Astro data permanently. In local mode, Astro runs an embedded Postgres via PGlite (Postgres compiled to WASM, data stored on local disk). In server mode, Astro connects to an external Postgres instance (via Supabase). Both paths use the same Drizzle ORM schema, so queries are identical regardless of mode.
- **Supabase**: A service built on top of Postgres that adds authentication, real-time subscriptions, and an API layer. Astro uses Supabase in "server mode" for multi-user deployments.
- **Zod**: A validation library. A Zod schema is a set of rules that checks "is this data shaped correctly?" For example: "this field must be a string, under 50,000 characters, and not empty." If data fails validation, the request is rejected before it can cause problems.

**Entry point**: `server/index.ts`
**Framework**: Hono.js with `@hono/node-server`

---

## 2. Startup Sequence

When you start the Backend (by running `npm run dev:backend` or `npm run dev`), it goes through a carefully ordered series of steps to prepare itself. Each step depends on the previous ones completing successfully. This is defined in `server/index.ts`, in the `start()` function.

Here is what happens, in order:

1. **Kill stale port processes** -- `fuser -k` on ports 3001 and 3002. When the development server restarts during coding (because a file changed), the old process sometimes does not shut down cleanly. This step forces any leftover processes off the ports so the new server can claim them.

2. **Run database migrations** -- `runMigrations()` via Drizzle. "Migrations" are scripted changes to the database structure. If we added a new column to a table since the last time the server ran, the migration applies that change. This ensures the database shape always matches what the code expects.

3. **Bootstrap local mode** (if local mode) -- Creates the fixed local team, user profile, and team membership in the PGlite database. This is idempotent and safe to call on every restart.

4. **Register event hooks** -- 8+ hooks are registered on the `astroEventTransport` singleton (skipped in test mode so tests run cleanly without side effects):
   - `sse-notification` -- Forward events to SSE clients (so the browser sees real-time updates)
   - `audit-log` -- Log user actions for accountability and debugging
   - `usage-metrics` -- Track token counts and cost (how much AI usage is happening)
   - `pr-creation` -- Automatically create GitHub pull requests when tasks finish
   - `merge-queue` -- Automatically manage merge queues for completed PRs
   - `git-pull` -- Automatically commit and push code changes
   - `channel-notification` -- Send notifications to Slack, Linear, or Telegram via webhooks
   - `observability` -- Collect structured trace data for the trace viewer and cost tracking

5. **Reset machine connections** -- `resetAllConnectionStatuses()` clears stale state from the previous session. If the server crashed while machines were marked as "connected," this ensures they start fresh and must re-register.

6. **Connect to Redis** (if configured) -- Redis is an in-memory data store used here for horizontal scaling. If you run multiple Backend instances (for handling more users), Redis lets them share information about which machines are connected and which tasks are running. Not needed for local development with a single server.

7. **Start relay server** -- The Relay is a WebSocket server on port 3002 that maintains persistent, two-way connections with Agent Runners on user machines. It registers handlers for three key events:
   - `task:result` -- An Agent Runner finished a task
   - `machine:connected` -- A new machine joined
   - `machine:disconnected` -- A machine went offline

8. **Start dispatch engine** -- `dispatchEngine.start()`. The dispatch engine watches for tasks whose dependencies are satisfied and automatically sends them out for execution. Think of it as a traffic controller that knows when each task is ready to go.

9. **Start cleanup scheduler** -- A 24-hour cycle that deletes old execution data and chat history to prevent the database from growing indefinitely. This is disabled in test mode and in local mode (PGlite handles its own cleanup).

10. **Start periodic cleanup tasks** -- Expired WebAuthn challenges are cleaned every minute and expired device codes every 5 minutes.

11. **Start HTTP server** -- Finally, Hono begins listening on port 3001. The Backend is now ready to accept requests from the browser.

**Shutdown**: When the server receives a termination signal (SIGTERM or SIGINT -- for example, when you press Ctrl+C), it gracefully shuts down each component in reverse order: stop the cleanup scheduler, observation collector, dispatch engine, HTTP server, relay, and Redis connection. If graceful shutdown takes longer than 3 seconds, it forces a hard kill to avoid hanging.

### How a Request Flows Through the Backend

Once the server is running, every incoming request from the browser passes through a series of layers before reaching its destination. Here is a typical request flow for dispatching a task:

```
┌──────────────────────────────────────────────────────────────────┐
│  REQUEST PROCESSING FLOW                                         │
│                                                                  │
│  Browser sends: POST /api/dispatch/task                          │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────┐                                                 │
│  │ Security    │ CORS check, rate limit, security headers        │
│  │ Middleware  │                                                  │
│  └──────┬──────┘                                                 │
│         ▼                                                        │
│  ┌─────────────┐                                                 │
│  │ Auth        │ Verify JWT (server mode) or skip (local mode)   │
│  │ Middleware  │ Attach userId to request context                 │
│  └──────┬──────┘                                                 │
│         ▼                                                        │
│  ┌─────────────┐                                                 │
│  │ Route       │ dispatch.ts handler                              │
│  │ Handler     │ Validate input (Zod), assemble context           │
│  └──────┬──────┘                                                 │
│         ▼                                                        │
│  ┌─────────────┐                                                 │
│  │ Relay       │ relayServer.dispatchTask()                       │
│  │ Server      │ → WebSocket → Agent Runner                      │
│  └──────┬──────┘                                                 │
│         ▼                                                        │
│  ┌─────────────┐                                                 │
│  │ Event       │ Events stream back: text, tools, files, result  │
│  │ Transport   │ → SSE → Browser                                 │
│  └─────────────┘                                                 │
└──────────────────────────────────────────────────────────────────┘
```

This pattern applies to all request types, though the specifics vary: a health check stops at the route handler (no relay or events needed), while a plan generation request follows a similar pipeline but may route through the relay to an agent runner for AI processing.

---

## 3. Routes

Routes are the Backend's "departments" -- each one handles a specific category of requests. There are 19 route files in `server/routes/`, mounted in `server/index.ts`.

When the browser sends a request to a URL like `/api/agent/generate-plan`, the Backend looks at the path (`/api/agent/generate-plan`) and forwards the request to the matching route handler (`agent.ts`), which knows how to process that specific type of request.

### 3.1 AI/Execution Routes

These routes handle all interactions with AI -- generating plans, chatting, dispatching tasks, and getting results.

#### `/api/agent` (`agent.ts`)

This is the main AI interaction endpoint. It handles plan generation (asking the AI to break a project into tasks), chat (discussing and refining a plan with the AI), and execution summary generation. All AI operations route through the relay to agent runners.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/generate-plan` | AI plan generation via SSE stream |
| POST | `/chat` | Plan-level refinement chat |
| POST | `/project-chat` | Plan-level chat (alias for /chat) |
| POST | `/task-chat` | Task-level chat with execution context |
| POST | `/summarize` | Generate execution summary |
| POST | `/abort` | Cancel running session |

**Plan generation** (`/generate-plan`):

This is what happens when you create a new project and the AI generates a plan (a graph of tasks). The browser describes what the user wants to build, and the AI returns a structured plan with nodes (tasks) and edges (dependencies between tasks).

- Input: description, visionDoc, projectId, model, workingDirectory, fileTree, keyFiles, targetMachineId, gitState
- Validation via Zod schemas (description max 50K chars, fileTree max 10K items, visionDoc max 100K). These limits prevent accidentally sending enormous payloads that would overwhelm the AI or the server.
- Dispatched through the relay as a `RelayTaskDispatch` with `type: 'plan'` and `outputFormat: { type: 'json_schema' }` to enforce structured JSON output conforming to the plan graph schema
- Returns an SSE stream: `text` events during generation (so the user sees progress), `plan_result` with the final JSON plan, and `done` when complete

**Chat** (`/chat`, `/project-chat`):

This powers the chat panel where users discuss and refine their plan with the AI. The user can say things like "break task 3 into smaller pieces" or "add a testing step after the implementation."

- Input: message, sessionId, projectId, visionDoc, planNodes, planEdges, messages (conversation history)
- Routes through the relay via `streamChatViaRelay()` -- the same relay-based execution path as task dispatch
- The AI can respond with structured modification blocks that automatically update the plan:
  - `astro-updates` -- change existing nodes
  - `astro-edges` -- add or modify dependency edges
  - `astro-add-nodes` -- add entirely new nodes
- Returns an SSE stream

**Task chat** (`/task-chat`):

Similar to plan-level chat, but focused on a single task. The AI has access to that task's execution output, description, and context, so you can ask questions like "why did the build fail?" or "what should I change in the config?"

- Input: message, sessionId, nodeId, projectId, taskTitle, taskDescription, taskOutput, visionDoc, model, messages
- Same relay-based streaming pattern as plan chat but with task execution context injected into the conversation

**Summarize** (`/summarize`):

After a task finishes executing, this endpoint generates a concise summary of what happened. This is useful because raw execution output can be thousands of lines long.

- Input: executionOutput (max 200K chars), taskDescription, projectId
- Makes a single-turn Anthropic API call (no back-and-forth, just one question and one answer) to generate a structured JSON summary
- Returns an `ExecutionSummary` with: workCompleted (what was done), filesChanged (which files were modified), status (success/failure), and followUps (suggested next steps)

#### `/api/dispatch` (`dispatch.ts`)

This is the full task dispatch endpoint -- the route that sends tasks to AI agents for execution via the relay. All AI execution flows through the relay to agent runners; there is no local execution path on the server.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/task` | Main task dispatch (relay-only, SSE streaming) |
| POST | `/cancel` | Cancel running task |
| POST | `/steer` | Send guidance to running agent |
| POST | `/prune-branch` | Kill task + all downstream dependents |
| POST | `/approve` | Respond to approval request |
| POST | `/request-dynamic-approval` | Request dynamic approval from user (MCP tool) |
| POST | `/reset` | Reset task execution state |
| POST | `/cleanup` | Clean up worktree/sandbox |
| GET | `/status` | Get dispatch engine status (queue stats, active executions) |
| GET | `/ready/:projectId` | Find tasks ready for dispatch in a project |
| POST | `/engine/start` | Start the dispatch engine |
| POST | `/engine/stop` | Stop the dispatch engine |

**Task dispatch** (`/task`):

This is the entry point for executing a task. When you click "Run" on a task in the UI, this is what handles it. All tasks are dispatched through the relay to agent runners -- there is no local execution path on the server.

- Input: nodeId, projectId, title, description, dependencies, verification, visionDoc, dependencyOutputs, preferredProvider, targetMachineId, model, maxTurns, workingDirectory, deliveryMode, acceptanceCriteria, dryRun, and more
- **Server-side resolution**: Before dispatching, the route fetches the plan node and project from the database to fill in any missing fields (title, description, visionDoc, dependencies, working directory, delivery mode). This means the frontend can send a minimal payload (just nodeId and projectId) and the server will resolve everything else.
- **Dependency validation**: Checks that all upstream dependencies have completed outputs. If dependencies are not met and `force` is not set, the request is rejected with a 400 error.
- **Serial execution constraint**: For `direct` delivery mode (non-git directories without isolation), only one task per project can run at a time to prevent file conflicts (returns 409 if violated).
- **Machine selection**: If no `targetMachineId` is specified, the server falls back to the project's `defaultMachineId`, then to `machineRegistry.findBestMachine()` which evaluates connected machines by load and capabilities.
- **Prompt assembly**: Builds a full task prompt including vision doc, dependency outputs, and workspace/delivery instructions. Different delivery modes (`pr`, `push`, `branch`, `copy`, `direct`) produce different workspace instruction blocks so the agent knows how to handle branching, commits, and PRs.
- Returns an SSE stream with execution events (so the browser can show live progress)

**`dispatchViaRelay()`**:

All task execution flows through this function, which dispatches through the Relay WebSocket to an Agent Runner. The Agent Runner on the target machine does the actual AI work (worktree creation, code generation, testing, commits, PR creation). This function listens for events from the Relay and re-emits them as SSE to the browser. It handles: task results, stdout (live output text), text events, tool traces (what tools the AI used), file changes, progress updates, session initialization, approval requests, and safety decisions.

Key features:
- **Image attachments**: Resolves `imageRefs` (blob UUIDs) to base64-encoded images and includes them in the dispatch payload for multimodal agent input.
- **Execution tracking**: Stores execution context in `executionContextStore` for user-scoped SSE filtering and ownership validation.
- **Environment config injection**: If the target machine has custom environment configuration (conda envs, module loads, etc.), it is injected into the dispatch payload.
- **Heartbeat timeout**: An activity timer (configurable, default 12 minutes) detects stalled executions. The timer pauses when the agent is waiting for a user approval response via `ask_user_question`.

**Steer** (`/steer`):

"Steering" lets you send guidance to an AI agent while it is running. For example, if you see it going down the wrong path, you can send a message like "focus on the database layer first, not the UI." The steer endpoint routes the message through the relay: `relayServer.steerTask()` forwards it through the WebSocket to the Agent Runner.

### 3.2 Event Routes

#### `/api/events` (`events.ts`, 376 lines)

This route provides the real-time event stream -- the "news ticker" that keeps the browser up to date.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/stream` | Persistent SSE connection for real-time events |

When the browser loads the Astro app, it opens a persistent SSE connection to `/api/events/stream`. This connection stays open for the entire session, and the server pushes events through it as things happen: a machine comes online, a task makes progress, an approval is needed, etc.

Key details:
- Query param: `projectId` (reserved for filtering events to a specific project)
- Header: `Last-Event-ID` for reconnection replay. If the browser's connection drops and it reconnects, it sends the ID of the last event it received, and the server replays everything since then. This prevents missing events during brief network blips.
- Heartbeat every 15 seconds -- a tiny "I'm still here" message to keep the connection alive (some network proxies will close idle connections)
- Event types include: machine state changes, task progress, approval requests, session bridge events
- Filters machines by authenticated user ID (you only see your own machines)
- Sends an initial snapshot of all connected machines when you first connect
- Stdout (live output from running tasks) is throttled to flush every 100ms via `StdoutThrottle`. Without throttling, a task producing rapid output could flood the browser with thousands of tiny events per second.
- Event replay is backed by `EventBuffer` (a ring buffer with Last-Event-ID support). A "ring buffer" is a fixed-size list that overwrites the oldest entries when full -- it keeps recent history without growing forever.

### 3.3 Relay Routes

#### `/api/relay` (`relay.ts`, ~400 lines)

The Relay routes let the browser manage remote machines and dispatch tasks to them. "Remote machines" are computers where Agent Runners are installed -- they could be your laptop, a lab server, or a cloud instance.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Relay health check |
| GET | `/status` | Detailed relay status with machine snapshot |
| GET | `/machines` | List connected machines (filtered by user) |
| GET | `/machines/:machineId` | Single machine details |
| POST | `/dispatch` | Dispatch task to agent runner via relay |
| POST | `/cancel` | Cancel relay task |
| GET | `/best-machine` | Select optimal machine for task |

The `/best-machine` endpoint is notable: when you have multiple machines connected, it evaluates which one is the best fit for a task based on current load, available providers, and capabilities.

### 3.4 Auth Routes

These routes handle user identity -- proving who you are so the system can show you your data and keep others out.

#### `/api/auth` (`auth.ts`, ~300 lines)

WebAuthn/passkey authentication via Supabase. WebAuthn is a modern authentication standard that uses your device's built-in security (fingerprint reader, face recognition, or a hardware security key) instead of passwords.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/webauthn/check-user` | Check if user exists |
| POST | `/register-options` | WebAuthn registration challenge |
| POST | `/register-verify` | Verify registration response |
| POST | `/login-options` | WebAuthn login challenge |
| POST | `/login-verify` | Verify login, return session tokens |

The registration/login flow works in two steps: first the server sends a "challenge" (a random puzzle), then the browser uses the device's security hardware to sign it, and the server verifies the signature. This proves the user has physical access to the registered device.

Challenge store: in-memory, TTL (time-to-live) 5 minutes, max 1000 entries. Challenges expire quickly to prevent replay attacks. Rate limited: 10 attempts per 15 minutes per IP address (to prevent brute-force attacks).

#### `/api/device` (`device-auth.ts`, ~400 lines)

Device Authorization Grant (RFC 8628) for machine registration. This is how Agent Runners authenticate themselves. When you set up an Agent Runner on a new machine, it cannot easily open a browser for login. Instead, it shows a short code on screen, you type that code into Astro's web UI, and the machine becomes authorized. This is the same pattern Netflix uses when you sign in on a TV.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/authorize` | Request device code (the short code shown on the machine) |
| POST | `/token` | Poll for authorization / exchange for access token (the machine keeps asking "has the user approved me yet?") |
| POST | `/register` | Register the authenticated machine |
| POST | `/refresh` | Refresh access token (tokens expire periodically for security; this gets a new one without re-authenticating) |
| POST | `/revoke` | Revoke token (de-authorize a machine) |
| GET | `/machines` | List registered machines |
| DELETE | `/machines/:id` | Revoke machine |

### 3.5 Data Routes

#### `/api/data` (`data.ts`)

CRUD operations for all persistent entities. "CRUD" stands for Create, Read, Update, Delete -- the four basic operations for stored data. This route is the filing cabinet: it lets the browser store and retrieve projects, plan nodes, user profiles, and other data.

All data queries are **team-scoped** using a `teamScopeFilter` helper function defined at the top of `data.ts`. This ensures users can only see and modify data belonging to their active team:

```ts
function teamScopeFilter(table, user: AuthUser) {
  return or(
    eq(table.teamId, user.teamId),
    and(isNull(table.teamId), eq(table.ownerId, user.id))
  )
}
```

The `or(...)` with the `isNull(teamId)` branch provides backward compatibility with legacy data created before teams were introduced -- rows where `teamId` is null are still accessible if `ownerId` matches the current user.

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/projects` | List/create projects |
| GET/POST | `/plan-nodes/:projectId` | List/create plan nodes for a project |
| DELETE | `/plan-nodes/:nodeId` | Delete a node |
| POST | `/plan-edges` | Create edges (dependency links between nodes) |
| DELETE | `/plan-edges/:edgeId` | Delete an edge |
| GET/PUT | `/user-profile` | Get/update user profile |
| GET/PUT | `/display-settings` | Get/update display settings (layout preferences, column visibility, etc.) |
| GET | `/usage-metrics` | Token/cost tracking (how much AI has been used) |
| GET/POST | `/initiatives` | List/create initiatives (groupings of related projects) |

### 3.6 Other Routes

These routes handle various supporting features. Each is relatively self-contained.

| Route | File | Purpose |
|-------|------|---------|
| `/api/health` | `health.ts` | Health check -- the browser pings this to confirm the Backend is alive. Also returns backend detection info and session statistics. |
| `/api/github` | `github.ts` | GitHub webhook handler -- receives notifications from GitHub (e.g., "a PR was merged") and acts on them |
| `/api/notifications` | `notifications.ts` | Push notifications to the browser |
| `/api/fs` | `fs.ts` | File system operations -- lets the browser read/write files on the server |
| `/api/repo` | `repo.ts` | Repository operations -- git clone, branch listing, file tree generation |
| `/api/skills` | `skills.ts` | Available skills/tools that agents can use |
| `/api/share` | `share.ts` | Share URLs -- generate shareable links to projects or plans |
| `/api/connected-accounts` | `connected-accounts.ts` | OAuth integrations (connect GitHub, Linear, etc.) |
| `/api/system` | `system.ts` | System information (OS, memory, disk, versions) |
| `/api/observations` | `observations.ts` | Observability/tracing data -- detailed records of what the AI did, for debugging and analysis |
| `/api/teams` | `teams.ts` | Team management -- CRUD, invitations, member roles |
| `/.well-known` | `well-known.ts` | Standards endpoints -- well-known URIs used by various internet standards (e.g., OAuth discovery) |

---

## 4. Middleware

Middleware functions are checkpoints that every request passes through before reaching its destination route. Think of them as security guards, form-checkers, and gatekeepers at the entrance to a building. Each request must pass through all the middleware before it reaches the route handler that will actually process it.

### 4.1 Authentication (`server/middleware/auth.ts`, 123 lines)

The authentication middleware answers the question "who is making this request?" It has two strategies depending on which mode the system is running in. Both strategies resolve the user into an `AuthUser` object that includes team context:

```ts
interface AuthUser {
  id: string
  email?: string
  teamId: string      // Active team (used for scoping all data queries)
  teamIds: string[]   // All teams the user belongs to
}
```

**Local Mode** (single user, no Supabase):
- Uses fixed constants: `LOCAL_USER_ID` (`00000000-...0000`) and `LOCAL_TEAM_ID` (`00000000-...0001`), both imported from `server/lib/db/bootstrap-local.ts`
- Accepts an `X-User-Id` header for per-browser isolation, but `teamId` and `teamIds` are always the fixed local team
- No JWT verification -- since there is only one user running locally, there is no need for cryptographic authentication

**Server Mode** (multi-user, with Supabase):
- Extracts the authentication token from the `Authorization: Bearer <token>` header, or from a query parameter (needed for SSE/EventSource connections, because the browser's built-in EventSource API cannot set custom headers)
- Verifies the token by calling `supabase.auth.getUser(token)` -- this checks with Supabase that the token is valid and not expired
- **Team resolution** via `resolveTeams()`: queries the `team_members` table to find all teams the user belongs to (`teamIds`), then resolves the active team from the `X-Team-Id` request header (falling back to the user's first team if the header is absent or invalid)
- Returns a 401 ("Unauthorized") error if the token is invalid or expired
- Test bypass: if the token is `'test-e2e-token'` and the environment variable `ALLOW_E2E_BYPASS=true` is set, authentication is skipped. This lets automated tests run without setting up real user accounts.

Functions:
- `requireAuth(c, next)` -- Enforces authentication. If the user cannot be identified, the request is rejected. On success, attaches an `AuthUser` object (with resolved `teamId` and `teamIds`) to the Hono context so downstream route handlers know who is making the request and which team's data to return.
- `optionalAuth(c, next)` -- Tries to authenticate but does not reject the request if no token is provided. Used for endpoints that work differently for logged-in vs. anonymous users.

### 4.2 Security

The Backend applies several layers of security to protect against common web attacks.

**CORS (Cross-Origin Resource Sharing)** (index.ts lines 85-100):

Browsers have a built-in security rule: a webpage at `example.com` cannot make requests to `api.other-site.com` unless `api.other-site.com` explicitly says "I allow requests from example.com." CORS is this "allow list."

- Allowed origins: `localhost:5173` (local development), `astro.your-domain.com` (production frontend), `astro.pages.dev` (Cloudflare Pages), plus any custom origins set via `CORS_ORIGIN` or `FRONTEND_URL` environment variables
- Production: strict origin match (only the exact listed domains are allowed)
- Dev: allows localhost + explicit origins (more permissive for developer convenience)

**Rate limiting** (index.ts lines 102-146):

Rate limiting prevents any single user (identified by IP address) from overwhelming the server with too many requests. Different categories have different limits, reflecting their cost:

- Global: 10,000 requests per 15 minutes per IP (generous, covers normal browsing)
- Auth: 3,000 requests per 15 minutes per IP (tighter, since auth endpoints are targeted by attackers)
- AI: 1,000 requests per hour per IP (tightest, since AI calls are expensive and slow)
- All limits are bypassed in test mode (so automated tests can run freely)

**Security headers** (index.ts lines 61-73):

These are HTTP headers the Backend adds to every response, instructing browsers to enable various security protections:

- **CSP (Content Security Policy)** -- tells the browser which sources of content (scripts, images, etc.) are trusted
- **HSTS (HTTP Strict Transport Security)** -- tells the browser to always use HTTPS, never HTTP
- **X-Frame-Options: DENY** -- prevents the Astro app from being embedded in an iframe on another site (protects against "clickjacking")
- **X-Content-Type-Options: nosniff** -- prevents browsers from guessing the type of a file (protects against certain injection attacks)

---

## 5. Data Storage

The Backend needs to store data permanently (projects, plans, user profiles) and also keep some data in memory for fast access (active sessions, connected machines). This section covers both.

### 5.1 Database (Drizzle ORM + PostgreSQL)

The primary permanent storage is a PostgreSQL database, accessed through Drizzle ORM. "ORM" stands for Object-Relational Mapping -- it is a translation layer that lets us write TypeScript code like `db.select().from(projects).where(eq(projects.id, '123'))` instead of raw SQL strings. This makes the code safer (no SQL injection vulnerabilities) and easier to maintain.

**Connection** (`server/lib/db/index.ts`):

The database layer uses a **dual-driver architecture** behind a single Drizzle ORM interface. A lazy-initializing `Proxy` (`export const db`) forwards all property accesses to the real driver instance, which is created on first use. This means no import changes are needed across the 50+ files that use `db` -- they all import the same `db` object, and the Proxy transparently routes to whichever driver was initialized.

- **Local mode**: `@electric-sql/pglite` -- Postgres compiled to WASM, running in-process with no network. Data is stored on local disk at `~/.astro/pglite/` (configurable via `PGLITE_DATA_DIR`). No connection pool needed since it is in-process.
- **Server mode**: `postgres.js` -- A fast PostgreSQL client library connecting to an external Postgres instance. Default connection string: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (the local Supabase instance). Pool: max 10 connections, 20-second idle timeout, 10-second connect timeout. "Connection pooling" means the Backend keeps a small set of open connections to the database and reuses them, rather than opening a new connection for every single query (which would be slow).

Both drivers are wrapped in Drizzle ORM with the same schema (`server/lib/db/schema.ts`), so all queries work identically regardless of mode.

**Migrations** (`server/lib/db/migrate.ts`):

- **Local mode**: Runs Drizzle migrations against PGlite on every startup (creates tables on first run, idempotent on restart). Migration files live in `./drizzle/`.
- **Server mode**: No-op -- Supabase manages migrations via `supabase/migrations/`.

**Local bootstrap** (`server/lib/db/bootstrap-local.ts`):

On first PGlite startup, creates a fixed local team (`LOCAL_TEAM_ID = '00000000-0000-0000-0000-000000000001'`), user profile (`LOCAL_USER_ID = '00000000-0000-0000-0000-000000000000'`), and team membership. This is idempotent and safe to call on every restart. These fixed IDs are used by the auth middleware in local mode (see section 4.1).

**Schema** (`server/lib/db/schema.ts`, ~300 lines, 32+ tables):

The schema defines the structure of all database tables -- what columns they have, what types of data they hold, and how they relate to each other. Here is an overview grouped by purpose:

**Core entities** (the main things users create and interact with):
- `projects` (26 columns) -- owner_id, name, description, visionDoc, workingDirectory, repository, etc. Each project is a top-level container for a plan.
- `planNodes` (28 columns) -- The individual tasks/milestones in a plan. Includes: type, title, description, status, dependencies, execution fields (output, errors, timing), PR metadata, and a soft-delete flag (marking as deleted rather than actually removing, so we can undo).
- `planEdges` -- The arrows connecting nodes in the plan graph. Each edge has a source node, target node, type, and soft-delete flag.
- `planNodeDependencies` -- A join table with a composite key (node ID + depends-on ID) that explicitly tracks which nodes depend on which other nodes.

**Execution tracking** (records of what AI agents have done):
- `sessions` -- Each AI interaction (plan generation, chat, task execution) creates a session. Stores: type, status, messages (as JSONB -- a flexible JSON column), and metrics.
- `taskExecutions` -- Detailed records of task runs. Includes: executionId, status, streamText (the raw output), token counts, cost, and a summary.
- `taskChatSessions` + `taskChatMessages` -- Chat history for task-level conversations.
- `toolTraces` -- Records of every tool call the AI made (e.g., "read file X", "run command Y") with full input and output.
- `fileChanges` -- Records of every file the AI modified, with diffs (showing exactly what changed).

**User data**:
- `userProfiles` -- name, email, domains (areas of expertise), apiKeys (stored as JSONB), settings
- `displaySettings` -- per-view layout preferences stored as JSONB (e.g., "in the task list, group by status and sort by priority")
- `usageMetrics` -- daily aggregation of AI costs and token usage

**Infrastructure**:
- `registeredMachines` -- id, userId, name, hostname, providers (which AI tools are installed), isConnected, isRevoked
- `refreshTokens` -- tokenHash, machineId, scopes, expiry. Used for the device authentication flow.

### 5.2 In-Memory Stores

Some data is too short-lived or too performance-sensitive for the database. These in-memory stores keep data in the server's RAM for instant access. The trade-off is that this data is lost if the server restarts -- which is fine, because it is all transient.

| Store | File | Purpose |
|-------|------|---------|
| Session manager | `server/lib/session-manager.ts` (212 lines) | Maps sessionId to AbortController + metadata. An AbortController is a mechanism for cancelling an in-progress operation. When you click "Cancel" on a running task, the session manager finds the right AbortController and triggers it. |
| Machine registry | `server/lib/machine-registry.ts` | Tracks which machines are currently connected via WebSocket, what they can do (capabilities), and how busy they are (load). |
| Event buffer | `server/lib/event-buffer.ts` | A ring buffer (fixed-size circular list) that stores recent SSE events. When a browser reconnects after a brief disconnection, the buffer replays missed events. |
| Stdout throttle | `server/lib/stdout-throttle.ts` | Batches stdout (live output) chunks per task, flushing every 100ms. Without this, a task producing rapid output would generate thousands of tiny SSE events per second. |
| Device code store | `server/lib/device-code-store.ts` | Temporarily holds device authorization codes (the short codes shown on a machine screen during setup). Codes expire after 5 minutes. |

---

## 6. Event System

The event system is the Backend's internal announcement system. When something noteworthy happens -- a task completes, a machine connects, an approval is needed -- the event system announces it to all interested parties. This decouples the parts of the system: the code that finishes a task does not need to know about SSE, audit logging, or Slack notifications. It just announces "task finished" and the event system takes care of the rest.

### 6.1 Event Transport (`server/lib/events/astro-event-transport.ts`, 135 lines)

The central event bus for cross-cutting concerns (things that affect multiple parts of the system). It is a singleton -- there is exactly one instance, shared across the entire Backend.

- `registerHook(name, hook)` -- Register an async event handler (max 100 listeners, to prevent accidental infinite loops)
- `emitEvent(event)` -- Announce an event to all listeners. Runs all registered hooks in parallel (simultaneously) so one slow hook does not block the others.
- `setEnabled(enabled)` -- Toggle the event system on or off. Disabled in test mode to prevent tests from triggering real side effects (like sending actual Slack messages).

The 8+ hooks registered on startup (see section 2) are the primary consumers of this bus.

### 6.2 Execution Event Bus (`server/lib/execution-event-bus.ts`, 32 lines)

A separate, simpler event emitter specifically for task execution events. It is stored as a singleton via `globalThis.__astro_execution_event_bus__` -- this unusual pattern ensures the same instance survives when the development server hot-reloads the code (otherwise, a new instance would be created and existing listeners would be lost).

Events emitted on this bus:
- `task:stdout` -- Live output text from a running task
- `task:result` -- Final result when a task completes
- `task:tool_trace` -- A tool call the AI made (read file, run command, etc.)
- `task:file_change` -- A file was modified by the AI
- `task:progress` -- Progress update (e.g., "step 2 of 5")

Both the relay path (remote execution) and local execution path emit to this bus. The SSE bridge (`/api/events/stream`) subscribes to both the relay server events and this bus, combining them into a single stream for the browser. This means the browser does not need to know or care whether a task is running locally or remotely -- it receives the same events either way.

### How Events Flow End-to-End

The following diagram shows the complete path an event takes from an Agent Runner on a user's machine all the way to the browser, and the side effects triggered along the way:

```
┌──────────────────────────────────────────────────────────────────┐
│  EVENT FLOW: From Agent Runner to Browser                        │
│                                                                  │
│  Agent Runner                                                    │
│  (produces events: text, tool_use, file_change, result)          │
│       │                                                          │
│       │ WebSocket messages                                       │
│       ▼                                                          │
│  Relay Server (EventEmitter)                                     │
│       │                                                          │
│       ├──► executionEventBus ──► /api/events/stream (SSE)        │
│       │                              │                            │
│       │                              ▼                            │
│       │                         Browser (EventSource)             │
│       │                              │                            │
│       │                              ├──► realtime-store          │
│       │                              └──► execution-store         │
│       │                                                          │
│       └──► AstroEventTransport (8+ hooks)                        │
│                 │                                                 │
│                 ├──► SSE notification (push to browser)           │
│                 ├──► Audit log (record user actions)              │
│                 ├──► Usage metrics (track cost/tokens)            │
│                 ├──► PR creation (auto-create GitHub PRs)         │
│                 ├──► Git pull (auto-commit changes)               │
│                 ├──► Channel notification (Slack/Linear)          │
│                 └──► Observability (structured tracing)            │
└──────────────────────────────────────────────────────────────────┘
```

The two branches from the Relay Server serve different purposes. The `executionEventBus` path carries real-time task output to the browser so users can watch progress. The `AstroEventTransport` path triggers side effects that do not need to be shown in real-time but are important for the system's operation -- logging, metrics, integrations, and observability.

---

## 7. Dispatch System

The dispatch system is the Backend's traffic controller for task execution. It decides when tasks are ready to run, where to run them, and what to do with the results.

### 7.1 Dispatch Engine (`server/lib/dispatch/dispatch-engine.ts`, ~900 lines)

The dispatch engine orchestrates the full lifecycle of task execution. All task execution routes through the relay to agent runners -- the server never runs AI itself.

**Lifecycle:**

1. **Watch** for tasks whose dependencies are all satisfied (all upstream tasks have completed successfully)
2. **Queue** ready tasks by priority (critical > high > normal > low). Higher-priority tasks are dispatched first.
3. **Dispatch** the task through the relay to an Agent Runner, which performs the actual AI work
4. **Stream** events back to the browser via SSE so the user sees real-time progress
5. **Route results**: when a task finishes, update the plan node's status, emit completion events, and trigger any downstream tasks that were waiting on this one
6. **Prune**: when a branch is killed (the user decides to abandon a line of work), cancel the task and all tasks that depend on it, recursively

**Hybrid architecture -- in-memory maps + DB persistence:**

The engine maintains two in-memory Maps that must stay in-memory:

- `activeExecutions` (Map<nodeId, { abortController, executionId, projectId }>) -- Kept in-memory because `AbortController` is a process-local construct that cannot be serialized. Each server instance owns the AbortControllers for executions it is running. Task execution status is separately persisted to the database by the dispatch and route layers.
- `pendingApprovals` (Map<approvalId, { resolve, reject, nodeId, ... }>) -- Kept in-memory because Promise `resolve`/`reject` callbacks cannot be serialized. When a user responds to an approval request, the response must be routed to the specific server instance holding the pending Promise.

**Approval system:**

The engine supports both procedure-level approvals (pause before a step) and dynamic approvals via the `ask_user_question` MCP tool. Dynamic approvals allow the agent to ask the user questions mid-execution without changing node status. Approvals wait indefinitely (no timeout) -- cleanup happens when the user responds or the execution is cancelled.

**Components** (located in `server/lib/dispatch/`, with core logic re-exported from `packages/core/`):

- `DispatchQueue` (`dispatch-queue.ts`) -- A priority-ordered task queue backed by Postgres via Drizzle ORM (`dispatchQueueEntries` table). Manages concurrency limits per project (`maxConcurrentPerProject`, default 5) and globally (`maxConcurrentTotal`, default 20). Supports retry with exponential backoff and jitter. Queue statuses: `pending → ready → queued → dispatched → in_progress → completed|failed|cancelled`.
- `ContextAssembler` (`context-assembler.ts`) -- Builds the full context that the AI needs: the project's vision document + outputs from completed upstream tasks + dependency resolution. Re-exported from `@astro/core`.
- `ResultRouter` (`result-router.ts`) -- Takes the result of a finished task and determines the target node status (`auto_verified`, `completed`, `awaiting_judgment`, etc.) based on verification hints and downstream dependencies. Re-exported from `@astro/core`.
- `BranchManager` (`branch-manager.ts`) -- Tracks which tasks are on which branches. Finds branch structure from the plan graph, identifies downstream nodes, and determines which nodes to cancel/prune when a branch is killed. Re-exported from `@astro/core`.
- `MachineSelector` (`machine-selector.ts`) -- Selects the optimal machine for task dispatch based on configurable policies. Re-exported from `@astro/core`.

### 7.2 Context Assembly

`server/lib/dispatch/context-assembler.ts`:

Before an AI agent starts working on a task, it needs context -- background information about the project and what has already been done. The context assembler gathers this information:

- **Vision doc**: The project's high-level description of what is being built and why. Wrapped in XML delimiters (`<user_vision>...</user_vision>`) for prompt injection protection -- this prevents a malicious vision doc from being interpreted as instructions to the AI.
- **Dependency outputs**: The results from tasks that this one depends on. If task B depends on task A, the AI working on task B gets to see what task A produced.
- **Repo context**: Key files from the repository -- CLAUDE.md (project instructions), README, package.json, and a file tree. This gives the AI an understanding of the codebase structure.

---

## 8. Prompt Templates

`server/lib/prompt-templates.ts` (452 lines):

> **Note:** The plan generation and chat prompts below are assembled server-side. Task execution prompts are assembled in `dispatch.ts` (see section 3.1) with vision doc, dependency outputs, and workspace/delivery instructions, then sent through the relay to the agent runner.

Prompt templates are the instructions we give to the AI. Just as a manager gives different instructions for different tasks ("write a report" vs. "review this code"), the Backend has different prompt templates for different AI interactions. These templates are carefully crafted to produce consistent, high-quality outputs.

### 8.1 Plan Generation Prompt

`buildInteractivePlanPrompt(visionDoc?, repoContext?, options?)`:

This prompt tells the AI how to generate a plan -- a directed graph of tasks and milestones. It uses the Claude Agent SDK with tool-based interaction (the agent calls `save_plan` to commit its plan). Key rules:
- Aim for 6–15 nodes, but this is flexible — use more for complex projects, fewer for simple ones (too few means the plan is too vague; too many means it is too granular)
- Must be a valid DAG (Directed Acyclic Graph -- no circular dependencies, because you cannot have task A depend on task B which depends on task A)
- Top-to-bottom layout for visual clarity
- Node types: `milestone` (a major checkpoint), `task` (a concrete unit of work), `branch` (an alternative approach), `decision` (a point where a human must choose)
- Estimates: XS (<100 lines of code), S (<500 LOC), M (<1000 LOC) -- never larger than M (tasks should be small and focused)
- Milestones have startDate/endDate; tasks have a milestoneId linking them to their parent milestone
- User-provided content is wrapped in `<user_vision>` / `<user_content>` XML delimiters to separate user input from system instructions

### 8.2 Chat Prompt

`buildChatSystemPrompt(visionDoc?, planNodes?, planEdges?)`:

This prompt enables the plan-level chat -- where users can discuss and modify their plan through conversation with the AI.
- Receives the current plan state (all nodes and edges) so the AI knows what already exists
- Supports structured modification blocks that the frontend can parse and apply automatically:
  - `astro-updates` -- modify existing nodes
  - `astro-edges` -- add or modify edges
  - `astro-add-nodes` -- add new nodes
- Decomposition rules: sub-tasks should be orthogonal (not overlapping in scope), ~20 minutes of expert work each, max size M

### 8.3 Task Execution Prompt

`buildTaskExecutionPrompt(context)`:

This prompt is used when dispatching a task to an AI agent for execution. It provides:
- The task title + description (what to do)
- The vision doc (the big picture -- why this task matters)
- Dependency outputs (what upstream tasks produced -- so the AI can build on prior work)
- The working directory (where the code lives)

### 8.4 Task Chat Prompt

`buildTaskChatSystemPrompt(context)`:

This prompt powers task-specific chat, where users can ask questions about a specific task's execution. It injects:
- Task title and description
- The task's execution output (what the AI produced when it ran)
- The vision doc for broader context

---

## 9. Observability

Observability is the ability to understand what happened inside a system after the fact. When an AI agent runs a task, it might make dozens of tool calls, read many files, and produce pages of output. Observability tooling records all of this in a structured way so developers can debug issues, understand AI behavior, and improve prompts.

### 9.1 Observation Collector (`server/lib/observability/observation-collector.ts`)

The observation collector subscribes to the execution event bus (see section 6.2) and captures detailed records of AI behavior. It listens for these events:

- `task:session_init` -- A new AI session started
- `task:tool_trace` -- The AI called a tool (read a file, ran a command, etc.)
- `task:stdout` -- The AI produced text output
- `task:file_change` -- The AI modified a file
- `task:progress` -- Progress update

The collector groups these raw events into **turns** -- a turn is one round of the AI conversation. Each turn becomes a "generation" observation. The turn structure looks like this:

```
Turn 0: [initial context] -> assistant produces text + tool_calls
Turn 1: [tool_results from turn 0] -> assistant produces text + tool_calls
Turn 2: [tool_results from turn 1] -> assistant produces text + tool_calls
...
Turn N: [tool_results from turn N-1] -> final assistant text (no more tool calls)
```

Each turn becomes a "generation observation" with:
- `input`: `{ turnIndex, toolResults }` (what the AI received)
- `output`: `{ text, toolCalls }` (what the AI produced)
- Tool observations are linked as children via `parentObservationId`, creating a tree structure that shows which tools were called during which turn

---

## 10. Environment Configuration

`server/lib/environment.ts` (293 lines):

The Backend's behavior is controlled by environment variables -- settings that are defined outside the code, typically in a `.env` file or in the deployment platform's configuration. This allows the same code to run differently in development (permissive, local database) vs. production (strict security, remote database).

| Variable | Purpose | Default |
|----------|---------|---------|
| `ASTRO_LOCAL_MODE` | Force local mode (PGlite embedded database, no external Postgres). The name is a legacy holdover from when local mode used browser IndexedDB; it now triggers PGlite instead. | Auto-detect based on whether Supabase vars are set |
| `DATABASE_URL` | Postgres connection string (where the database lives) | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `SUPABASE_URL` | Supabase API URL | (none -- if not set, system auto-detects local mode) |
| `SUPABASE_ANON_KEY` | Supabase anonymous key (for unauthenticated API access) | (none) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (for admin-level database access, bypasses Row Level Security) | (none) |
| `RELAY_PORT` | WebSocket relay port (where Agent Runners connect) | 3002 |
| `RELAY_JWT_SECRET` | Secret key used to sign and verify JWT tokens for relay authentication | Test default in dev |
| `DEVICE_AUTH_JWT_SECRET` | Secret key for device authorization access tokens | Test default in dev |
| `DEVICE_AUTH_REFRESH_SECRET` | Secret key for device authorization refresh tokens | Test default in dev |
| `REDIS_URL` | Redis connection URL for horizontal scaling (multiple relay instances sharing state) | (none, optional -- not needed for single-instance local development) |
| `WEBAUTHN_RP_NAME` | WebAuthn relying party name (displayed to users during passkey setup) | `'Astro'` |
| `WEBAUTHN_RP_ID` | WebAuthn domain (must match the domain the app is served from) | `'localhost'` |
| `WEBAUTHN_ORIGIN` | WebAuthn origin URL (full URL including protocol and port) | `'http://localhost:5173'` |
| `CORS_ORIGIN` | Additional CORS origin to allow (beyond the built-in defaults) | (none) |
| `FRONTEND_URL` | Additional CORS origin (alternative to CORS_ORIGIN, used in some deployment configs) | (none) |

**Production validation**: When running in production mode, all JWT secrets must be unique (not sharing the same key, which would be a security vulnerability) and at least 256 bits long (64 hexadecimal characters). This prevents weak secrets that could be guessed or brute-forced.

---

## Addendum: Additional Subsystems (audited 2026-02-27)

This section documents subsystems and infrastructure that complement the main sections above.

### Teams & Collaboration

(`server/routes/teams.ts`, `server/lib/email-service.ts`):
- Team creation, membership management, email-based invitations with tokens
- Team member roles: owner, admin, member
- Database tables: `teams`, `teamMembers`, `inviteTokens`, `projectMembers`

### Channel Notification System

(`server/lib/channel/`):

A multi-channel notification system that routes task events to external platforms:
- `channel-config-manager.ts` -- Manages per-project channel configuration (which events go to which channels)
- `channel-router.ts` -- Routes notifications to the correct platform based on configuration
- `channel-formatter.ts` -- Formats event data into platform-specific message formats for Slack, Linear, and Telegram
- `channel-types.ts` -- Type definitions for channel configuration and messages
- `webhook-verifier.ts` -- Verifies webhook signatures for inbound messages from external platforms

The channel system is integrated via the `channel-notification-hook` on the event transport (section 6.1). When a task completes, fails, or requires approval, the hook checks the project's channel configuration and dispatches formatted notifications.

### Access Control

(`server/lib/access/user-access-control.ts`):
- Global and per-project allowlist/blocklist
- Hierarchical access control rules

### Safety Rails

(`server/lib/observability/safety-rails.ts`):
- Safety guardrails for AI execution, including approval gates and risk assessment

### Additional Library Files

| File | Purpose |
|------|---------|
| `email-service.ts` | Email sending for team invitations |
| `push-notifications.ts` | Browser push notification delivery |
| `github-client.ts` | GitHub API wrapper |
| `repo-context.ts` | Repository context assembly for prompts |
| `repo-setup.ts` | Repository setup utilities |
| `error-utils.ts` | Error handling utilities |
| `execution-event-bus.ts` | Singleton event emitter for task execution events |
| `execution-context-store.ts` | Maps executionId to user/project/machine for SSE scoping |
| `skill-manager.ts` | Skill registry and prompt injection |
| `challenge-store.ts` | WebAuthn challenge storage with TTL |

### Middleware

- `server/middleware/auth.ts` -- Authentication middleware (see section 4.1)
- `server/middleware/audit.ts` -- Audit logging middleware for request tracking
