# Machine Ownership & Team Model

> **Status:** IMPLEMENTED -- Machine registration, user-scoped dispatch, and team visibility
> are live. The `machine_team_shares` join table was added in the multi-team machine sharing
> migration (2026-03-23). This document specifies the ownership model, explains why machines
> are personal, and documents the correct patterns for shared environments.

---

## Table of Contents

- [Core Principles](#core-principles)
- [Machine Registration Flow](#machine-registration-flow)
- [Shared VMs (SSH Access)](#shared-vms-ssh-access)
- [Workspace Filtering](#workspace-filtering)
- [Data Model](#data-model)
- [Dispatch Flow](#dispatch-flow)
- [Team Machine Visibility](#team-machine-visibility)
- [Key Files](#key-files)
- [FAQ](#faq)

---

## Core Principles

Four rules govern how machines relate to users and teams in Astro:

### 1. Machines Are Personal

A machine belongs to the user who registered it via `astro-agent start`. The `registered_machines.userId` column records this owner, and it is set at registration time during the device auth flow. Only that user can dispatch tasks to it.

```
User A runs `astro-agent start` on laptop-01
  --> device auth flow authenticates User A
  --> registered_machines row created with userId = User A
  --> laptop-01 belongs to User A
```

### 2. No Cross-User Dispatch

You cannot dispatch jobs to a teammate's compute. Each user runs their own agent-runner instances. When the backend selects a machine for task execution, it filters candidates to machines owned by the requesting user (plus any machines explicitly shared via team sharing). The `findBestMachine()` function enforces this:

```
candidates = candidates.filter(m =>
  !m.userId || m.userId === userId || m.userId === LOCAL_USER_ID
  || teamSharedMachineIds?.has(m.machineId)
);
```

User-owned machines are sorted first (preferred), and shared machines are used only as fallback.

### 3. Projects Are Team-Scoped

Team members see each other's projects, can fork or copy them, but execution always runs on the dispatching user's own machines. The team context (`X-Team-Id` header) controls which projects, plans, and executions are visible, but it never affects which machines are available for dispatch.

```
                     Team "Acme Corp"
                    ┌─────────────────────────────────────┐
                    │                                     │
                    │  Projects (shared, team-scoped)     │
                    │  ┌──────────┐  ┌──────────┐        │
                    │  │ Project A│  │ Project B│        │
                    │  └──────────┘  └──────────┘        │
                    │                                     │
                    └─────────────────────────────────────┘

       Alice's Machines              Bob's Machines
       (Alice dispatches             (Bob dispatches
        to these only)                to these only)
      ┌──────────────┐             ┌──────────────┐
      │ laptop-01    │             │ workstation-1│
      │ gpu-server-2 │             │ cloud-vm-3   │
      └──────────────┘             └──────────────┘
```

### 4. Team Machine Visibility Is Read-Only

The "Team Machines" section in Environments shows what compute teammates have available. This provides awareness ("Bob has a GPU box connected") but does not grant dispatch rights. Visibility flows through the `machine_team_shares` join table; dispatchability flows through `registered_machines.userId`.

```
Environments page for Alice:
  ┌─────────────────────────────────────────────┐
  │  My Machines                                │
  │  ┌─────────────────────────────────────┐    │
  │  │ laptop-01      connected   macOS    │    │
  │  │ gpu-server-2   connected   Linux    │    │
  │  └─────────────────────────────────────┘    │
  │                                             │
  │  Team Machines (read-only awareness)        │
  │  ┌─────────────────────────────────────┐    │
  │  │ workstation-1  connected   Linux    │    │  <-- Bob's machine
  │  │ cloud-vm-3     offline     Linux    │    │  <-- Bob's machine
  │  └─────────────────────────────────────┘    │
  └─────────────────────────────────────────────┘
```

---

## Machine Registration Flow

```
User runs `astro-agent start` on a machine (laptop, VM, HPC node)
       │
       ▼
Device auth flow authenticates the user
  (OAuth2 Device Authorization Grant, RFC 8628)
       │
       ▼
Machine is registered in `registered_machines` table
  userId = current authenticated user
  hostname, platform, providers = detected from local environment
       │
       ▼
Machine connects to the Relay via WebSocket
  (wss://relay-url, authenticated with device token)
       │
       ▼
Machine appears in the user's Environments page
  Machine Registry (in-memory) tracks the live WebSocket handle
  Database (registered_machines) persists the machine metadata
```

The registration creates a durable record in the database and a live entry in the in-memory machine registry. The durable record survives server restarts and reconnections. The live entry tracks the current WebSocket connection for real-time message routing.

### Multi-Instance Behavior

In a multi-instance deployment (e.g., two Fly.io instances behind a load balancer), each instance maintains its own in-memory registry of the WebSocket connections it owns. Cross-instance dispatch is coordinated via Redis pub/sub. The database `registered_machines` table is the single source of truth for which machines exist; the in-memory registries are ephemeral views scoped to each process.

---

## Shared VMs (SSH Access)

If multiple team members have SSH access to the same VM, **only one person should register it**.

### What Happens If Two Users Register the Same VM

Running `astro-agent start` from two different user accounts on the same VM causes three problems:

1. **Two competing agent processes on the same hardware.** Both processes consume CPU, memory, and disk. Task execution from one agent may interfere with the other (file locks, port conflicts, resource contention).

2. **File system conflicts in working directories.** Both agents may attempt to write to the same git worktrees or working directories. This leads to corrupted checkouts, merge conflicts, and non-deterministic execution results.

3. **Two separate relay connections from the same host.** The relay sees two distinct machines (different machine IDs, different user IDs) that happen to share the same physical hardware. Dispatch to either machine succeeds, but the underlying resource is shared, leading to unpredictable load and performance.

### Correct Approach

One user registers the VM as their machine. If the team needs shared access to that VM's compute:

- **Designate that user's account as the "service account" for that machine.** The service account owns the registration; other team members dispatch to their own machines.

- **Use team machine sharing for awareness.** Share the machine with the team via `machine_team_shares` so teammates can see its status, but dispatch still goes through the owning account.

- **For dedicated shared compute (e.g., an HPC cluster), use a single service account** that registers all nodes. Team members submit work through the Astro UI, which dispatches to the service account's machines via the relay.

---

## Workspace Filtering

The Environments page shows **all machines the current user owns**, regardless of workspace (team) selection.

```
                    Workspace selection
                    (team filter)
                           │
                           ▼
                ┌──────────────────────┐
                │                      │
      ┌─────── │   Affects:           │ ──────────┐
      │         │   - Projects         │           │
      │         │   - Plans            │           │
      │         │   - Executions       │           │
      │         │   - Settings         │           │
      │         └──────────────────────┘           │
      │                                            │
      │         Does NOT affect:                   │
      │         ┌──────────────────────┐           │
      │         │  Machines            │           │
      │         │  (user-scoped,       │           │
      │         │   not team-scoped)   │           │
      │         └──────────────────────┘           │
      │                                            │
      ▼                                            ▼
  Projects for                              Stats cards reflect
  selected team                             user's full machine fleet
```

- **Workspace filtering applies to projects** (team-scoped), **not machines** (user-scoped).
- **Stats cards** (Total Machines, Connected, Active Tasks) reflect the user's full machine fleet across all teams.
- The team switcher changes the default context for project-level operations but never restricts which machines are visible or dispatchable.

---

## Data Model

### `registered_machines` Table

The core machine table. Each row represents one physical machine registered by one user.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `TEXT PK` | Machine identifier (generated at registration) |
| `user_id` | `UUID NOT NULL` | The owner -- the user who registered this machine |
| `team_id` | `UUID` | Legacy column from single-team era. Not used for filtering. Kept for backward compatibility; superseded by `machine_team_shares`. |
| `name` | `TEXT NOT NULL` | Human-readable machine name |
| `hostname` | `TEXT NOT NULL` | OS hostname at registration time |
| `platform` | `TEXT` | Operating system (darwin, linux, win32) |
| `environment_type` | `TEXT` | Machine type (local, cloud, hpc) |
| `providers` | `TEXT[]` | Available agent providers (claude-sdk, codex, etc.) |
| `is_connected` | `BOOLEAN` | Whether a live relay connection exists |
| `is_revoked` | `BOOLEAN` | Whether the machine has been deregistered |
| `metadata` | `JSONB` | Arbitrary key-value metadata |
| `registered_at` | `TIMESTAMP` | When the machine was first registered |
| `last_seen_at` | `TIMESTAMP` | Last heartbeat or connection time |

### `machine_team_shares` Table

Join table for team visibility. Allows a machine to be visible (read-only awareness) to members of multiple teams.

| Column | Type | Description |
|--------|------|-------------|
| `machine_id` | `TEXT NOT NULL` | FK to `registered_machines.id` (CASCADE delete) |
| `team_id` | `UUID NOT NULL` | FK to `teams.id` (CASCADE delete) |
| `shared_at` | `TIMESTAMPTZ` | When the share was created |
| | | **PK**: `(machine_id, team_id)` |

### RLS Policies

Row-Level Security ensures data isolation:

- **`machine_team_shares_select`**: Team members can view shares for their teams.
- **`machine_team_shares_insert`**: Only the machine owner (`registered_machines.user_id = auth.uid()`) can share their machine with a team.
- **`machine_team_shares_delete`**: Only the machine owner can revoke team shares.

### Helper Functions

| Function | Purpose |
|----------|---------|
| `user_can_access_machine(machine_id)` | Returns `true` if the current user owns the machine OR is a member of a team it is shared with |
| `get_user_available_machines(user_id)` | Returns all machines available to a user: owned machines (with `is_team_machine = false`) plus team-shared machines (with `is_team_machine = true`, `team_id`, and `team_name`) |

### Entity Relationship

```
users
  │
  │ 1:N
  ▼
registered_machines ─────────────────── machine_team_shares ──── teams
  (user_id = owner)     1:N              (machine_id, team_id)    N:1
                                              │
                                              │
                                         Read-only
                                         awareness
                                         (not dispatch)
```

---

## Dispatch Flow

When a user triggers a task (from Plan, Playground, or Active Jobs), the backend selects a machine and routes the task through the relay.

```
User triggers task
       │
       ▼
Backend resolves target machine:
  1. Explicit machine ID from UI?  ──Yes──▶ Use that machine
  2. Project has defaultMachineId?  ──Yes──▶ Use that machine
  3. Neither?  ──▶ Call findBestMachine()
       │
       ▼
findBestMachine(preferredProvider, userId, teamSharedMachineIds):
  1. Get all connected machines from registry
  2. Filter to user-owned + team-shared machines
  3. Filter by preferred provider (if specified)
  4. Filter to connected machines with available capacity
  5. Sort: user-owned first, then by load (lowest first)
  6. Return best candidate (or undefined if none available)
       │
       ▼
Machine selected?
  ├── Yes ──▶ Check connectivity
  │            ├── Connected ──▶ Dispatch via WebSocket (or Redis pub/sub)
  │            └── Offline ──▶ Fallback to best available
  │                             ├── Found ──▶ Dispatch to fallback
  │                             └── None ──▶ Return error 503
  │
  └── No ──▶ Return error 400
              "No available machine. Start an agent runner with:
               npx astro-agent start --relay wss://<your-relay-url>"
```

### Sorting Priority

The `findBestMachine()` function uses a two-level sort:

1. **User-owned machines first.** Machines where `userId === requestingUserId` are strongly preferred.
2. **Lowest load second.** Among machines at the same ownership level, the one with the lowest combined CPU + active task score wins.

```typescript
candidates.sort((a, b) => {
  // Prefer user-owned over shared/anonymous
  const aOwned = a.userId === userId ? 1 : 0;
  const bOwned = b.userId === userId ? 1 : 0;
  if (aOwned !== bOwned) return bOwned - aOwned;

  // Then by load (CPU + active tasks * 10)
  const scoreA = a.load.cpuPercent + (a.load.activeTasks * 10);
  const scoreB = b.load.cpuPercent + (b.load.activeTasks * 10);
  return scoreA - scoreB;
});
```

### Failure Modes

| Scenario | Behavior |
|----------|----------|
| No machines connected | Error 400: "No available machine" with setup instructions |
| Target machine offline | Fallback to best available; if none, error 503 |
| No machines match provider | Fallback: retry without provider filter; if still none, error |
| Team-shared machine available but user-owned also available | User-owned machine selected (sorted first) |

---

## Team Machine Visibility

Team machine visibility is a read-only awareness feature. It answers the question "what compute does my team have?" without granting dispatch rights.

### How It Works

1. Machine owner shares their machine with a team by inserting a row into `machine_team_shares`.
2. Team members can see the shared machine in their Environments page (via the `get_user_available_machines()` function).
3. The UI marks these as "Team Machines" with the sharing team's name.
4. Dispatch does not use team-shared machines unless the dispatch code explicitly passes `teamSharedMachineIds`.

### Sharing a Machine

Only the machine owner can share their machine with a team:

```sql
-- Owner shares their machine with a team
INSERT INTO machine_team_shares (machine_id, team_id)
VALUES ('machine-abc', 'team-uuid-123');
```

The RLS policy `machine_team_shares_insert` enforces that `machine_id` must belong to the authenticated user.

### Revoking a Share

```sql
-- Owner revokes team visibility
DELETE FROM machine_team_shares
WHERE machine_id = 'machine-abc' AND team_id = 'team-uuid-123';
```

---

## Key Files

| File | Role |
|------|------|
| `server/lib/machine-registry.ts` | In-memory machine registry (WebSocket handles, `findBestMachine()`) |
| `server/lib/relay-server.ts` | Relay server -- WebSocket connections, task dispatch, heartbeats |
| `server/routes/dispatch.ts` | Dispatch route -- resolves target machine, triggers execution |
| `server/routes/device-auth.ts` | Device auth flow -- how machines authenticate during registration |
| `packages/core/src/db/schema.ts` | Database schema (`registeredMachines`, `machineTeamShares` tables) |
| `supabase/migrations/20260323000000_multi_team_machine_sharing.sql` | Migration that creates `machine_team_shares` and helper functions |
| `server/lib/registered-machines-store.ts` | DB CRUD for registered machines |

---

## FAQ

### Can I dispatch to a teammate's machine?

No. Dispatch is scoped to the requesting user's own machines (plus explicitly shared team machines when the dispatch code opts in). This is enforced in `findBestMachine()` and the dispatch route.

### Why not allow cross-user dispatch?

Three reasons:

1. **Security.** A machine runs under the owner's credentials, file system, and API keys. Allowing another user to dispatch code execution on someone else's machine is a security boundary violation.
2. **Resource isolation.** The machine owner controls their compute budget. Cross-user dispatch would let teammates consume resources without the owner's consent.
3. **Simplicity.** User-scoped ownership is a simple, predictable model. It avoids complex permission hierarchies and audit trails for machine access.

### What about a shared GPU cluster?

Register all cluster nodes under a single service account. Share visibility with the team via `machine_team_shares`. Team members see the cluster's status; the service account is the execution principal.

### If I revoke a machine, does it disconnect immediately?

Setting `is_revoked = true` in the database marks the machine as deregistered. The relay will close the WebSocket connection on the next heartbeat check. Active tasks on that machine will fail with a disconnect error.

### Does the `team_id` column on `registered_machines` do anything?

It is a legacy column from the single-team era. The multi-team sharing model uses `machine_team_shares` instead. The column is kept for backward compatibility but is not used for filtering or dispatch logic.

---

## Related Pages

- **[Relay](RELAY.md)** -- WebSocket relay architecture, message routing, heartbeats
- **[Architecture](ARCHITECTURE.md)** -- System overview, dispatch engine, streaming pipeline
- **[Auth and Teams](AUTH_AND_TEAMS.md)** -- Authentication flows, team lifecycle, RLS policies
- **[Backend](BACKEND.md)** -- API routes, middleware, data flow
- **[Data Model](DATA_MODEL.md)** -- Full entity reference, type definitions
