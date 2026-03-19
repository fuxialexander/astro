# User-Defined Examples & Prompt Templates — Implementation Guide

> Last updated: 2026-03-19
> Status: READY TO IMPLEMENT
> Design doc: [USER_EXAMPLES_AND_PROMPT_TEMPLATES.md](./USER_EXAMPLES_AND_PROMPT_TEMPLATES.md)

This document contains the concrete, file-by-file implementation plan. Each phase is a self-contained PR that delivers a **vertical slice** (backend + frontend together) behind the `user-examples` feature flag.

## CRITICAL: Feature Flag Discipline

The server is deployed and live. **Every new endpoint, UI section, store load, and page modification must be gated behind the `user-examples` feature flag.** External users must see zero changes until GA.

### Flag Enforcement Checklist (applies to ALL phases)

| Layer | How to Gate |
|-------|-------------|
| **Backend routes** | Feature-gate middleware: `if (!hasFeature(team?.featureFlags, 'user-examples')) return c.json({ error: 'Feature not enabled' }, 403)` on every new route group |
| **Existing route changes** | `GET /api/examples` response shape must NOT change for unflagged teams — only add `custom` field when flag is on |
| **Frontend sections** | `const userExamplesEnabled = useFeatureFlag('user-examples')` — wrap all new UI in `{userExamplesEnabled && (...)}` |
| **Store loading** | Do NOT call `load()` for custom-example-store or prompt-template-store unless flag is on — avoids 403 errors for unflagged users |
| **Data loader** | Gate the new store loads: `if (hasFeature) { loadCustomExamples(); loadPromptTemplates(); }` |
| **Dispatch schema** | New optional field `promptTemplateContent` — harmless if unused, but the UI that sends it must be gated |

### Implementation Order (Revised)

The phases are now **vertical slices** — each delivers a testable end-to-end feature behind the flag, not horizontal layers.

| Phase | What | Delivers |
|-------|------|----------|
| **1** | Foundation | DB tables + feature flag + route stubs. Zero UI. Zero risk. |
| **2** | Custom Examples E2E | Backend CRUD + store + examples page with "My Examples" section + launch flow. Internal users can create/edit/delete/launch custom examples. |
| **3** | AI Example Generator | AI generation endpoint + generator dialog. Internal users can describe a workflow and AI creates the template. |
| **4** | Save Project as Example | Save-from-project endpoint + dialog + project page menu item. Internal users can save completed projects as reusable examples. |
| **5** | Prompt Templates E2E | Backend CRUD + store + examples page section + editor dialog. Internal users can create/manage prompt templates. |
| **6** | Prompt Templates at Launch | Dispatch integration + plan page selector. Internal users can apply prompt templates when creating projects or dispatching tasks. |
| **7** | Polish | View prompts on built-ins, clone action, badge refinements. |

---

## Phase 1: Foundation (DB + Flag + Route Stubs)

**Goal**: Create tables, Drizzle schema, migrations, feature flag, empty route files. No UI, no risk. Deploy this first — the flag defaults to `false` so nothing is visible.

### Step 1.1: Feature Flag

**File: `server/lib/feature-flags.ts`** — Add to `GLOBAL_DEFAULTS`:
```typescript
'user-examples': false,
```

**File: `src/hooks/use-feature-flag.ts`** — Add identical entry to `GLOBAL_DEFAULTS`:
```typescript
'user-examples': false,
```

**File: `scripts/sync-feature-flags.ts`** — Add to `INTERNAL_FLAGS`:
```typescript
'user-examples': true,
```

Run `npm run env:prod && npm run flags` after deploy to enable for internal teams.

### Step 1.2: Drizzle Schema

**File: `packages/core/src/db/schema.ts`** — Add two tables after existing tables:

```typescript
// ── Custom Examples ──────────────────────────────────────────────────
export const customExamples = pgTable('custom_examples', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default('custom'),
  icon: text('icon'),
  tags: text('tags').array().notNull().default([]),

  // Parameter schema (mirrors UseCaseTemplate)
  requiredParameters: jsonb('required_parameters').notNull().default([]),
  optionalParameters: jsonb('optional_parameters').notNull().default([]),

  // Prompts — the core value
  // { planGeneration: string, taskExecution?: string, planRefinement?: string, sharedContext?: string }
  prompts: jsonb('prompts').notNull(),

  // Execution guidance (optional)
  execution: jsonb('execution'),
  parallelization: jsonb('parallelization'),
  planHints: jsonb('plan_hints'),

  // Skills
  recommendedSkills: text('recommended_skills').array().notNull().default([]),

  // Provenance
  source: text('source').notNull().default('user'), // 'user' | 'project' | 'ai-generated'
  sourceProjectId: uuid('source_project_id'),

  // Visibility
  visibility: text('visibility').notNull().default('team'), // 'personal' | 'team'

  // Ownership
  authorId: uuid('author_id').notNull(),
  teamId: uuid('team_id'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('custom_examples_name_author').on(table.name, table.authorId),
  index('custom_examples_author_idx').on(table.authorId),
  index('custom_examples_team_idx').on(table.teamId),
  index('custom_examples_category_idx').on(table.category),
])

// ── Prompt Templates ─────────────────────────────────────────────────
export const promptTemplates = pgTable('prompt_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),

  // Scope: which launch stage this template applies to
  scope: text('scope').notNull(), // 'project' | 'task'

  // The prompt body (markdown, may contain {{param}} placeholders)
  content: text('content').notNull(),

  // Optional parameter hints for placeholder UI
  // Array of { name: string, description: string, default?: string }
  parameters: jsonb('parameters').notNull().default([]),

  tags: text('tags').array().notNull().default([]),

  // Visibility
  visibility: text('visibility').notNull().default('team'), // 'personal' | 'team'

  // Ownership
  authorId: uuid('author_id').notNull(),
  teamId: uuid('team_id'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('prompt_templates_name_scope_author').on(table.name, table.scope, table.authorId),
  index('prompt_templates_author_idx').on(table.authorId),
  index('prompt_templates_team_idx').on(table.teamId),
  index('prompt_templates_scope_idx').on(table.scope),
])
```

**File: `server/lib/db/schema.ts`** — Add re-exports:
```typescript
export { customExamples, promptTemplates } from '../../../packages/core/src/db/schema.js'
```

### Step 1.3: PGlite Migration

```bash
npx drizzle-kit generate
```

This auto-generates the PGlite migration in `drizzle/`.

### Step 1.4: Supabase Migration

**File: `supabase/migrations/YYYYMMDDHHMMSS_add_custom_examples_and_prompt_templates.sql`**

```sql
-- Custom Examples: user-created project templates
CREATE TABLE IF NOT EXISTS custom_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'custom',
  icon TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  required_parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  optional_parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompts JSONB NOT NULL,
  execution JSONB,
  parallelization JSONB,
  plan_hints JSONB,
  recommended_skills TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'user',
  source_project_id UUID,
  visibility TEXT NOT NULL DEFAULT 'team',
  author_id UUID NOT NULL,
  team_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS custom_examples_name_author
  ON custom_examples(name, author_id);
CREATE INDEX IF NOT EXISTS custom_examples_author_idx ON custom_examples(author_id);
CREATE INDEX IF NOT EXISTS custom_examples_team_idx ON custom_examples(team_id);
CREATE INDEX IF NOT EXISTS custom_examples_category_idx ON custom_examples(category);

ALTER TABLE custom_examples ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'custom_examples_select') THEN
    CREATE POLICY custom_examples_select ON custom_examples
      FOR SELECT USING (
        author_id = auth.uid()
        OR (visibility = 'team' AND team_id IN (
          SELECT team_id FROM team_members WHERE user_id = auth.uid()
        ))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'custom_examples_insert') THEN
    CREATE POLICY custom_examples_insert ON custom_examples
      FOR INSERT WITH CHECK (author_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'custom_examples_update') THEN
    CREATE POLICY custom_examples_update ON custom_examples
      FOR UPDATE USING (author_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'custom_examples_delete') THEN
    CREATE POLICY custom_examples_delete ON custom_examples
      FOR DELETE USING (author_id = auth.uid());
  END IF;
END $$;

-- Prompt Templates: lightweight reusable prompts for projects and tasks
CREATE TABLE IF NOT EXISTS prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL CHECK (scope IN ('project', 'task')),
  content TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'team',
  author_id UUID NOT NULL,
  team_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS prompt_templates_name_scope_author
  ON prompt_templates(name, scope, author_id);
CREATE INDEX IF NOT EXISTS prompt_templates_author_idx ON prompt_templates(author_id);
CREATE INDEX IF NOT EXISTS prompt_templates_team_idx ON prompt_templates(team_id);
CREATE INDEX IF NOT EXISTS prompt_templates_scope_idx ON prompt_templates(scope);

ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'prompt_templates_select') THEN
    CREATE POLICY prompt_templates_select ON prompt_templates
      FOR SELECT USING (
        author_id = auth.uid()
        OR (visibility = 'team' AND team_id IN (
          SELECT team_id FROM team_members WHERE user_id = auth.uid()
        ))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'prompt_templates_insert') THEN
    CREATE POLICY prompt_templates_insert ON prompt_templates
      FOR INSERT WITH CHECK (author_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'prompt_templates_update') THEN
    CREATE POLICY prompt_templates_update ON prompt_templates
      FOR UPDATE USING (author_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'prompt_templates_delete') THEN
    CREATE POLICY prompt_templates_delete ON prompt_templates
      FOR DELETE USING (author_id = auth.uid());
  END IF;
END $$;
```

### Step 1.5: Verify

```bash
npm run build && npm run lint && npm test
```

---

## Phase 2: Custom Examples End-to-End

**Goal**: Backend CRUD + shared launch logic + store + examples page with "My Examples" section. After this phase, internal users can create, edit, delete, and launch custom examples.

### Step 2.1: Custom Examples Routes (Backend)

**New file: `server/routes/custom-examples.ts`**

```typescript
import { Hono } from 'hono'
import { eq, and, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../lib/db/index.js'
import { customExamples } from '../lib/db/schema.js'
import { validateTemplate } from '../../packages/core/src/templates/index.js'
import { interpolatePrompt } from '../../packages/core/src/templates/interpolate.js'
import { hasFeature } from '../lib/feature-flags.js'

const customExamplesRoute = new Hono()
customExamplesRoute.use('/*', requireAuth)

// Feature gate middleware
customExamplesRoute.use('/*', async (c, next) => {
  const team = c.get('team')
  if (!hasFeature(team?.featureFlags, 'user-examples')) {
    return c.json({ error: 'Feature not enabled' }, 403)
  }
  await next()
})

// ── LIST ────────────────────────────────────────────────────────────
// GET /api/examples/custom?category=...
customExamplesRoute.get('/', async (c) => {
  const user = c.get('user')
  const team = c.get('team')
  const category = c.req.query('category')

  // User's own + team-visible examples
  const rows = await db.select().from(customExamples).where(
    and(
      or(
        eq(customExamples.authorId, user.id),
        and(
          eq(customExamples.visibility, 'team'),
          eq(customExamples.teamId, team.id)
        )
      ),
      category ? eq(customExamples.category, category) : undefined
    )
  ).orderBy(customExamples.createdAt)

  return c.json({ examples: rows, count: rows.length })
})

// ── GET ONE ─────────────────────────────────────────────────────────
// GET /api/examples/custom/:id
customExamplesRoute.get('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  const team = c.get('team')

  const [row] = await db.select().from(customExamples).where(
    and(
      eq(customExamples.id, id),
      or(
        eq(customExamples.authorId, user.id),
        and(eq(customExamples.visibility, 'team'), eq(customExamples.teamId, team.id))
      )
    )
  )
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ example: row })
})

// ── CREATE ──────────────────────────────────────────────────────────
// POST /api/examples/custom
const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  category: z.string().max(100).default('custom'),
  icon: z.string().max(10).optional(),
  tags: z.array(z.string().max(50)).max(20).default([]),
  requiredParameters: z.array(z.any()).default([]),
  optionalParameters: z.array(z.any()).default([]),
  prompts: z.object({
    planGeneration: z.string().min(1),
    taskExecution: z.string().optional(),
    planRefinement: z.string().optional(),
    sharedContext: z.string().optional(),
  }),
  execution: z.any().optional(),
  parallelization: z.any().optional(),
  planHints: z.any().optional(),
  recommendedSkills: z.array(z.string()).default([]),
  source: z.enum(['user', 'project', 'ai-generated']).default('user'),
  sourceProjectId: z.string().uuid().optional(),
  visibility: z.enum(['personal', 'team']).default('team'),
})

customExamplesRoute.post('/', async (c) => {
  const user = c.get('user')
  const team = c.get('team')
  const body = createSchema.parse(await c.req.json())

  const [row] = await db.insert(customExamples).values({
    ...body,
    authorId: user.id,
    teamId: team.id,
  }).returning()

  return c.json({ example: row }, 201)
})

// ── UPDATE ──────────────────────────────────────────────────────────
// PATCH /api/examples/custom/:id
customExamplesRoute.patch('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  const body = await c.req.json()

  const [row] = await db.update(customExamples)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(customExamples.id, id), eq(customExamples.authorId, user.id)))
    .returning()

  if (!row) return c.json({ error: 'Not found or not owner' }, 404)
  return c.json({ example: row })
})

// ── DELETE ───────────────────────────────────────────────────────────
// DELETE /api/examples/custom/:id
customExamplesRoute.delete('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')

  const result = await db.delete(customExamples)
    .where(and(eq(customExamples.id, id), eq(customExamples.authorId, user.id)))

  return c.json({ success: true })
})

// ── LAUNCH (same flow as built-in) ──────────────────────────────────
// POST /api/examples/custom/:id/launch
// Uses shared launchTemplate() from server/lib/example-launcher.ts
customExamplesRoute.post('/:id/launch', async (c) => {
  // 1. Fetch custom example from DB
  // 2. Convert DB row to LaunchableTemplate shape
  // 3. Call launchTemplate() — same function used by built-in examples
  // 4. Return LaunchExampleResult
})

export { customExamplesRoute }
```

### Step 2.2: Extract Shared Launch Logic

Move the launch logic from `server/routes/examples.ts` (lines 518-668) into a shared function so both built-in and custom examples use the same code.

**New file: `server/lib/example-launcher.ts`**

```typescript
import { interpolatePrompt } from '../../packages/core/src/templates/interpolate.js'

export interface LaunchableTemplate {
  id: string
  name: string
  version?: string
  requiredParameters: unknown[]
  optionalParameters: unknown[]
  prompts: { planGeneration: string; taskExecution?: string; sharedContext?: string }
  execution?: unknown
  parallelization?: unknown
  planHints?: unknown
}

export async function launchTemplate(
  template: LaunchableTemplate,
  params: Record<string, unknown>,
  projectName: string,
  opts: { workingDirectory?: string; targetMachineId?: string; visionDoc?: string; model?: string; preferredProvider?: string },
  user: { id: string },
  team: { id: string },
): Promise<LaunchExampleResult> {
  // 1. Validate parameters against template schema
  // 2. Interpolate prompts using interpolatePrompt()
  // 3. Create project with source metadata
  // 4. Return result
  // (Move existing logic from server/routes/examples.ts POST /:id/launch here)
}
```

Then both `server/routes/examples.ts` and `server/routes/custom-examples.ts` call `launchTemplate()`.

### Step 2.3: Update Existing Examples Route (BACKWARD-COMPATIBLE)

**File: `server/routes/examples.ts`** — Modify `GET /api/examples` to include custom examples **only when the flag is on**.

**CRITICAL**: The response shape for unflagged teams must NOT change. The `custom` field is only added when the flag is enabled. The existing `templates` array stays identical.

```typescript
// At the top of the GET / handler, after fetching builtins:
const team = c.get('team')
const user = c.get('user')

// Base response — identical shape to before for unflagged teams
const response: Record<string, unknown> = {
  templates: builtinTemplates,
  count: builtinTemplates.length,
  categories,
}

// Only add custom field when flag is enabled
if (hasFeature(team?.featureFlags, 'user-examples')) {
  const customRows = await db.select().from(customExamples).where(
    or(
      eq(customExamples.authorId, user.id),
      and(eq(customExamples.visibility, 'team'), eq(customExamples.teamId, team.id))
    )
  )
  response.custom = customRows
  response.count = builtinTemplates.length + customRows.length
}

return c.json(response)
```

This way:
- **Unflagged teams**: get `{ templates, count, categories }` — exactly as before
- **Flagged teams**: get `{ templates, custom, count, categories }` — the frontend checks for the `custom` field

### Step 2.4: Register Routes

**File: `server/index.ts`** — Add:
```typescript
import { customExamplesRoute } from './routes/custom-examples.js'
app.route('/api/examples/custom', customExamplesRoute)
```

### Step 2.5: Frontend Types

**New file: `src/types/examples.ts`**

```typescript
export interface CustomExample {
  id: string
  name: string
  description: string
  category: string
  icon?: string
  tags: string[]
  requiredParameters: unknown[]
  optionalParameters: unknown[]
  prompts: {
    planGeneration: string
    taskExecution?: string
    planRefinement?: string
    sharedContext?: string
  }
  execution?: unknown
  parallelization?: unknown
  planHints?: unknown
  recommendedSkills: string[]
  source: 'user' | 'project' | 'ai-generated'
  sourceProjectId?: string
  visibility: 'personal' | 'team'
  authorId: string
  teamId?: string
  createdAt: string
  updatedAt: string
}

export interface PromptTemplate {
  id: string
  name: string
  description: string
  scope: 'project' | 'task'
  content: string
  parameters: Array<{ name: string; description: string; default?: string }>
  tags: string[]
  visibility: 'personal' | 'team'
  authorId: string
  teamId?: string
  createdAt: string
  updatedAt: string
}
```

### Step 2.6: API Client Functions (Custom Examples only)

**File: `src/lib/api-client.ts`** — Add:

```typescript
// ── Custom Examples ─────────────────────────────────────────────────
export async function getCustomExamples(category?: string) {
  const params = category ? `?category=${category}` : ''
  return fetchApi<{ examples: CustomExample[]; count: number }>(`/api/examples/custom${params}`)
}

export async function getCustomExample(id: string) {
  return fetchApi<{ example: CustomExample }>(`/api/examples/custom/${id}`)
}

export async function createCustomExample(data: CreateCustomExampleInput) {
  return fetchApi<{ example: CustomExample }>('/api/examples/custom', { method: 'POST', body: data })
}

export async function updateCustomExample(id: string, data: Partial<CreateCustomExampleInput>) {
  return fetchApi<{ example: CustomExample }>(`/api/examples/custom/${id}`, { method: 'PATCH', body: data })
}

export async function deleteCustomExample(id: string) {
  return fetchApi<{ success: boolean }>(`/api/examples/custom/${id}`, { method: 'DELETE' })
}

export async function launchCustomExample(id: string, params: LaunchExampleParams) {
  return fetchApi<LaunchExampleResult>(`/api/examples/custom/${id}/launch`, { method: 'POST', body: params })
}
```

### Step 2.7: Custom Example Store

**New file: `src/stores/custom-example-store.ts`**

```typescript
import { create } from 'zustand'
import * as api from '@/lib/api-client'
import type { CustomExample } from '@/types/examples'

interface CustomExampleStore {
  examples: CustomExample[]
  isLoading: boolean
  loaded: boolean
  error: string | null

  load: () => Promise<void>
  create: (data: Parameters<typeof api.createCustomExample>[0]) => Promise<CustomExample | null>
  update: (id: string, data: Partial<CustomExample>) => Promise<void>
  remove: (id: string) => Promise<void>
  saveFromProject: (projectId: string, name: string, description?: string) => Promise<CustomExample | null>
}

export const useCustomExampleStore = create<CustomExampleStore>((set, get) => ({
  examples: [],
  isLoading: false,
  loaded: false,
  error: null,

  load: async () => {
    if (get().loaded) return
    set({ isLoading: true, error: null })
    try {
      const result = await api.getCustomExamples()
      set({ examples: result.examples, loaded: true })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load' })
    } finally {
      set({ isLoading: false })
    }
  },

  create: async (data) => {
    try {
      const result = await api.createCustomExample(data)
      set((s) => ({ examples: [...s.examples, result.example] }))
      return result.example
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to create' })
      return null
    }
  },

  update: async (id, data) => {
    const result = await api.updateCustomExample(id, data)
    set((s) => ({
      examples: s.examples.map((ex) => (ex.id === id ? result.example : ex)),
    }))
  },

  remove: async (id) => {
    await api.deleteCustomExample(id)
    set((s) => ({ examples: s.examples.filter((ex) => ex.id !== id) }))
  },

  saveFromProject: async (projectId, name, description) => {
    try {
      const result = await api.saveProjectAsExample({ projectId, name, description })
      set((s) => ({ examples: [...s.examples, result.example] }))
      return result.example
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to save' })
      return null
    }
  },
}))
```

### Step 2.8: Examples Page — "My Examples" Section

**File: `src/pages/examples.tsx`** — Add "My Examples" section wrapped in feature flag:

```tsx
export function Examples() {
  const builtInTemplates = useExampleStore((s) => s.templates)
  const customExamples = useCustomExampleStore((s) => s.examples)
  const userExamplesEnabled = useFeatureFlag('user-examples')

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <h1 className="text-xl font-primary font-semibold">{t('title')}</h1>
        {userExamplesEnabled && (
          <Button onClick={() => setGeneratorOpen(true)}>Create Example</Button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-8">
        {/* Section 1: Built-in Examples */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">BUILT-IN EXAMPLES</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {builtInTemplates.map((t) => (
              <ExampleCard key={t.id} template={t} badge="Built-in" onClick={...} />
            ))}
          </div>
        </section>

        {/* Section 2: My Examples (feature-gated) */}
        {userExamplesEnabled && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3">MY EXAMPLES</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {customExamples.map((ex) => (
                <ExampleCard key={ex.id} template={ex}
                  badge={ex.source === 'project' ? 'Saved' : 'Custom'}
                  onEdit={...} onDelete={...} onClick={...} />
              ))}
              {/* "+" card to create new */}
              <Card className="p-5 cursor-pointer border-dashed hover:border-primary/40"
                onClick={() => setGeneratorOpen(true)}>
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Plus className="h-8 w-8 mb-2" />
                  <span>New Example</span>
                </div>
              </Card>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
```

### Step 2.9: Example Card Component

**File: `src/components/examples/example-card.tsx`** — Add badge prop:

```tsx
interface ExampleCardProps {
  template: UseCaseTemplateSummary | CustomExample
  badge?: 'Built-in' | 'Saved' | 'Custom'
  onClick: () => void
  onEdit?: () => void
  onDelete?: () => void
}
```

The badge renders as a small colored chip in the top-right corner of the card.

### Step 2.10: Data Loader (Feature-Gated)

**File: `src/components/data-loader.tsx`** — Load custom example store ONLY when flag is on:

```typescript
// Inside the data loader effect:
if (hasFeatureFlag('user-examples')) {
  useCustomExampleStore.getState().load()
}
```

If the flag is off, the store never calls the API — no 403 errors for external users.

---

## Phase 3: AI Example Generator

**Goal**: AI generation endpoint + 2-step generator dialog. Internal users can describe a workflow and AI produces a full example template.

**Depends on**: Phase 2 (store + CRUD must work to save the generated example).

### Step 3.1: AI Generation Endpoint

**File: `server/routes/custom-examples.ts`** — Add to the existing route file (already behind feature-gate middleware from Phase 2):

```typescript
// POST /api/examples/generate
// Streams AI-generated example template as SSE
customExamplesRoute.post('/generate', async (c) => {
  const body = z.object({
    description: z.string().min(10).max(5000),
    inputs: z.string().max(2000).optional(),
    deliverables: z.string().max(2000).optional(),
  }).parse(await c.req.json())

  const systemPrompt = buildExampleGenerationPrompt()
  const userMessage = [
    `## Workflow Description\n${body.description}`,
    body.inputs ? `## Expected Inputs\n${body.inputs}` : '',
    body.deliverables ? `## Expected Deliverables\n${body.deliverables}` : '',
  ].filter(Boolean).join('\n\n')

  // Stream AI response as SSE (same pattern as agent chat)
  // The AI returns a JSON object matching the CreateCustomExample schema
  // Frontend parses the JSON from the streamed text
})
```

### Step 3.2: Generation System Prompt

**File: `packages/core/src/prompt-templates.ts`** — Add `buildExampleGenerationPrompt()`:

```typescript
export function buildExampleGenerationPrompt(): string {
  return `You are a template designer for Astro, an AI planning platform.
Given a workflow description, generate a reusable project template as a JSON object.

The JSON must have this structure:
{
  "name": "Short template name",
  "description": "1-2 sentence description",
  "category": "analysis|development|research|writing|custom",
  "icon": "emoji",
  "tags": ["tag1", "tag2"],
  "requiredParameters": [
    { "name": "param_name", "label": "Human Label", "type": "text|textarea|select", "description": "What this param is for" }
  ],
  "optionalParameters": [...],
  "prompts": {
    "planGeneration": "The main prompt that describes what to plan. Use {{param_name}} for parameters.",
    "taskExecution": "Optional per-task guidance. Use {{param_name}} for parameters.",
    "sharedContext": "Optional background context injected into all tasks."
  }
}

Rules:
- Plan generation prompt should be detailed (200-500 words) and describe the full workflow
- Use {{param_name}} syntax for user-provided values
- Include 1-3 required parameters for the most important inputs
- Optional parameters for nice-to-have customization
- Return ONLY valid JSON, no markdown fences`
}
```

### Step 3.3: Generator Dialog

**New file: `src/components/examples/example-generator-dialog.tsx`**

```tsx
// 2-step dialog:
//
// Step 1: "Describe Your Workflow"
//   - Description textarea (required): "What does this workflow do?"
//   - Inputs textarea (optional): "What inputs does it need?"
//   - Deliverables textarea (optional): "What should it produce?"
//   - "Generate" button → POST /api/examples/generate (SSE stream)
//
// Step 2: "Review & Edit"
//   - AI response parsed as JSON → populated into editable form:
//     - Name, description, icon, category (editable text/select)
//     - Parameters list (editable, add/remove)
//     - Plan Generation Prompt (textarea)
//     - Task Execution Prompt (textarea)
//     - Shared Context (textarea)
//   - "Regenerate" button → back to SSE stream
//   - "Save Example" button → useCustomExampleStore.create()
//
// Loading state: show streamed text in a code block while generating
```

### Step 3.4: Wire to Examples Page

The "Create Example" button in the header and the "+" card from Phase 2 both open `ExampleGeneratorDialog`. Both are already gated behind `userExamplesEnabled`.

### Step 3.5: Save-from-Project API Client

**File: `src/lib/api-client.ts`** — Add:

```typescript
export async function generateExample(data: { description: string; inputs: string; deliverables: string }) {
  // Returns SSE stream — use parseChatSSE pattern
  return fetchSSE('/api/examples/generate', { method: 'POST', body: data })
}

export async function saveProjectAsExample(data: { projectId: string; name: string; description?: string; visibility?: string }) {
  return fetchApi<{ example: CustomExample }>('/api/examples/save-from-project', { method: 'POST', body: data })
}
```

---

## Phase 4: Save Project as Example

**Goal**: Save-from-project endpoint + dialog + project page menu item. Internal users can save completed projects as reusable examples.

**Depends on**: Phase 2 (store + CRUD).

### Step 4.1: Save-from-Project Endpoint

**File: `server/routes/custom-examples.ts`** — Add:

```typescript
// POST /api/examples/save-from-project
customExamplesRoute.post('/save-from-project', async (c) => {
  const user = c.get('user')
  const team = c.get('team')

  const body = z.object({
    projectId: z.string().uuid(),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    visibility: z.enum(['personal', 'team']).default('team'),
  }).parse(await c.req.json())

  // 1. Fetch project + plan nodes
  // 2. Extract visionDoc as planGeneration prompt
  // 3. Extract task patterns as taskExecution prompt
  // 4. Build parameter schema from detected variables
  // 5. Insert into custom_examples with source: 'project'
  // 6. Return the created example
})
```

### Step 4.2: Save-as-Example Dialog

**New file: `src/components/examples/save-as-example-dialog.tsx`**

```tsx
// Props: projectId, open, onOpenChange
//
// On open: fetch project data, pre-fill form
//
// Form fields:
//   - Name (pre-filled from project name)
//   - Description (editable textarea)
//   - Plan prompt (pre-filled from visionDoc, read-only or editable)
//   - Visibility toggle (personal / team)
//
// On save: call useCustomExampleStore.saveFromProject()
```

### Step 4.3: Project Page Integration

Add "Save as Example" to the project page dropdown/menu. **Feature-gated**:

```tsx
{useFeatureFlag('user-examples') && (
  <DropdownMenuItem onClick={() => setSaveAsExampleOpen(true)}>
    Save as Example
  </DropdownMenuItem>
)}
```

---

## Phase 5: Prompt Templates End-to-End

**Goal**: Backend CRUD + store + examples page section + editor dialog. Internal users can create and manage prompt templates.

**Depends on**: Phase 1 (DB table).

### Step 5.1: Prompt Templates Routes

**New file: `server/routes/prompt-templates.ts`**

```typescript
import { Hono } from 'hono'
import { eq, and, or } from 'drizzle-orm'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../lib/db/index.js'
import { promptTemplates } from '../lib/db/schema.js'
import { hasFeature } from '../lib/feature-flags.js'

const promptTemplatesRoute = new Hono()
promptTemplatesRoute.use('/*', requireAuth)

// Feature gate
promptTemplatesRoute.use('/*', async (c, next) => {
  const team = c.get('team')
  if (!hasFeature(team?.featureFlags, 'user-examples')) {
    return c.json({ error: 'Feature not enabled' }, 403)
  }
  await next()
})

// GET /api/prompt-templates?scope=project|task
promptTemplatesRoute.get('/', async (c) => {
  const user = c.get('user')
  const team = c.get('team')
  const scope = c.req.query('scope')

  const rows = await db.select().from(promptTemplates).where(
    and(
      or(
        eq(promptTemplates.authorId, user.id),
        and(eq(promptTemplates.visibility, 'team'), eq(promptTemplates.teamId, team.id))
      ),
      scope ? eq(promptTemplates.scope, scope) : undefined
    )
  ).orderBy(promptTemplates.createdAt)

  return c.json({ templates: rows, count: rows.length })
})

// POST /api/prompt-templates
const createPromptSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  scope: z.enum(['project', 'task']),
  content: z.string().min(1).max(50000),
  parameters: z.array(z.object({
    name: z.string(),
    description: z.string(),
    default: z.string().optional(),
  })).default([]),
  tags: z.array(z.string().max(50)).max(20).default([]),
  visibility: z.enum(['personal', 'team']).default('team'),
})

promptTemplatesRoute.post('/', async (c) => {
  const user = c.get('user')
  const team = c.get('team')
  const body = createPromptSchema.parse(await c.req.json())

  const [row] = await db.insert(promptTemplates).values({
    ...body,
    authorId: user.id,
    teamId: team.id,
  }).returning()

  return c.json({ template: row }, 201)
})

// GET /api/prompt-templates/:id
promptTemplatesRoute.get('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  const team = c.get('team')

  const [row] = await db.select().from(promptTemplates).where(
    and(
      eq(promptTemplates.id, id),
      or(
        eq(promptTemplates.authorId, user.id),
        and(eq(promptTemplates.visibility, 'team'), eq(promptTemplates.teamId, team.id))
      )
    )
  )
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ template: row })
})

// PATCH /api/prompt-templates/:id
promptTemplatesRoute.patch('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')
  const body = await c.req.json()

  const [row] = await db.update(promptTemplates)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(promptTemplates.id, id), eq(promptTemplates.authorId, user.id)))
    .returning()

  if (!row) return c.json({ error: 'Not found or not owner' }, 404)
  return c.json({ template: row })
})

// DELETE /api/prompt-templates/:id
promptTemplatesRoute.delete('/:id', async (c) => {
  const { id } = c.req.param()
  const user = c.get('user')

  await db.delete(promptTemplates)
    .where(and(eq(promptTemplates.id, id), eq(promptTemplates.authorId, user.id)))

  return c.json({ success: true })
})

export { promptTemplatesRoute }
```

### Step 5.2: Register Routes

**File: `server/index.ts`** — Add:
```typescript
import { promptTemplatesRoute } from './routes/prompt-templates.js'
app.route('/api/prompt-templates', promptTemplatesRoute)
```

### Step 5.3: API Client Functions (Prompt Templates)

**File: `src/lib/api-client.ts`** — Add:

```typescript
// ── Prompt Templates ────────────────────────────────────────────────
export async function getPromptTemplates(scope?: 'project' | 'task') {
  const params = scope ? `?scope=${scope}` : ''
  return fetchApi<{ templates: PromptTemplate[]; count: number }>(`/api/prompt-templates${params}`)
}

export async function createPromptTemplate(data: CreatePromptTemplateInput) {
  return fetchApi<{ template: PromptTemplate }>('/api/prompt-templates', { method: 'POST', body: data })
}

export async function updatePromptTemplate(id: string, data: Partial<CreatePromptTemplateInput>) {
  return fetchApi<{ template: PromptTemplate }>(`/api/prompt-templates/${id}`, { method: 'PATCH', body: data })
}

export async function deletePromptTemplate(id: string) {
  return fetchApi<{ success: boolean }>(`/api/prompt-templates/${id}`, { method: 'DELETE' })
}
```

### Step 5.4: Prompt Template Store

**New file: `src/stores/prompt-template-store.ts`**

Same Zustand pattern as `custom-example-store.ts`. Exposes `load(scope?)`, `create()`, `update()`, `remove()`.

### Step 5.5: Data Loader

**File: `src/components/data-loader.tsx`** — Add alongside custom examples load:

```typescript
if (hasFeatureFlag('user-examples')) {
  useCustomExampleStore.getState().load()   // from Phase 2
  usePromptTemplateStore.getState().load()  // new
}
```

### Step 5.6: Prompt Template Editor Dialog

**New file: `src/components/examples/prompt-template-editor-dialog.tsx`**

Form fields: name, description, scope (project/task radio), content textarea, tags. "Create" / "Save" button calls store.

### Step 5.7: Examples Page — "Prompt Templates" Section

Add the third section to `src/pages/examples.tsx`. Gated with `{userExamplesEnabled && (...)}`:

```tsx
{/* Section 3: Prompt Templates (feature-gated) */}
{userExamplesEnabled && (
  <section>
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold text-muted-foreground">PROMPT TEMPLATES</h2>
      <Button variant="outline" size="sm" onClick={() => setPromptEditorOpen(true)}>
        Create Prompt Template
      </Button>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* Project prompts */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2">Project Prompts</h3>
        {promptTemplates.filter(t => t.scope === 'project').map(t => (
          <PromptTemplateCard key={t.id} template={t} onEdit={...} onDelete={...} />
        ))}
      </div>
      {/* Task prompts */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-2">Task Prompts</h3>
        {promptTemplates.filter(t => t.scope === 'task').map(t => (
          <PromptTemplateCard key={t.id} template={t} onEdit={...} onDelete={...} />
        ))}
      </div>
    </div>
  </section>
)}
```

---

## Phase 6: Prompt Templates at Launch Time

**Goal**: Users can select prompt templates when creating projects or dispatching tasks. This is the phase that touches existing dispatch infrastructure.

**Depends on**: Phase 5 (prompt templates must exist to select from).

### Step 6.1: Prompt Template Selector Component

**New file: `src/components/examples/prompt-template-selector.tsx`**

```tsx
// A popover/dropdown that lists available prompt templates for the given scope.
// On select: calls onSelect(content) → parent pre-fills the textarea.
interface PromptTemplateSelectorProps {
  scope: 'project' | 'task'
  onSelect: (content: string) => void
}
```

### Step 6.2: Project Prompt Template Integration

**Where**: Plan page new-project form, or the project description textarea.

Wherever the project description / vision doc textarea lives, add a small "Load Template" button next to it that opens the selector. **Feature-gated**.

### Step 6.3: Task Prompt Template at Dispatch

**File: `server/routes/dispatch.ts`** — Add to `dispatchTaskSchema`:

```typescript
promptTemplateContent: z.string().max(50000).optional(),
```

**File: `packages/core/src/prompt-templates.ts`** — Modify `TaskExecutionContext` and `buildTaskExecutionPrompt()`:

```typescript
export interface TaskExecutionContext {
  // ... existing fields
  promptTemplateContent?: string  // NEW
}

export function buildTaskExecutionPrompt(context: TaskExecutionContext): string {
  const parts: string[] = []

  if (context.visionDoc) {
    parts.push(`## Project Vision\n\n<user_vision>\n${context.visionDoc}\n</user_vision>`)
  }

  // NEW: Inject prompt template content if provided
  if (context.promptTemplateContent) {
    parts.push(`## Task Guidance (from template)\n\n<task_guidance>\n${context.promptTemplateContent}\n</task_guidance>`)
  }

  if (context.dependencyOutputs) {
    parts.push(`## Previous Task Outputs\n\n...`)
  }
  // ... rest unchanged
}
```

### Step 6.4: Frontend Dispatch Flow

Wherever the dispatch confirmation UI is (the component that calls `POST /api/dispatch/task`), add the `PromptTemplateSelector` for `scope: 'task'`. The selected content goes into `body.promptTemplateContent`. **Feature-gated**.

---

## Phase 7: Polish & Remaining Items

### 7.1: View Prompts on Built-in Examples

Add a "View Prompts" button/action to built-in example cards. Opens a read-only dialog showing `planGeneration`, `taskExecution`, and `sharedContext` prompts. Helps users understand what examples do and inspires custom creation.

### 7.2: Clone Example

Add a "Clone" action on any example card (built-in or custom). Copies all fields into a new custom example with the name suffixed "(Copy)". Opens the edit form.

### 7.3: Badge Refinements

Polish the badge colors and styles:
- Built-in: neutral/grey
- Custom: blue
- Saved (from project): green
- AI-generated: purple

### 7.4: Empty States

Add helpful empty states for "My Examples" and "Prompt Templates" sections when there are no items yet. Include a call-to-action button pointing to the generator dialog or editor.

---

## File Summary

### New Files

| File | Phase | Purpose |
|------|-------|---------|
| `server/routes/custom-examples.ts` | 2 | CRUD + generate + save-from-project API |
| `server/routes/prompt-templates.ts` | 5 | CRUD API for prompt templates |
| `server/lib/example-launcher.ts` | 2 | Shared launch logic (extracted) |
| `src/stores/custom-example-store.ts` | 2 | Zustand store for custom examples |
| `src/stores/prompt-template-store.ts` | 5 | Zustand store for prompt templates |
| `src/types/examples.ts` | 2 | TypeScript types |
| `src/components/examples/example-generator-dialog.tsx` | 3 | AI generator 2-step dialog |
| `src/components/examples/save-as-example-dialog.tsx` | 4 | Save project as example |
| `src/components/examples/prompt-template-editor-dialog.tsx` | 5 | Create/edit prompt template |
| `src/components/examples/prompt-template-selector.tsx` | 6 | Dropdown selector at launch |
| `supabase/migrations/YYYYMMDDHHMMSS_add_custom_examples_and_prompt_templates.sql` | 1 | DB migration |

### Modified Files

| File | Phase | Change |
|------|-------|--------|
| `packages/core/src/db/schema.ts` | 1 | Add `customExamples` + `promptTemplates` tables |
| `server/lib/db/schema.ts` | 1 | Re-export new tables |
| `server/index.ts` | 2, 5 | Register new routes |
| `server/routes/examples.ts` | 2 | Return custom examples in list (flag-gated), extract launch logic |
| `server/routes/dispatch.ts` | 6 | Add `promptTemplateContent` to dispatch schema |
| `server/lib/feature-flags.ts` | 1 | Add `user-examples` flag |
| `src/hooks/use-feature-flag.ts` | 1 | Add `user-examples` flag |
| `scripts/sync-feature-flags.ts` | 1 | Add `user-examples` to `INTERNAL_FLAGS` |
| `packages/core/src/prompt-templates.ts` | 3, 6 | Add `buildExampleGenerationPrompt()`, modify `buildTaskExecutionPrompt()` + `TaskExecutionContext` |
| `src/pages/examples.tsx` | 2, 5 | Three-section layout, badges, create buttons |
| `src/components/examples/example-card.tsx` | 2 | Add badge prop, edit/delete actions |
| `src/lib/api-client.ts` | 2, 3, 5 | Add all new API functions |
| `src/components/data-loader.tsx` | 2, 5 | Load custom examples + prompt templates on startup (flag-gated) |
| Project page component | 4 | Add "Save as Example" menu item |
| Dispatch confirmation component | 6 | Add prompt template selector |
| Plan page / new project form | 6 | Add "Load Prompt Template" button |
