# Multi-User Team Features — Implementation Plan

> **Status: IN PROGRESS (~85% backend complete, ~30% frontend wired)**
>
> Backend team infrastructure is largely built. Frontend has UI shells but API calls are stubbed. This document provides a concrete implementation plan to close the remaining gaps and ship team support.
>
> See [`LOCAL_SERVER_REFACTOR.md`](./LOCAL_SERVER_REFACTOR.md) for the completed refactoring work that laid the team-scoped data foundation.

---

## Current State Audit

### What's Already Built

**Backend (server/) — ~85% complete:**

| Component | Status | Notes |
|-----------|--------|-------|
| `teams` table + `team_members` table | Done | Schema in `server/lib/db/schema.ts` |
| `invite_tokens` table | Done | Schema with token, email, role, expiry, usedAt |
| Auth middleware team resolution | Done | `server/middleware/auth.ts` resolves `teamId` + `teamIds[]` from `team_members` |
| `X-Team-Id` header support | Done | Middleware reads header, validates membership, sets active team |
| Auto-create personal team on registration | Done | `resolveTeams()` creates "Personal" team for users with no memberships |
| Team-scoped queries | Done | All data routes use `teamScopeFilter()` from `server/lib/db/team-scope.ts` |
| `POST /api/teams/invite` | Done | Creates invite token, sends email via `sendInvitationEmail()` |
| `GET /api/teams/:teamId/invites` | Done | Lists pending invites (admin/owner only) |
| `DELETE /api/teams/invites/:inviteId` | Done | Revokes an invitation |
| `GET /api/teams/invite/:token` | Done | Public endpoint to get invite details |
| `POST /api/teams/accept/:token` | Done | Accept invitation, adds to `team_members` |
| `GET /api/teams/:teamId/members` | Done | Lists members with profiles |
| `DELETE /api/teams/:teamId/members/:userId` | Done | Remove member (admin/owner or self) |
| Email service for invitations | Done | `server/lib/email-service.ts` |
| Local mode team isolation | Done | `bootstrap-local.ts` creates `LOCAL_USER_ID` + `LOCAL_TEAM_ID` |

**Backend — Missing:**

| Component | Status | Required for |
|-----------|--------|-------------|
| `GET /api/teams` | Missing | Team list (user's teams with roles) |
| `POST /api/teams` | Missing | Create new team |
| `PUT /api/teams/:id` | Missing | Update team name/description |
| `DELETE /api/teams/:id` | Missing | Delete team + cascade |
| `PUT /api/teams/:id/members/:userId/role` | Missing | Change member role |
| `POST /api/teams/:id/transfer-ownership` | Missing | Transfer owner role |

**Frontend (src/) — ~30% wired:**

| Component | Status | Notes |
|-----------|--------|-------|
| `team-store.ts` | Built | Has `load()`, `addTeam()`, `updateTeam()`, `deleteTeam()` — calls `dataClient` |
| `data-client.ts` | Built | Has `listTeams()`, `createTeam()`, `updateTeam()`, `deleteTeam()` + `setActiveTeamId()` |
| `api-client.ts` | Built | Sends `X-Team-Id` header on all requests |
| Settings Teams tab (`settings.tsx`) | Shell built, 4 API calls stubbed | `fetchTeams`, `fetchTeamData`, `handleSendInvite`, `handleRevokeInvite`, `handleRemoveMember` all have `// TODO` |
| Team invite page (`team-invite.tsx`) | Done | `/invite/:token` route with accept/decline UI |
| Route `/invite/:token` | Done | Registered in `app.tsx` |
| Sidebar team switcher | Not started | No UI element in sidebar for switching teams |
| `DataLoader` team-aware reset | Done | `resetAllStores()` exists, `X-Team-Id` sent on requests |

---

## Architecture: "Single User = Team of One"

Both local mode and server mode use the same team-scoped data model:

```
Local mode:
  userId = LOCAL_USER_ID (fixed UUID)
  teamId = LOCAL_TEAM_ID (fixed UUID)
  All queries: WHERE team_id = LOCAL_TEAM_ID

Server mode (single user):
  userId = auth.users.id
  teamId = auto-created personal team
  All queries: WHERE team_id = personal_team_id

Server mode (multi-team):
  userId = auth.users.id
  teamId = selected from X-Team-Id header (validated against team_members)
  All queries: WHERE team_id = active_team_id
```

**Key invariant:** Every query uses `teamId` — there is no "unscoped" path. The team switcher changes which `teamId` is sent, and all data reloads for the new context.

---

## Implementation Steps

### Step 1: Add missing team CRUD endpoints

**File:** `server/routes/teams.ts`

Add these endpoints to the existing route file:

```
GET  /api/teams              — List user's teams with roles
POST /api/teams              — Create a new team (user becomes owner)
PUT  /api/teams/:id          — Update team name/description (owner/admin)
DELETE /api/teams/:id        — Delete team + all data (owner only)
PUT  /api/teams/:id/members/:userId/role — Change member role (owner/admin)
```

**`GET /api/teams`** implementation:
```typescript
// Join team_members → teams to get teams + user's role
const results = await db.select({
  id: teams.id,
  name: teams.name,
  description: teams.description,
  role: teamMembers.role,
  memberCount: sql<number>`(SELECT count(*) FROM team_members WHERE team_id = ${teams.id})`,
  createdAt: teams.createdAt,
})
  .from(teamMembers)
  .innerJoin(teams, eq(teams.id, teamMembers.teamId))
  .where(eq(teamMembers.userId, user.id))
  .orderBy(teams.createdAt)
```

**`POST /api/teams`** implementation:
- Insert into `teams` table
- Insert into `team_members` with `role: 'owner'`
- Return the new team

**`DELETE /api/teams/:id`** implementation:
- Verify user is owner
- Prevent deletion of the user's last team (personal workspace)
- Delete in order: `invite_tokens` → `team_members` → all team-scoped data → `teams`
- Use a transaction

**`PUT /api/teams/:id/members/:userId/role`** implementation:
- Verify user is owner or admin
- Admin cannot promote to owner
- Cannot demote the last owner
- Update `team_members.role`

---

### Step 2: Wire Settings Teams tab to real API calls

**File:** `src/pages/settings.tsx`, function `TeamsContent()`

Replace the 4 stubbed `// TODO` blocks:

**`fetchTeams`** (line ~1219):
```typescript
const headers = await getAuthHeaders()
const res = await fetch(apiUrl('/api/teams'), { headers })
const data = await res.json()
setTeams(data.teams)
```

**`fetchTeamData`** (line ~1241):
```typescript
const headers = await getAuthHeaders()
const [membersRes, invitesRes] = await Promise.all([
  fetch(apiUrl(`/api/teams/${selectedTeamId}/members`), { headers }),
  fetch(apiUrl(`/api/teams/${selectedTeamId}/invites`), { headers }),
])
const membersData = await membersRes.json()
const invitesData = await invitesRes.json()
setMembers(membersData.members)
setPendingInvites(invitesData.invites)
```

**`handleSendInvite`** (line ~1253):
```typescript
const headers = await getAuthHeaders()
await fetch(apiUrl('/api/teams/invite'), {
  method: 'POST',
  headers,
  body: JSON.stringify({ teamId: selectedTeamId, email: inviteEmail, role: inviteRole }),
})
// Re-fetch invites to refresh list
```

**`handleRevokeInvite`** (line ~1272):
```typescript
const headers = await getAuthHeaders()
await fetch(apiUrl(`/api/teams/invites/${inviteId}`), {
  method: 'DELETE',
  headers,
})
// Re-fetch invites
```

**`handleRemoveMember`** (line ~1286):
```typescript
const headers = await getAuthHeaders()
await fetch(apiUrl(`/api/teams/${selectedTeamId}/members/${userId}`), {
  method: 'DELETE',
  headers,
})
// Re-fetch members
```

---

### Step 3: Add sidebar team switcher (Slack-style dropdown)

**File:** `src/components/layout/sidebar.tsx`

Add a team switcher dropdown at the top of the sidebar, below the logo. Design follows the Slack workspace switcher pattern:

**Behavior:**
- Shows current active team name + chevron-down icon
- Clicking opens a dropdown listing all teams the user belongs to
- Each team shows: name, role badge, member count
- Personal workspace always listed first, marked with a home icon
- "Create Team" button at the bottom of the dropdown
- Only visible when user has 2+ teams (single-team users see nothing)
- Switching teams:
  1. Calls `setActiveTeamId(newTeamId)` on both `data-client` and `api-client`
  2. Saves `active-team-id` to `localStorage` for persistence across refreshes
  3. Calls `resetAllStores()` → DataLoader re-fetches everything for new team context

**Component:** `TeamSwitcher` (new component in sidebar, ~80 lines)

```
┌─────────────────────────┐
│ ▼ Zhuoran's Workspace   │  ← Clickable, opens dropdown
├─────────────────────────┤
│ 🏠 Personal       owner │  ← Always first
│    Acme Corp      admin │
│    Research Lab   member │
│─────────────────────────│
│ + Create Team            │
└─────────────────────────┘
```

**State management:**
- Read teams from `useTeamStore` (already loaded by `DataLoader` via `team-store.load()`)
- Active team ID stored in `localStorage('astro-active-team-id')`
- On mount, `team-store.load()` reads teams and sets active team ID on both API clients

**Data flow on team switch:**
1. User clicks team in dropdown
2. `setActiveTeamId(newId)` called on data-client + api-client
3. `localStorage.setItem('astro-active-team-id', newId)`
4. Call `resetAllStores()` from `src/app.tsx`
5. DataLoader re-runs: all stores reload with new `X-Team-Id` header
6. UI reflects new team's projects, plans, tasks, etc.

---

### Step 4: Add team-store to DataLoader

**File:** `src/app.tsx`

The `team-store` is currently NOT loaded in `DataLoader`. Add it:

1. Import `useTeamStore`
2. Add `loadTeams`, `teamsLoaded` to the selectors
3. Add `if (userChanged || !teamsLoaded) loadTeams()` to the effect
4. Add `teamsLoaded` to the `allLoaded` check
5. Add `useTeamStore.setState({ loaded: false })` to `resetAllStores()`

After teams load, `team-store.load()` already calls `setActiveTeamId()` on both API clients. But it currently defaults to `teams[0]`. It should:
1. Check `localStorage('astro-active-team-id')` first
2. Fall back to `teams[0]` if not found or not in user's teams

---

### Step 5: Create "New Team" dialog

**File:** `src/pages/settings.tsx` or sidebar team switcher

Add a dialog with:
- Team name (required)
- Team description (optional)
- Submit calls `POST /api/teams`
- On success, reload teams and switch to new team

---

## RBAC (Role-Based Access Control)

Three roles with hierarchical permissions:

| Role | Permissions |
|------|------------|
| **owner** | Full control. Can delete team, manage billing, transfer ownership, manage all members and roles. One owner per team (transferable). |
| **admin** | Can manage members (invite, remove, change roles except owner), manage projects, configure team settings. Cannot delete team or manage billing. |
| **member** | Can view and edit projects, create plans, dispatch tasks. Cannot manage team settings or members. |

**Permission matrix:**

| Action | owner | admin | member |
|--------|-------|-------|--------|
| View projects and plans | Yes | Yes | Yes |
| Create/edit projects | Yes | Yes | Yes |
| Dispatch tasks | Yes | Yes | Yes |
| Invite members | Yes | Yes | No |
| Remove members | Yes | Yes | No |
| Change member roles | Yes | Yes (not to owner) | No |
| Update team settings | Yes | Yes | No |
| Manage billing | Yes | No | No |
| Delete team | Yes | No | No |
| Transfer ownership | Yes | No | No |

**Implementation approach:**
- Role is stored in `team_members.role` column (already exists)
- Backend middleware checks role before allowing mutations (partially implemented in teams.ts)
- Frontend hides UI elements the user does not have permission for (backend enforces regardless)

---

## API Endpoints Summary

All team management endpoints require authentication. Mutation endpoints require appropriate role.

| Method | Endpoint | Description | Status | Required Role |
|--------|----------|-------------|--------|---------------|
| GET | `/api/teams` | List user's teams | **Missing** | Any authenticated |
| POST | `/api/teams` | Create team | **Missing** | Any authenticated |
| GET | `/api/teams/:id` | Get team details | **Missing** | Team member |
| PUT | `/api/teams/:id` | Update team | **Missing** | owner, admin |
| DELETE | `/api/teams/:id` | Delete team | **Missing** | owner |
| POST | `/api/teams/invite` | Send invite | Done | owner, admin |
| GET | `/api/teams/:teamId/invites` | List invites | Done | owner, admin |
| DELETE | `/api/teams/invites/:inviteId` | Revoke invite | Done | owner, admin |
| GET | `/api/teams/invite/:token` | Get invite details | Done | Public |
| POST | `/api/teams/accept/:token` | Accept invite | Done | Authenticated |
| GET | `/api/teams/:teamId/members` | List members | Done | Team member |
| DELETE | `/api/teams/:teamId/members/:userId` | Remove member | Done | owner, admin |
| PUT | `/api/teams/:id/members/:userId/role` | Change role | **Missing** | owner, admin |

---

## Frontend Pages

| Route | Page | Status | Description |
|-------|------|--------|-------------|
| `/settings?tab=teams` | Teams management | Shell built, API stubbed | Team list, members, invites |
| `/invite/:token` | Team invite acceptance | Done | Accept/decline invite UI |
| Sidebar team switcher | Team dropdown | Not started | Slack-style workspace switcher |

---

## Billing Integration (Future)

Stripe integration for team-based billing. Each team is a billing unit. Not in current scope.

**Planned features:**
- Per-team Stripe subscription linked to the team owner
- Plan tiers (Free, Pro, Enterprise) with usage limits
- Usage tracking per team (AI tokens, tasks dispatched, storage)
- Billing portal for invoices, payment method management
- Seat-based pricing

**Tables to add (when needed):**
- `billing_subscriptions` — team_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end
- `billing_events` — audit log of billing-related events

---

## Implementation Priority

```
Phase 1 (ship team support):
  1. Add missing CRUD endpoints (GET/POST/PUT/DELETE /api/teams, role change)
  2. Wire Settings Teams tab to real API calls (replace 4 TODOs)
  3. Add team-store to DataLoader + localStorage active team persistence
  4. Add sidebar team switcher (Slack-style dropdown)
  5. Create "New Team" dialog

Phase 2 (hardening):
  6. RBAC enforcement in all mutation endpoints
  7. Team deletion cascade (ensure all scoped data is cleaned up)
  8. Realtime sync for team changes (Supabase Realtime on team_members)
  9. E2E tests for team flows

Phase 3 (monetization):
  10. Billing integration (Stripe per-team subscription)
  11. Usage limits per plan tier
  12. Team settings page (name, description, danger zone)
```

**Prerequisites (already completed):**
- Team-scoped data model (all queries use `team_id`) — Phase 1
- `teams`, `team_members`, `invite_tokens` schema tables — Phase 1
- `X-Team-Id` header in frontend API clients — Phase 2
- Auth middleware resolves `teamId` from `team_members` — Phase 1
- Auto-created personal team on user registration — Phase 2b
- Account-switch loading fix (stale closure bug) — Phase 3

---

## Files Summary

| Step | File | Change Type |
|------|------|-------------|
| 1 | `server/routes/teams.ts` | Add 5 new endpoints |
| 2 | `src/pages/settings.tsx` `TeamsContent()` | Wire 4 stubbed API calls |
| 3 | `src/app.tsx` `DataLoader` | Add team-store to load cycle |
| 3 | `src/stores/team-store.ts` | Add localStorage active team persistence |
| 4 | `src/components/layout/sidebar.tsx` | Add TeamSwitcher component |
| 5 | `src/pages/settings.tsx` or sidebar | Add "Create Team" dialog |
