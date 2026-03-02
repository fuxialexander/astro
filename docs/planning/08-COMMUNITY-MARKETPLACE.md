# Community Marketplace: Plan Sharing and Template Exchange

## Vision

The core intellectual property in Astro is the **plan graph** — the structured decomposition of a complex goal into executable tasks with dependencies, prompts, and configuration. A plan is to an AI agent what a program is to a computer. Users invest significant effort refining system prompts, task decompositions, and execution strategies. The community marketplace lets them share these refined plans with others, creating a network effect that makes Astro more valuable for everyone.

## Core Concepts

### Plan = Program in the LLM Era

```
Traditional: Source code → Compiler → Execution
Astro:       System prompt → Plan graph → Agent execution
```

A shared plan includes:
- **System prompt / vision doc** — The high-level description and constraints
- **Plan graph** (nodes + edges) — The task DAG with prompts, dependencies, and config
- **Template parameters** — What the user needs to customize to run it themselves
- **Execution results** (optional) — Proof that the plan works, with metrics

### User Journey

```
1. User creates project → generates plan → refines it → executes it
2. Results are good → user clicks "Publish to Community"
3. User writes description, marks customizable fields, sets visibility
4. Plan appears on Community page
5. Another user discovers it → stars it → clicks "Use This Plan"
6. System creates local copy with their project name
7. New user edits prompts for their context → generates/imports graph → runs it
```

## Data Model

### Shared Plan (Database Schema)

```sql
CREATE TABLE shared_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  title VARCHAR(200) NOT NULL,
  description TEXT,                     -- Markdown description of what the plan does
  author_id UUID REFERENCES user_profiles(id),
  author_name VARCHAR(100),             -- Display name (or "Anonymous")
  is_anonymous BOOLEAN DEFAULT false,

  -- Content (the actual plan)
  vision_doc TEXT,                       -- System prompt / vision document
  plan_data JSONB NOT NULL,             -- { nodes: PlanNode[], edges: PlanEdge[] }
  template_id VARCHAR(100),             -- If created from a template
  template_parameters JSONB,            -- Original parameters used

  -- Customization guide
  customization_notes TEXT,             -- "Change node 3's prompt for your own dataset"
  customizable_fields JSONB,            -- Array of { nodeId, field, description }

  -- Execution evidence
  execution_summary JSONB,              -- { totalTasks, completed, failed, totalCost, totalTokens }
  execution_results TEXT,               -- Summary of what the execution produced

  -- Metadata
  category VARCHAR(50),                 -- software-development, research, etc.
  tags TEXT[],                          -- searchable tags
  version INTEGER DEFAULT 1,

  -- Community metrics
  stars_count INTEGER DEFAULT 0,
  forks_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,

  -- Visibility
  visibility VARCHAR(20) DEFAULT 'public',  -- public, team, unlisted
  team_id UUID REFERENCES teams(id),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Soft delete
  deleted_at TIMESTAMPTZ
);

-- Stars (upvotes)
CREATE TABLE shared_plan_stars (
  user_id UUID REFERENCES user_profiles(id),
  plan_id UUID REFERENCES shared_plans(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, plan_id)
);

-- Forks (copies)
CREATE TABLE shared_plan_forks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_plan_id UUID REFERENCES shared_plans(id),
  forked_by UUID REFERENCES user_profiles(id),
  project_id UUID REFERENCES projects(id),     -- The local project created from fork
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Comments
CREATE TABLE shared_plan_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES shared_plans(id),
  author_id UUID REFERENCES user_profiles(id),
  author_name VARCHAR(100),
  content TEXT NOT NULL,
  parent_comment_id UUID REFERENCES shared_plan_comments(id), -- For replies
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_shared_plans_category ON shared_plans(category);
CREATE INDEX idx_shared_plans_stars ON shared_plans(stars_count DESC);
CREATE INDEX idx_shared_plans_created ON shared_plans(created_at DESC);
CREATE INDEX idx_shared_plans_author ON shared_plans(author_id);
CREATE INDEX idx_shared_plan_comments_plan ON shared_plan_comments(plan_id);
```

### Drizzle ORM Schema

```typescript
// server/lib/db/schema.ts additions

export const sharedPlans = pgTable('shared_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  authorId: uuid('author_id').references(() => userProfiles.id),
  authorName: varchar('author_name', { length: 100 }),
  isAnonymous: boolean('is_anonymous').default(false),
  visionDoc: text('vision_doc'),
  planData: jsonb('plan_data').notNull(),
  templateId: varchar('template_id', { length: 100 }),
  templateParameters: jsonb('template_parameters'),
  customizationNotes: text('customization_notes'),
  customizableFields: jsonb('customizable_fields'),
  executionSummary: jsonb('execution_summary'),
  executionResults: text('execution_results'),
  category: varchar('category', { length: 50 }),
  tags: text('tags').array(),
  version: integer('version').default(1),
  starsCount: integer('stars_count').default(0),
  forksCount: integer('forks_count').default(0),
  commentsCount: integer('comments_count').default(0),
  visibility: varchar('visibility', { length: 20 }).default('public'),
  teamId: uuid('team_id').references(() => teams.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  deletedAt: timestamp('deleted_at'),
})
```

## API Endpoints

### Shared Plans

```
POST   /api/community/plans              -- Publish a plan
GET    /api/community/plans              -- List/search plans (paginated)
GET    /api/community/plans/:id          -- Get plan details
PUT    /api/community/plans/:id          -- Update plan (author only)
DELETE /api/community/plans/:id          -- Delete plan (author only)
POST   /api/community/plans/:id/fork     -- Fork plan to local project
GET    /api/community/plans/:id/export   -- Download plan as JSON

POST   /api/community/plans/:id/star     -- Star/unstar a plan
GET    /api/community/plans/:id/starred  -- Check if current user starred

GET    /api/community/plans/:id/comments -- List comments
POST   /api/community/plans/:id/comments -- Add comment
PUT    /api/community/comments/:id       -- Edit comment (author only)
DELETE /api/community/comments/:id       -- Delete comment (author only)

GET    /api/community/plans/trending     -- Trending plans (by stars in last 7 days)
GET    /api/community/plans/categories   -- Categories with counts
GET    /api/community/my-plans           -- Current user's published plans
```

### Query Parameters for List

```
GET /api/community/plans?
  category=research-analysis&
  tags=ml,training&
  sort=stars|recent|forks&
  search=keyword&
  author=userId&
  page=1&
  limit=20
```

## Frontend Pages

### Community Browser (`/community`)

```
/community
├── Header: "Community Plans" + search bar
├── Category tabs: All | Software | Research | ML | DevOps | Docs | ...
├── Sort: Trending | Most Stars | Newest | Most Forked
├── Plan cards grid:
│   ├── Title
│   ├── Description (truncated)
│   ├── Author (or "Anonymous")
│   ├── Category badge
│   ├── Stars count + Fork count
│   ├── Node count (plan complexity indicator)
│   └── Created date
└── Pagination
```

### Plan Detail (`/community/plans/:id`)

```
/community/plans/:id
├── Header: Title + Author + Stars/Forks counts
├── Star button + Fork button ("Use This Plan")
├── Tabs:
│   ├── Overview
│   │   ├── Description (markdown rendered)
│   │   ├── Customization notes
│   │   ├── Execution summary (if provided)
│   │   └── Tags
│   ├── Plan Preview
│   │   ├── Read-only React Flow graph visualization
│   │   ├── Node list with prompts
│   │   └── Vision doc preview
│   └── Comments
│       ├── Comment list (threaded)
│       └── Add comment form
└── Sidebar:
    ├── Author info
    ├── Category
    ├── Template used (if any)
    ├── Created/Updated dates
    └── Download JSON button
```

### Publish Dialog (from Plan View)

In the plan-view page, add a "Publish" button (next to existing Export button):

```
[Publish to Community] dialog:
├── Title (pre-filled from project name)
├── Description (markdown editor)
├── Category (dropdown)
├── Tags (multi-select / free-form)
├── Customization Notes (textarea)
│   "Explain what others should change to use this plan"
├── Mark Customizable Fields (interactive)
│   Show each node → user clicks to mark which fields are customizable
├── Include Execution Results? (checkbox)
├── Visibility: Public | Team Only | Unlisted
├── Anonymous? (checkbox)
└── [Publish] [Cancel]
```

### Fork Flow ("Use This Plan")

When a user clicks "Use This Plan":

```
1. Dialog appears:
   ├── "Create a new project from this plan"
   ├── Project Name (text input, required)
   ├── Working Directory (optional)
   ├── "This plan has X customizable fields you should review"
   └── [Create Project] [Cancel]

2. On submit:
   ├── POST /api/community/plans/:id/fork
   ├── Server creates new project with:
   │   ├── Vision doc from shared plan
   │   ├── Plan graph (nodes + edges) with new UUIDs
   │   └── source: { type: 'community-fork', planId, forkedAt }
   ├── Increment fork count on original plan
   └── Navigate to /project/:newId/plan

3. User lands on plan view with the forked graph
   ├── Banner: "Forked from [Original Plan Name] by [Author]"
   ├── Customizable fields highlighted
   └── User can edit prompts and re-run
```

## Implementation Plan

### Phase 1: Backend Foundation (1-2 weeks)

1. **Database migration** — Add `shared_plans`, `shared_plan_stars`, `shared_plan_forks`, `shared_plan_comments` tables
2. **API routes** — `server/routes/community.ts` with all CRUD endpoints
3. **Fork logic** — Clone plan data with new UUIDs, create project, track lineage
4. **Search** — Full-text search on title, description, tags using PostgreSQL `tsvector`

### Phase 2: Publishing Flow (1 week)

1. **Publish button** in plan-view header (next to Export)
2. **Publish dialog** component with form fields
3. **Plan snapshot** — Serialize current plan graph + vision doc to JSONB
4. **Customizable fields picker** — Let user mark which node fields others should edit

### Phase 3: Community Browser (1-2 weeks)

1. **Community page** (`/community`) with card grid
2. **Category tabs and search**
3. **Sorting and filtering**
4. **Plan detail page** with graph preview
5. **Sidebar navigation** — Add "Community" link

### Phase 4: Social Features (1 week)

1. **Star/unstar** with optimistic UI updates
2. **Comments** with threaded replies
3. **Fork flow** — "Use This Plan" → create local project
4. **Fork banner** — Show lineage on forked projects

### Phase 5: Polish (1 week)

1. **Trending algorithm** — Stars-per-day weighted by recency
2. **Author profiles** — Link to user's published plans
3. **Related plans** — "Users who forked this also liked..."
4. **Moderation** — Report inappropriate content

## Local Mode Considerations

For now, community is **server-mode only**. Local users can:
- **Export** plans as JSON (already works via existing export)
- **Import** plans from JSON files (already works via existing import)

If we want local users to access community in the future:
- Read-only API access with anonymous browsing
- Download plan JSON → import locally
- No publishing from local mode (requires auth)

## Relationship to Templates vs Shared Plans

| Aspect | Templates | Shared Plans |
|--------|-----------|-------------|
| Author | Platform team | Any user |
| Content | Parameters + prompt templates | Complete plan graph + vision doc |
| Customization | Fill parameters → generate graph | Edit existing graph directly |
| Versioning | Semver, maintained | User revisions, community feedback |
| Quality | Curated, tested | Community-driven, starred |
| Use case | "I want to do X" (starting point) | "Someone did X well, I want their approach" |

They complement each other:
- Templates: "Start from a blueprint"
- Shared Plans: "Start from someone's proven execution"

## Technical Considerations

### Plan Data Size
- Average plan: 10-50 nodes, ~50-200KB JSON
- PostgreSQL JSONB handles this easily
- Consider compression for plans with large prompts

### Search Performance
- Use PostgreSQL `tsvector` for full-text search
- Index on category, tags, stars_count
- Cache trending results (refresh every 15 minutes)

### Privacy
- Anonymous publishing hides author identity
- Team-only visibility restricts to team members
- Unlisted plans accessible only via direct link
- No personal data in plan exports (sanitize before publishing)

### Content Moderation
- Report button on each plan and comment
- Admin review queue (future)
- Auto-flag plans with suspicious content (future)
