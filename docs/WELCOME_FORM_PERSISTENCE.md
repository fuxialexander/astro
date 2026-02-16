# Welcome Form Persistence & Real-time Machine Updates

## Problem

When users complete the device auth flow via `scripts/agent-setup.sh`, they are redirected to the `/welcome` page. However:

1. **Agent not started yet**: The CLI is still going through setup steps, so the remote agent hasn't connected
2. **Form state lost on refresh**: If users fill Step 1 (project details) then wait for the agent to connect, refreshing the page loses all their input
3. **No real-time updates**: The machine list doesn't update automatically when the agent connects

## Solution

Implemented a comprehensive solution with three components:

### 1. Form Persistence Hook (`use-welcome-form-persistence.ts`)

Created a custom hook that:
- Saves all form state to `localStorage` on every change
- Restores form state from `localStorage` on mount
- Clears persisted state after successful project creation
- Handles the entire form state including navigation step

**Key features:**
```typescript
export function useWelcomeFormPersistence() {
  const [state, setState] = useState(() => {
    // Restore from localStorage on mount
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : defaultState
  })

  // Auto-save on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  return {
    state,
    updateField,
    clearState, // Call after successful submission
  }
}
```

### 2. Real-time Machine Updates

Updated `welcome.tsx` to subscribe to the `useRealtimeStore` for live machine updates:

```typescript
// Subscribe to real-time machine list
const realtimeMachines = useRealtimeStore((s) => s.machines)

// Combine with execution store machines
const realtimeMachinesList = Array.from(realtimeMachines.values()).filter(
  (m) => m.environmentType === formState.selectedEnvironment
)
```

**Events handled:**
- `machine:connected` - Updates machine list when agent connects
- `machine:disconnected` - Removes machine when agent disconnects
- `machines:snapshot` - Initial machine list on page load

### 3. Waiting State UI

Added a visual indicator on Step 2 when no remote machines are available:

```tsx
{isRemoteEnv && (availableMachines.length === 0 && realtimeMachinesList.length === 0) && (
  <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2.5">
    <RefreshCw className="h-4 w-4 animate-spin" />
    <div className="flex flex-col">
      <span className="font-medium">Waiting for agent...</span>
      <span className="text-xs">
        Complete the agent setup in your terminal. This page will update automatically.
      </span>
    </div>
  </div>
)}
```

## User Flow (Improved)

1. **User runs `scripts/agent-setup.sh`**
   - Device auth completes
   - Browser redirects to `/welcome`

2. **User fills Step 1 (project details)**
   - Form state auto-saves to localStorage
   - User can close tab/refresh without losing data

3. **User reaches Step 2 (environment selection)**
   - If remote agent not started yet: shows "Waiting for agent..." message
   - User can continue with setup or wait

4. **Agent connects in terminal**
   - Real-time store receives `machine:connected` event
   - Machine dropdown updates automatically (no refresh needed!)
   - Waiting message disappears, machine appears in dropdown

5. **User completes form and submits**
   - Project created successfully
   - Form state cleared from localStorage
   - User navigated to plan view

## Benefits

✅ **No data loss**: Form state persists across page refreshes
✅ **No manual refresh needed**: Machine list updates automatically via SSE
✅ **Clear feedback**: Users see waiting state and know what to expect
✅ **Seamless UX**: Users can continue filling the form while agent connects
✅ **Automatic cleanup**: Form state cleared after successful submission

## Technical Details

### localStorage Schema

```typescript
interface WelcomeFormState {
  // Step 1
  userType: 'builder' | 'scientist' | null
  inputMode: 'type' | 'paste' | 'import' | 'repo'
  description: string
  pastedDoc: string
  repoUrl: string
  repoPath: string

  // Step 2
  domain: string
  startDate: string
  targetDate: string
  techStack: string
  selectedEnvironment: 'local' | 'remote' | 'hpc' | 'cloud'
  selectedMachineId: string | null

  // Navigation
  currentStep: number
}
```

Stored in `localStorage` under key: `nexus:welcome-form-state`

### Real-time Events

The welcome page subscribes to the global SSE event stream via `useRealtimeStore`:

- **Event source**: `/api/events/stream`
- **Machine events**: `machines:snapshot`, `machine:connected`, `machine:disconnected`
- **Update mechanism**: Zustand store updates → React re-renders → UI updates

### Machine List Merging

The welcome page combines machines from two sources:

1. **Execution store** (`execution-store.ts`): Machines loaded via HTTP API
2. **Realtime store** (`realtime-store.ts`): Machines from SSE events

This ensures machines are available from both initial load and real-time updates.

## Files Changed

- **New**: `src/hooks/use-welcome-form-persistence.ts` - Form persistence hook
- **Updated**: `src/pages/welcome.tsx` - Added persistence + real-time updates

## Testing

To test the full flow:

```bash
# Terminal 1: Start backend
npm run dev:backend

# Terminal 2: Start frontend
npm run dev:frontend

# Terminal 3: Run agent setup
./scripts/agent-setup.sh

# Browser:
# 1. Complete device auth
# 2. Fill Step 1 of welcome form
# 3. Refresh page → verify Step 1 data persists
# 4. Go to Step 2 → see "Waiting for agent..." message
# 5. Complete agent setup in terminal
# 6. Watch machine appear automatically (no refresh needed!)
```

## Future Improvements

- Add timeout/fallback if agent never connects (e.g., "Still waiting? Check your terminal")
- Add manual refresh button for users who prefer explicit control
- Show connection status indicator (e.g., "2 machines connected")
- Add form state expiration (e.g., clear after 24 hours)
