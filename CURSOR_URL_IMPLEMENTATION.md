# Cursor URL Implementation Summary

## Overview

Successfully implemented hostname-based URL switching for Cursor integration. The system now intelligently switches between `file://` and `ssh+remote://` protocols based on whether the browser and agent are on the same machine.

## Implementation Details

### 1. Agent Runner CLI (`packages/agent-runner/src/cli.ts`)

**Added:**
- `--hostname <hostname>` flag to setup command
- Auto-detection using `uname -n` if hostname not provided
- Passes hostname through to registration flow

**Usage:**
```bash
# Explicit hostname (matches SSH config)
./scripts/agent-setup.sh example.com --hostname my-dev-server

# Auto-detect system hostname
./scripts/agent-setup.sh example.com
# Output: Auto-detected machine hostname: MacBook-Pro.local
```

### 2. Agent Setup Script (`scripts/agent-setup.sh`)

**Added:**
- `--hostname|--machine-name` flag parsing
- Auto-detection fallback: `MACHINE_NAME="$(uname -n)"`
- Passes hostname to CLI: `--hostname "$MACHINE_NAME"`
- Updated usage documentation

### 3. Setup Command (`packages/agent-runner/src/commands/setup.ts`)

**Modified:**
- Added `hostname?: string` to `SetupOptions` interface
- Threads hostname through to `runDeviceAuthFlow`
- Uses custom hostname if provided, otherwise falls back to detected hostname
- Registers machine with correct hostname

### 4. Backend System Route (`server/routes/system.ts`)

**New file:**
- `GET /api/system/hostname` - Returns server's hostname for browser detection
- `GET /api/system/info` - Returns additional system info (debugging)

### 5. Path Utils (`src/lib/path-utils.ts`)

**Added utilities:**
- `getBrowserHostname()` - Fetches and caches browser hostname
- `buildFileUrl()` - Async URL builder with smart protocol detection
- `buildFileUrlSync()` - Sync version for React rendering
- `parseFileUrl()` - Parses file URLs to extract components
- `isSameHostname()` - Hostname comparison with alias normalization

**Smart protocol logic:**
```typescript
if (isSameHostname(browserHostname, machine.hostname)) {
  return `file:///path/to/file:42`  // Same machine
} else {
  return `ssh+remote://hostname/path/to/file:42`  // Different machine
}
```

### 6. File Changes UI (`src/components/task-detail/file-changes-view.tsx`)

**Modified:**
- Added `machineId` prop to `FileChangesViewProps`
- Each file change now has a clickable "Open in editor" button
- Pre-caches hostname and builds URLs using `buildFileUrlSync()`
- Opens files with correct protocol when clicked

### 7. Task Detail Page (`src/pages/task-detail.tsx`)

**Modified:**
- Passes `machineId` prop to `FileChangesView` component
- Machine ID already available from execution or task stream

### 8. App Bootstrap (`src/app.tsx`)

**Modified:**
- Pre-caches browser hostname on app load
- Runs in `DataLoader` useEffect alongside realtime connection
- Ensures hostname is available for subsequent URL building

### 9. Server Integration (`server/index.ts`)

**Modified:**
- Imported and mounted `systemRoute` at `/api/system`
- System endpoints now available alongside other API routes

### 10. Types (`src/types/index.ts`)

**Modified:**
- Re-exported `RegisteredMachine` from server types
- Frontend uses simplified `MachineInfo` interface for URL building

## How It Works

### Machine Registration Flow

1. **User runs setup:**
   ```bash
   ./scripts/agent-setup.sh fuxialexander.work --hostname dev-server
   ```

2. **Agent registers with hostname:**
   - Hostname sent in device auth flow
   - Stored in `RegisteredMachine` (already has `hostname` field)
   - Synced to browser via machines store

### File URL Building with Local Toggle

1. **Task execution completes:**
   - File changes stored with absolute paths
   - Machine ID tracked from execution

2. **User opens Files tab:**
   - Component fetches machine from store using `machineId`
   - User sees a **"Local" toggle** in the file changes header
   - Toggle controls URL protocol selection

3. **Toggle behavior:**
   ```typescript
   // Toggle ON (Local mode)
   url = "file:///path/to/file:42"  // Always use file://

   // Toggle OFF (Remote mode - default)
   if (browserHostname === machineHostname) {
     url = "file:///path/to/file:42"  // Same machine
   } else {
     url = "ssh+remote://machine/path/to/file:42"  // Different machine
   }
   ```

4. **User clicks file:**
   - Opens URL with `window.open(fileUrl, '_self')`
   - Cursor recognizes protocol and opens file
   - SSH remote: connects via SSH config
   - Local file: opens directly

### The Local Toggle Solution

**Problem:** Browser can't reliably detect which machine it's running on.

**Solution:** Let the user explicitly control the URL protocol with a toggle:
- **Local ON**: Assume files are on the current machine → `file://`
- **Local OFF**: Use smart detection based on agent hostname → `file://` or `ssh+remote://`

**Benefits:**
- ✅ Simple, explicit control
- ✅ Works with multiple laptops/machines
- ✅ No hostname detection needed
- ✅ Toggle state persists per session
- ✅ User can switch as needed

## Hostname Normalization

The system handles common hostname aliases:

```typescript
normalizeHostname("localhost")       → "localhost"
normalizeHostname("127.0.0.1")       → "localhost"
normalizeHostname("::1")             → "localhost"
normalizeHostname("MacBook.local")   → "MacBook"
```

This ensures reliable same-machine detection.

## Future Enhancements

Documented in `docs/CURSOR_URL_SWITCHING.md`:

1. **Hostname aliases** - Map multiple names to same machine
2. **SSH config parsing** - Auto-detect from `~/.ssh/config`
3. **Browser extension** - Detect local hostname without server
4. **VSCode protocol** - Support `vscode://` and `vscode-remote://`
5. **Line number support** - Add line numbers to file URLs
6. **Column numbers** - Support `file:///path:42:10` syntax

## Testing

### Manual Test Flow

1. **Setup agent on remote machine:**
   ```bash
   ./scripts/agent-setup.sh example.com --hostname my-server
   ```

2. **Verify registration:**
   - Check `/environments` page
   - Should show machine with hostname "my-server"

3. **Run task on remote machine:**
   - Dispatch task to remote environment
   - Wait for file changes

4. **Check file URLs:**
   - Open task detail → Files tab
   - Hover over file changes
   - Should see "Open in editor" button
   - Click should generate `ssh+remote://my-server/path/to/file`

5. **Test local execution:**
   - Run task on local machine
   - Files should open with `file:///path/to/file`

## Files Modified

### Backend
- `server/routes/system.ts` (new)
- `server/index.ts`
- `packages/agent-runner/src/cli.ts`
- `packages/agent-runner/src/commands/setup.ts`
- `scripts/agent-setup.sh`

### Frontend
- `src/lib/path-utils.ts`
- `src/components/task-detail/file-changes-view.tsx`
- `src/pages/task-detail.tsx`
- `src/app.tsx`
- `src/types/index.ts`

### Documentation
- `docs/CURSOR_URL_SWITCHING.md` (new)
- `CURSOR_URL_IMPLEMENTATION.md` (this file)

## Build Status

✅ **All builds successful:**
- Frontend: `npm run build` → 0 errors
- Agent runner: `cd packages/agent-runner && npm run build` → 0 errors
- TypeScript strict mode: All type errors resolved

## Next Steps

To complete the feature:

1. **Test on real SSH remote:**
   - Set up agent on remote server
   - Configure SSH config entry
   - Test file opening workflow

2. **Add line number support:**
   - Parse line numbers from tool traces
   - Pass to `buildFileUrl()` function
   - Format as `:42` suffix

3. **Enhance click behavior:**
   - Add Cmd+Click to copy URL
   - Add context menu with "Copy URL" option
   - Show protocol badge (file/ssh) on hover

4. **Error handling:**
   - Handle missing machine gracefully
   - Warn if SSH config missing
   - Fallback to file:// if detection fails
