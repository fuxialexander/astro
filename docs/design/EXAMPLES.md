# Examples System Design

> Last updated: 2026-03-04
> Status: IMPLEMENTED
> Supersedes: The "built-in templates" portion of TEMPLATES.md. Custom templates remain documented in TEMPLATES.md.

## 1. Overview

Examples are curated, polished project templates that demonstrate Astro's capabilities across different domains. They serve as **onboarding ramps** — users click an example, configure a few parameters, and land on a fully-populated Plan page ready to execute.

Unlike custom templates (user-created, stored in DB), examples are **shipped with Astro** as TypeScript definitions paired with SKILL.md files in the skills catalog.

### Design Goals

1. **Teach by doing**: Each example mirrors the Plan page layout so users learn the interface while configuring their first project
2. **Extensible**: Adding a new example requires only two files — a template definition and a SKILL.md
3. **Self-contained**: Each example bundles its own prompts, parameters, skills, and output specification
4. **Quality over quantity**: Ship a small number of polished examples rather than many untested ones

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Example Definition                          │
│         packages/core/src/templates/examples/*.ts               │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ academic-        │  │ academic-        │  │ moat-        │  │
│  │ presentation.ts  │  │ review.ts        │  │ fragility.ts │  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘  │
│           │                     │                    │          │
│           └─────────┬───────────┴────────────────────┘          │
│                     │                                           │
│              examples/index.ts                                  │
│           (BUILTIN_TEMPLATES array)                             │
└─────────────────────┬───────────────────────────────────────────┘
                      │
          GET /api/templates (merged with custom templates)
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend                                    │
│                                                                 │
│  ┌──────────────┐    ┌───────────────────────┐    ┌──────────┐ │
│  │ Examples Page │───>│ TemplatePickerDialog  │───>│ Plan     │ │
│  │ /examples    │    │ (Configure → Launch)   │    │ Page     │ │
│  └──────────────┘    └───────────────────────┘    └──────────┘ │
└─────────────────────────────────────────────────────────────────┘
                      │
                      │ skills: ['academic-presentation']
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Skills Catalog                                │
│           skills-catalog/anthropic/*/SKILL.md                   │
│                                                                 │
│  Each example references a SKILL.md that is injected into the   │
│  agent's system prompt during plan generation and execution.    │
└─────────────────────────────────────────────────────────────────┘
```

## 3. User Flow

The flow is designed so the configure dialog **previews** what the Plan page will look like:

```
 Examples Page          Configure Dialog           Plan Page
┌──────────────┐     ┌──────────────────────┐   ┌──────────────────┐
│              │     │ Project Configuration│   │                  │
│  📖 Card     │────>│  - Project Name *    │──>│ Machine selector │
│  📑 Card     │     │  - Working Directory │   │ Working Dir [📁] │
│  🎓 Card     │     │                      │   │ (pre-filled)     │
│              │     │ Template Parameters  │   │                  │
│              │     │  - Required params   │   │ Plan graph       │
│              │     │  ▸ Advanced Options  │   │ (generated)      │
│              │     │                      │   │                  │
│              │     │ [Create Project →]   │   │ [Confirm & Run]  │
└──────────────┘     └──────────────────────┘   └──────────────────┘
```

**Step-by-step:**

1. **Examples page** (`/examples`): Grid of example cards. Click one.
2. **Configure dialog**: Opens directly at Configure step (skips Browse). User fills:
   - **Project Name** (required) — auto-generated from template name
   - **Working Directory** (optional) — text input; hint says "also settable on plan page"
   - **Template parameters** — required shown up front, optional in collapsible "Advanced Options"
3. **Create Project**: Calls `POST /api/templates/:id/launch` with parameters + working directory → creates project → navigates to Plan page
4. **Plan page**: Working directory pre-filled from project. User selects machine (folder picker available here), reviews the generated plan, confirms to start execution.

The configure dialog teaches users what information feeds into planning. The Plan page is where they select infrastructure (machine) and confirm execution.

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

Prompts use `{{paramName}}` mustache-style placeholders. All required and optional parameter IDs are available:

```
- Paper Source: {{paperSource}}
- Deliverables: {{deliverables}}
- Slide Count: {{slideCount}}
```

### Three Prompt Slots

| Slot | Injected When | Purpose |
|------|---------------|---------|
| `planGeneration` | Plan DAG creation | Instructs Claude how to decompose the goal into tasks |
| `taskExecution` | Each task runs | Provides execution context and tool guidance |
| `sharedContext` | Both plan + execution | Reference tables, rubrics, color palettes, scoring criteria |

## 5. SKILL.md Pairing

Every example references a SKILL.md in the skills catalog. The skill contains the **detailed methodology** that would bloat the template definition.

```
Template (TypeScript)          SKILL.md (Markdown)
─────────────────────          ──────────────────────
Parameters, prompts,           Full methodology,
output format, hints    ←───→  rubrics, templates,
                               HTML/CSS, charts
```

### Separation of Concerns

| In the Template | In the SKILL.md |
|----------------|-----------------|
| Parameter schema and validation | Detailed scoring rubrics |
| Prompt structure (what to plan) | Step-by-step methodology |
| Output format description | HTML/CSS templates, chart specs |
| Execution config (model, turns) | Tool usage guidelines |
| Plan hints (node count, milestones) | Quality checklists |

### SKILL.md Location

```
skills-catalog/anthropic/{skill-name}/SKILL.md
```

The skill name matches `execution.skills[0]` in the template definition.

### SKILL.md Frontmatter

```yaml
---
name: academic-presentation
version: "1.0.0"
description: "Convert academic papers into slides, blog posts, and posters"
category: workflows
tags: [academic, slides, pdf, html]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash]
---
```

## 6. Template Registry

### File: `packages/core/src/templates/examples/index.ts`

```typescript
import { academicPresentationTemplate } from './academic-presentation.js'
import { academicReviewTemplate } from './academic-review.js'
import { moatFragilityTemplate } from './moat-fragility.js'

export const BUILTIN_TEMPLATES: UseCaseTemplate[] = [
  academicPresentationTemplate,
  academicReviewTemplate,
  moatFragilityTemplate,
]

export const TEMPLATES_BY_CATEGORY: Record<string, UseCaseTemplate[]> = {
  'research-analysis': [academicPresentationTemplate, academicReviewTemplate],
  'data-science': [moatFragilityTemplate],
}

export function getTemplateById(id: string): UseCaseTemplate | undefined
export function getTemplatesByCategory(category: string): UseCaseTemplate[]
```

### Parent re-export: `packages/core/src/templates/index.ts`

Re-exports all templates, types, loader utilities, and validation functions from `@astro/core/templates`.

## 7. Frontend Components

### Examples Page (`src/pages/examples.tsx`)

- Route: `/examples` (with `/templates` redirecting here)
- Sidebar: "Examples" with `BookOpen` icon
- Renders a grid of cards from `useTemplateStore.templates`
- Each card shows: icon, name, description, category badge
- Click → opens `TemplatePickerDialog` with `skipBrowse` and `initialTemplateId`

### TemplatePickerDialog (`src/components/templates/template-picker-dialog.tsx`)

Two-step wizard when launched from Examples (`skipBrowse=true`):

1. **Configure**: Project name + working directory + `TemplateParameterForm`
2. **Launch**: Summary of configuration → "Launch Project" button

On launch: calls `useTemplateStore.launchTemplate(projectName, workingDirectory)` → navigates to `/projects/:id/plan`.

### TemplateParameterForm (`src/components/templates/template-parameter-form.tsx`)

Dynamic form renderer:
- Groups parameters by `group` field → renders group headers
- Required parameters shown at top
- Optional parameters in collapsible "Advanced Options" section
- Supports all parameter types (string, select, multi-select, etc.)
- Conditional visibility via `visibleWhen`
- Real-time validation (debounced 500ms)

## 8. Current Examples

### 🎓 Academic Paper Presentation (`astro/academic-presentation`)

**Category**: `research-analysis`
**Skill**: `academic-presentation`

Converts academic papers into slides (PDF), blog posts (Markdown), and conference posters (PDF). Uses HTML-based rendering with a low-saturation color palette and Playwright for PDF generation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| paperSource | string | Yes | PDF directory path or arXiv links |
| deliverables | multi-select | Yes | slides, blog-post, poster |
| slideCount | select | No | brief / standard / detailed |
| targetAudience | select | No | researcher / graduate / engineer / general |
| slideTheme | select | No | light / dark / both |
| blogStyle | select | No | detailed / succinct |
| posterOrientation | select | No | portrait / landscape |
| githubUrl | string | No | Companion code repository |
| customRequirements | string | No | Narrative direction |

### 📖 Academic Paper/Book Review (`astro/academic-review`)

**Category**: `research-analysis`
**Skill**: `academic-review`

Generates a superhuman-level detailed review with an 8-dimension scoring rubric (1-10 scale). Supports PDF, LaTeX, Markdown, and Word inputs via appropriate document reading skills.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| sourceDirectory | string | Yes | Directory containing document(s) |
| documentType | select | Yes | paper / book / thesis |
| sourceFormat | select | Yes | pdf / latex / markdown / docx |
| reviewDepth | select | No | comprehensive / standard / quick |
| reviewerExpertise | select | No | expert / researcher / student |
| focusAreas | multi-select | No | novelty, math, experiments, writing |
| targetVenue | string | No | Calibrate to specific venue |
| reportFormat | select | No | latex-pdf / markdown-pdf |
| includeDiagrams | select | No | yes / no |
| literatureSearch | select | No | enabled / disabled |

### 📑 Moat & Fragility Analysis (`astro/moat-fragility`)

**Category**: `data-science`
**Skill**: `moat-fragility`

Evaluates a company's competitive advantage through quantitative CA scoring (4 pillars), qualitative moat analysis (7 Powers framework), and anti-fragility resilience testing. User provides a ticker symbol; outputs a structured PDF report.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| tickerSymbol | string | Yes | Stock ticker (e.g., AAPL) |
| supplementaryDocs | string | No | Path to supplementary filings |
| comparisonTickers | string | No | Competitor tickers (comma-separated) |
| analysisDepth | select | No | comprehensive / standard / quick |
| timeHorizon | select | No | 3year / 5year / 10year |
| sectorFocus | select | No | auto / tech / consumer / healthcare / financial |
| reportStyle | select | No | professional / executive |

## 9. Adding a New Example

### Checklist

1. **Create the template definition**:
   ```
   packages/core/src/templates/examples/{example-name}.ts
   ```
   Export a `UseCaseTemplate` object named `{exampleName}Template`.

2. **Create the SKILL.md**:
   ```
   skills-catalog/anthropic/{skill-name}/SKILL.md
   ```
   Include YAML frontmatter + detailed methodology. Reference external skills (PDF, DOCX) when needed.

3. **Register in the index**:
   ```
   packages/core/src/templates/examples/index.ts
   ```
   - Add import + re-export
   - Add to `BUILTIN_TEMPLATES` array
   - Add to `TEMPLATES_BY_CATEGORY` map

4. **Re-export from parent**:
   ```
   packages/core/src/templates/index.ts
   ```
   Add the named export for the new template.

5. **Build and test**:
   ```bash
   npm run build   # Verify types
   npm run lint     # Verify lint
   npm test         # Verify tests
   ```

### Template Authoring Guidelines

**Parameters:**
- Keep required parameters to 1-3 (low friction to get started)
- Use sensible defaults for all optional parameters
- Group related parameters (`source`, `analysis`, `output`, etc.)
- Use `visibleWhen` to hide irrelevant options
- Placeholder text should show format, not specific real-world values (e.g., `XXXX.XXXXX` not `2502.15872`)

**Prompts:**
- `planGeneration`: Reference the skill by name; describe the DAG structure (phases, parallelism, labels, verification)
- `taskExecution`: Specify which tools to use for which file types; reference the skill for detailed methodology
- `sharedContext`: Include scoring rubrics, color palettes, report templates — anything both planning and execution need

**Skills:**
- Keep methodology out of the template — put it in SKILL.md
- Template prompts should say "consult the skill's SKILL.md for..." not duplicate the content
- Reference external skills (PDF, DOCX) when the example handles those file types

**Output:**
- Describe the output directory structure in `outputFormat.example`
- Use `type: 'free'` unless the output must conform to a JSON schema

**Naming:**
- Template ID: `astro/{kebab-case-name}`
- Skill name: `{kebab-case-name}` (matches the template)
- Category: Pick from existing `UseCaseCategory` values
- Domains: Pick from existing `DomainExpertise` values

### Example Skeleton

```typescript
import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const myExampleTemplate: UseCaseTemplate = {
  id: 'astro/my-example',
  name: 'My Example',
  description: 'One-line description of what this example does.',
  category: 'research-analysis',
  version: '1.0.0',
  icon: '🔬',
  tags: ['tag1', 'tag2'],
  maturity: 'stable',

  requiredParameters: [
    {
      id: 'inputSource',
      name: 'Input Source',
      description: 'Path to the input data.',
      type: 'string',
      required: true,
      placeholder: '/path/to/data/',
      group: 'source',
      order: 0,
    },
  ],

  optionalParameters: [
    // Add optional parameters here
  ],

  prompts: {
    planGeneration: `You are an expert...
## Skill Reference
This project uses the \`my-example\` skill. Consult the SKILL.md for detailed methodology.
## Planning Guidelines
Decompose into a DAG of tasks...`,

    taskExecution: `You are executing a task...
## Skill Reference
Consult the \`my-example\` skill's SKILL.md for methodology.`,

    sharedContext: `Shared reference material...`,
  },

  outputFormat: {
    type: 'free',
    description: 'Output description.',
    example: `output/\n  result.pdf`,
  },

  parallelization: {
    maxConcurrentTasks: 4,
    autoDispatch: true,
    defaultPriority: 'normal',
    retry: { maxRetries: 2, retryDelayMs: 5000, exponentialBackoff: true },
    machineSelectionPolicy: 'priority',
  },

  execution: {
    preferredModel: 'claude-sonnet-4-20250514',
    maxTurns: 50,
    maxBudgetPerTask: 5.0,
    skills: ['my-example'],
    deliveryMode: 'branch',
    skipSafetyCheck: false,
    defaultVerification: 'mixed',
  },

  planHints: {
    targetNodeCount: { min: 4, max: 12 },
    defaultEstimate: 'M',
    suggestedMilestones: [
      { title: 'Data Loaded', description: 'Input parsed and validated' },
      { title: 'Analysis Complete', description: 'Core analysis finished' },
      { title: 'Report Generated', description: 'Final output produced' },
    ],
    commonLabels: ['l5'],
    preferParallelTasks: true,
  },

  domains: ['scientific-computing'],
  recommendedSkills: ['my-example'],
  source: 'builtin',
  enabled: true,
}
```

## 10. Relationship to Other Systems

```
┌─────────────────────────────────────────────────────────┐
│                    Examples                              │
│  (Template definitions + SKILL.md)                      │
└────────┬──────────────────────────────┬─────────────────┘
         │                              │
         ▼                              ▼
┌──────────────────┐          ┌──────────────────┐
│  Templates System│          │  Skills System   │
│  (TEMPLATES.md)  │          │  (SKILLS.md)     │
│                  │          │                  │
│  - Custom CRUD   │          │  - Skill registry│
│  - Launch API    │          │  - Prompt inject │
│  - Param valid.  │          │  - Collections   │
└────────┬─────────┘          └────────┬─────────┘
         │                              │
         ▼                              ▼
┌─────────────────────────────────────────────────────────┐
│                Plan Generation + Execution               │
│                                                         │
│  Template prompts → Claude Agent SDK → Plan DAG         │
│  Skill instructions → injected into agent system prompt │
└─────────────────────────────────────────────────────────┘
```

- **Templates system** (TEMPLATES.md): Handles the API, database, custom template CRUD, launch flow. Examples are built-in templates served through the same API.
- **Skills system** (SKILLS.md): Manages the skill registry, prompt injection, collections. Example-paired skills are loaded from `skills-catalog/anthropic/` and seeded into the DB on startup. The Skills page is hidden from the sidebar; skills are now primarily used as agent context for examples.
- **Plan generation**: Template prompts guide DAG structure; skill instructions guide individual task execution.

## 11. Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/templates/examples/*.ts` | Example template definitions |
| `packages/core/src/templates/examples/index.ts` | Registry: exports, categories, lookup |
| `packages/core/src/templates/index.ts` | Public API re-exports |
| `packages/core/src/types/use-case-template.ts` | `UseCaseTemplate` type definition |
| `skills-catalog/anthropic/*/SKILL.md` | Skill methodology files |
| `src/pages/examples.tsx` | Examples page (card grid) |
| `src/components/templates/template-picker-dialog.tsx` | Configure + Launch wizard |
| `src/components/templates/template-parameter-form.tsx` | Dynamic parameter form |
| `src/stores/template-store.ts` | Frontend state + launch action |
| `server/routes/templates.ts` | API: list, launch, validate |
| `src/stores/sidebar-store.ts` | Sidebar "Examples" entry |
| `src/app.tsx` | Route: `/examples`, redirect `/templates` |
