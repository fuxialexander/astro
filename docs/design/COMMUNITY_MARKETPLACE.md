# Community Marketplace Design

This document describes the architecture and implementation of Astro's Community Marketplace, a feature that enables users to publish, discover, fork, and collaborate on project plans.

## Overview

The Community Marketplace transforms Astro from a personal planning tool into a collaborative platform where users can:
- **Publish** project plans to share with the community
- **Discover** plans through browsing, search, and trending algorithms
- **Fork** plans to create their own versions
- **Engage** through starring and commenting
- **Track lineage** to understand plan evolution

## Architecture

### Data Model

```
┌──────────────────────────────────────────────────────────────┐
│                    Database Schema                            │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  shared_plans                                                │
│  ├── id (PK)                                                 │
│  ├── title, description, vision_doc                          │
│  ├── author_id (FK → user_profiles)                          │
│  ├── plan_data (JSONB: {nodes, edges})                       │
│  ├── visibility ('public' | 'team' | 'unlisted')             │
│  ├── stars_count, forks_count, comments_count                │
│  └── category, tags[], deleted_at                            │
│                                                               │
│  shared_plan_stars (user_id, plan_id composite PK)           │
│  shared_plan_forks (source_plan_id, forked_by, project_id)   │
│  shared_plan_comments (plan_id, author_id, content)          │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Three-Tier Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                          │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ Community      │  │ Plan Detail    │  │ Publish      │  │
│  │ Browser        │  │ Page           │  │ Dialog       │  │
│  └────────────────┘  └────────────────┘  └──────────────┘  │
│           │                   │                   │          │
│           └───────────────────┴───────────────────┘          │
│                               │                              │
└───────────────────────────────┼──────────────────────────────┘
                                │
┌───────────────────────────────┼──────────────────────────────┐
│                    Backend (Hono.js)                         │
│  ┌────────────────────────────────────────────────────┐     │
│  │         server/routes/community.ts                  │     │
│  │  ┌──────────────────────────────────────────────┐  │     │
│  │  │  POST /api/community/plans          (publish)│  │     │
│  │  │  GET  /api/community/plans          (browse) │  │     │
│  │  │  GET  /api/community/plans/:id      (details)│  │     │
│  │  │  POST /api/community/plans/:id/fork (fork)   │  │     │
│  │  │  POST /api/community/plans/:id/star (star)   │  │     │
│  │  │  POST /api/community/plans/:id/comments      │  │     │
│  │  │  GET  /api/community/plans/trending          │  │     │
│  │  │  GET  /api/community/my-plans                │  │     │
│  │  └──────────────────────────────────────────────┘  │     │
│  └────────────────────────────────────────────────────┘     │
└───────────────────────────────┼──────────────────────────────┘
                                │
┌───────────────────────────────┼──────────────────────────────┐
│                    Database (PostgreSQL + RLS)               │
│  ┌────────────────────────────────────────────────────┐     │
│  │  shared_plans, shared_plan_stars,                  │     │
│  │  shared_plan_forks, shared_plan_comments           │     │
│  │  + Row-Level Security (RLS) policies               │     │
│  └────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

## Core Workflows

### 1. Publish Workflow

```
User completes a project
  ↓
Click "Publish to Community" button
  ↓
PublishDialog opens:
  - Title, description, category
  - Visibility: public | team | unlisted
  - Optional: customization notes
  ↓
POST /api/community/plans
  ├── Sanitize plan data (remove execution-specific fields)
  ├── Compute execution summary (task counts)
  ├── Store in shared_plans table
  └── Return plan ID
  ↓
Navigate to community plan detail page
```

**Security:**
- Execution-specific fields (executionId, executionOutput, executionError) are stripped before publishing
- Project ownership is verified when computing execution summaries
- Author ID is automatically set from authenticated user

### 2. Browse & Discovery Workflow

```
User visits /community
  ↓
Community Browser Page:
  ├── Search bar (title/description)
  ├── Category tabs (all, workflows, templates, etc.)
  ├── Sort options (stars, recent, forks)
  └── Plan cards grid
  ↓
GET /api/community/plans?category=X&sort=Y&search=Z
  ├── Filter by visibility (public, or team if member)
  ├── Apply category/tag filters
  ├── Apply search (full-text on title/description)
  ├── Sort by stars/recent/forks
  └── Paginate results (20 per page)
  ↓
Display plan cards:
  - Title, description (truncated)
  - Author name (or "Anonymous")
  - Stars, forks, comments counts
  - Category badge, tags
```

**Visibility Rules:**
- **Public** plans: visible to all authenticated users
- **Team** plans: visible only to team members
- **Unlisted** plans: visible only to author (shareable via direct link)

### 3. Plan Detail & Read-Only Canvas

```
User clicks on a plan card
  ↓
Navigate to /community/:planId
  ↓
GET /api/community/plans/:id
  ├── Check visibility permissions
  ├── Fetch plan data + author info
  └── Return full plan details
  ↓
Render plan detail page:
  ├── Header: title, author, stats, actions
  ├── Read-only React Flow canvas (non-interactive)
  ├── Vision doc (expandable)
  ├── Comments section (threaded)
  └── Lineage banner (if forked from another plan)
```

**Read-Only Canvas:**
- Uses `PlanCanvas` component with `readOnly={true}` prop
- Nodes and edges are displayed but not draggable or selectable
- No context menus or edit actions
- Preserves zoom/pan for exploration

### 4. Fork Workflow

```
User clicks "Fork" button on plan detail page
  ↓
ForkDialog opens:
  - Confirm fork action
  - Preview: title (with "(Fork)" suffix)
  ↓
POST /api/community/plans/:id/fork
  ├── Check visibility permissions
  ├── Generate new UUIDs for all nodes and edges
  ├── Reset execution state (status → 'planned')
  ├── Create new project with forked nodes/edges
  ├── Record fork in shared_plan_forks table
  ├── Increment forks_count on source plan
  └── Return new project ID
  ↓
Navigate to /projects/:projectId (new forked project)
```

**ID Remapping:**
```
Source Plan                     Forked Project
├── node-abc123                 ├── node-def456 (new UUID)
├── node-xyz789                 ├── node-ghi012 (new UUID)
└── edge-src-abc→tgt-xyz        └── edge-src-def→tgt-ghi (remapped)
```

**Lineage Tracking:**
- Forked projects store source plan ID in `projects.source.planId`
- Community plan detail page displays "Forked from X by Y" banner
- Enables future lineage graph visualization

### 5. Social Features: Stars & Comments

#### Star/Unstar

```
User clicks star button
  ↓
POST /api/community/plans/:id/star
  ├── Check visibility permissions
  ├── Check if already starred
  ├── If starred: delete star record, decrement count
  └── If not starred: insert star record, increment count
  ↓
Return { starred: true/false }
  ↓
Update UI immediately (optimistic update)
```

#### Comments (Threaded)

```
User submits comment
  ↓
POST /api/community/plans/:id/comments
  ├── Check visibility permissions
  ├── Validate content (non-empty)
  ├── Verify parent comment exists (if reply)
  ├── Insert comment with author_id
  ├── Increment comments_count
  └── Return comment object
  ↓
GET /api/community/plans/:id/comments
  ├── Fetch all comments with author info
  ├── Build nested structure (replies under parents)
  └── Return { comments: rootComments[] }
  ↓
Render threaded comments UI:
  - Root comments with nested replies
  - Edit/delete for own comments
  - Reply button for all comments
```

### 6. Trending Algorithm

```
GET /api/community/plans/trending
  ↓
Calculate trending score:
  score = (stars_last_7d × 2) + (forks_last_7d × 3) + ln(total_stars + 1)
  ↓
Filter by visibility (public, or team if member)
  ↓
Order by score DESC
  ↓
Return top 20 plans
```

**Weighting Rationale:**
- Forks (×3) are weighted highest — indicates serious adoption
- Recent stars (×2) indicate current popularity
- Logarithmic total stars bonus prevents old plans from dominating

## Local Mode Behavior

Community features require authentication and are unavailable in local mode (PGlite). All access points are guarded at the component level:

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Community Access Points                          │
│                                                                      │
│  Sidebar link ──────── isServerMode() ──── hidden in local mode     │
│                                                                      │
│  /community page ───── isLocalMode()  ──── EmptyState message       │
│                                                                      │
│  /community/:id ────── isLocalMode()  ──── EmptyState message       │
│                                                                      │
│  Publish button ────── isServerMode() ──── hidden in local mode     │
│  (plan-view.tsx)                                                     │
│                                                                      │
│  Dashboard CTA ─────── isServerMode() ──── hidden in local mode     │
│  "Browse Community"                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

The guided product tour (driver.js) also adapts: the Community step is skipped in local mode, showing 4 steps instead of 5.

## Security & Access Control

### Three-Layer Defense

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Authentication Middleware (requireAuth)       │
│  ✓ All /api/community/* routes require auth             │
│  ✓ User ID from JWT token                               │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Layer 2: Application-Level Checks (Hono routes)        │
│  ✓ Visibility checks (public | team | unlisted)         │
│  ✓ Ownership checks (author can edit/delete)            │
│  ✓ Project ownership checks (when fetching data)        │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Row-Level Security (RLS) Policies             │
│  ✓ Database-level enforcement                           │
│  ✓ Protects against direct DB access or ORM bugs        │
│  ✓ Automatic filtering based on auth.uid()              │
└─────────────────────────────────────────────────────────┘
```

### RLS Policies (Migration 20260304000000)

#### shared_plans

```sql
-- Read: public, or team member, or author
SELECT: visibility = 'public'
     OR (visibility = 'team' AND team_id IN (user's teams))
     OR (visibility = 'unlisted' AND author_id = current_user)
     OR author_id = current_user

-- Write: author only
INSERT: author_id = current_user (or NULL for anonymous)
UPDATE: author_id = current_user
DELETE: author_id = current_user
```

#### shared_plan_stars

```sql
-- Read: can read the plan
SELECT: plan_id IN (accessible plans)

-- Write: own stars only
INSERT: user_id = current_user
DELETE: user_id = current_user
```

#### shared_plan_forks

```sql
-- Read: can read the plan OR is the forker
SELECT: source_plan_id IN (accessible plans) OR forked_by = current_user

-- Write: own forks only
INSERT: forked_by = current_user
```

#### shared_plan_comments

```sql
-- Read: can read the plan
SELECT: plan_id IN (accessible plans)

-- Write: own comments only
INSERT: author_id = current_user
UPDATE: author_id = current_user
DELETE: author_id = current_user
```

### Sanitization Rules

**Before Publishing:**
1. Strip execution-specific fields:
   - `executionId`, `executionOutput`, `executionError`
   - `executionStartedAt`, `executionCompletedAt`
2. Remove sensitive project metadata:
   - Machine IDs, environment variables
   - File paths (workingDirectory, sourceDirectory)
3. Preserve:
   - Plan structure (nodes, edges)
   - Vision doc, prompts, acceptance criteria
   - Template parameters (if derived from template)

**Before Forking:**
1. Regenerate all UUIDs (nodes, edges)
2. Reset execution state (`status` → 'planned')
3. Clear node-specific IDs (`number`, `executionId`)
4. Preserve node metadata (title, description, prompts)

## Frontend Components

### 1. Community Browser (`src/pages/community.tsx`)

**Features:**
- Search bar with debounced full-text search
- Category tabs (all, workflows, templates, research, etc.)
- Sort dropdown (stars, recent, forks)
- Infinite scroll pagination
- Plan card grid (responsive: 1-3 columns)

**State Management:**
- `useCommunityStore` (Zustand)
- Optimistic updates for star actions
- Cache plans in memory, invalidate on publish

### 2. Plan Detail Page (`src/pages/community-plan-detail.tsx`)

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Header: [Title] [Author] [Stars] [Forks] [Comments]    │
│  Actions: [Star] [Fork] [Export] [Share]                │
├─────────────────────────────────────────────────────────┤
│  Lineage Banner (if forked): "Forked from X by Y"       │
├─────────────────────────────────────────────────────────┤
│  Vision Doc (collapsible)                               │
├─────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────┐  │
│  │     Read-Only React Flow Canvas                   │  │
│  │  ┌──────┐       ┌──────┐       ┌──────┐          │  │
│  │  │Task 1│ ───▶  │Task 2│ ───▶  │Task 3│          │  │
│  │  └──────┘       └──────┘       └──────┘          │  │
│  └───────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  Comments Section (threaded)                            │
│  ├── Comment 1 by User A                                │
│  │   └── Reply 1.1 by User B                            │
│  └── Comment 2 by User C                                │
└─────────────────────────────────────────────────────────┘
```

**Read-Only Canvas Modifications:**
- `PlanCanvas` accepts `readOnly` prop
- Disables node/edge drag & drop
- Disables selection and context menus
- Keeps zoom/pan controls for navigation
- Uses simplified node rendering (no status badges)

### 3. Publish Dialog (`src/components/community/publish-dialog.tsx`)

**3-Step Wizard:**
```
┌─────────────────────────────────────────────────────────┐
│  Step 1: Basic Info                                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Title:       [__________________________]       │   │
│  │ Description: [__________________________]       │   │
│  │                                                 │   │
│  │ Category:    [▼ Select category ]              │   │
│  │ Tags:        [tag1] [tag2] [+ Add]             │   │
│  └─────────────────────────────────────────────────┘   │
│                                          [Next ▶]       │
├─────────────────────────────────────────────────────────┤
│  Step 2: Visibility                                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ◉ Public     (visible to everyone)             │   │
│  │ ○ Team only  (visible to team members)         │   │
│  │ ○ Unlisted   (only via direct link)            │   │
│  └─────────────────────────────────────────────────┘   │
│                                [◀ Back]  [Next ▶]       │
├─────────────────────────────────────────────────────────┤
│  Step 3: Preview                                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Title: Build a web scraper                      │   │
│  │ Author: You                                     │   │
│  │ Category: workflows                             │   │
│  │ Tags: [python] [automation]                     │   │
│  │ Visibility: Public                              │   │
│  │ Tasks: 12 total, 10 completed                   │   │
│  └─────────────────────────────────────────────────┘   │
│                                [◀ Back]  [Publish]      │
└─────────────────────────────────────────────────────────┘
```

### 4. Fork Dialog (`src/components/community/fork-dialog.tsx`)

**Simple Confirmation:**
```
┌─────────────────────────────────────────────────────────┐
│  Fork Plan: "Build a web scraper"                       │
│                                                          │
│  This will create a new project in your workspace:      │
│    • Name: "Build a web scraper (Fork)"                 │
│    • All tasks will be reset to 'planned'               │
│    • Execution history will be cleared                  │
│                                                          │
│                            [Cancel]  [Fork This Plan]   │
└─────────────────────────────────────────────────────────┘
```

### 5. Plan Card (`src/components/community/plan-card.tsx`)

**Card Layout:**
```
┌─────────────────────────────────────────────┐
│  📋  Build a web scraper                     │
│                                              │
│  Automated data collection from websites... │
│  (description truncated to 2 lines)         │
│                                              │
│  👤 John Doe                                 │
│  📁 workflows    🏷️ python  automation       │
│                                              │
│  ⭐ 42   🍴 12   💬 8   🕒 2 days ago        │
└─────────────────────────────────────────────┘
```

## API Endpoints Reference

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/community/plans` | Publish a plan | ✓ |
| GET | `/api/community/plans` | List plans (browse/search) | ✓ |
| GET | `/api/community/plans/:id` | Get plan details | ✓ |
| PUT | `/api/community/plans/:id` | Update plan (author only) | ✓ |
| DELETE | `/api/community/plans/:id` | Soft delete plan (author only) | ✓ |
| POST | `/api/community/plans/:id/fork` | Fork plan to new project | ✓ |
| GET | `/api/community/plans/:id/export` | Export plan as .astro.json | ✓ |
| POST | `/api/community/plans/:id/star` | Toggle star (upvote) | ✓ |
| GET | `/api/community/plans/:id/starred` | Check if user starred plan | ✓ |
| GET | `/api/community/plans/:id/comments` | List comments (threaded) | ✓ |
| POST | `/api/community/plans/:id/comments` | Add comment or reply | ✓ |
| PUT | `/api/community/comments/:id` | Edit comment (author only) | ✓ |
| DELETE | `/api/community/comments/:id` | Soft delete comment (author only) | ✓ |
| GET | `/api/community/plans/trending` | Get trending plans (7d window) | ✓ |
| GET | `/api/community/plans/categories` | Get categories with counts | ✓ |
| GET | `/api/community/my-plans` | Get user's published plans | ✓ |

## Database Indexes

Performance-critical indexes:

```sql
-- Sorting and filtering
CREATE INDEX shared_plans_stars_count_idx ON shared_plans(stars_count DESC);
CREATE INDEX shared_plans_created_at_idx ON shared_plans(created_at DESC);
CREATE INDEX shared_plans_category_idx ON shared_plans(category);
CREATE INDEX shared_plans_author_id_idx ON shared_plans(author_id);

-- Comments lookup
CREATE INDEX shared_plan_comments_plan_id_idx ON shared_plan_comments(plan_id);

-- Trending algorithm (7-day window queries)
CREATE INDEX shared_plan_stars_created_at_idx ON shared_plan_stars(created_at);
CREATE INDEX shared_plan_forks_created_at_idx ON shared_plan_forks(created_at);
```

## Future Enhancements

### Phase 2: Advanced Features (Planned)

1. **Collections**
   - Users can create curated lists of plans
   - "My Favorites", "Python Tutorials", "ML Workflows"
   - Public or private collections

2. **Follow Authors**
   - Follow users to get notified of their new plans
   - Author activity feed

3. **Plan Remixing**
   - Merge multiple plans into one project
   - "This plan + that plan" workflow builder

4. **Verified Plans**
   - Badge for plans that meet quality criteria
   - Automated checks: has tests, has docs, builds successfully

5. **Plan Templates Marketplace**
   - Convert plans to parameterized templates
   - Template versioning and updates
   - "Install" templates directly from community

6. **Analytics Dashboard**
   - Plan views, fork rate, engagement metrics
   - Author leaderboard and reputation system

### Phase 3: Enterprise Features (Future)

1. **Team Marketplaces**
   - Private marketplace for team-only plans
   - Organization-wide plan library

2. **Plan Subscriptions**
   - Subscribe to plan updates
   - Get notified when author publishes a new version

3. **Paid Plans**
   - Premium plans with payment processing
   - Revenue sharing for authors

## Implementation Checklist

### Phase 1: Core Marketplace (Complete)

- [x] Database schema and migrations
- [x] RLS policies for shared_plans tables
- [x] Backend API routes (publish, browse, fork, star, comment)
- [x] Community browser page with search and filtering
- [x] Plan detail page with read-only canvas
- [x] Publish dialog (3-step wizard)
- [x] Fork dialog and ID remapping logic
- [x] Comments section with threading
- [x] Trending algorithm
- [x] "My Plans" section
- [x] Lineage tracking (fork attribution)

### Phase 2: Polish & Enhancements (Pending)

- [ ] Collections feature
- [ ] Follow authors
- [ ] Plan remixing
- [ ] Verified plans badge
- [ ] Analytics dashboard
- [ ] Improved search (Postgres full-text search)
- [ ] Plan preview thumbnails (auto-generated from canvas)
- [ ] Export plan as PDF/image
- [ ] Keyboard shortcuts for browsing

## Related Files

- `packages/core/src/db/schema.ts` — Database schema definitions
- `supabase/migrations/20260304000000_add_community_rls.sql` — RLS policies
- `server/routes/community.ts` — Backend API implementation
- `src/pages/community.tsx` — Community browser page
- `src/pages/community-plan-detail.tsx` — Plan detail page
- `src/components/community/publish-dialog.tsx` — Publish dialog
- `src/components/community/fork-dialog.tsx` — Fork dialog
- `src/components/community/plan-card.tsx` — Plan card component
- `src/stores/community-store.ts` — Zustand state management
- `src/lib/community-client.ts` — API client functions

## Testing Recommendations

### Unit Tests (To Be Added)

- **Fork ID remapping**: Verify all node/edge IDs are regenerated and references updated
- **Trending score calculation**: Test edge cases (zero stars, new plans, old popular plans)
- **Comment threading**: Ensure correct nested structure with orphaned replies
- **Visibility filtering**: Verify RLS policies match application-level checks

### Integration Tests (To Be Added)

- **Publish → Fork → Edit cycle**: Full end-to-end workflow
- **Cross-user access**: Verify user A cannot star/comment on user B's unlisted plan
- **Soft delete cascades**: Ensure comments/stars remain intact when plan is soft-deleted

### Manual Testing Checklist

- [ ] Publish a plan with all visibility types (public, team, unlisted)
- [ ] Fork a plan and verify no execution data leaks
- [ ] Star/unstar plans, verify counts update correctly
- [ ] Post root comments and replies, verify threading
- [ ] Edit/delete own comments, verify others cannot
- [ ] Search for plans by keywords
- [ ] Filter by category and tags
- [ ] Sort by stars/recent/forks
- [ ] View trending plans, verify freshness

## Performance Considerations

### Query Optimization

- **Trending endpoint**: Uses subqueries for 7-day counts — consider materialized view if slow
- **Comments endpoint**: Fetches all comments for a plan — consider pagination if threads grow large
- **Browse endpoint**: Uses ILIKE for search — consider Postgres full-text search (tsvector) for large datasets

### Caching Strategy (Future)

- **Plan cards**: Cache in Redis for 5 minutes, invalidate on updates
- **Trending plans**: Recompute hourly, cache results
- **User's starred plans**: Cache per-user, invalidate on star/unstar

### CDN for Static Assets (Future)

- **Plan thumbnails**: Auto-generate canvas screenshots, serve from CDN
- **Author avatars**: Serve from Cloudflare Images
