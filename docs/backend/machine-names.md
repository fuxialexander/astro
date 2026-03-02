# Machine Names & Hostnames Data Flow

This document describes how machine identity (name, hostname) flows through the system, from agent-runner registration to UI display and editor URL construction.

## Key Fields

| Field | Source | Mutable by User | Example |
|-------|--------|-----------------|---------|
| `hostname` | System `os.hostname()` on the agent-runner machine | No | `xf2217-MS-7E70` |
| `name` | Initially set from agent-runner payload (often = hostname or macOS "Computer Name" like "Macbook Pro"); user can rename via UI | Yes | `spe` |
| `machineId` | Hardware-derived or generated (`hostname-uuid8`) | No | `xf2217-MS-7E70-a1b2c3d4` |

The user-set `name` is typically an **SSH alias** from `~/.ssh/config` (e.g., `Host spe`), so it's used for SSH remote URLs.

## Registration Flow

```
Agent Runner                    Relay Server (WS)              Persistent Store (DB)
    |                                |                                |
    |-- machine.register ----------->|                                |
    |   payload: {                   |                                |
    |     name: "Macbook Pro",       |  machineRegistry.register()    |
    |     hostname: "xf2217-MS-7E70",|  stores in live Map            |
    |     platform: "linux",         |                                |
    |     providers: [...]           |                                |
    |   }                            |                                |
    |                                |-- machine:connected event ---->|
    |                                |   ensureMachineRegistered()    |
    |                                |   - If exists: update status   |
    |                                |     (preserves user-set name)  |
    |                                |   - If new: insert with        |
    |                                |     payload name               |
    |                                |                                |
    |                                |<-- getMachine() ---------------|
    |                                |   Sync DB name back to         |
    |                                |   live registry entry          |
```

### Name Preservation on Reconnect

When a machine reconnects, `registerMachine()` in `server/lib/registered-machines-store.ts` checks:

```
preserveName = existingMachine.name
  && existingMachine.name !== existingMachine.hostname  // user renamed it
  && existingMachine.name !== existingMachine.id
  && existingMachine.name !== params.name               // incoming name differs
```

If the user renamed the machine (name differs from hostname), the DB name is preserved.

After `ensureMachineRegistered()`, the `machine:connected` handler in `server/index.ts` syncs the DB name back to the live `machineRegistry` entry so subsequent API responses use the correct name.

## Data Stores

### Server-Side

| Store | Location | Contains | Name Source |
|-------|----------|----------|-------------|
| **machineRegistry** (live) | `server/lib/machine-registry.ts` | Connected machines only, in-memory Map | WebSocket handshake payload; synced from DB after connect |
| **registered_machines** (persistent) | Supabase table or SQLite via Drizzle | All registered machines (including offline) | User-editable via PATCH `/api/device/machines/:id` |

### Client-Side

| Store | Location | Fetches From | Used By |
|-------|----------|--------------|---------|
| **useMachinesStore** | `src/stores/machines-store.ts` | `GET /api/device/machines` (persistent DB) | Project overview (machine name display), repo config dialog |
| **useRealtimeStore** | `src/stores/realtime-store.ts` | SSE `machine:connected` events (live registry) | Environments page (connected machines section) |
| **useExecutionStore** | `src/stores/execution-store.ts` | `GET /api/relay/machines` (live registry + DB cross-ref) | Node inspector machine selector, task dispatch |

### Name Sync Between Client Stores

When a `machine:connected` SSE event arrives, `realtime-store.ts` checks `useMachinesStore` for a user-set name and prefers it over the WebSocket-provided name. When `renameMachine()` is called in `useMachinesStore`, it also updates the realtime store's live machine entry.

## API Endpoints

| Endpoint | Returns Name From | Notes |
|----------|-------------------|-------|
| `GET /api/device/machines` | Persistent DB | Always has user-set name |
| `GET /api/relay/machines` | Live registry, cross-referenced with DB | Prefers user-set name from DB |
| `PATCH /api/device/machines/:id` | Updates DB `name` only | Does not change `hostname` |
| SSE `machine:connected` | Live registry | Client-side overrides with DB name |

## UI Display

| Location | Store | Shows |
|----------|-------|-------|
| **Project Overview** "Working Directory (name)" | useMachinesStore | `machine.name` |
| **Environments** connected machines | useRealtimeStore | `machine.name` (synced from useMachinesStore) |
| **Environments** offline machines | useMachinesStore | `machine.name` with `machine.hostname` as subtitle |
| **Node Inspector** machine selector | useExecutionStore | `machine.name` from relay endpoint |
| **Plan Canvas** machine dropdown | useExecutionStore | `machine.name` from relay endpoint |

## Editor URL Construction

The editor URL (Cursor/VSCode "Open in Editor") uses two modes:

- **Local**: `cursor://file/path` — no machine info needed
- **Remote**: `cursor://vscode-remote/ssh-remote+{name}/path` — uses `machine.name` as the SSH target

The user-set `name` is used for the SSH remote target because it typically matches an SSH config alias. The raw `hostname` is only used internally for same-machine detection (`isSameHostname()` in `path-utils.ts`).

### project-overview.tsx

```
defaultMachine = project.defaultMachineId
  ? machines.find(m => m.id === project.defaultMachineId)
  : (machines.length === 1 ? machines[0] : undefined)  // auto-select if only one

if (useLocalUrls)  → cursor://file/path
if (remote)        → cursor://vscode-remote/ssh-remote+{defaultMachine.name}/path
```

### path-utils.ts (file-changes-view)

```
sshTarget = machine.name || machine.hostname
if (forceLocal)      → cursor://file/path
if (isSameHostname)  → cursor://file/path      (comparison uses hostname)
else                 → cursor://vscode-remote/ssh-remote+{sshTarget}/path
```

## Rename Flow

```
User clicks rename          PATCH /api/device/machines/:id
in Environments UI    --->  Updates DB `name` column
        |
        v
  useMachinesStore          useRealtimeStore
  updates local state  ---> updates live machine entry
        |                   (if connected)
        v
  API persistence
  via dataClient
```

The rename does NOT propagate to:
- The live `machineRegistry` on the server (until next reconnect or API call)
- The `useExecutionStore` (until next `loadMachines()` call)

These are eventually consistent — the next page load or machine reconnect will pick up the new name.
