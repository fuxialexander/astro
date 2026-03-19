# User-Defined Examples & Prompt Templates — Implementation Guide

> Last updated: 2026-03-19
> Status: READY TO IMPLEMENT
> Design doc: [USER_EXAMPLES_AND_PROMPT_TEMPLATES.md](./USER_EXAMPLES_AND_PROMPT_TEMPLATES.md)

This document contains the concrete, file-by-file implementation plan. Each phase is a self-contained PR.

---

## Phase 1: Database & Feature Flag

**Goal**: Create tables, Drizzle schema, migrations, feature flag. No UI yet.

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

## Phase 2: Backend API Routes

**Goal**: CRUD endpoints for both tables + AI generation endpoint + save-from-project endpoint.

### Step 2.1: Custom Examples Routes

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
// Reuses the same launch logic from server/routes/examples.ts
// but reads the template from DB instead of BUILTIN_TEMPLATES
customExamplesRoute.post('/:id/launch', async (c) => {
  // 1. Fetch custom example from DB
  // 2. Convert DB row to UseCaseTemplate shape
  // 3. Validate parameters (reuse validateParameters from examples.ts)
  // 4. Interpolate prompts (reuse interpolatePrompt)
  // 5. Create project with source: { type: 'custom-template', templateId: id }
  // 6. Return LaunchExampleResult
  // (Extract the launch logic from server/routes/examples.ts into a shared function)
})

export { customExamplesRoute }
```

### Step 2.2: Prompt Templates Routes

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

### Step 2.3: Register Routes

**File: `server/index.ts`** — Add to route registration:
```typescript
import { customExamplesRoute } from './routes/custom-examples.js'
import { promptTemplatesRoute } from './routes/prompt-templates.js'

// Inside route setup:
app.route('/api/examples/custom', customExamplesRoute)
app.route('/api/prompt-templates', promptTemplatesRoute)
```

### Step 2.4: AI Example Generation Endpoint

**File: `server/routes/custom-examples.ts`** — Add to the route file:

```typescript
// POST /api/examples/generate
// SSE stream — AI generates a UseCaseTemplate from user description
const generateSchema = z.object({
  description: z.string().min(10).max(5000),
  inputs: z.string().min(5).max(3000),
  deliverables: z.string().min(5).max(3000),
  model: z.string().optional(),
  preferredProvider: z.string().optional(),
})

customExamplesRoute.post('/generate', async (c) => {
  const user = c.get('user')
  const body = generateSchema.parse(await c.req.json())

  const systemPrompt = buildExampleGenerationPrompt()
  const userMessage = [
    `## Workflow Description\n${body.description}`,
    `## User Inputs\n${body.inputs}`,
    `## Deliverables\n${body.deliverables}`,
  ].join('\n\n')

  // Use the same relay-based chat pattern as /api/agent/chat
  // but with structured output (JSON response, no tools)
  return streamChatViaRelay(c, {
    taskId: `example-gen-${Date.now()}`,
    projectId: 'system',
    nodeId: 'example-gen',
    prompt: userMessage,
    systemPrompt,
    maxTurns: 1, // Single-turn, no tools
    type: 'chat',
    model: body.model,
    preferredProvider: body.preferredProvider,
  })
})
```

The `buildExampleGenerationPrompt()` function returns the system prompt from Section 6.3 of the design doc (instructs AI to output a `UseCaseTemplate` JSON).

**File: `packages/core/src/prompt-templates.ts`** — Add:

```typescript
export function buildExampleGenerationPrompt(): string {
  return `You are an expert at designing reusable project templates for Astro,
a planning platform that decomposes complex goals into task DAGs.

The user will describe a type of project they want to templatize.
Generate a complete example definition as JSON.

## Output Format

Return ONLY valid JSON (no markdown fences, no explanation) matching this structure:

{
  "name": "Short Display Name",
  "description": "1-2 sentence description",
  "icon": "single emoji",
  "category": "one of: software-development, data-science, machine-learning, devops-infrastructure, research-analysis, documentation, testing-qa, security, computational-biology, custom",
  "requiredParameters": [...],
  "optionalParameters": [...],
  "prompts": {
    "planGeneration": "System prompt for creating the plan DAG. Use {{paramName}} placeholders.",
    "taskExecution": "System prompt for executing individual tasks.",
    "sharedContext": "Domain knowledge, rubrics, standards."
  },
  "planHints": {
    "targetNodeCount": { "min": 6, "max": 12 },
    "suggestedMilestones": [{ "title": "...", "description": "..." }],
    "preferParallelTasks": true
  }
}

## Parameter Schema

Each parameter:
{
  "id": "camelCaseId",
  "name": "Display Name",
  "description": "Help text",
  "type": "string | number | boolean | select | multi-select | file-path",
  "required": true/false,
  "default": "sensible default",
  "placeholder": "placeholder text",
  "options": [{ "label": "Display", "value": "value" }],
  "validation": { "min": 0, "max": 100, "pattern": "regex" }
}

## Guidelines

- planGeneration: Describe how to DECOMPOSE the project into tasks, not how to execute them
- taskExecution: Give domain-specific guidance for individual task execution
- sharedContext: Reference material, scoring rubrics, quality standards
- Keep required parameters to 1-3 (low friction)
- Provide sensible defaults for all optional parameters
- Use {{paramName}} placeholders throughout prompts`
}
```

### Step 2.5: Save-from-Project Endpoint

**File: `server/routes/custom-examples.ts`** — Add:

```typescript
// POST /api/examples/save-from-project
const saveFromProjectSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  visibility: z.enum(['personal', 'team']).default('team'),
})

customExamplesRoute.post('/save-from-project', async (c) => {
  const user = c.get('user')
  const team = c.get('team')
  const body = saveFromProjectSchema.parse(await c.req.json())

  // 1. Fetch the project
  const [project] = await db.select().from(projects)
    .where(eq(projects.id, body.projectId))
  if (!project) return c.json({ error: 'Project not found' }, 404)

  // 2. Extract template data from the project
  const prompts = {
    planGeneration: project.visionDoc || project.description || '',
    taskExecution: undefined as string | undefined,
    sharedContext: undefined as string | undefined,
  }

  // If project was launched from a template, carry over its params
  let requiredParameters: unknown[] = []
  let optionalParameters: unknown[] = []
  let recommendedSkills: string[] = []
  const projectSource = project.source as Record<string, unknown> | null

  if (projectSource?.type === 'template' && projectSource.templateId) {
    // Look up original template to get parameter schema
    const originalTemplate = getTemplateById(projectSource.templateId as string)
    if (originalTemplate) {
      // Clone params but update defaults to the values actually used
      const usedParams = (projectSource.parameters || {}) as Record<string, unknown>
      requiredParameters = originalTemplate.requiredParameters.map(p => ({
        ...p,
        default: usedParams[p.id] ?? p.default,
      }))
      optionalParameters = originalTemplate.optionalParameters.map(p => ({
        ...p,
        default: usedParams[p.id] ?? p.default,
      }))
      if (originalTemplate.prompts.taskExecution) {
        prompts.taskExecution = originalTemplate.prompts.taskExecution
      }
      if (originalTemplate.prompts.sharedContext) {
        prompts.sharedContext = originalTemplate.prompts.sharedContext
      }
      recommendedSkills = originalTemplate.recommendedSkills || []
    }
  }

  // 3. Count plan nodes for hints
  const planNodes = await db.select().from(planNodesTable)
    .where(eq(planNodesTable.projectId, body.projectId))
  const nodeCount = planNodes.length

  // 4. Create the custom example
  const [row] = await db.insert(customExamples).values({
    name: body.name,
    description: body.description,
    category: 'custom',
    icon: '📋',
    requiredParameters,
    optionalParameters,
    prompts,
    recommendedSkills,
    planHints: nodeCount > 0 ? {
      targetNodeCount: { min: Math.max(3, nodeCount - 2), max: nodeCount + 3 },
    } : undefined,
    source: 'project',
    sourceProjectId: body.projectId,
    visibility: body.visibility,
    authorId: user.id,
    teamId: team.id,
  }).returning()

  return c.json({ example: row }, 201)
})
```

### Step 2.6: Update Existing Examples Route

**File: `server/routes/examples.ts`** — Modify `GET /api/examples` to include custom:

```typescript
// At the top of the GET / handler, after fetching builtins:
const team = c.get('team')
const user = c.get('user')
let customRows: typeof customExamples.$inferSelect[] = []

if (hasFeature(team?.featureFlags, 'user-examples')) {
  customRows = await db.select().from(customExamples).where(
    or(
      eq(customExamples.authorId, user.id),
      and(eq(customExamples.visibility, 'team'), eq(customExamples.teamId, team.id))
    )
  )
}

return c.json({
  templates: builtinTemplates,  // existing
  custom: customRows,           // new
  count: builtinTemplates.length + customRows.length,
  categories,
})
```

### Step 2.7: Extract Shared Launch Logic

The launch logic in `server/routes/examples.ts` (lines 518-668) should be extracted into a shared function so both built-in and custom examples use the same code:

**File: `server/lib/example-launcher.ts`** (new)

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
  // 1. Validate parameters
  // 2. Interpolate prompts
  // 3. Create project
  // 4. Return result
  // (Move existing logic from server/routes/examples.ts POST /:id/launch here)
}
```

Then both `server/routes/examples.ts` and `server/routes/custom-examples.ts` call `launchTemplate()`.

---

## Phase 3: Frontend Stores & API Client

**Goal**: Zustand stores + API client functions for custom examples and prompt templates.

### Step 3.1: API Client Functions

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

export async function generateExample(data: { description: string; inputs: string; deliverables: string }) {
  // Returns SSE stream — use parseChatSSE pattern
  return fetchSSE('/api/examples/generate', { method: 'POST', body: data })
}

export async function saveProjectAsExample(data: { projectId: string; name: string; description?: string; visibility?: string }) {
  return fetchApi<{ example: CustomExample }>('/api/examples/save-from-project', { method: 'POST', body: data })
}

export async function launchCustomExample(id: string, params: LaunchExampleParams) {
  return fetchApi<LaunchExampleResult>(`/api/examples/custom/${id}/launch`, { method: 'POST', body: params })
}

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

### Step 3.2: Types

**File: `src/types/examples.ts`** (new)

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

### Step 3.3: Custom Example Store

**File: `src/stores/custom-example-store.ts`** (new)

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

### Step 3.4: Prompt Template Store

**File: `src/stores/prompt-template-store.ts`** (new)

Same pattern as above but for `PromptTemplate`. Exposes `load(scope?)`, `create()`, `update()`, `remove()`.

---

## Phase 4: Examples Page Redesign

**Goal**: Three-section layout, badges, "Create" buttons.

### Step 4.1: Modify Examples Page

**File: `src/pages/examples.tsx`** — Restructure:

```tsx
export function Examples() {
  const builtInTemplates = useExampleStore((s) => s.templates)
  const customExamples = useCustomExampleStore((s) => s.examples)
  const promptTemplates = usePromptTemplateStore((s) => s.templates)
  const userExamplesEnabled = useFeatureFlag('user-examples')

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <h1 className="text-xl font-primary font-semibold">{t('title')}</h1>
        {userExamplesEnabled && (
          <div className="flex gap-2">
            <Button onClick={() => setGeneratorOpen(true)}>Create Example</Button>
            <Button variant="outline" onClick={() => setPromptEditorOpen(true)}>Create Prompt Template</Button>
          </div>
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

        {/* Section 3: Prompt Templates (feature-gated) */}
        {userExamplesEnabled && promptTemplates.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3">PROMPT TEMPLATES</h2>
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
      </div>

      {/* Dialogs */}
      <ExampleGeneratorDialog open={generatorOpen} onOpenChange={setGeneratorOpen} />
      <PromptTemplateEditorDialog open={promptEditorOpen} onOpenChange={setPromptEditorOpen} />
      <ExamplePickerDialog open={pickerOpen} ... />
    </div>
  )
}
```

### Step 4.2: Example Card Component

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

---

## Phase 5: AI Example Generator Dialog

**Goal**: 2-step dialog — describe workflow, then review/edit AI output.

### Step 5.1: Generator Dialog

**New file: `src/components/examples/example-generator-dialog.tsx`**

```tsx
// Step 1: Three textareas (description, inputs, deliverables) + "Generate" button
// Step 2: Parsed JSON displayed as editable form:
//   - Name, description, icon, category (editable text/select)
//   - Parameters list (editable, add/remove)
//   - Plan Generation Prompt (textarea)
//   - Task Execution Prompt (textarea)
//   - Shared Context (textarea)
//   - "Regenerate" and "Save Example" buttons
//
// On "Generate": POST /api/examples/generate, parse SSE stream,
// extract JSON from the AI response, populate Step 2 form.
//
// On "Save": call useCustomExampleStore.create() with form data.
```

### Step 5.2: Save-as-Example Dialog

**New file: `src/components/examples/save-as-example-dialog.tsx`**

```tsx
// Props: projectId
// On open: fetch project data, pre-fill form
// Form: name (pre-filled from project name), description (editable),
//   plan prompt (pre-filled from visionDoc, read-only or editable),
//   visibility toggle (personal/team)
// On save: call useCustomExampleStore.saveFromProject()
```

**Integration point**: Add "Save as Example" to the project page dropdown menu (e.g., in the project header or settings menu). Only shown when `useFeatureFlag('user-examples')` is true.

---

## Phase 6: Prompt Template Integration at Launch Time

**Goal**: Users can select prompt templates when creating projects or dispatching tasks.

### Step 6.1: Project Prompt Template Selector

**Where**: Plan page new-project form, or the project description textarea.

**New component: `src/components/examples/prompt-template-selector.tsx`**

```tsx
// A popover/dropdown that lists available prompt templates for the given scope.
// On select: calls onSelect(content) -> parent pre-fills the textarea.
interface PromptTemplateSelectorProps {
  scope: 'project' | 'task'
  onSelect: (content: string) => void
}
```

**Integration in Plan page** — wherever the project description / vision doc textarea lives, add a small "Load Template" button next to it that opens the selector.

### Step 6.2: Task Prompt Template at Dispatch

**Where**: The dispatch confirmation flow when user clicks "Run" on a node.

**File: `server/routes/dispatch.ts`** — Add to `dispatchTaskSchema`:

```typescript
promptTemplateContent: z.string().max(50000).optional(),
```

**File: `packages/core/src/prompt-templates.ts`** — Modify `buildTaskExecutionPrompt()`:

```typescript
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

**File: `packages/core/src/prompt-templates.ts`** — Add to `TaskExecutionContext`:

```typescript
export interface TaskExecutionContext {
  // ... existing fields
  promptTemplateContent?: string  // NEW
}
```

**Frontend dispatch flow** — wherever the dispatch confirmation UI is (the component that calls `POST /api/dispatch/task`), add the `PromptTemplateSelector` for `scope: 'task'`. The selected content goes into `body.promptTemplateContent`.

---

## Phase 7: Polish & Remaining Items

### 7.1: View Prompts on Built-in Examples

Add a "View Prompts" button/action to built-in example cards. Opens a read-only dialog showing `planGeneration`, `taskExecution`, and `sharedContext` prompts. Helps users understand what examples do and inspires custom creation.

### 7.2: Clone Example

Add a "Clone" action on any example card (built-in or custom). Copies all fields into a new custom example with the name suffixed "(Copy)". Opens the edit form.

### 7.3: Load Data on App Startup

**File: `src/components/data-loader.tsx`** (or equivalent) — Add:

```typescript
const loadCustomExamples = useCustomExampleStore((s) => s.load)
const loadPromptTemplates = usePromptTemplateStore((s) => s.load)

useEffect(() => {
  if (useFeatureFlag('user-examples')) {
    loadCustomExamples()
    loadPromptTemplates()
  }
}, [])
```

---

## File Summary

### New Files

| File | Purpose |
|------|---------|
| `server/routes/custom-examples.ts` | CRUD + generate + save-from-project API |
| `server/routes/prompt-templates.ts` | CRUD API for prompt templates |
| `server/lib/example-launcher.ts` | Shared launch logic (extracted) |
| `src/stores/custom-example-store.ts` | Zustand store for custom examples |
| `src/stores/prompt-template-store.ts` | Zustand store for prompt templates |
| `src/types/examples.ts` | TypeScript types |
| `src/components/examples/example-generator-dialog.tsx` | AI generator 2-step dialog |
| `src/components/examples/save-as-example-dialog.tsx` | Save project as example |
| `src/components/examples/prompt-template-editor-dialog.tsx` | Create/edit prompt template |
| `src/components/examples/prompt-template-selector.tsx` | Dropdown selector at launch |
| `supabase/migrations/YYYYMMDDHHMMSS_add_custom_examples_and_prompt_templates.sql` | DB migration |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/db/schema.ts` | Add `customExamples` + `promptTemplates` tables |
| `server/lib/db/schema.ts` | Re-export new tables |
| `server/index.ts` | Register new routes |
| `server/routes/examples.ts` | Return custom examples in list, extract launch logic |
| `server/routes/dispatch.ts` | Add `promptTemplateContent` to dispatch schema |
| `server/lib/feature-flags.ts` | Add `user-examples` flag |
| `src/hooks/use-feature-flag.ts` | Add `user-examples` flag |
| `scripts/sync-feature-flags.ts` | Add `user-examples` to `INTERNAL_FLAGS` |
| `packages/core/src/prompt-templates.ts` | Add `buildExampleGenerationPrompt()`, modify `buildTaskExecutionPrompt()` + `TaskExecutionContext` |
| `src/pages/examples.tsx` | Three-section layout, badges, create buttons |
| `src/components/examples/example-card.tsx` | Add badge prop, edit/delete actions |
| `src/lib/api-client.ts` | Add all new API functions |
| `src/components/data-loader.tsx` | Load custom examples + prompt templates on startup |
| Project page component | Add "Save as Example" menu item |
| Dispatch confirmation component | Add prompt template selector |
| Plan page / new project form | Add "Load Prompt Template" button |
