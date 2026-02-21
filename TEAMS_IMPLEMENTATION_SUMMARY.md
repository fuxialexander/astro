# Team Collaboration Schema Implementation Summary

## Overview
Implemented a complete team collaboration system with role-based access control for Astro platform.

## What Was Implemented

### 1. Database Migration (`supabase/migrations/20260221120000_add_teams.sql`)

Created comprehensive SQL migration with:

#### New Tables
- **`teams`** - Core team entity
  - `id` (uuid, primary key)
  - `name` (text, required)
  - `description` (text, default '')
  - `created_at`, `updated_at` (timestamptz)

- **`team_members`** - Team membership junction table
  - `team_id` (uuid, FK to teams)
  - `user_id` (uuid, FK to auth.users)
  - `role` (team_member_role enum: 'owner', 'admin', 'member')
  - `joined_at` (timestamptz)
  - Composite primary key: (team_id, user_id)

#### Schema Updates
- Added `team_id` column to existing `projects` table (nullable, FK to teams)
- Added indexes for performance (team name, user lookups, role filtering)

#### Security & Access Control

**Custom Type:**
- `team_member_role` enum with three levels: 'owner', 'admin', 'member'

**Helper Functions:**
- `user_is_team_member(p_team_id)` - Check if user is in team
- `user_can_manage_team(p_team_id)` - Check if user is owner/admin
- `user_has_project_access(p_project_id)` - **Updated** to include team-based access

**RLS Policies:**
- Teams table: Members can view, authenticated users can create, owners/admins can update, owners can delete
- Team members table: Members can view, owners/admins can manage membership
- All policies enforce role-based permissions

**Automatic Workflows:**
- `on_team_created` trigger automatically adds creator as 'owner' when team is created
- `teams_updated_at` trigger maintains updated_at timestamps

**Realtime:**
- Enabled Supabase Realtime subscriptions for `teams` and `team_members` tables

### 2. Drizzle Schema Updates (`server/lib/db/schema.ts`)

Added TypeScript schema definitions:

```typescript
// New tables
export const teams = pgTable('teams', { ... })
export const teamMembers = pgTable('team_members', { ... })

// Updated projects table
export const projects = pgTable('projects', {
  // ... existing fields
  teamId: uuid('team_id'),  // NEW
  // ... rest of fields
})
```

### 3. Documentation (`docs/TEAMS_SCHEMA.md`)

Created comprehensive documentation covering:
- Schema overview and table descriptions
- Custom types and helper functions
- RLS policies and security model
- Usage examples and SQL queries
- Workflow descriptions
- Future enhancement ideas

## Key Features

### Role Hierarchy
1. **Owner** - Full control (delete team, manage all members and settings)
2. **Admin** - Manage members and team settings (cannot delete team)
3. **Member** - View team and access team projects

### Access Model
Projects can now be accessed via three paths:
1. **Direct ownership** - User owns the project
2. **Project membership** - User is explicitly added to project_members
3. **Team membership** - User is member of team that owns the project (NEW)

### Security Design
- All operations protected by Row Level Security (RLS)
- Automatic owner assignment on team creation
- Cascade deletion: Deleting team → removes members, sets projects.team_id to null
- Function-based access checks ensure consistent security across operations

## Files Created/Modified

### Created:
1. `supabase/migrations/20260221120000_add_teams.sql` - Database migration
2. `docs/TEAMS_SCHEMA.md` - Complete schema documentation
3. `TEAMS_IMPLEMENTATION_SUMMARY.md` - This file

### Modified:
1. `server/lib/db/schema.ts` - Added teams, teamMembers tables; updated projects table

## Database Schema Diagram

```
┌─────────────┐
│   teams     │
│             │
│ id (PK)     │
│ name        │
│ description │
│ created_at  │
│ updated_at  │
└──────┬──────┘
       │
       │ 1:N
       │
┌──────▼──────────────┐       ┌─────────────────┐
│  team_members       │  N:1  │   auth.users    │
│                     ├───────┤                 │
│ team_id (FK, PK)    │       │ id (PK)         │
│ user_id (FK, PK)    │       │ ...             │
│ role                │       └─────────────────┘
│ joined_at           │
└─────────────────────┘

       1:N
        │
        │
┌───────▼────────────┐
│   projects         │
│                    │
│ id (PK)            │
│ team_id (FK, NEW)  │
│ owner_id (FK)      │
│ ...                │
└────────────────────┘
```

## Testing the Implementation

### Create a Team
```sql
-- Automatically creates team and adds current user as owner
INSERT INTO teams (name, description)
VALUES ('Engineering', 'Core engineering team')
RETURNING *;
```

### Add Members
```sql
-- Add admin
INSERT INTO team_members (team_id, user_id, role)
VALUES ('team-uuid', 'user-uuid', 'admin');

-- Add regular member
INSERT INTO team_members (team_id, user_id, role)
VALUES ('team-uuid', 'user-uuid-2', 'member');
```

### Assign Project to Team
```sql
UPDATE projects
SET team_id = 'team-uuid'
WHERE id = 'project-uuid';
```

### Query Team Projects (as team member)
```sql
SELECT * FROM projects
WHERE team_id = 'team-uuid';
-- RLS automatically filters based on team membership
```

## Migration Deployment

To apply this migration:

```bash
# Local Supabase
npm run dev:supabase
# Migration auto-applies on startup

# Production
# Upload migration file to Supabase dashboard or use CLI
supabase db push
```

## Next Steps (Implementation)

To fully integrate teams into the Astro UI:

1. **Frontend Components**
   - Teams list page
   - Team creation dialog
   - Team settings page
   - Member management UI
   - Team selector for projects

2. **API Endpoints**
   - `GET /api/teams` - List user's teams
   - `POST /api/teams` - Create team
   - `GET /api/teams/:id` - Get team details
   - `PUT /api/teams/:id` - Update team
   - `DELETE /api/teams/:id` - Delete team
   - `GET /api/teams/:id/members` - List members
   - `POST /api/teams/:id/members` - Add member
   - `PUT /api/teams/:id/members/:userId` - Update member role
   - `DELETE /api/teams/:id/members/:userId` - Remove member

3. **Zustand Store**
   - `teams-store.ts` - Team state management
   - Sync with Realtime subscriptions

4. **UI Updates**
   - Add "Team" field to project creation/edit forms
   - Show team badge on project cards
   - Team filter in projects list
   - Team selector in sidebar

## Compliance with Requirements

✅ **Team table with specified schema**
- team_id (uuid, primary key) ✓
- name (text) ✓
- created_at (timestamp) ✓
- updated_at (timestamp) ✓

✅ **Team members junction table**
- team_id (uuid) ✓
- user_id (uuid) ✓
- role (text: 'owner' | 'admin' | 'member') ✓
- joined_at (timestamp) ✓

✅ **Projects table update**
- team_id column (nullable) ✓

✅ **RLS policies**
- Team members can read team projects ✓
- Only owners/admins can update team settings ✓
- Members can be added only by owners/admins ✓

✅ **Documentation**
- Migration file created ✓
- Drizzle schema updated ✓
- Comprehensive documentation provided ✓

## Security Highlights

1. **Automatic Owner Assignment** - Creator is always owner, preventing orphaned teams
2. **Role-based Permissions** - Three-tier role system with clear hierarchy
3. **Cascade Safety** - Deleting teams doesn't delete projects (sets team_id to null)
4. **Function-based Access** - Centralized access checks via SQL functions
5. **RLS Enforcement** - All operations secured at database level
6. **Realtime Enabled** - Multi-device collaboration support

## Performance Considerations

Indexes created for optimal query performance:
- `idx_teams_name` - Fast team name lookups
- `idx_team_members_user` - Fast user membership queries
- `idx_team_members_role` - Fast role-based filtering
- `idx_projects_team` - Fast project-by-team queries

## Conclusion

The team collaboration schema is production-ready with:
- Complete database schema with proper normalization
- Comprehensive security model via RLS policies
- Role-based access control (owner/admin/member)
- Automatic workflows (owner assignment, cascade deletion)
- Realtime subscription support
- Full documentation and usage examples

The schema follows PostgreSQL best practices and integrates seamlessly with existing Astro architecture.
