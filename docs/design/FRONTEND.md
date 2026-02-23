# Astro Frontend -- Design Document

## What Is the Frontend?

The frontend is the part of Astro that runs inside your web browser. When you open Astro in Chrome, Safari, Firefox, or any other browser, everything you see and click on -- the buttons, the project list, the plan graph, the chat panel -- is the frontend. It is a self-contained application that gets downloaded to your browser and then runs locally on your machine.

Technically, it is a **React 19 single-page application** built with **Vite 7**. "Single-page application" means that once the browser loads the initial page, all navigation happens inside that same page without full page reloads -- clicking from the Dashboard to a Project just swaps out the visible content, making the experience feel fast and fluid.

### Why Do We Need a Separate Frontend?

Astro is split into two major halves: the frontend (this document) and the backend (see `BACKEND.md`). This is a deliberate design choice called **separation of concerns**:

- **The frontend** handles everything the user sees and interacts with: rendering the UI, responding to clicks and keystrokes, showing real-time updates, and keeping in-memory state so the app feels responsive.
- **The backend** handles everything that needs to happen "behind the scenes": talking to the AI (Claude), storing data in a database, coordinating task execution across machines, and managing authentication.

Think of it like a restaurant. The frontend is the dining room -- the menus, the tables, the waitstaff who take your order and bring your food. The backend is the kitchen -- the chefs, the pantry, the ovens. Customers interact with the dining room; the kitchen does the heavy lifting. They communicate through a well-defined interface (the order ticket), just as the frontend and backend communicate through API calls.

### How It Fits Into the Bigger Picture

```
  [Your Browser]                    [Astro Server]              [Agent Runners]
  +-----------------+               +---------------+           +---------------+
  | FRONTEND        |  HTTP/SSE     | BACKEND       |  WebSocket| Machines that |
  | (This document) | ------------> | (Hono API)    | --------> | run AI agents |
  | React app       | <------------ | AI, Database  | <-------- | and execute   |
  | Runs in browser |               | Port 3001     |           | tasks         |
  +-----------------+               +---------------+           +---------------+
```

The frontend communicates with the backend over HTTP (for regular requests) and SSE (Server-Sent Events -- explained below). It never talks directly to AI models or databases; the backend acts as the intermediary for all of that.

### Internal Data Flow

Inside the frontend, data flows through a layered architecture. User actions update Zustand stores (in-memory state), which persist to the backend via API calls and receive real-time updates from the server:

```
┌──────────────────────────────────────────────────────────────────┐
│  FRONTEND INTERNAL DATA FLOW                                     │
│                                                                  │
│  User Action (click, type, navigate)                             │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────┐    read     ┌─────────────┐                    │
│  │ React       │ ◄────────── │ Zustand     │                    │
│  │ Component   │             │ Store       │                    │
│  │ (renders UI)│ ──────────► │ (in-memory) │                    │
│  └─────────────┘    write    └──────┬──────┘                    │
│                                     │                            │
│                          ┌──────────┴──────────┐                 │
│                          │ write               │                 │
│                          ▼                     ▼                 │
│                   ┌─────────────┐       ┌──────────┐            │
│                   │ API Call    │       │ SSE      │            │
│                   │ (Hono      │       │ Stream   │            │
│                   │  Backend)  │       │ (events) │            │
│                   │ persist    │       │ receive  │            │
│                   │ via Drizzle│       │ updates  │            │
│                   └──────┬─────┘       └────┬─────┘            │
│                          │                   │                   │
│                          ▼                   │                   │
│                   ┌─────────────┐            │                   │
│                   │ PGlite     │            │                   │
│                   │ (local) or │            │                   │
│                   │ Postgres   │            │                   │
│                   │ (server)   │            │                   │
│                   └─────────────┘   ┌───────▼─────────┐         │
│                                     │ realtime-store  │         │
│                                     │ (machine state, │         │
│                                     │  task streams,  │         │
│                                     │  approvals)     │         │
│                                     └─────────────────┘         │
└──────────────────────────────────────────────────────────────────┘
```

**Entry point**: `src/main.tsx` (where React starts) calls into `src/app.tsx` (where routes and layout are defined).
**Dev server**: `http://localhost:5173` (Vite proxies `/api` requests to `localhost:3001`, meaning any request the frontend makes to `/api/...` gets automatically forwarded to the backend).

---

## 1. Routing -- How URLs Map to Pages

### Why Routing Matters

When you navigate to `https://astro.example.com/projects`, you expect to see a list of projects. When you go to `https://astro.example.com/settings`, you expect to see settings. **Routing** is the system that decides which page to show based on the URL. It is the "table of contents" for the app -- it maps every URL to a specific page component.

All routes are defined in `src/app.tsx` using **React Router v7**, a library that handles this URL-to-page mapping.

### The Route Table

| Path | Page Component | What the User Sees |
|------|---------------|-------------|
| `/` | `dashboard.tsx` | The home screen. Shows stats, pending decisions, active projects, system health, and usage metrics. If the user has no projects yet, it automatically redirects them to `/welcome` so they can get started. |
| `/projects` | `projects.tsx` | A list of all projects in a table view. Columns are sortable, and projects can be grouped. |
| `/projects/new` | `project-new.tsx` | A form for creating a new project. When submitted, it triggers AI plan generation -- the AI looks at the project description and automatically creates a plan of tasks. |
| `/project/:id` | `project-overview.tsx` | The detail page for a single project. The `:id` part is a placeholder -- `/project/abc123` shows project `abc123`. Has overview and updates tabs, plus a dialog for viewing/editing the project's vision document. |
| `/project/:id/plan` | `plan-view.tsx` | The plan graph -- this is one of the most important pages. It shows the project's tasks as an interactive node-and-edge graph. Users can toggle between Graph view (visual), List view (table), and Timeline view (Gantt chart). Also includes a detail panel for the selected node and a chat panel for talking to the AI about the plan. |
| `/project/:id/task/:nodeId` | `task-detail.tsx` | Detailed view of a single task's execution. Shows the terminal output, a timeline of tool calls the AI agent made, file changes, and a chat interface for steering the agent. |
| `/tasks` | `my-tasks.tsx` | A cross-project task list -- all tasks from all projects in one place. Supports filters, grouping, and display customization. |
| `/environments` | `environments.tsx` | Manage the machines and environments where tasks run. Shows connected machines and SLURM clusters (high-performance computing clusters used for scientific workloads). |
| `/agents` | `agents.tsx` | View and monitor AI agents. |
| `/initiatives` | `initiatives.tsx` | Group related projects into higher-level initiatives. |
| `/settings` | `settings.tsx` | Configure the backend connection and choose which AI model to use. |
| `/device` | `device-auth.tsx` | A special page for the device authentication flow (used when registering a new machine to run tasks -- similar to how you authorize a smart TV to access your Netflix account by entering a code on your phone). |
| `/welcome` | `welcome.tsx` | The onboarding experience for new users. Offers two paths: create an empty project, or create a project from an existing code repository. |
| `/login` | `login.tsx` | The login page, using WebAuthn/passkey authentication (the same technology that lets you log into websites with your fingerprint or face). This is a public route -- you do not need to be logged in to see it. |
| `/invite/:token` | `team-invite.tsx` | Team invitation acceptance flow. When a user receives an invite link, this page validates the token and lets them join the team. This is a public route. |

---

## 2. State Management -- How the App Keeps Track of Everything

### What Is "State"?

State is the current data the application is working with at any given moment. For example: the list of projects, which task is selected, whether the sidebar is collapsed, what the user typed into a chat box -- all of this is state.

Managing state well is one of the hardest problems in building a user interface. If different parts of the UI disagree about what the current state is, you get bugs -- a button that shows "running" when the task already finished, a list that does not update when you add an item, and so on.

### What Are Stores?

Astro uses a library called **Zustand** (German for "state") to manage application state. Zustand lets you create **stores** -- think of each store as a dedicated notebook for one topic. The "project store" is the notebook where all project data lives. The "execution store" is the notebook for task execution state. Any part of the UI can read from or write to these notebooks, and when the data changes, every part of the UI that is looking at that data automatically updates.

All stores live in the `src/stores/` directory. There are 27 of them in total, each responsible for a specific domain of data.

### How Data Gets Saved (The Two-Layer Write Pattern)

Every time the user does something that changes data (create a project, rename a task, start an execution), the change goes through two layers. This is a critical pattern to understand:

1. **Zustand store** (immediate, optimistic) -- Like writing on a whiteboard in front of you. The UI updates instantly because it reads from the Zustand store. This is in-memory -- it only lives as long as the browser tab is open. The update is "optimistic," meaning the UI assumes the save will succeed.

2. **API call** (server persistence) -- The data is sent to the Hono backend, which persists it through Drizzle ORM to either PGlite (local mode) or Postgres (server mode). If the API call fails, the optimistic update is reverted in the Zustand store so the UI reflects the true state.

Think of it this way: you write a note on your whiteboard (instant feedback) and simultaneously send it to the filing cabinet (durable storage). If the filing cabinet rejects the note, you erase the whiteboard entry. There is no intermediate local cache -- the backend (PGlite in local mode, Postgres in server mode) is always the source of truth.

### 2.1 DataLoader -- Getting Everything Ready at Startup

Before the user can interact with the app, all the stores need to load their data. This is handled by the `DataLoader` logic embedded in `src/app.tsx` (lines 68-150).

Here is what happens when you open Astro:

```
DataLoader checks: are we in local mode, or is the user authenticated?
  (In local mode: no login needed, proceed immediately)
  (In server mode: wait until auth is initialized and user has a session)

  Then it loads all stores in parallel:
    - projects, plan, settings, user-profile, display-settings,
      usage, task-chats, sessions, initiatives, executions, agent,
      activities, sidebar, plugins, skills, realtime connection

  While loading, the user sees a loading spinner.
  Once every store reports loaded: true, the spinner disappears and the app is ready.
```

Loading in parallel (all at once) rather than sequentially (one after another) makes startup faster -- instead of waiting for each store to finish before starting the next, they all start loading simultaneously.

### Store Dependencies

The stores are not completely independent -- some depend on or trigger actions in others. Understanding these relationships helps trace how a change in one area ripples through the system:

```
┌──────────────────────────────────────────────────────────────────┐
│  STORE DEPENDENCIES                                              │
│                                                                  │
│  project-store ─────► plan-store (cascade delete)                │
│       │                    │                                     │
│       │                    ├──► execution-store (task dispatch)   │
│       │                    │         │                            │
│       │                    │         ├──► realtime-store (SSE)    │
│       │                    │         └──► usage-store (metrics)   │
│       │                    │                                     │
│       │                    └──► agent-store (plan generation)     │
│       │                              │                            │
│       └──► initiative-store          └──► settings-store (model)  │
│                                                                  │
│  Independent stores:                                             │
│  • user-profile-store    • display-settings-store                │
│  • task-chat-store       • activity-store                        │
│  • machines-store        • auth-store                            │
└──────────────────────────────────────────────────────────────────┘
```

For example, deleting a project in `project-store` cascades to `plan-store` (removing all nodes and edges for that project). Dispatching a task from the plan triggers `execution-store`, which in turn writes usage metrics to `usage-store` and receives real-time events via `realtime-store`. The `agent-store` reads the selected model from `settings-store` when generating plans.

### 2.2 Core Stores (Detailed)

#### project-store (`src/stores/project-store.ts`, 74 lines)

**What it does**: Manages the list of projects. Every project the user creates, renames, or deletes goes through this store.

**State it holds**:
- `projects: Project[]` -- the array of all projects
- `loaded: boolean` -- whether the store has finished loading from storage

**Where data is saved**: Persisted via API calls to the Hono backend, which writes through Drizzle ORM to PGlite (local mode) or Postgres (server mode).

**Key behavior**: When you delete a project, it also cascades -- meaning it tells the plan store to remove all plan nodes and edges for that project, so you do not end up with orphaned task data. This is done via `usePlanStore.removeProjectPlan()`.

---

#### plan-store (`src/stores/plan-store.ts`, 382 lines)

**What it does**: Manages the plan graph for every project. A "plan" in Astro is a directed graph of tasks -- nodes represent tasks, and edges represent dependencies between them (e.g., "Task B depends on Task A finishing first"). This store holds all of those nodes and edges.

**Why it is 382 lines**: Plan management is complex. Nodes need automatic layout (positioning on screen), edges need deduplication (preventing the same dependency from being added twice), and there is support for soft-delete (marking items as deleted without actually removing them, so they can be recovered).

**State it holds**:
- `nodes: PlanNode[]` -- all task nodes across all projects
- `edges: PlanEdge[]` -- all dependency edges across all projects
- `loaded: boolean`

**Where data is saved**: Persisted via API calls to the Hono backend, which writes through Drizzle ORM to PGlite (local mode) or Postgres (server mode).

**Key behaviors**:
- **Auto-layout**: When nodes are loaded and some are missing position data (x/y coordinates for where to draw them on the graph), the store automatically calculates positions using `layoutGraph()`.
- **Edge deduplication**: On load and when adding new edges, duplicates are filtered out.
- **Soft-delete**: Nodes and edges have `deletedAt` and `deletionActionId` fields. The helper function `isLive(item)` filters out deleted items so the UI only shows active ones. This enables undo/recovery.
- **Data recovery**: The store fetches the authoritative data from the API on load. The backend (PGlite or Postgres) is always the source of truth.

---

#### agent-store (`src/stores/agent-store.ts`, 480 lines)

**What it does**: Manages AI generation sessions -- the process of the AI creating or modifying a project plan. When you click "Generate Plan" and the AI starts streaming back a plan, this store coordinates the entire process.

**State it holds**:
- `sessions: Map<string, GenerationSession>` -- one entry per active generation session, keyed by project ID
- `loaded: boolean`

**Where data is saved**: These are ephemeral (short-lived) -- they live only in the Zustand store in memory because generation sessions are only relevant while they are happening. They are not persisted to the backend.

**Key behaviors -- the Plan Generation Flow**:

This is one of the most important workflows in Astro. Here is what happens step by step when the AI generates a plan:

1. An `AbortController` is created (this is the browser's way of providing a "cancel" button -- if the user wants to stop generation, the AbortController signals the request to stop).
2. The frontend calls `generatePlan()`, which sends a request to the backend and opens an SSE (Server-Sent Events) stream. **SSE is a way for the server to push real-time updates to the browser** -- imagine a news ticker where new items keep appearing as they are generated, rather than the browser having to repeatedly ask "is there anything new yet?"
3. As the AI generates text, `"text"` events arrive through the stream. These get appended to `streamText`, providing a live preview of what the AI is writing.
4. When the AI finishes, a `"plan_result"` event arrives containing the complete plan (nodes and edges) in structured form. The store parses this.
5. Node IDs are prefixed with the first 8 characters of the project ID to ensure global uniqueness (so node "task-1" in project A does not collide with node "task-1" in project B).
6. Milestones are auto-assigned via backward BFS (breadth-first search) through the dependency graph -- essentially, the system walks backward through the dependency chain to figure out which milestone each task belongs to.
7. The plan is saved to the plan store via `usePlanStore.setProjectPlan()`.
8. The graph layout is reorganized so nodes are positioned neatly via `reorganizeProject()`.
9. Sessions are automatically deleted after 5 minutes of completion to avoid clutter.

---

#### execution-store (`src/stores/execution-store.ts`, 1566 lines)

**What it does**: Manages task execution -- the process of AI agents actually doing work (writing code, running tests, analyzing data). This is the largest and most complex store because task execution involves many moving parts: tracking running tasks, processing streams of output, handling approvals, managing batch execution, and more.

**Why it is so large**: Task execution is the heart of Astro's functionality. A single task execution can produce hundreds of events (terminal output, tool calls, file changes, progress updates), and the store needs to handle all of them, plus manage multiple simultaneous executions, plus handle error cases, plus support batch execution of entire projects.

**State it holds**:
- `executions: Map<string, TaskExecution>` -- one entry per actively-executing node, keyed by node ID. Contains all output, tool traces, file changes, and metrics for that execution.
- `providers: ProviderStatus[]` -- which AI providers are available (e.g., Claude Code, Codex) and their status (installed, authenticated, capabilities).
- `machines: MachineInfo[]` -- the list of connected machines (computers) that can run agent tasks.
- `batchExecutions: Map<string, BatchExecution>` -- state for batch executions (running many tasks at once).
- `pendingApprovals: Map<string, ApprovalRequest>` -- when an AI agent needs a human decision ("Should I delete this file?"), the approval request lives here until the user responds.

**The Execution Flow (lines 325-509)** -- step by step, what happens when a user clicks "Execute" on a task:

1. **Validate**: The store checks that the node exists, is not already executing, and all of its dependency tasks have completed. It also checks that a working directory is configured (the agent needs to know where to run).
2. **Resolve environment**: Determines which machine and provider to use, considering both per-task overrides and project-level defaults.
3. **Build dependency context**: Gathers the output/results from all completed upstream tasks. For example, if Task B depends on Task A, the system collects Task A's results so Task B's agent has that context.
4. **Dispatch**: Sends a POST request to `/api/dispatch/task` and opens an SSE stream to receive real-time updates.
5. **Process events as they arrive**:
   - `init` -- The execution has been assigned an ID and is now running. The store sets `executionId` and marks status as "running."
   - `text` -- A chunk of terminal output from the agent. Appended to `streamText` so the user can watch the agent work in real-time (like watching someone type in a terminal).
   - `tool_use` -- The agent is calling a tool (e.g., reading a file, running a command). Added to the tool traces timeline.
   - `tool_result` -- The tool call finished and produced a result. The corresponding tool trace entry is updated.
   - `file_change` -- The agent modified a file. Added to the file changes list.
   - `result` -- The execution finished. The store updates the node's status, accumulates usage metrics (tokens used, cost, duration), refreshes the file tree cache, and if we are in batch mode, triggers the next wave of tasks.
   - `error` -- Something went wrong. The node is set to `awaiting_judgment` status so a human can decide what to do.

**Batch Execution (lines 637-672, 1487-1540)**:

Batch execution lets users run an entire project's plan automatically, respecting dependencies:

1. `executeAllProject()` finds all nodes with "planned" status whose dependencies have all been met (completed successfully).
2. All ready nodes are dispatched in parallel -- if three tasks can run at the same time, they do.
3. Whenever a task completes, the system checks: "Did that completion unblock any other tasks?" If yes, those newly-ready tasks are dispatched immediately.
4. The batch is considered finished when all dispatched tasks are done and no more planned tasks have their dependencies met.

This is like a domino chain -- tasks cascade automatically based on the dependency graph.

---

#### realtime-store (`src/stores/realtime-store.ts`, 772 lines)

**What it does**: Handles real-time events coming from the server. While the execution-store handles tasks that the user dispatches directly from the browser, the realtime-store handles events from tasks running on remote machines (via the relay server), machine status updates, and approval requests.

Think of this store as the "message center" -- it listens to a constant stream of updates from the server and routes each message to the right place.

**State it holds**:
- `connected: boolean` -- whether the EventSource connection to the server is alive.
- `machines: Map<string, MachineEntry>` -- connected machines and their status.
- `activityFeed: ActivityEvent[]` -- the last 50 events (like a rolling activity log).
- `taskStreams: Map<string, TaskStream>` -- per-task output buffers for relay-dispatched tasks. Each buffer accumulates stdout, tool traces, and file changes.
- `dynamicApprovals: Map<string, DynamicApprovalRequest>` -- when an agent running on a remote machine needs a human decision, the approval dialog information is stored here.

**How it works**: The store opens an `EventSource` connection to `/api/events/stream`. **EventSource is a browser API for receiving Server-Sent Events (SSE)** -- a persistent connection where the server can push messages to the browser at any time, without the browser having to ask. It handles 30+ event types:

- **Machine events**: `machine:connected`, `machine:disconnected` -- a machine came online or went offline.
- **Task events**: `task:stdout`, `task:text`, `task:progress`, `task:result`, `task:tool_trace`, `task:file_change` -- real-time updates from running tasks.
- **Session events**: `session:attached`, `session:detached`, `session:event` -- an agent session connected to or disconnected from a task.
- **Approval events**: `approval:requested`, `task:approval_request` -- an agent is asking for human input.

---

#### settings-store (`src/stores/settings-store.ts`, 73 lines)

**What it does**: Stores application settings -- which AI model to use, which provider is the default, and whether the backend connection is healthy.

**State it holds**:
- `model: string` -- the selected AI model (default: `"claude-sonnet-4-5-20250929"`)
- `defaultProvider: string` -- the default AI provider to use for task execution
- `connectionStatus: string` -- whether the backend is reachable

---

#### task-chat-store (`src/stores/task-chat-store.ts`, 226 lines)

**What it does**: Manages chat conversations tied to individual tasks. Each task node in a plan can have its own chat session where the user discusses that specific task with the AI. This store tracks those conversations, including multi-turn continuity via `sessionId` (so the AI remembers what was said earlier in the conversation).

**State it holds**:
- `sessions: Map<string, TaskChatSession>` -- one chat session per plan node, keyed by node ID.

---

#### Other Stores

These stores handle more focused concerns:

- **`user-profile-store`** -- User identity information (name, email), domain expertise, experience level, and API keys. This helps the AI tailor its communication and plan generation.
- **`usage-store`** -- Accumulated session metrics: how much AI usage has cost (in dollars), how many tokens have been consumed, how many tasks have been executed. Useful for budgeting and monitoring.
- **`activity-store`** -- A history of activity events across the app (up to 1000 events), like a detailed audit log of what happened and when.
- **`display-settings-store`** -- Per-view display preferences. For example, on the task list page, should tasks be grouped by project or by status? Should they be sorted by due date or priority? These preferences persist across sessions.
- **`machines-store`** -- The list of registered machines (computers) that have been authenticated to run tasks. Supports fetching the list, revoking access, and renaming machines.
- **`initiative-store`** -- Groups related projects into initiatives (higher-level organizational units).
- **`auth-store`** -- Manages the Supabase authentication session (login state, tokens). Completely skipped in local mode since there is no authentication.
- **`slurm-store`** -- State for HPC (High-Performance Computing) clusters. SLURM is a job scheduler used in scientific computing environments -- this store tracks cluster status, jobs, and queue information.
- **`session-store`**, **`observation-store`**, **`plugin-store`**, **`skill-store`**, **`sidebar-store`**, **`github-store`**, **`connected-accounts-store`** -- Additional stores for session management, observability traces, plugin integrations, skill definitions, sidebar UI state, GitHub integration, and connected third-party accounts.
- **`api-keys-store`** -- Manages encrypted API keys for AI providers (Anthropic, Bedrock, etc.).
- **`team-store`** -- Team management: team creation, membership, invitation state. Used in multi-user server mode.
- **`toast-store`** -- Toast notification state (success/error/info messages displayed as transient popups).
- **`keyboard-nav-store`** -- Keyboard navigation state for accessible UI traversal (arrow keys, vim-style bindings).
- **`ui-store`** -- General UI state (sidebar collapsed, command palette open, active view). Separate from `sidebar-store`.

**Total: 27 stores.**

---

## 3. API Client -- How the Frontend Talks to the Backend

### Why We Need an API Client

The frontend cannot directly access the database or call AI models -- it runs in the user's browser, which is a sandboxed environment. So whenever it needs data from the server or wants to trigger an action (like generating a plan), it sends an HTTP request to the backend. The **API client** (`src/lib/api-client.ts`, ~360 lines) is the module that encapsulates all of these requests, providing typed functions so the rest of the frontend code does not need to know the details of URL paths, HTTP methods, or request formatting.

Think of the API client as the frontend's "phone" for calling the backend. Instead of every component having to know the backend's phone number (URL) and speak its language (HTTP protocol), they just call a function like `generatePlan()` and the API client handles the rest.

### 3.1 SSE-Based Endpoints (Streaming)

Some operations take a long time (generating a plan, executing a task) and produce incremental results. For these, Astro uses **Server-Sent Events (SSE)** -- a way for the server to push real-time updates to the browser as they happen, like a live sports scoreboard that updates without you needing to refresh the page.

| Function | Endpoint | What It Does |
|----------|---------|---------|
| `generatePlan()` | POST `/api/agent/generate-plan` | Asks the AI to create a project plan. The server streams back text chunks as the AI generates them, then sends the final structured plan. Callbacks: `onText` (each chunk), `onPlanResult` (the finished plan), `onError`, `onDone`. |
| `chatWithAgent()` | POST `/api/agent/chat` | Plan-level conversation with the AI. Supports multi-turn via `sessionId` (so the AI remembers previous messages in the conversation). |
| `chatWithTask()` | POST `/api/agent/task-chat` | Task-level conversation with the AI, including execution context (what the task has done so far). |
| `dispatchTask()` | POST `/api/agent/dispatch` | Dispatches a task for execution directly (bypassing the dispatch queue). Returns a stream of execution events. |

All SSE functions accept an `AbortSignal` for cancellation -- this is how the "Cancel" button works. When the user clicks cancel, the AbortSignal tells the browser to drop the connection, and the backend cleans up.

Parsing of the SSE event streams is handled inline within `api-client.ts` using the streaming fetch API and text decoding. SSE responses are parsed line by line as `data:` events arrive.

### 3.2 REST Endpoints (Request-Response)

For simpler operations that return a result immediately:

| Function | Endpoint | What It Does |
|----------|---------|---------|
| `getProviders()` | GET `/api/agent/providers` | Retrieves the list of available AI providers and their status (installed? authenticated? what capabilities?). |
| `redetectProviders()` | POST `/api/agent/providers/detect` | Tells the backend to re-scan for available AI providers. Useful if you just installed a new provider. |
| `fetchTraceObservations()` | GET `/api/observations/{traceId}` | Fetches detailed trace data for a specific execution, in a format compatible with Langfuse (an observability tool). Used for debugging what an AI agent did and why. |
| `fetchTraceStats()` | GET `/api/observations/stats` | Fetches aggregate execution statistics (total tokens, cost, duration). |

### 3.3 Authentication

How does the backend know who is making a request?

The function `authHeaders()` handles this. In **server mode** (multi-user), it extracts the Supabase session token (a cryptographic proof of identity) and includes it in the request as `Authorization: Bearer <token>`. The backend verifies this token to identify the user and enforce permissions.

In **local mode** (single-user, no login), no token is sent. Optionally, an `X-User-Id` header is used for per-browser isolation (so different browsers on the same machine can have separate data).

---

## 4. Key UI Components -- What the User Sees and Interacts With

### Why Components?

The frontend is built from **components** -- reusable, self-contained pieces of UI. A button is a component. A dialog box is a component. The entire plan graph is a component made of smaller components. This modularity means we can build complex interfaces from simple building blocks, and when we fix a bug in a building block, every place that uses it gets the fix.

### 4.1 Plan Graph (`src/components/plan-graph/`)

This is the centerpiece of Astro's UI -- the visual plan editor where users see their project as an interactive graph of tasks.

**React Flow** is the library powering this. It is a specialized library for drawing interactive node-and-edge graphs in the browser -- the kind where you can drag nodes around, zoom in and out, and draw connections between them.

- **`plan-canvas.tsx`** -- The canvas itself. Wraps React Flow with a `ReactFlowProvider` (required for React Flow's internal state management), adds a background grid, and provides controls (zoom buttons, fit-to-screen). Also handles the popover that appears when you click "+" to create a new node.

- **`task-node.tsx`** -- The visual representation of a single task in the graph. Each node is color-coded by status (blue for in-progress, green for completed, red for errored, etc.), shows a live progress indicator when the task is executing, and has a hover "+" button for adding child tasks directly from the graph.

- **`plan-graph-tab.tsx`** -- The graph view tab, which includes the canvas plus a node editor panel that opens when you select a node.

- **`plan-timeline-tab.tsx`** -- The Gantt timeline view. Instead of showing tasks as a graph, it shows them on a horizontal timeline, making it easy to see scheduling, overlap, and duration. Similar to project management tools like MS Project or Asana's timeline view.

### 4.2 Task Detail (`src/components/task-detail/`)

When you drill into a specific task, you see its full execution history. These components render that detail view:

- **`task-output-view.tsx`** -- A terminal-style output viewer. It shows the raw text output from the AI agent, just like you would see in a command-line terminal. Includes search (to find specific text in long output), copy (to grab the output), and auto-scroll (to follow the latest output as it streams in).

- **`tool-trace-view.tsx`** -- A vertical timeline showing every tool call the AI agent made. A "tool call" is when the agent uses a capability like "read file," "run command," or "search code." Each entry in the timeline shows what tool was called, with what inputs, and what the result was. Entries are collapsible so you can expand only the ones you care about.

- **`file-changes-view.tsx`** -- A list of every file the AI agent created, modified, or deleted, with diff display (showing exactly what lines were added or removed, similar to a Git diff).

- **`steer-chat.tsx`** -- A chat interface for "steering" a running agent. If you see the agent going in the wrong direction, you can type a message here to give it guidance without stopping the execution. Like a co-pilot giving course corrections to the pilot.

- **`task-chat.tsx`** -- A general chat interface tied to this task. Unlike steer-chat (which is for real-time guidance during execution), task-chat is for discussing the task at any time -- before, during, or after execution.

- **`session-activity-view.tsx`** -- A unified timeline that merges all activity for a session: text output, tool calls, file changes, chat messages, and errors, all in chronological order. Gives a complete narrative of what happened.

### 4.3 Execution Panel (`src/components/execution/`)

- **`execution-panel.tsx`** -- The UI for controlling task execution. Shows play/cancel buttons, the live output stream, and information about which AI provider and machine are being used. This is the "control center" for a running task.

- **`provider-status.tsx`** -- Displays which AI providers are available and their status as colored badges (green = available, red = unavailable, yellow = needs authentication).

### 4.4 Agent Chat (`src/components/agent/`)

- **`generation-toasts.tsx`** -- Toast-based notifications during AI plan generation. Displays streaming progress so the user can watch the plan being created in real-time without blocking the UI with a modal overlay.

- **`chat-panel.tsx`** -- A sidebar chat panel for refining the plan through conversation. The user can ask the AI to modify the plan, and the AI responds with both explanatory text and structured plan modifications that get applied automatically.

---

## 5. Data Flow -- Key User Journeys Step by Step

These sections trace exactly what happens in the system for the most common user actions, from the moment the user clicks a button to the final state change.

### 5.1 Create Project and Generate Plan

This is the first thing most users do: create a project and let the AI generate an initial plan. The project creation form (`project-new.tsx`) is a single unified page that combines project description, directory configuration, repository URL, reference repos, environment selection, and an optional first task -- all in one place.

**The Unified Form**

The form contains the following sections, presented top-to-bottom:

1. **Project description** (required) -- A textarea where the user describes what they are building. Supports voice input via `VoiceInputButton`.
2. **Project directory** (optional) -- A text input for the local or remote path. As the user types, the `useDirectoryDetection` hook debounces calls to `GET /api/repo/detect` and shows inline feedback below the input:
   - If the directory does not exist: "Directory will be created with git initialized."
   - If it is a git repo with a GitHub/GitLab/Bitbucket remote: "Git repo detected (GitHub). PRs will be created for review."
   - If it is a git repo with no remote: "Local git repo (no remote). Changes saved as local branches."
   - If it exists but is not a git repo: "No git history. Initialize Git recommended for safe parallel execution."
   The delivery mode (`pr`, `push`, `branch`, `direct`) is derived automatically from the detection result using `deriveDeliveryMode()` from `project-source.ts`.
3. **Repository URL** (collapsed by default) -- Click "+ Add repository URL" to expand. Supports manual URL entry or browsing connected GitHub repos via the GitHub integration.
4. **Reference repos** (collapsed by default) -- Click "+ Add reference code" to expand. Users can add multiple read-only reference repository URLs that agents can read but will not modify.
5. **First task** (optional) -- A text input for an initial task node to seed the plan with. Used only in the non-AI path.
6. **Environment selector** -- In local mode, a dropdown to choose local/remote/HPC/cloud environment type plus machine selector. In server (multi-tenant) mode, shows registered machines as selectable cards with online/offline status.

**Two Creation Paths**

The form offers two submit buttons:

- **"Create & Generate Plan"** (primary) -- The AI path. Creates the project, navigates to the graph view, runs `useRepoSetup.setupRepo()` to clone/detect the repository, then calls `startGeneration()` to kick off AI plan generation via SSE.
- **"Create Project"** (secondary) -- The manual path. Runs repo setup first, creates the project with the resolved directory, optionally adds a first task node, then navigates to the list view.

**AI Path Flow (step by step)**

```
User fills out the unified form and clicks "Create & Generate Plan"
  |
  v
A Project object is created with a random UUID, a color, an icon, and
all form fields (description, sourceDirectory, repository, environment, etc.)
  |
  v
addProject() writes to the Zustand store (optimistic) and Hono backend (persistent)
  |
  v
The browser navigates to /project/{id}/graph (the plan graph view)
  |
  v
useRepoSetup.setupRepo() is called:
  - POSTs to /api/repo/setup with project details
  - The backend clones the repo (if URL provided), detects git state,
    builds a file tree, and extracts key files (CLAUDE.md, README, package.json)
  - If the directory exists but has no git: a GitInitDialog prompts the user
  - On success: updates the project with resolved sourceDirectory, repository,
    structured source object, and deliveryMode
  |
  v
startGeneration() is called in the agent-store with repo context:
  - workingDirectory, fileTree, keyFiles, and targetMachineId are passed in
  |
  v
POST /api/agent/generate-plan is sent to the backend, opening an SSE stream
  |
  v
"text" events arrive one by one as the AI generates content
  -> Each chunk is appended to streamText (the user sees a live preview
     of the AI's reasoning as it builds the plan)
  |
  v
A "plan_result" event arrives with the final structured plan (nodes and edges)
  -> The store parses the JSON into PlanNode[] and PlanEdge[]
  |
  v
Node IDs are prefixed with projectId[:8] for global uniqueness
  (e.g., "abc12345-task-1" instead of just "task-1")
  |
  v
Milestones are auto-assigned via backward BFS:
  The system walks backward through the dependency graph to group tasks
  under the appropriate milestone
  |
  v
usePlanStore.setProjectPlan() saves all nodes and edges
  |
  v
reorganizeProject() calculates a neat visual layout for the graph
  |
  v
The user sees a complete, interactive plan graph they can explore and modify
```

### 5.2 Execute a Task

This is what happens when a user clicks "Execute" on a task node to have an AI agent work on it.

```
User clicks "Execute" on a plan node
  |
  v
The execution-store runs validation:
  - Does this node exist?
  - Is it already executing? (Prevent double-execution)
  - Have all dependency tasks completed? (Can't build the roof before the walls)
  - Is a working directory configured? (The agent needs to know where to work)
  |
  v
Environment resolution:
  - Check for per-task overrides (user specified a particular machine for this task)
  - Fall back to project-level defaults
  |
  v
Build dependency context:
  - Gather the output and results from all completed upstream tasks
  - This context is injected into the agent's prompt so it knows what already happened
  |
  v
POST /api/dispatch/task is sent to the backend, opening an SSE stream
  |
  v
Events arrive as the agent works:

  "init" event:
    -> The execution gets assigned an ID
    -> Status is set to "running"
    -> The UI shows the task as active

  "text" events (many of these):
    -> Each chunk is appended to the terminal output
    -> The user watches the agent work in real-time

  "tool_use" events:
    -> The agent is calling a tool (reading a file, running a command, etc.)
    -> A new entry appears in the tool traces timeline

  "tool_result" events:
    -> A tool call finished and returned a result
    -> The corresponding timeline entry is updated with the result

  "file_change" events:
    -> The agent modified, created, or deleted a file
    -> The change appears in the file changes list

  "result" event (task completed):
    -> The node's status is updated (completed, awaiting_judgment, etc.)
    -> Usage metrics are accumulated (tokens used, cost, duration)
    -> The file tree cache is refreshed to reflect any new/changed files
    -> An execution summary is requested (fire-and-forget)
    -> If this task was part of a batch execution: the system checks for
       newly-unblocked tasks and dispatches the next wave automatically

  "error" event (something went wrong):
    -> The node status is set to "awaiting_judgment"
    -> The user can review the error and decide what to do
```

### 5.3 Plan-Level Chat

This is what happens when the user has a conversation with the AI about the plan as a whole (not a specific task).

```
User types a message in the chat panel and presses Enter
  |
  v
chatWithAgent() is called with:
  - message: what the user typed
  - sessionId: identifier for conversation continuity (so the AI remembers context)
  - projectId: which project we're discussing
  - visionDoc: the project's vision document (gives the AI strategic context)
  - planNodes and planEdges: the current state of the plan
  - messages: previous messages in this conversation
  |
  v
POST /api/agent/chat is sent to the backend, opening an SSE stream
  |
  v
"text" chunks arrive as the AI generates its response
  -> Each chunk is appended to the conversation display in real-time
  |
  v
"done" event arrives, marking the end of the response
  -> The sessionId is extracted for use in the next message (multi-turn continuity)
  |
  v
If the AI's response contains plan modification blocks:
  (The AI can include structured instructions to change the plan,
   wrapped in special tags like astro-updates, astro-edges, astro-add-nodes)
  |
  v
These modification blocks are parsed and applied:
  - astro-updates: modify existing nodes (rename, change status, etc.)
  - astro-edges: add or remove dependency edges
  - astro-add-nodes: create entirely new task nodes
  |
  v
The plan store is updated, and the graph view reflects the changes immediately
```

### 5.4 Relay-Dispatched Task (Remote Machine)

This is what happens when a task runs on a remote machine (not the local development server) and events flow back through the relay server.

```
A task is dispatched to a remote machine via the relay server
  (The relay server is a WebSocket hub that brokers communication
   between the Astro platform and agent runners on user machines)
  |
  v
The relay server broadcasts execution events via /api/events/stream (SSE)
  -> The browser's EventSource connection receives these events
  |
  v
The realtime-store processes each event by type:

  "task:stdout" -> Appended to taskStreams[taskId].stdout
    (The user sees terminal output from the remote machine)

  "task:tool_trace" -> Added to the tool traces array
    (Tool call timeline updates)

  "task:file_change" -> Added to the file changes array
    (File modification list updates)

  "task:result" -> Updates the plan node status
    (The graph shows the task as completed/failed)

  "task:approval_request" -> Shows an approval dialog
    (The remote agent is asking the user a question,
     like "This will delete 50 files. Proceed?")
  |
  v
If the user received an approval request:
  -> The user reviews the question and responds (approve/deny/provide input)
  -> respondToDynamicApproval() sends a POST to /api/dispatch/approval
  -> The answer is forwarded back through the relay to the agent runner
  -> The agent continues (or stops) based on the user's response
```

---

## 6. Persistence Strategy -- How Data Survives

### Why Persistence Matters

If the app only kept data in memory (the Zustand store), everything would be lost the moment you closed the browser tab. Persistence means saving data to durable storage so it survives page reloads, browser restarts, and even switching computers.

### 6.1 The Write Pattern (Two-Layer Save with Optimistic Updates)

Every time the user changes something, the data flows through two layers:

```
User action (click a button, type text, drag a node)
  |
  v
Layer 1: Zustand state update (immediate, optimistic)
  The in-memory store is updated right away.
  The UI re-renders instantly to reflect the change.
  This is an "optimistic update" -- the UI assumes the save will succeed.
  |
  v
Layer 2: API call to Hono backend (async)
  The data is sent via fetch('/api/...') to the Hono backend.
  The backend writes it through Drizzle ORM to the database:
    - In local mode: PGlite (Postgres compiled to WASM, runs in-process)
    - In server mode: Postgres (external database via postgres-js)
  |
  v
If the API call fails:
  The optimistic update is reverted in the Zustand store.
  The store's `error` field is set with a descriptive message.
  The UI reflects the true server state.
```

Why two layers? **Speed and simplicity.** Layer 1 makes the UI feel instant. Layer 2 ensures data is durably persisted. The backend is always the single source of truth -- there is no intermediate browser-side cache. Both local mode (PGlite) and server mode (Postgres) use the exact same API endpoints and Drizzle ORM schema, so the frontend code is identical regardless of deployment mode.

### 6.2 The Load Pattern (How Data Is Restored at Startup)

When the app starts up, each store needs to load its initial data. The pattern is uniform across all stores:

```
Store.load():

  set({ loading: true, error: null })

  try:
    data = await fetch('/api/...')       // Ask the Hono backend for the data
    set({ data, loading: false })        // Populate the Zustand store
  catch (err):
    set({ loading: false, error: err.message })  // Surface the error to the UI
```

The load pattern is the same in both local and server mode -- the frontend always fetches from the API. In local mode, the Hono backend reads from PGlite (an in-process Postgres running in WASM). In server mode, it reads from an external Postgres database. The frontend does not need to know or care which backend database is in use.

**Store state fields**: Every store now includes `loading: boolean` and `error: string | null` fields. Components can use these to show loading spinners, error messages, or retry prompts as appropriate.

### 6.3 Persistence via Drizzle ORM

All data persistence is handled through the Hono backend using **Drizzle ORM**. The frontend does not interact with any browser-side database. Instead, each store calls API endpoints (e.g., `fetch('/api/projects')`, `fetch('/api/plan/nodes')`) and the backend handles reading from and writing to the database.

The Drizzle schema defines tables for projects, plan nodes, plan edges, executions, settings, user profiles, task chats, usage metrics, activities, display settings, and more. The same schema is used for both PGlite (local mode) and Postgres (server mode), ensuring data compatibility across environments.

This approach eliminates the complexity of keeping a browser-side cache in sync with the server. The backend is the single source of truth, and the frontend always reflects what the backend has stored.

---

## 7. Types -- The Shape of the Data

### Why Types Matter

Astro uses TypeScript, which means every piece of data has a defined "shape" -- a type that says what fields it has and what kind of data each field holds. This prevents a whole class of bugs (like trying to read a field that does not exist, or passing a number where a string is expected). Types are like contracts: they guarantee that when you receive a `Project` object, it will always have an `id`, a `name`, a `description`, and so on.

All shared types are defined in `src/types/index.ts` (365 lines). Here are the key ones:

- **`Project`**: Represents a user's project. Fields include: `id`, `name`, `description`, `visionDoc` (the strategic document injected into every AI session), `workingDirectory` (where the code lives on disk), `repository` (Git URL), `fileTree` (cached directory listing), `defaultEnvironment`, `defaultMachineId`.

- **`PlanNode`**: A single node in the plan graph. This is one of the most important types. Fields include: `id`, `projectId`, `type` (one of: milestone, task, branch, decision), `title`, `description`, `status` (one of: planned, dispatched, in_progress, auto_verified, awaiting_approval, awaiting_judgment, completed, pruned), `dependencies` (list of node IDs this task depends on), `environment`, `verification` (how to verify the task succeeded), `position` (x/y coordinates on the graph canvas), execution metadata (executionId, output, error, timestamps), PR metadata (for tasks that create pull requests), and soft-delete fields (deletedAt, deletionActionId).

- **`PlanEdge`**: A connection between two nodes in the plan graph. Fields: `source` (the node ID the edge comes from), `target` (the node ID the edge goes to), `type` (either "dependency" meaning "B depends on A" or "branch" meaning "B is an alternative exploration path from A").

- **`TaskExecution`**: The full state of a running or completed task execution. This is a rich type containing: `executionId`, `status`, `streamText` (the accumulated terminal output), `toolTraces` (array of tool call records), `fileChanges` (array of file modification records), `activityEvents` (timeline of everything that happened), `metrics` (usage data), `subroutineProgress` (progress of sub-steps), `planTodos` (things the agent plans to do), `planQuestions` (things the agent wants to ask about).

- **`TaskActivityEvent`**: A union type (meaning it can be one of several shapes) representing a single event in the execution timeline. Variants include: text (output), tool_use (agent called a tool), tool_result (tool returned a result), steer (user sent guidance), chat (conversation message), file_change (file was modified), error (something went wrong).

- **`UsageMetrics`**: Tracks resource consumption for an execution. Fields: `durationMs` (how long it took in milliseconds), `inputTokens` (how many tokens were sent to the AI), `outputTokens` (how many tokens the AI generated), `estimatedCostUsd` (estimated cost in US dollars), `model` (which AI model was used), `turnsUsed` (how many back-and-forth turns the agent took).

- **`Session`**: Represents a conversation or execution session. Fields: `id`, `type` (one of: plan-chat, task-chat, steer, execution, plan-generation), `messages` (the conversation history), `status`.

- **`ProviderStatus`**: Describes an AI provider's availability. Fields: `id`, `name`, `installed` (is the provider software present?), `authStatus` (is the user authenticated with this provider?), `available` (is it ready to use?), `capabilities` (what can this provider do?).

See `src/types/index.ts` for the complete type definitions including all fields, optional flags, and nested types. Additional types are modularized into `src/types/observations.ts` (observability/trace types), `src/types/plugin.ts` (plugin system types), and `src/types/skill.ts` (skill system types).

---

## Addendum: Recent Additions (audited 2026-02-21)

This section documents components, pages, hooks, and libraries added since the original document was written. The main sections above remain accurate for the features they describe; this addendum covers what's new.

### New Pages (2)

| Route | Page | Purpose |
|-------|------|---------|
| `/invite/:token` | `team-invite.tsx` | Team invitation acceptance flow (public route) |
| `/workflows` | `workflows.tsx` | Workflow management and automation |

### Routing Changes

- Default route (`/`) now redirects to `/tasks` (My Tasks) instead of Dashboard
- Plan view expanded to multiple sub-routes: `/project/:id/graph`, `/project/:id/list`, `/project/:id/timeline`, `/project/:id/board`, `/project/:id/overview` — all handled by `plan-view.tsx` with view mode switching
- `project-overview.tsx` exists but is no longer used in routing (superseded by plan-view overview mode)

### New Component Directories (6)

| Directory | Purpose |
|-----------|---------|
| `src/components/board/` | Kanban board view (board-view.tsx, board-column.tsx, board-card.tsx) |
| `src/components/command-palette/` | Refactored command palette with sub-components (breadcrumbs, categories, items, quick-actions) |
| `src/components/mobile/` | Mobile-responsive components (status-bar.tsx) |
| `src/components/sharing/` | Import/export features (import-preview-dialog.tsx) |
| `src/components/views/` | Reusable view patterns (filter-select.tsx, item-list-view.tsx, item-timeline-view.tsx) |
| `src/components/task-detail/trace-viewer/` | Observability trace viewer (turn-list, trace-summary-card, tool-call-item, turn-detail) |

### New Top-Level Components (selected)

- `generation-toasts.tsx` — Toast-based plan generation UI (replaced `generation-overlay.tsx`)
- `auth-guard.tsx` — Authentication guard for protected routes
- `color-icon-picker.tsx` — Color and icon selection for projects/initiatives
- `dynamic-approval-dialog.tsx` — Dynamic approval prompts from agents
- `git-init-dialog.tsx` — Git repository initialization dialog
- `github-connect-button.tsx` — GitHub OAuth connection button
- `repo-config-dialog.tsx` — Repository configuration settings
- `session-dialog.tsx` — Session management dialog
- `team-selector-dialog.tsx` — Team selection for multi-user mode
- `plugin-loader.tsx`, `plugin-routes.tsx`, `plugin-settings.tsx`, `plugin-error-boundary.tsx` — Plugin system UI
- `skill-settings.tsx` — Skill configuration panel
- `toast-container.tsx` — Toast notification container

### Custom Hooks (7)

| Hook | Purpose |
|------|---------|
| `use-keyboard-nav.ts` | Keyboard navigation (arrow keys, vim bindings) |
| `use-bar-drag-resize.ts` | Drag-to-resize for panels and sidebars |
| `use-voice-transcription.ts` | Voice input transcription |
| `use-welcome-form-persistence.ts` | Welcome form state persistence across page reloads |
| `use-repo-setup.ts` | Repository setup orchestration: POSTs to `/api/repo/setup`, updates project with resolved source/deliveryMode/fileTree, handles `needsGitInit` prompt via `GitInitDialog`, and exposes `confirmGitInit` for git initialization |
| `use-directory-detection.ts` | Debounced directory detection as the user types a path (calls `GET /api/repo/detect`). Returns `DetectionResult` with `exists`, `isGit`, `remoteType`, `suggestedDeliveryMode`. Used for inline feedback in the project creation form. |
| `use-file-tree-refresh.ts` | Auto-refreshes a project's file tree when stale (>5 min), missing, or targeting a different machine. Fetches from `/api/fs/files` (remote) or `/api/repo/file-tree` (local). Also exports `refreshAllFileTrees()` for bulk refresh after initial project load. |

### New Library Files (16)

| File | Purpose |
|------|---------|
| `api-url.ts` | API URL resolution utilities |
| `color-icon-utils.ts` | Color and icon utility functions |
| `commands.ts` | Command palette command definitions |
| `crypto-utils.ts` | Cryptographic utilities (API key encryption) |
| `data-client.ts` | Server data fetching client |
| `date-utils.ts` | Date manipulation and formatting |
| `git-url-utils.ts` | Git URL parsing (HTTPS, SSH formats) |
| `path-utils.ts` | Path manipulation (getBrowserHostname) |
| `plugin-context.ts` | Plugin execution context |
| `plugin-loader.ts` | Dynamic plugin loading system |
| `project-source.ts` | Project source resolution and delivery mode derivation. Exports: `resolveProjectSource(project)` resolves a `ProjectSource` from legacy project fields; `deriveDeliveryMode(source)` maps git state to `pr`/`push`/`branch`/`direct`; `detectRemoteType(url)` classifies a git URL as `github`/`gitlab`/`bitbucket`/`generic`/`none`; `urlsMatchSameRepo(url1, url2)` normalizes and compares git URLs; `deliveryModeLabel(mode)` and `remoteTypeLabel(type)` return human-readable labels. |
| `realtime-sync.ts` | Supabase realtime data synchronization |
| `skill-loader.ts` | Skill loading and discovery |
| `status-config.ts` | Task status configuration and colors |
| `supabase-client.ts` | Supabase client initialization |
| `app-mode.ts` | Local vs server mode detection |

### New Subsystems

**Plugin System**: Dynamic plugin loading with error boundaries, routes, and settings UI. Plugins can extend the app with custom views and capabilities.

**Skill System**: Skill loading and management for reusable AI capabilities. Skills are discoverable and configurable.

**Team & Collaboration**: Team creation, membership, email invitations, and team-scoped project access. Foundation for multi-user server mode.

**Observability Trace Viewer**: Rich trace visualization with turn-by-turn analysis, tool call inspection, and summary cards.

**Board View**: Kanban-style board view for plan nodes, complementing the existing graph, list, and timeline views.

**Mobile Layout**: Responsive layout with mobile-specific components for smaller screens.
