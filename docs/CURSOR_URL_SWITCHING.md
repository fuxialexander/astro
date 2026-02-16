# Cursor URL Switching

## Overview

Nexus supports smart URL switching between remote and local file access based on machine hostname matching. This enables seamless Cursor integration whether you're working locally or remotely.

## Architecture

### Machine Hostname Registration

When setting up an agent runner, the machine's hostname is registered:

```bash
# Explicitly specify hostname (matching SSH config)
./scripts/agent-setup.sh fuxialexander.work --hostname my-dev-server

# Auto-detect system hostname
./scripts/agent-setup.sh fuxialexander.work
# Uses: uname -n
```

The hostname is:
1. Passed to the agent runner via `--hostname` flag
2. Included in machine registration (`/api/device/register`)
3. Stored in the machine registry and browser state

### URL Format Detection

When displaying file paths from task execution:

**Remote URL** (when browser ≠ agent machine):
```
ssh+remote://my-dev-server/path/to/file.ts:42
```

**Local URL** (when browser = agent machine):
```
file:///path/to/file.ts:42
```

### Browser-Side Detection

The browser can detect if it's on the same machine by:

1. **Browser hostname**: `window.location.hostname` or fetch `uname -n` via local API
2. **Machine hostname**: From machine registry (`useMachinesStore`)
3. **Match logic**: If hostnames match → use `file://`, else use `ssh+remote://`

## Implementation

### Backend (Machine Registry)

```typescript
// server/lib/registered-machines-store.ts
interface RegisteredMachine {
  id: string;
  name: string;
  hostname: string;  // NEW: system hostname
  capabilities: string[];
  // ...
}
```

### Frontend (URL Builder)

```typescript
// src/lib/path-utils.ts
export function buildFileUrl(
  filePath: string,
  lineNumber: number | undefined,
  machineId: string
): string {
  const machine = useMachinesStore.getState().machines.find(m => m.id === machineId);
  const browserHostname = await getBrowserHostname(); // fetch from local API or detect

  const isSameMachine = machine?.hostname === browserHostname;

  if (isSameMachine) {
    return `file://${filePath}${lineNumber ? `:${lineNumber}` : ''}`;
  } else {
    return `ssh+remote://${machine?.hostname}${filePath}${lineNumber ? `:${lineNumber}` : ''}`;
  }
}
```

### Agent Runner

```typescript
// packages/agent-runner/src/cli.ts
const hostname = program.opts().hostname || os.hostname();

// Include in registration payload
await registerMachine({
  name: machineName,
  hostname: hostname,
  capabilities: detectCapabilities(),
  // ...
});
```

## Usage

### Setup Script

```bash
# Option 1: Match SSH config hostname
./scripts/agent-setup.sh example.com --hostname my-server

# Option 2: Auto-detect
./scripts/agent-setup.sh example.com
# Output: Auto-detected machine hostname: MacBook-Pro.local

# Option 3: With SSH config discovery
./scripts/agent-setup.sh example.com --with-ssh-config --hostname hpc-cluster
```

### Browser Detection

The browser needs to know its own hostname. Two approaches:

**Approach 1: Server-side endpoint**
```typescript
// server/routes/system.ts
app.get('/api/system/hostname', (c) => {
  return c.json({ hostname: os.hostname() });
});
```

**Approach 2: Client-side heuristic**
```typescript
// Use window.location.hostname for web-based detection
// Or embed in initial HTML for SSR
```

## Benefits

1. **Seamless UX**: Click file links in browser → opens in Cursor immediately
2. **Smart routing**: Automatically uses local vs remote protocol
3. **SSH config alignment**: Matches existing SSH host configuration
4. **Multi-machine support**: Works across laptop, dev server, HPC cluster

## Example Flow

1. User sets up agent on dev server: `./scripts/agent-setup.sh --hostname dev-server`
2. Agent registers with hostname: `dev-server`
3. User opens Nexus in browser (local laptop)
4. Browser detects own hostname: `MacBook-Pro.local`
5. Task output shows file: `/home/user/project/src/app.ts:42`
6. Browser builds URL: `ssh+remote://dev-server/home/user/project/src/app.ts:42`
7. Cursor opens file via SSH remote (auto-configured)

## Future Enhancements

- **Hostname aliases**: Map multiple hostnames to same machine (e.g., `localhost`, `127.0.0.1`, `MacBook-Pro.local`)
- **SSH config parsing**: Auto-detect hostname from `~/.ssh/config`
- **Browser extension**: Detect local hostname without server round-trip
- **VSCode protocol**: Support `vscode://` and `vscode-remote://` URLs
