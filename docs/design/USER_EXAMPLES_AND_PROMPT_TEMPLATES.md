# User-Defined Examples & Prompt Templates

> Last updated: 2026-03-19
> Status: PROPOSED
> Depends on: [EXAMPLES.md](./EXAMPLES.md), [AI_PATHWAY_USER_FLOWS.md](./AI_PATHWAY_USER_FLOWS.md)

## 1. Problem Statement

Today, Astro ships 3 built-in examples (academic-presentation, academic-review, moat-fragility). These are hardcoded TypeScript objects in `packages/core/src/templates/examples/`. Users cannot create their own examples or reusable prompts through the web UI — they must have access to the GitHub repo.

This limits Astro to workflows the maintainers anticipated. Users who repeatedly run the same kind of project (e.g., "analyze a financial report", "review a codebase for security", "generate a literature survey") must re-describe their goals every time.

### Goals

1. Let users create **custom examples** that appear alongside built-ins on the Examples page
2. Let users save **completed projects as reusable examples** (capture what worked)
3. Let users create and manage **prompt templates** — lightweight reusable prompts for plan generation and task execution
4. Provide an **AI-assisted workflow** for generating examples and prompt templates from natural-language descriptions
5. All of the above scoped to team (shared) or personal (private)

---

## 2. Concepts

### 2.1 Built-in Examples (existing)

Shipped with Astro. Hardcoded in `packages/core/src/templates/examples/`. Read-only. Displayed with a "Built-in" badge on the Examples page.

### 2.2 User Examples (new)

Full project templates created by users. Stored in the database. Same structure as built-in examples: parameters, prompts (plan generation + task execution + shared context), execution config, plan hints. Two creation paths:

- **AI-generated**: User describes the workflow, AI produces the example definition
- **Saved from project**: User saves a completed project as a reusable example

### 2.3 Prompt Templates (new)

Lightweight reusable prompt snippets. Simpler than full examples — no parameter schemas, no execution config. Just a name, description, scope, and prompt body with optional `{{param}}` placeholders.

Two scopes:
- **Project prompt templates**: Pre-fill the plan generation prompt when creating a project
- **Task prompt templates**: Pre-fill or augment the task execution prompt when dispatching a task

Users select and edit prompt templates during the existing launch flows — they don't create new execution pathways.

### Relationship Between Concepts

```
                        Full Examples (cards on Examples page)
                       /                                      \
              Built-in Examples                    User Examples
              (read-only, badged)                  (CRUD, team-scoped)
                                                  /               \
                                        AI-generated        Saved from project

                        Prompt Templates (separate section on Examples page)
                       /                   \
              Project Prompts          Task Prompts
           (plan generation)        (task execution)
```

Examples are **heavyweight** — they configure the entire project lifecycle (parameters, prompts, execution, skills). Prompt templates are **lightweight** — they're just prompt text that users select and inject at launch time.

---

## 3. User Flows

### 3.1 AI Example Generator

A new AI pathway accessible from the Examples page.

```
Examples Page
    |
    |  User clicks "Create Example" button
    v
+------------------------------------------+
| AI Example Generator Dialog              |
|                                          |
| Step 1: Describe Your Workflow           |
|   "What kind of project is this?"        |
|   [textarea: natural language desc]      |
|                                          |
|   "What inputs should users provide?"    |
|   [textarea: describe parameters]        |
|                                          |
|   "What are the deliverables?"           |
|   [textarea: describe outputs]           |
|                                          |
|   [Generate Example ->]                  |
+------------------------------------------+
    |
    |  POST /api/examples/generate
    |  AI streams back a UseCaseTemplate JSON
    v
+------------------------------------------+
| Step 2: Review & Edit                    |
|                                          |
|  Name: [editable]                        |
|  Description: [editable]                 |
|  Icon: [picker]                          |
|  Category: [dropdown]                    |
|                                          |
|  Parameters:                             |
|    [list of generated params, editable]  |
|                                          |
|  Plan Generation Prompt:                 |
|    [editable textarea, rendered md]      |
|                                          |
|  Task Execution Prompt:                  |
|    [editable textarea, rendered md]      |
|                                          |
|  [Regenerate] [Save Example]            |
+------------------------------------------+
    |
    |  POST /api/examples/custom (create)
    v
Example card appears in "My Examples" section
```

**AI System Prompt** for generation:

The AI receives the user's description, inputs, and deliverables, and produces a complete `UseCaseTemplate` JSON including:
- `name`, `description`, `icon`, `category`
- `requiredParameters` and `optionalParameters` (with types, validation, defaults)
- `prompts.planGeneration` — how to decompose the project into a DAG
- `prompts.taskExecution` — how to execute individual tasks
- `prompts.sharedContext` — domain-specific reference material
- `planHints` — target node count, milestone suggestions

The AI does NOT have access to tools during generation — it's a single structured-output call, similar to how plan generation works today.

### 3.2 Save Project as Example

Available on completed projects.

```
Project Page (completed project)
    |
    |  User clicks "Save as Example" (in project menu)
    v
+------------------------------------------+
| Save as Example Dialog                   |
|                                          |
| Astro extracts from the project:         |
|   - Vision doc -> planGeneration prompt  |
|   - Template params used (if launched    |
|     from an example) -> parameter schema |
|   - Skills activated -> recommendedSkills|
|   - Execution config (model, delivery)   |
|                                          |
| User reviews and edits:                  |
|   Name: [pre-filled from project name]   |
|   Description: [editable]                |
|   Plan Prompt: [pre-filled from vision]  |
|   Task Prompt: [editable]                |
|   Visibility: [Personal / Team]          |
|                                          |
| [Save as Example]                        |
+------------------------------------------+
    |
    |  POST /api/examples/custom
    |  with source_project_id set
    v
Example card appears in "My Examples" section
```

**Extraction logic:**

| Project Field | Maps To |
|--------------|---------|
| `visionDoc` | `prompts.planGeneration` |
| `templateId` + `templateParameters` | Cloned parameter schema with actual values as defaults |
| Skills from execution | `recommendedSkills` |
| Model, delivery mode | `execution` config |
| Plan node count | `planHints.targetNodeCount` |

If the project was NOT launched from a template (freeform project), the extraction is simpler — the vision doc becomes the plan prompt, and no parameter schema is generated (the user can add parameters manually in the edit step).

### 3.3 Prompt Template Management

Prompt templates are displayed in a separate section on the Examples page.

```
Examples Page (redesigned)
+------------------------------------------------------------------+
| Examples                                        [Create Example]  |
|------------------------------------------------------------------|
| Get started with a curated example or create your own.           |
|                                                                  |
| BUILT-IN EXAMPLES                            [badge: "Built-in"] |
| +----------------+  +----------------+  +----------------+       |
| | Academic       |  | Academic       |  | Moat &         |       |
| | Presentation   |  | Review         |  | Fragility      |       |
| +----------------+  +----------------+  +----------------+       |
|                                                                  |
| MY EXAMPLES                                                      |
| +----------------+  +----------------+  +----------------+       |
| | Drug Discovery |  | Security Audit |  | + New          |       |
| | (saved)        |  | (AI-generated) |  |   Example      |       |
| +----------------+  +----------------+  +----------------+       |
|                                                                  |
|------------------------------------------------------------------|
| PROMPT TEMPLATES                       [Create Prompt Template]  |
| Reusable prompts for projects and tasks.                         |
|                                                                  |
|  Project Prompts              Task Prompts                       |
|  +--------------------+      +--------------------+              |
|  | Code Review Plan   |      | Security Checklist |              |
|  | ML Experiment Plan  |      | Test Generation    |              |
|  | Migration Plan      |      | Documentation      |              |
|  +--------------------+      +--------------------+              |
+------------------------------------------------------------------+
```

**Creating a prompt template:**

User clicks "Create Prompt Template" -> dialog with:
- Name, description
- Scope: Project (plan generation) or Task (task execution)
- Prompt body (markdown textarea)
- Optional: `{{param}}` placeholders with descriptions

**Using a project prompt template:**

When creating a project (either from the Plan page or via "New Project"), a new "Load Prompt Template" button appears. Clicking it shows available project-scope templates. Selecting one pre-fills the project description / vision doc. User edits and proceeds normally.

**Using a task prompt template:**

When a task is about to be dispatched (user clicks "Run" on a plan node), an optional "Apply Prompt Template" selector appears in the dispatch confirmation UI. Selecting one augments the task execution context that the context assembler injects into the agent prompt.

### 3.4 Viewing Built-in Example Prompts

Users can view (read-only) the prompts of built-in examples. On the example card, a "View Prompts" action shows the plan generation, task execution, and shared context prompts. This helps users understand how examples work and inspires them to create their own.

---

## 4. Data Model

### 4.1 `custom_examples` Table

Revives the dropped `custom_templates` table with improvements. Renamed to `custom_examples` to match UI terminology.

```sql
CREATE TABLE IF NOT EXISTS custom_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'custom',
  icon TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',

  -- Parameter schema
  required_parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  optional_parameters JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Prompts (the core value)
  prompts JSONB NOT NULL,
  -- Structure: { planGeneration: string, taskExecution?: string,
  --              planRefinement?: string, sharedContext?: string }

  -- Execution guidance
  execution JSONB,
  parallelization JSONB,
  plan_hints JSONB,

  -- Skills
  recommended_skills TEXT[] NOT NULL DEFAULT '{}',

  -- Provenance
  source TEXT NOT NULL DEFAULT 'user',
  -- 'user' = AI-generated or manually created
  -- 'project' = saved from a completed project
  source_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,

  -- Visibility
  visibility TEXT NOT NULL DEFAULT 'team',
  -- 'personal' = only the author
  -- 'team' = all team members

  -- Ownership
  author_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX custom_examples_author_idx ON custom_examples(author_id);
CREATE INDEX custom_examples_team_idx ON custom_examples(team_id);
CREATE INDEX custom_examples_category_idx ON custom_examples(category);

-- Unique: one example name per author
ALTER TABLE custom_examples
  ADD CONSTRAINT custom_examples_name_author_unique UNIQUE (name, author_id);

-- RLS
ALTER TABLE custom_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_examples_select ON custom_examples
  FOR SELECT USING (
    author_id = auth.uid()
    OR (visibility = 'team' AND team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    ))
  );

CREATE POLICY custom_examples_insert ON custom_examples
  FOR INSERT WITH CHECK (author_id = auth.uid());

CREATE POLICY custom_examples_update ON custom_examples
  FOR UPDATE USING (author_id = auth.uid());

CREATE POLICY custom_examples_delete ON custom_examples
  FOR DELETE USING (author_id = auth.uid());
```

### 4.2 `prompt_templates` Table

New table for lightweight prompt snippets.

```sql
CREATE TABLE IF NOT EXISTS prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',

  -- Scope
  scope TEXT NOT NULL CHECK (scope IN ('project', 'task')),
  -- 'project' = plan generation prompt
  -- 'task' = task execution prompt

  -- Content
  content TEXT NOT NULL,
  -- Markdown prompt body. May contain {{param}} placeholders.

  -- Optional parameter hints (for UI display when there are placeholders)
  parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Array of { name: string, description: string, default?: string }

  tags TEXT[] NOT NULL DEFAULT '{}',

  -- Visibility
  visibility TEXT NOT NULL DEFAULT 'team',

  -- Ownership
  author_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX prompt_templates_author_idx ON prompt_templates(author_id);
CREATE INDEX prompt_templates_team_idx ON prompt_templates(team_id);
CREATE INDEX prompt_templates_scope_idx ON prompt_templates(scope);

-- Unique: one name per scope per author
ALTER TABLE prompt_templates
  ADD CONSTRAINT prompt_templates_name_scope_author_unique UNIQUE (name, scope, author_id);

-- RLS (same pattern as custom_examples)
ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY prompt_templates_select ON prompt_templates
  FOR SELECT USING (
    author_id = auth.uid()
    OR (visibility = 'team' AND team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    ))
  );

CREATE POLICY prompt_templates_insert ON prompt_templates
  FOR INSERT WITH CHECK (author_id = auth.uid());

CREATE POLICY prompt_templates_update ON prompt_templates
  FOR UPDATE USING (author_id = auth.uid());

CREATE POLICY prompt_templates_delete ON prompt_templates
  FOR DELETE USING (author_id = auth.uid());
```

---

## 5. API Endpoints

### 5.1 Custom Examples

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/examples/custom` | List user's custom examples (+ team-visible) |
| POST | `/api/examples/custom` | Create a custom example |
| GET | `/api/examples/custom/:id` | Get full example definition |
| PATCH | `/api/examples/custom/:id` | Update example |
| DELETE | `/api/examples/custom/:id` | Delete example |
| POST | `/api/examples/custom/:id/launch` | Launch project from custom example (same flow as built-in launch) |
| POST | `/api/examples/generate` | AI generates an example from description (SSE stream) |
| POST | `/api/examples/save-from-project` | Save a project as a reusable example |

### 5.2 Prompt Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/prompt-templates` | List prompt templates (filter by `?scope=project\|task`) |
| POST | `/api/prompt-templates` | Create a prompt template |
| GET | `/api/prompt-templates/:id` | Get prompt template |
| PATCH | `/api/prompt-templates/:id` | Update prompt template |
| DELETE | `/api/prompt-templates/:id` | Delete prompt template |

### 5.3 Updated Built-in Examples

| Method | Endpoint | Change |
|--------|----------|--------|
| GET | `/api/examples` | Now returns `{ builtIn: [...], custom: [...] }` |

---

## 6. AI Example Generator — Pathway Design

### 6.1 Endpoint

`POST /api/examples/generate` — SSE stream.

### 6.2 Request

```typescript
interface GenerateExampleRequest {
  description: string    // "What kind of project is this?"
  inputs: string         // "What inputs should users provide?"
  deliverables: string   // "What are the deliverables?"
  model?: string
  preferredProvider?: string
}
```

### 6.3 System Prompt

```markdown
You are an expert at designing reusable project templates for Astro,
a planning platform that decomposes complex goals into task DAGs.

The user will describe a type of project they want to templatize.
Generate a complete example definition as JSON.

## Output Schema

Return a JSON object with:
- name: Short display name (2-5 words)
- description: 1-2 sentence description
- icon: Single emoji
- category: One of [software-development, data-science, machine-learning,
  devops-infrastructure, research-analysis, documentation, testing-qa,
  security, computational-biology, custom]
- requiredParameters: Array of parameter objects (keep to 1-3)
- optionalParameters: Array of parameter objects (keep to 3-6)
- prompts:
  - planGeneration: System prompt for plan DAG creation.
    Use {{paramName}} placeholders for all parameters.
    Instruct the AI how to decompose this type of project into tasks.
  - taskExecution: System prompt for executing individual tasks.
    Provide domain-specific guidance.
  - sharedContext: Reference material, rubrics, standards, or domain
    knowledge relevant to this type of project.
- planHints:
  - targetNodeCount: { min, max } — typical DAG size
  - suggestedMilestones: Array of { title, description }
  - preferParallelTasks: boolean

## Parameter Schema

Each parameter:
{
  id: string (camelCase),
  name: string (display name),
  description: string (help text),
  type: "string" | "number" | "boolean" | "select" | "multi-select" | "file-path",
  required: boolean,
  default?: any,
  placeholder?: string,
  options?: [{ label, value }],  // for select/multi-select
  validation?: { min?, max?, pattern?, message? },
  visibleWhen?: { parameterId, operator, value }
}

## Guidelines

- Plan generation prompts should describe how to break DOWN the project,
  not how to execute individual tasks
- Task execution prompts should give domain-specific tool guidance
- Keep required parameters minimal (low friction)
- Provide sensible defaults for optional parameters
- Use {{paramName}} placeholders liberally — they make the template reusable
```

### 6.4 Response

The AI returns structured JSON. The backend validates it against the `UseCaseTemplate` schema using the existing `validateTemplate()` function and streams the result to the frontend.

---

## 7. Frontend Changes

### 7.1 Examples Page (`src/pages/examples.tsx`)

Redesign to three sections:

1. **Built-in Examples** — existing cards with a "Built-in" badge overlay
2. **My Examples** — user/team custom examples with edit/delete actions, plus a "+" card that opens the AI generator
3. **Prompt Templates** — two columns (Project / Task), lighter-weight cards with edit/delete

Header gets two buttons:
- **"Create Example"** — opens AI Example Generator dialog
- **"Create Prompt Template"** — opens simple create dialog

### 7.2 New Components

| Component | Purpose |
|-----------|---------|
| `example-generator-dialog.tsx` | AI Example Generator — 2-step dialog (describe -> review/edit/save) |
| `save-as-example-dialog.tsx` | Save project as example — extraction + review + save |
| `prompt-template-editor-dialog.tsx` | Create/edit prompt templates — name, scope, content |
| `prompt-template-selector.tsx` | Dropdown/popover for selecting a prompt template at launch time |
| `example-badge.tsx` | Small badge component: "Built-in", "Saved", "AI-generated" |

### 7.3 Modified Components

| Component | Change |
|-----------|--------|
| `examples.tsx` (page) | Three-section layout, built-in badge, "Create" buttons |
| `example-picker-dialog.tsx` | Support launching from custom examples (same flow, different data source) |
| Plan page new-project form | "Load Prompt Template" button for project prompts |
| Dispatch confirmation UI | "Apply Prompt Template" selector for task prompts |

### 7.4 New Stores

| Store | Purpose |
|-------|---------|
| `custom-example-store.ts` | CRUD for user-defined examples + AI generation |
| `prompt-template-store.ts` | CRUD for prompt templates |

The existing `example-store.ts` continues to manage built-in examples. The Examples page merges both sources for display.

---

## 8. Prompt Template Integration Points

### 8.1 At Project Creation (Project Prompt Templates)

When a user creates a new project (Plan page or "New Project"), the description/vision field gains a "Load Template" button:

```
+-----------------------------------------------+
| New Project                                    |
|                                                |
| Project Name: [_______________]                |
|                                                |
| Description:                                   |
| [Load Prompt Template v]                       |
| +-------------------------------------------+  |
| |                                           |  |
| | (pre-filled from template, user edits)    |  |
| |                                           |  |
| +-------------------------------------------+  |
|                                                |
| [Start Planning]                               |
+-----------------------------------------------+
```

Selecting a template:
1. Calls `interpolatePrompt(template.content, params)` if the template has `{{param}}` placeholders
2. Pre-fills the description textarea
3. User reviews, edits, and proceeds as normal

The prompt template content becomes the input to `buildInteractivePlanPrompt()` through the existing flow — no changes needed to the backend dispatch pipeline.

### 8.2 At Task Dispatch (Task Prompt Templates)

When dispatching a task (clicking "Run" on a plan node), the dispatch UI gains an optional "Prompt Template" selector:

```
+-----------------------------------------------+
| Dispatch Task: "Implement auth module"         |
|                                                |
| Machine: [laptop-01 v]                         |
| Model: [claude-sonnet-4 v]                     |
|                                                |
| Prompt Template: [None v]                      |
|   > Security Checklist                         |
|   > Test-First Development                     |
|   > Documentation Standards                    |
|                                                |
| Additional Instructions: (optional)            |
| +-------------------------------------------+  |
| | (template content shown here, editable)   |  |
| +-------------------------------------------+  |
|                                                |
| [Cancel] [Dispatch]                            |
+-----------------------------------------------+
```

The selected template's content is passed as additional execution context in the dispatch payload. The context assembler appends it to the task execution prompt:

```
vision doc + dependency outputs + skills + prompt template content
```

This requires a small change to the dispatch API (`POST /api/dispatch/task`) to accept an optional `promptTemplateContent` field, and to `buildTaskExecutionPrompt()` to include it.

---

## 9. Implementation Plan

### Phase 1: Database & API Foundation

1. Create `custom_examples` table + Drizzle schema + Supabase migration
2. Create `prompt_templates` table + Drizzle schema + Supabase migration
3. Add CRUD API routes for both tables
4. Add `POST /api/examples/generate` endpoint (AI example generation)
5. Add `POST /api/examples/save-from-project` endpoint
6. Update `GET /api/examples` to return `{ builtIn, custom }` shape

### Phase 2: Examples Page Redesign

7. Redesign Examples page with three sections (built-in, my examples, prompt templates)
8. Add "Built-in" badge to existing example cards
9. Create `custom-example-store.ts` and `prompt-template-store.ts`
10. Wire custom examples to the existing `ExamplePickerDialog` launch flow

### Phase 3: AI Example Generator

11. Build `example-generator-dialog.tsx` — Step 1: describe workflow
12. Build Step 2: review/edit generated template (parameter list, prompt editor)
13. Wire to `POST /api/examples/generate` with SSE streaming
14. Add "Create Example" button to Examples page header

### Phase 4: Save Project as Example

15. Build `save-as-example-dialog.tsx` — extraction + review + save
16. Add extraction logic: vision doc, template params, skills, execution config
17. Add "Save as Example" action to project page menu
18. Wire to `POST /api/examples/save-from-project`

### Phase 5: Prompt Templates

19. Build `prompt-template-editor-dialog.tsx` — create/edit dialog
20. Build `prompt-template-selector.tsx` — dropdown for selecting at launch time
21. Add "Load Prompt Template" to Plan page / new project form
22. Add "Apply Prompt Template" to dispatch confirmation UI
23. Update dispatch API to accept `promptTemplateContent`
24. Update `buildTaskExecutionPrompt()` to include template content

### Phase 6: Polish

25. Add "View Prompts" action to built-in example cards (read-only)
26. Add clone action: clone built-in or custom example
27. Add import/export for custom examples (JSON format)
28. Feature flag: `user-examples` — gate all new UI behind it

---

## 10. Key Design Decisions

### Why two tables instead of one?

Custom examples and prompt templates serve different purposes at different abstraction levels:

| | Custom Examples | Prompt Templates |
|---|---|---|
| **Complexity** | Full parameter schema, prompts, execution config, plan hints | Just name + prompt body |
| **Usage** | Creates an entire project (same as built-in examples) | Pre-fills a text field at launch time |
| **Creation effort** | AI generates or extracted from a project | User writes a few paragraphs |
| **Display** | Cards with configure dialog | Lightweight list items |

Merging them into one table would force prompt templates to carry empty parameter schemas, execution configs, and plan hints — unnecessary complexity. Separate tables keep each concept clean.

### Why AI generation instead of a form builder?

A full template definition includes parameter schemas with types, validation rules, conditional visibility, multiple prompt slots with `{{param}}` interpolation, execution configs, and plan hints. Asking users to fill this out manually through a form is:

1. **Overwhelming** — most users don't understand what "plan generation prompt" vs "task execution prompt" means
2. **Error-prone** — parameter IDs must match prompt placeholders exactly
3. **Slow** — a good template takes significant prompt engineering

AI generation solves all three: the user describes what they want in plain language, and the AI produces a well-structured template that the user can review and tweak. This follows the same pattern Astro uses for plan generation — AI does the heavy lifting, human provides strategic direction.

### Why "Save as Example" in addition to AI generation?

Different user journeys:

- **AI generation**: "I have a new idea for a workflow" — forward-looking, speculative
- **Save as Example**: "This project worked great, I want to do it again" — backward-looking, proven

Save-as-Example produces higher-quality templates because the prompts are extracted from a project that actually succeeded. The vision doc, skills, and execution config are battle-tested.

### How do custom examples interact with skills?

Custom examples can reference skills by name in `recommended_skills`. When launching, the same skill resolution logic (`deriveEffectiveSkills`) runs. Users can reference:
- Built-in Astro skills (from `skills-catalog/`)
- Team skills (from the Skills page)

The AI example generator can suggest relevant skills based on the workflow description.

---

## 11. Key Files (Existing)

| File | Relevance |
|------|-----------|
| `packages/core/src/templates/examples/` | Built-in example definitions |
| `packages/core/src/templates/interpolate.ts` | `interpolatePrompt()` — reused for prompt templates |
| `packages/core/src/templates/template-validator.ts` | `validateTemplate()` — reused for custom examples |
| `packages/core/src/templates/template-loader.ts` | Markdown/YAML parsing — reused for import/export |
| `packages/core/src/prompt-templates.ts` | `buildInteractivePlanPrompt()`, `buildTaskExecutionPrompt()` |
| `server/routes/examples.ts` | Existing example API routes (list, launch, validate, preview) |
| `src/pages/examples.tsx` | Examples page (to be redesigned) |
| `src/stores/example-store.ts` | Built-in example store |
| `src/components/examples/example-picker-dialog.tsx` | Configure + Launch wizard |
| `packages/core/src/db/schema.ts` | Database schema source of truth |
| `server/lib/dispatch/context-assembler.ts` | Assembles execution context (for task prompt injection) |

---

## 12. Migration Notes

- The `custom_templates` table was previously created (`20260303100000`) and dropped (`20260305300000`). The new `custom_examples` table uses a new migration with a new name to avoid confusion.
- Dead frontend components (`save-as-template-dialog.tsx`, `use-template-sheet.tsx`, etc.) were already removed in PR #648. New components are built from scratch.
- The existing `ExamplePickerDialog` launch flow works unchanged for custom examples — it just needs to accept a `UseCaseTemplate` from the database instead of from `BUILTIN_TEMPLATES`.
