# Examples System Design

> Last updated: 2026-03-05
> Status: IMPLEMENTED (with dead code identified for cleanup)

## 1. Overview

Examples are curated, polished project templates that demonstrate Astro's capabilities across different domains. They serve as **onboarding ramps** -- users click an example, configure a few parameters, and land on a fully-populated Plan page ready to execute.

Examples are **shipped with Astro** as TypeScript definitions paired with SKILL.md files in the skills catalog. There are currently 3 active examples.

### Terminology

The UI says **"Examples"**. The code uses **"templates"** internally (stores, types, API routes, component filenames). A future cleanup should rename `template` -> `example` throughout the codebase to match the UI.

### Design Goals

1. **Teach by doing**: Each example mirrors the Plan page layout so users learn the interface while configuring their first project
2. **Extensible**: Adding a new example requires only two files -- a template definition and a SKILL.md
3. **Self-contained**: Each example bundles its own prompts, parameters, skills, and output specification
4. **Quality over quantity**: Ship a small number of polished examples rather than many untested ones

---

## 2. Architecture

```
+-------------------------------------------------------------+
|                     Example Definitions                       |
|         packages/core/src/templates/examples/*.ts             |
|                                                               |
|  +------------------+  +------------------+  +--------------+ |
|  | academic-        |  | academic-        |  | moat-        | |
|  | presentation.ts  |  | review.ts        |  | fragility.ts | |
|  +--------+---------+  +--------+---------+  +------+-------+ |
|           |                     |                    |         |
|           +----------+----------+--------------------+         |
|                      |                                         |
|               examples/index.ts                                |
|            (BUILTIN_TEMPLATES array)                           |
+--------------------------+------------------------------------+
                           |
             GET /api/templates (built-in only for now)
                           |
                           v
+-------------------------------------------------------------+
|                     Frontend                                  |
|                                                               |
|  +--------------+    +-----------------------+    +----------+|
|  | Examples Page |--->| TemplatePickerDialog  |--->| Plan     ||
|  | /examples    |    | (Configure -> Launch)  |    | Page     ||
|  +--------------+    +-----------------------+    +----------+|
+-------------------------------------------------------------+
                           |
                           | skills: ['academic-presentation']
                           v
+-------------------------------------------------------------+
|                   Skills Catalog                              |
|           skills-catalog/anthropic/*/SKILL.md                 |
|                                                               |
|  Each example references a SKILL.md that is injected into     |
|  the agent's system prompt during plan generation + execution.|
+-------------------------------------------------------------+
```

---

## 3. User Flow

```
 Examples Page          Configure Dialog           Plan Page
+--------------+     +----------------------+   +------------------+
|              |     | Project Configuration|   |                  |
|  Card        |---->|  - Project Name *    |-->| Machine selector |
|  Card        |     |  - Working Directory |   | Working Dir      |
|  Card        |     |                      |   | (pre-filled)     |
|              |     | Template Parameters  |   |                  |
|              |     |  - Required params   |   | Plan graph       |
|              |     |  > Advanced Options  |   | (generated)      |
|              |     |                      |   |                  |
|              |     | [Enter Plan Mode ->] |   | [Start Planning] |
+--------------+     +----------------------+   +------------------+
```

**Step-by-step:**

1. **Examples page** (`/examples`): Grid of example cards. Click one.
2. **Configure dialog** (`TemplatePickerDialog` with `skipBrowse`): Opens directly at Configure step. User fills:
   - **Project Name** (required) -- auto-generated from template name
   - **Working Directory** (optional) -- text input
   - **Template parameters** -- required shown up front, optional in collapsible "Advanced Options"
3. **Enter Plan Mode**: Navigates to Plan page with prefilled form data (description, visionDoc, machine, provider). No project created yet.
4. **Plan page**: User reviews the prefilled goal, clicks "Start Planning" which triggers **Pathway 3** (Interactive Plan) -- full agentic plan generation with tools.

Alternatively, the Plan page has a "Start from an Example" button that opens `TemplatePickerDialog` with `onLaunchSuccess`. This path calls `POST /api/templates/:id/launch` to create the project immediately, then starts P3.

**Important:** The Examples flow always ends at **Pathway 3 (Interactive Plan)**, NOT Pathway 5 (Plan Generation). Pathway 5 is dead code with no active UI callers.

---

## 4. Example Definition Schema

Each example is a `UseCaseTemplate` object exported from `packages/core/src/templates/examples/`.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID: `astro/{example-name}` |
| `name` | string | Display name |
| `description` | string | 1-2 sentence description |
| `category` | UseCaseCategory | Grouping: `research-analysis`, `data-science`, etc. |
| `version` | string | Semver string |
| `icon` | string | Emoji icon for the card |
| `tags` | string[] | Search/filter tags |
| `maturity` | `stable` | Always `stable` for shipped examples |
| `requiredParameters` | UseCaseParameter[] | Parameters the user must fill |
| `optionalParameters` | UseCaseParameter[] | Parameters with sensible defaults |
| `prompts` | PromptConfig | Plan generation, task execution, and shared context prompts |
| `outputFormat` | OutputFormatSpec | What the example produces |
| `execution` | ExecutionConfig | Model, skills, delivery mode |
| `planHints` | PlanGenerationHints | DAG structure guidance |
| `domains` | DomainExpertise[] | For machine selection hints |
| `recommendedSkills` | string[] | Skills to activate |
| `source` | `'builtin'` | Always `builtin` for examples |
| `enabled` | `true` | Always enabled |

### Parameter Types

```typescript
type ParameterType =
  | 'string'        // Text input
  | 'number'        // Numeric input
  | 'boolean'       // Toggle switch
  | 'select'        // Single-select dropdown
  | 'multi-select'  // Checkbox group
  | 'file-path'     // Text input with folder icon
  | 'code'          // Monospace textarea
```

### Conditional Visibility

Parameters can be shown/hidden based on other parameter values:

```typescript
{
  id: 'slideCount',
  visibleWhen: {
    parameterId: 'deliverables',
    operator: 'contains',    // equals | not-equals | contains | not-empty
    value: 'slides',
  },
}
```

### Prompt Interpolation

Prompts use `{{paramName}}` mustache-style placeholders. All required and optional parameter IDs are available.

### Three Prompt Slots

| Slot | Injected When | Purpose |
|------|---------------|---------|
| `planGeneration` | Plan DAG creation | Instructs Claude how to decompose the goal into tasks |
| `taskExecution` | Each task runs | Provides execution context and tool guidance |
| `sharedContext` | Both plan + execution | Reference tables, rubrics, color palettes, scoring criteria |

---

## 5. SKILL.md Pairing

Every example references a SKILL.md in the skills catalog. The skill contains the **detailed methodology** that would bloat the template definition.

| In the Template | In the SKILL.md |
|----------------|-----------------|
| Parameter schema and validation | Detailed scoring rubrics |
| Prompt structure (what to plan) | Step-by-step methodology |
| Output format description | HTML/CSS templates, chart specs |
| Execution config (model, turns) | Tool usage guidelines |
| Plan hints (node count, milestones) | Quality checklists |

Skills are stored at: `skills-catalog/anthropic/{skill-name}/SKILL.md`

---

## 6. Current Examples

### Academic Paper Presentation (`astro/academic-presentation`)

**Category**: `research-analysis` | **Skill**: `academic-presentation`

Converts academic papers into slides (PDF), blog posts (Markdown), and conference posters (PDF). Uses HTML-based rendering with a low-saturation color palette and Playwright for PDF generation.

Key parameters: `workingDirectory` (required), `sourceFormat` (required, pdf/latex/markdown/docx), `deliverables` (required multi-select), `paperLink` (optional), `slideCount`, `targetAudience`, `slideTheme`, `blogStyle`, `posterOrientation`

### Academic Paper/Book Review (`astro/academic-review`)

**Category**: `research-analysis` | **Skill**: `academic-review`

Generates a detailed review with an 8-dimension scoring rubric (1-10 scale). Supports PDF, LaTeX, Markdown, and Word inputs.

Key parameters: `sourceDirectory` (required), `documentType` (required), `sourceFormat` (required), `reviewDepth`, `focusAreas`, `targetVenue`

### Moat & Fragility Analysis (`astro/moat-fragility`)

**Category**: `data-science` | **Skill**: `moat-fragility`

Evaluates a company's competitive advantage through quantitative CA scoring, qualitative moat analysis (7 Powers framework), and anti-fragility resilience testing.

Key parameters: `tickerSymbol` (required), `comparisonTickers`, `analysisDepth`, `timeHorizon`

### Inactive Examples (on disk, not imported)

9 template files exist but are not imported in `index.ts`: web-app, ml-pipeline, api-development, data-pipeline, code-documentation, security-audit, benchmark-runner, literature-review, paper-to-slides. These can be re-enabled by adding imports to `index.ts`.

---

## 7. Adding a New Example

### Checklist

1. Create `packages/core/src/templates/examples/{example-name}.ts` -- export a `UseCaseTemplate` object
2. Create `skills-catalog/anthropic/{skill-name}/SKILL.md` -- detailed methodology + YAML frontmatter
3. Register in `packages/core/src/templates/examples/index.ts` -- import, add to `BUILTIN_TEMPLATES`, add to `TEMPLATES_BY_CATEGORY`
4. Build and test: `npm run build && npm run lint && npm test`

### Authoring Guidelines

- Keep required parameters to 1-3 (low friction)
- Use sensible defaults for optional parameters
- Keep methodology in SKILL.md, not in prompts
- Template prompts should say "consult the skill's SKILL.md" not duplicate content

---

## 8. API Endpoints (Active)

| Endpoint | Method | Purpose | Frontend Caller |
|----------|--------|---------|-----------------|
| `/api/templates` | GET | List all examples | `template-store.load()` |
| `/api/templates/categories` | GET | List categories | `template-store.load()` |
| `/api/templates/:id` | GET | Get example details | `template-store.selectTemplate()` |
| `/api/templates/:id/validate` | POST | Validate params | `template-store.validateParameters()` |
| `/api/templates/:id/preview` | POST | Preview prompts | `template-picker-dialog` |
| `/api/templates/:id/launch` | POST | Create project | `template-store.launchTemplate()` |

---

## 9. Dead Code -- Pending Cleanup

The following template-related code was built but never wired to the UI. See issue #646 for the cleanup plan.

### Dead Frontend Components

| File | Lines | Purpose | Why Dead |
|------|-------|---------|----------|
| `src/components/templates/use-template-sheet.tsx` | 339 | Apply template to existing project | Never imported/rendered |
| `src/components/templates/save-as-template-dialog.tsx` | 349 | Save plan as reusable template | Never imported/rendered |
| `src/components/templates/featured-template-chips.tsx` | 113 | Template chip row | Never imported/rendered |
| `src/components/templates/template-preview.tsx` | ~150 | Template preview panel | Only used by dead `use-template-sheet` |

### Dead Frontend Functions

| Location | Function | Why Dead |
|----------|----------|----------|
| `src/stores/agent-store.ts` | `startGeneration()` | Never called from UI (Pathway 5 caller) |
| `src/lib/api-client.ts` | `generatePlan()` | All callers dead (Pathway 5 API) |
| `src/lib/api-client.ts` | `applyTemplate()` | Sole caller is dead `use-template-sheet` |
| `src/lib/api-client.ts` | `getTemplateSchema()` | Never imported |
| `src/lib/api-client.ts` | Custom CRUD (5 functions) | No UI calls store methods |
| `src/stores/template-store.ts` | Custom CRUD methods | No UI caller |

### Dead Backend Routes

| Route | Why Dead |
|-------|----------|
| POST `/api/templates/:id/apply` | Sole caller was dead `use-template-sheet` |
| GET `/api/templates/:id/schema` | Never used from frontend |
| Custom template CRUD (5 routes) | No UI reaches them |
| POST `/api/agent/generate-plan` (Pathway 5) | All frontend callers dead |
| POST `/api/agent/compact` (Pathway 9) | Zero callers anywhere |

### Dead Database Infrastructure

| Item | Status |
|------|--------|
| `custom_templates` table + migration | Table exists, has RLS policies, but no UI writes to it |

### Future Rename: template -> example

Once the dead code is removed, the codebase should be renamed to match the UI:
- `template-store.ts` -> `example-store.ts`
- `src/components/templates/` -> `src/components/examples/`
- `useTemplateStore` -> `useExampleStore`
- `UseCaseTemplate` -> `UseCaseExample` (or keep as `Example`)
- API routes: `/api/templates` -> `/api/examples`

This is a large rename best done in a dedicated PR after the dead code cleanup.

---

## 10. Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/templates/examples/*.ts` | Example definitions |
| `packages/core/src/templates/examples/index.ts` | Registry: exports, categories, lookup |
| `packages/core/src/types/use-case-template.ts` | `UseCaseTemplate` type definition |
| `skills-catalog/anthropic/*/SKILL.md` | Skill methodology files |
| `src/pages/examples.tsx` | Examples page (card grid) |
| `src/components/templates/template-picker-dialog.tsx` | Configure + Launch wizard |
| `src/components/templates/template-parameter-form.tsx` | Dynamic parameter form |
| `src/stores/template-store.ts` | Frontend state + launch action |
| `server/routes/templates.ts` | API: list, launch, validate |
