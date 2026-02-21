# Teams Collaboration Schema

This document describes the team collaboration feature implementation in Astro.

## Overview

The teams feature enables users to organize projects into teams with role-based access control. Team members can collaborate on projects with different permission levels.

## Database Schema

### Tables

#### `teams`
Primary table for storing team information.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key, auto-generated |
| `name` | text | Team name (required) |
| `description` | text | Team description (default: '') |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Last update timestamp |

**Indexes:**
- `idx_teams_name` on `name`

**Triggers:**
- `teams_updated_at` - Auto-updates `updated_at` on row modification
- `on_team_created` - Auto-adds creator as owner when team is created

---

#### `team_members`
Junction table for team membership with role-based access.

| Column | Type | Description |
|--------|------|-------------|
| `team_id` | uuid | Foreign key to `teams.id` (cascade delete) |
| `user_id` | uuid | Foreign key to `auth.users.id` (cascade delete) |
| `role` | team_member_role | Member role: 'owner', 'admin', or 'member' |
| `joined_at` | timestamptz | Membership creation timestamp |

**Primary Key:** `(team_id, user_id)`

**Indexes:**
- `idx_team_members_user` on `user_id`
- `idx_team_members_role` on `(team_id, role)`

---

#### `projects` (updated)
Added `team_id` column to existing projects table.

| Column | Type | Description |
|--------|------|-------------|
| `team_id` | uuid (nullable) | Foreign key to `teams.id` (set null on delete) |
| ... | ... | (existing columns) |

**New Index:**
- `idx_projects_team` on `team_id`

## Custom Types

### `team_member_role`
Enum type for team member roles:
- `owner` - Full control over team (delete team, manage all members)
- `admin` - Can manage team settings and members
- `member` - Can view team and access team projects

## Helper Functions

### `user_is_team_member(p_team_id uuid)`
Returns `boolean` - Checks if the current user is a member of the specified team.

**Usage:**
```sql
select user_is_team_member('team-uuid-here');
```

### `user_can_manage_team(p_team_id uuid)`
Returns `boolean` - Checks if the current user is an owner or admin of the specified team.

**Usage:**
```sql
select user_can_manage_team('team-uuid-here');
```

### `user_has_project_access(p_project_id uuid)` (updated)
Enhanced to include team-based access. Returns `boolean` - Checks if user can access a project via:
1. Project ownership
2. Direct project membership
3. **Team membership (new)**

## Row Level Security (RLS) Policies

### Teams Table

| Policy | Operation | Condition |
|--------|-----------|-----------|
| Team members can view teams | SELECT | `user_is_team_member(id)` |
| Users can create teams | INSERT | `auth.uid() is not null` |
| Owners/admins can update teams | UPDATE | `user_can_manage_team(id)` |
| Owners can delete teams | DELETE | User has 'owner' role |

### Team Members Table

| Policy | Operation | Condition |
|--------|-----------|-----------|
| Team members can view team membership | SELECT | `user_is_team_member(team_id)` |
| Owners/admins can add members | INSERT | `user_can_manage_team(team_id)` OR creating team with self as owner |
| Owners/admins can update member roles | UPDATE | `user_can_manage_team(team_id)` |
| Owners/admins can remove members | DELETE | `user_can_manage_team(team_id)` |

## Realtime Subscriptions

Both `teams` and `team_members` tables are enabled for Supabase Realtime, allowing multi-device collaboration and live updates.

```sql
alter publication supabase_realtime add table teams;
alter publication supabase_realtime add table team_members;
```

## Workflow

### Creating a Team
1. User creates a team (INSERT into `teams`)
2. Trigger `on_team_created` automatically adds creator as 'owner' in `team_members`
3. Owner can now add additional members

### Adding Members
1. Owner/admin executes INSERT into `team_members` with desired role
2. New member gains access to all team projects
3. Realtime subscription notifies other team members

### Assigning Projects to Teams
1. Owner/admin updates `projects.team_id` to team's UUID
2. All team members automatically gain access via updated `user_has_project_access()` function
3. Project visibility follows team membership

### Role Management
- **Owner**: Can delete team, manage all members, update team settings
- **Admin**: Can manage members and update team settings
- **Member**: Can view team and access team projects (read/write based on project-level permissions)

## Migration File

The schema is defined in:
```
supabase/migrations/20260221120000_add_teams.sql
```

## Drizzle Schema

TypeScript definitions are in:
```
server/lib/db/schema.ts
```

Exports:
- `teams` - Team table schema
- `teamMembers` - Team members junction table schema
- `projects` - Updated with `teamId` field

## Usage Examples

### Create a Team
```sql
-- Team is created with current user as owner (via trigger)
insert into teams (name, description)
values ('Engineering', 'Core engineering team');
```

### Add a Team Member
```sql
insert into team_members (team_id, user_id, role)
values (
  'team-uuid-here',
  'user-uuid-here',
  'admin'
);
```

### Assign Project to Team
```sql
update projects
set team_id = 'team-uuid-here'
where id = 'project-uuid-here';
```

### Query Team Projects
```sql
select p.*
from projects p
where p.team_id = 'team-uuid-here';
```

### Query Team Members
```sql
select u.name, u.email, tm.role
from team_members tm
join user_profiles u on u.id = tm.user_id
where tm.team_id = 'team-uuid-here'
order by tm.role, u.name;
```

## Security Considerations

1. **Automatic Owner Assignment**: When a team is created, the creator is automatically assigned as owner via trigger
2. **Cascade Deletion**: Deleting a team cascades to team_members and sets projects.team_id to null
3. **Role Hierarchy**: Only owners can delete teams; owners and admins can manage members
4. **Project Access**: Team membership grants access to all team projects (complementing direct project membership)
5. **RLS Enforcement**: All operations are secured via Row Level Security policies

## Future Enhancements

Potential improvements to consider:
- Team invitations with email-based invite flow
- Team activity feed
- Team-level settings and preferences
- Team analytics and usage metrics
- Team avatars and branding
