# Network-Agnostic Machine Identity

## Problem
Machine identity was based on `os.hostname()`, which can vary across different WiFi/network connections (especially on macOS where hostname adjusts based on DHCP/network settings). This caused the same physical machine to appear as multiple different machines when connecting from different networks.

## Solution
Implemented hardware-based machine identification that remains stable across network changes.

### Priority Hierarchy
1. **Hardware UUID** (best) - Read from system (IOPlatformUUID on macOS, /sys/class/dmi/id/product_uuid on Linux, WMIC on Windows)
2. **Primary MAC Address** - MAC address of primary network interface (en0, eth0, Ethernet)
3. **Random UUID** (fallback) - Generated once and stored persistently

### Changes Made

#### New Files
- **`packages/agent-runner/src/lib/hardware-id.ts`**
  - `getHardwareId()` - Async function to detect hardware-based identifier
  - `generateMachineName()` - Generate human-friendly machine name from hardware ID
  - Platform-specific hardware UUID detection (macOS, Linux, Windows)
  - Network interface MAC address extraction with priority ordering

#### Modified Files
- **`packages/agent-runner/src/lib/config.ts`**
  - Added `initializeMachineId()` - Async initialization using hardware ID
  - Updated `getMachineId()` - Returns existing ID or generates fallback
  - Removed dependency on `os.hostname()` for machine identity

- **`packages/agent-runner/src/commands/setup.ts`**
  - Initialize hardware-based machine ID at start of setup (Step 0)
  - Display hardware ID source (UUID/MAC/Random) to user
  - Check if already authenticated to avoid re-registration
  - Pass hardware ID info to device auth flow instead of hostname
  - Use stable `machineName` from hardware ID for registration
  - Include hardware ID in metadata for server-side deduplication
  - Updated `runDeviceAuthFlow()` signature to accept `hwId` instead of `customHostname`

- **`packages/agent-runner/src/commands/start.ts`**
  - Initialize hardware-based machine ID on startup if not set
  - Ensures stable ID even if setup was incomplete

### Machine Registration Flow (Updated)

**Before:**
```
1. Setup runs with hostname from network (e.g., "MacBook-Pro-WiFi1.local")
2. Server creates machine with this name
3. User changes network → hostname changes (e.g., "MacBook-Pro-WiFi2.local")
4. Setup runs again → Server sees "different" machine → Creates duplicate
```

**After:**
```
1. Setup generates hardware UUID (e.g., "E8B82C4F-...")
2. Creates stable machine name (e.g., "machine-e8b82c4f")
3. Registers with server, includes hardware ID in metadata
4. User changes network → hostname changes BUT hardware ID stays same
5. Setup detects existing authentication → Offers re-authentication (optional)
6. Same machine, same identity, no duplicates
```

### Benefits
1. **Network Agnostic** - Machine identity doesn't change when switching WiFi/Ethernet/VPN
2. **Persistent** - Survives network configuration changes, DHCP reassignments
3. **Hardware-Based** - Uses actual hardware identifiers when available
4. **Graceful Fallback** - Works even when hardware UUID isn't accessible
5. **Deduplication Ready** - Server can deduplicate machines using hardware ID metadata

### Usage
No user-facing changes required. The system automatically:
- Detects hardware UUID on first setup
- Uses stable identifier for all subsequent operations
- Prevents duplicate machine registrations across networks

### Testing
To verify the fix:
```bash
# Run setup on one network
npx @nexus/agent setup

# Note the Machine ID displayed

# Switch to a different WiFi network

# Run setup again
npx @nexus/agent setup

# Should see "Already authenticated" with the SAME Machine ID
```

### Migration
Existing machines with hostname-based IDs will continue to work. On next setup run:
- Hardware ID will be initialized
- Stored persistently
- Used for all future operations

No manual migration needed.
