# Team Machine Sharing Implementation

This document describes the implementation of team machine sharing in Astro, allowing machines to be shared with teams for collaborative multi-user execution environments.

## Overview

Team machine sharing enables users to designate their registered machines as team resources, making them available for task execution by all team members. This supports collaborative workflows where teams share computational resources across local machines, HPC clusters, and cloud instances.

## Key Features

### 1. Machine Sharing with Teams
- **Ownership**: Machines are owned by individual users but can be shared with a team
- **Team Assignment**: Machine owners can assign their machine to a team via `team_id` field
- **Access Control**: Team members get read-only access to team machines; only owners can modify settings

### 2. Machine Selection Policy
Four selection strategies when multiple machines are available:

- **Priority** (default): Prefer user machines > team machines, connected > disconnected
- **Round-Robin**: Rotate through available machines to distribute load evenly
- **Least-Loaded**: Select machine with fewest active tasks (requires usage tracking)
- **Manual**: Explicitly specify target machine ID

### 3. Machine Usage Tracking
- Logs all task executions per machine for capacity planning and billing
- Tracks start time, completion time, duration, status
- Enables least-loaded selection policy
- Queryable via REST API for analytics

### 4. Row-Level Security
- Team members can **read** team machine configurations (name, status, providers)
- Only machine owners can **modify** or **delete** their machines
- Team machine sharing respects team membership via RLS policies

## Database Schema Changes

### Registered Machines Table
```sql
ALTER TABLE registered_machines ADD COLUMN team_id uuid REFERENCES teams(id) ON DELETE SET NULL;
```

### Machine Usage Logs Table
```sql
CREATE TABLE machine_usage_logs (
  id uuid PRIMARY KEY,
  machine_id text NOT NULL,
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  node_id text NOT NULL,
  execution_id text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  duration_ms integer,
  status text NOT NULL, -- 'success' | 'failure' | 'cancelled'
  created_at timestamptz NOT NULL
);
```

### Database Functions
- `user_can_access_machine(machine_id)`: Check if user owns or has team access
- `get_user_available_machines(user_id)`: Get all machines available to a user (owned + team)

## TypeScript API

### Types
```typescript
interface RegisteredMachine {
  id: string
  userId: string
  teamId?: string  // NEW: Team ID if shared
  name: string
  hostname: string
  environmentType: EnvironmentType
  providers: ProviderType[]
  isConnected: boolean
  // ... other fields
}

interface MachineWithTeamInfo extends RegisteredMachine {
  isTeamMachine: boolean
  teamName?: string
}

interface MachineUsageLog {
  id: string
  machineId: string
  userId: string
  projectId: string
  nodeId: string
  executionId: string
  startedAt: Date
  completedAt?: Date
  durationMs?: number
  status: 'success' | 'failure' | 'cancelled'
}
```

### Backend Functions

```typescript
// Machine sharing
async function shareMachineWithTeam(machineId: string, teamId: string | null): Promise<boolean>
async function getTeamMachines(teamId: string): Promise<RegisteredMachine[]>
async function getAvailableMachines(userId: string): Promise<MachineWithTeamInfo[]>

// Usage tracking
async function logMachineUsageStart(params: { ... }): Promise<string | null>
async function logMachineUsageComplete(params: { ... }): Promise<boolean>
async function getMachineUsageLogs(machineId: string, limit?: number): Promise<MachineUsageLog[]>
```

### Machine Selection

```typescript
import { selectMachine } from '@/server/lib/dispatch/machine-selector'

const result = selectMachine({
  availableMachines,      // All user + team machines
  targetEnvironment,      // 'local' | 'hpc' | 'cloud'
  preferredProvider,      // 'claude-code' | 'slurm' | etc
  targetMachineId,        // Optional explicit machine
  userId,
  projectId,
  machineLoad,            // Optional: Map<machineId, activeTaskCount>
}, 'priority')

if (result.success) {
  console.log(`Selected: ${result.machine.name} - ${result.reason}`)
}
```

## Dispatch Engine Integration

### Dispatch Config
```typescript
const dispatchConfig: DispatchEngineConfig = {
  // ... other config
  machineSelectionPolicy: 'priority' | 'round-robin' | 'least-loaded' | 'manual'
}
```

### Task Dispatch Flow
1. User dispatches task from team project
2. Dispatch engine calls `getAvailableMachines(userId)` to get owned + team machines
3. Machine selector applies policy to choose best machine
4. Task is dispatched to selected machine
5. Usage tracking logs start/completion

## UI Integration (To Be Implemented)

### Machine Settings Page
- **Share with Team** toggle for each machine
- Team dropdown selector (shows user's teams)
- Visual indicator for team-shared machines
- Team member count and usage statistics

### Environments Page
- Display team machines separately from user machines
- Show "Shared by {owner}" badge for team machines
- Filter/group by team
- View-only UI for team machines (no edit/delete for non-owners)

### Project Settings
- Default machine selector includes team machines
- Machine availability indicator (owned vs team)

## RLS Policies

### Registered Machines
```sql
-- Read: user's own machines + team machines
CREATE POLICY "Users can view accessible machines"
  ON registered_machines FOR SELECT
  USING (user_id = auth.uid() OR user_can_access_machine(id));

-- Write: only own machines
CREATE POLICY "Users can update own machines"
  ON registered_machines FOR UPDATE
  USING (user_id = auth.uid());
```

### Machine Usage Logs
```sql
-- Read: logs for accessible machines
CREATE POLICY "Users can view machine usage logs"
  ON machine_usage_logs FOR SELECT
  USING (user_can_access_machine(machine_id));

-- Write: service role only
CREATE POLICY "Service role can insert usage logs"
  ON machine_usage_logs FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
```

## Migration Path

### Phase 1: Database & Backend (Current)
- ✅ Add `team_id` to registered_machines
- ✅ Create machine_usage_logs table
- ✅ Add RLS policies
- ✅ Update TypeScript types
- ✅ Implement backend functions
- ✅ Add machine selection logic

### Phase 2: Dispatch Integration (Next)
- Update dispatch engine to query available machines
- Integrate machine selector into task dispatch flow
- Add usage logging to execution pipeline
- Test with team projects

### Phase 3: UI (Future)
- Add team sharing toggle to machine settings
- Display team machines in environments page
- Show usage statistics and analytics
- Add machine selection preferences to project settings

### Phase 4: Advanced Features (Future)
- Machine resource quotas per team
- Machine scheduling/reservations
- Cost tracking and billing per team
- Machine health monitoring dashboard

## Testing

### Unit Tests
```typescript
// Test machine selection policies
describe('Machine Selector', () => {
  it('should prefer user machines over team machines', () => { ... })
  it('should round-robin across machines', () => { ... })
  it('should select least-loaded machine', () => { ... })
})
```

### Integration Tests
```typescript
// Test team machine access
it('should allow team members to read team machines', () => { ... })
it('should prevent team members from modifying team machines', () => { ... })
it('should log machine usage on task execution', () => { ... })
```

## Configuration

### Environment Variables
```bash
# Machine selection policy (default: priority)
MACHINE_SELECTION_POLICY=priority|round-robin|least-loaded|manual
```

### Dispatch Engine Config
```typescript
{
  machineSelectionPolicy: 'priority'  // Default policy
}
```

## Security Considerations

1. **Read-Only Team Access**: Team members cannot modify or delete team machines
2. **Owner Control**: Only machine owners can share/unshare their machines
3. **Team Membership**: Access automatically revoked when user leaves team
4. **Usage Auditing**: All machine usage is logged for accountability
5. **RLS Enforcement**: Database-level security prevents unauthorized access

## Performance Considerations

1. **Caching**: Available machines query can be cached per user
2. **Indexing**: Indexes on `team_id` and `machine_id` for fast lookups
3. **Load Tracking**: Real-time load tracking uses in-memory state
4. **Usage Logs**: Partitioned by date for efficient historical queries

## Future Enhancements

1. **Machine Pools**: Create named pools of machines for different workloads
2. **Auto-Scaling**: Automatically provision cloud machines when needed
3. **Cost Allocation**: Track and allocate costs per team/project
4. **Machine Templates**: Pre-configured machine setups for common scenarios
5. **Health Checks**: Automated machine health monitoring and alerting
6. **Capacity Planning**: Predictive analytics for resource planning

## References

- Database Schema: `supabase/migrations/20260221130000_add_team_machines.sql`
- TypeScript Types: `server/types/device-auth.ts`
- Backend Store: `server/lib/registered-machines-store.ts`
- Machine Selector: `server/lib/dispatch/machine-selector.ts`
- Dispatch Types: `server/lib/dispatch/types.ts`
