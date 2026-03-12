---
name: astro-template-builder
version: "1.0.0"
description: "Meta-skill for building standardized Astro use-case templates (examples). Guides AI agents through the full lifecycle: user requirements elicitation, template TypeScript authoring, SKILL.md creation, registration, and unit testing."
category: workflows
tags: [meta, template, builder, astro, example, skill, testing]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash]
---

# Astro Template Builder

You are an expert Astro platform developer building new use-case templates (examples). Templates are structured definitions that configure how Astro generates plans, dispatches tasks, and renders configuration UI for a specific type of work.

This skill guides you through the full lifecycle of building a template — from understanding what the user wants, through writing the TypeScript template and companion SKILL.md, to registration and unit testing.

---

## 0. Before You Write Any Code — Requirements Elicitation

**CRITICAL**: Do NOT start coding immediately. Templates encode significant domain knowledge, and users often don't have a fully formed idea upfront. Your first job is to discuss, clarify, and help the user sharpen their requirements through conversation.

### 0.1 Key Questions to Ask

Work through these questions with the user. Not all apply to every template, but consider each one:

**Scope & Purpose**
1. What is the primary task/workflow this template automates?
2. Who is the target user? (developer, researcher, analyst, designer)
3. What does "done" look like? What are the concrete deliverables? (files, reports, PRs, datasets)
4. Is there an existing manual process this replaces? Walk me through it step by step.

**Data Sources & Inputs**
5. What data does the agent need to start? (APIs, files, URLs, databases)
6. Which inputs are essential vs. nice-to-have? (required vs. optional parameters)
7. Are there inputs that accept multiple values? (e.g., multiple URLs → parallel branches)
8. What formats are the inputs in? (PDF, LaTeX, JSON, CSV, URL, plain text)
9. Are there authentication/API key requirements?

**Processing & Analysis**
10. What are the distinct phases of work? Can any run in parallel?
11. What domain knowledge does the agent need? (scoring rubrics, frameworks, methodologies)
12. Are there external tools/services involved? (curl, Playwright, LaTeX compiler, Python)
13. What quality criteria distinguish good output from bad output?

**Output & Delivery**
14. What file format(s) should the output be in? (HTML, PDF, Markdown, JSON)
15. Should outputs match a specific visual style? (If so, which existing template's style?)
16. Where should output files go? What folder structure?
17. Is there a compilation/assembly step at the end? (e.g., individual files → combined document)

**Corner Cases & Failure Modes**
18. What happens if the primary data source is unavailable or returns empty?
19. What happens if a secondary data source fails? (graceful degradation vs. hard stop)
20. Are there inputs that could be ambiguous? How should the agent resolve them?
21. What's the maximum reasonable scale? (e.g., max number of items to process)

**Configuration & Customization**
22. What settings should power users be able to tune? (depth, style, scope)
23. Are there mutually exclusive options? (e.g., format A vs. format B)
24. Should any settings be visible only when another option is selected? (conditional visibility)

### 0.2 Discussion Strategy

- **Start broad**: Ask about the overall goal and deliverables first
- **Then narrow**: Drill into specific phases, data sources, and edge cases
- **Validate understanding**: After 2-3 rounds, summarize your understanding back to the user and ask them to confirm or correct
- **Propose before building**: Before writing any code, present:
  1. The proposed parameter list (required vs. optional)
  2. The proposed plan structure (phases, parallelism)
  3. The proposed deliverables and folder structure
  4. Key corner cases and how you'll handle them
- **Iterate**: The user may change their mind or realize new requirements. That's normal. Adjust the plan.

### 0.3 When the User is Vague

Users often say things like "build me a template for X" without specifying details. In these cases:

- Don't assume — ask. "When you say 'analysis report', do you mean a PDF? HTML? Markdown? All three?"
- Offer concrete options: "For the visual style, we could match the academic-presentation palette (Palatino + low-saturation colors) or create a new one. Which do you prefer?"
- Show examples from existing templates: "The moat-fragility template has 4 required params and 5 optional. Does that feel like the right level of complexity for yours?"
- Start with the minimum viable template and note what could be added later

---

## 1. Astro Template Architecture

### 1.1 How Templates Work End-to-End

```
User selects template in UI
       ↓
Configuration page renders parameter form
  - requiredParameters: always shown
  - optionalParameters with prominent=true: always shown
  - other optionalParameters: hidden in "Advanced Options" collapsible
       ↓
User fills parameters, clicks "Launch"
       ↓
Backend calls interpolatePrompt(planGeneration, resolvedParams)
  - {{paramName}} placeholders → replaced with values
  - Empty optional params → entire line containing placeholder is removed
  - Runs of 3+ newlines → collapsed to 2
       ↓
sharedContext (if present) is prepended:
  fullDescription = sharedContext + "\n\n---\n\n" + interpolatedPlanGeneration
       ↓
SKILL.md files fetched from /api/skills/files/{skillName}/SKILL.md
  - recommendedSkills: always loaded
  - conditionalSkills: loaded based on parameter values
  - Become the project's visionDoc
       ↓
Plan generation AI receives fullDescription + generates task DAG
       ↓
Each task dispatched with visionDoc (SKILL.md content) in <user_vision> tags
```

### 1.2 The Three Deliverables You Must Create

For every new template, you produce three things:

1. **SKILL.md** (`skills/{skill-name}/SKILL.md`) — Detailed execution instructions the agent follows when running individual tasks. This is the "how to do the work" document.

2. **Template TypeScript** (`packages/core/src/templates/examples/{name}.ts`) — The `UseCaseTemplate` object defining parameters, prompts, execution config, and plan hints. This is the "what to plan and configure" definition.

3. **Unit Tests** (`packages/core/src/templates/__tests__/{name}.test.ts`) — Tests verifying registration, interpolation, parameter schema, and plan assembly.

Plus registration in `packages/core/src/templates/examples/index.ts`.

---

## 2. Template TypeScript — Complete Reference

### 2.1 File Location & Naming

```
packages/core/src/templates/examples/{kebab-case-name}.ts
```

### 2.2 Required Structure

```typescript
import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const myTemplate: UseCaseTemplate = {
  // ── Identity (all required) ──
  id: 'astro--kebab-case-name',     // Must match: /^[a-z0-9][a-z0-9-/]*[a-z0-9]$/
  name: 'Human Readable Name',       // 2-80 characters
  description: '...',                 // What it does, what user provides, what they get
  category: '...',                    // See valid categories below
  version: '1.0.0',                   // Semver

  // ── Display (optional) ──
  icon: '📰',                         // Single emoji
  tags: ['tag1', 'tag2'],            // For search/filtering
  maturity: 'stable',                 // 'stable' | 'beta' | 'experimental'

  // ── Parameters ──
  requiredParameters: [ ... ],        // User MUST fill these
  optionalParameters: [ ... ],        // Have defaults, shown in "Advanced Options"

  // ── Prompts ──
  prompts: {
    planGeneration: `...`,            // REQUIRED: Main prompt for plan decomposition
    sharedContext: `...`,             // OPTIONAL: Domain knowledge prepended to all prompts
    taskExecution: `...`,             // OPTIONAL: Override per-task system prompt (rarely used)
    planRefinement: `...`,            // OPTIONAL: Override plan chat prompt (rarely used)
  },

  // ── Output ──
  outputFormat: { type: 'free', description: '...', example: '...' },

  // ── Parallelization ──
  parallelization: { maxConcurrentTasks: 4, autoDispatch: true, ... },
  inputParallelization: { ... },      // OPTIONAL: for multi-value inputs

  // ── Execution ──
  execution: {
    preferredModel: 'claude-sonnet-4-20250514',
    maxTurns: 50,
    maxBudgetPerTask: 5.0,
    skills: ['skill-name'],           // SKILL.md to inject as visionDoc
    defaultVerification: 'mixed',
  },

  // ── Plan Hints ──
  planHints: {
    targetNodeCount: { min: 4, max: 14 },
    defaultEstimate: 'M',
    suggestedMilestones: [ ... ],
    commonLabels: ['l5', 'l1'],
    preferParallelTasks: true,
  },

  // ── Relationships ──
  domains: ['scientific-computing'],
  recommendedSkills: ['skill-name'],
  conditionalSkills: { ... },         // OPTIONAL
  source: 'builtin',
  enabled: true,
}
```

### 2.3 Valid Categories

```
'software-development' | 'data-science' | 'machine-learning' |
'devops-infrastructure' | 'research-analysis' | 'research' | 'finance' |
'documentation' | 'testing-qa' | 'security' | 'computational-biology' | 'custom'
```

### 2.4 Parameter Types & UI Mapping

| Type | UI Component | Notes |
|------|-------------|-------|
| `'string'` | Text input | Single-line text |
| `'textarea'` | Multi-line textarea | For long text, URLs per line, etc. |
| `'number'` | Number input | With optional min/max validation |
| `'boolean'` | Toggle switch | |
| `'select'` | Dropdown | Requires `options` array |
| `'multi-select'` | Checkbox group | Requires `options`, default is array |
| `'file-path'` | File picker | With directory browsing |
| `'code'` | Code editor (Monaco) | With language hint |

### 2.5 Parameter Visibility Rules

Parameters render in the configuration form based on these rules:

```
ALWAYS VISIBLE (main section):
  - requiredParameters (required: true)
  - optionalParameters with prominent: true

HIDDEN (behind "Advanced Options" collapsible):
  - optionalParameters without prominent: true

CONDITIONALLY VISIBLE:
  - Parameters with visibleWhen: { parameterId: 'X', operator: 'equals', value: 'Y' }
  - Only shown when the referenced parameter has the matching value
  - Operators: 'equals' | 'not-equals' | 'contains' | 'not-empty'
```

**Design guideline**: Put the user's primary inputs (what they're providing) as `prominent: true`. Put tuning knobs (depth, style, format) in Advanced Options.

### 2.6 Prompt Interpolation Rules

The `interpolatePrompt()` function processes `{{paramName}}` placeholders:

1. For each parameter key in the resolved values:
   - If the value is empty/undefined/whitespace: **remove the entire line** containing the placeholder
   - If the value is an array: join with `', '`
   - Otherwise: replace `{{paramName}}` with the string value
2. After all substitutions: collapse runs of 3+ newlines to 2

**Implications for prompt writing:**
- Put each optional parameter on its own line so it gets cleanly removed when empty
- Don't put multiple parameters on the same line unless they always appear together
- Lines like `- Additional Papers: {{additionalPapers}}` vanish cleanly when empty
- The planGeneration prompt should still make sense after empty-parameter lines are stripped
- **Test this**: your unit tests should verify no `{{...}}` placeholders remain after interpolation with both full and minimal params

### 2.7 Plan Generation Prompt Best Practices

The `planGeneration` prompt is the most important part of the template. It tells the AI how to decompose the project into a task DAG. Structure it as:

```
1. Role statement: "You are a [domain expert] designing a [task type] pipeline."

2. Specification block: All {{parameters}} listed clearly

3. Skill reference: Point to the SKILL.md as source of truth for execution details

4. Planning guidelines:
   - Phase 1: Data retrieval/validation (always first)
   - Phase 2-N: Processing phases (with parallelism notes)
   - Final phase: Assembly/compilation (depends on all prior)

5. Corner case handling: What to do when inputs are missing/invalid

6. Parallelism rules: What can run concurrently

7. Labels: Which task labels to use (l1-l5)

8. Verification: Which tasks need human review vs. auto-verify
```

**Critical corner case pattern**: If the template's data source might be empty (API returns nothing, file doesn't exist), the prompt MUST include a STOP instruction:

```
- **CRITICAL**: If [condition], report "[error message]" and STOP.
  Do not create further tasks.
```

### 2.8 Shared Context Best Practices

The `sharedContext` is prepended to the full description and is available to both planning and execution. Use it for:

- Color palette / typography specifications
- Scoring rubrics or evaluation frameworks
- Data source API documentation
- Output folder structure
- Corner case handling rules
- Domain terminology definitions

**Do NOT put planning instructions in sharedContext** — those belong in planGeneration.

---

## 3. SKILL.md — Complete Reference

### 3.1 File Location & Structure

```
skills/{skill-name}/SKILL.md
```

### 3.2 Required Sections

```markdown
---
name: skill-name
version: "1.0.0"
description: "What this skill teaches the agent to do"
category: workflows
tags: [tag1, tag2]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash]
---

# Skill Title

Role statement: "You are a [domain expert] producing [deliverables]."

---

## 0. Workflow — Multi-Step Task Decomposition

CRITICAL instruction to decompose, not do everything in one task.
Recommended plan structure with task dependencies.
Minimum task count guidance.

## 1. [Phase-specific sections]

Detailed instructions for each phase of work.
Include: API endpoints, curl commands, data formats.
Include: fallback strategies when data sources fail.

## N. Color Palette & Typography (if producing visual output)

CSS specifications matching the Astro design system.
Color variables, font stacks, box styles.

## N+1. Figure/Diagram Guidelines (if applicable)

SVG style rules matching the color palette.
When to generate figures, what they should show.

## N+2. Output Assembly & PDF Rendering (if applicable)

How to combine individual outputs into a final deliverable.
Chrome headless / puppeteer-core rendering commands.

## N+3. Quality Checklist

Checkboxes for all quality criteria the agent should verify before marking done.
```

### 3.3 Visual Style — The Astro Design System

If the template produces visual output (HTML, PDF, slides), use this consistent style:

**Color Palette (low-saturation)**
```css
--bg:       #FAF8F5;  /* warm off-white */
--text:     #3A3A3A;  /* soft black */
--emph:     #C4A882;  /* warm sand */
--blue:     #8FA8B8;  /* dusty blue */
--green:    #A8B8A0;  /* sage */
--teal:     #7FA8A0;  /* muted teal */
--gold:     #C8B878;  /* antique gold */
--lavender: #9B8FBF;  /* soft purple */
--red:      #A86464;  /* muted red */
```

**Typography**
```css
font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
code: 'Fira Code', 'Source Code Pro', monospace;
```

**Box Styles** (border-left colored boxes for content categorization)
```css
.box-blue    { background: rgba(143,168,184,0.12); border-left: 4px solid #8FA8B8; }
.box-green   { background: rgba(168,184,160,0.12); border-left: 4px solid #A8B8A0; }
.box-pink    { background: rgba(196,168,130,0.12); border-left: 4px solid #C4A882; }
.box-gold    { background: rgba(200,184,120,0.12); border-left: 4px solid #C8B878; }
.box-lavender{ background: rgba(155,143,191,0.12); border-left: 4px solid #9B8FBF; }
.box-red     { background: rgba(168,100,100,0.10); border-left: 4px solid #A86464; }
```

**SVG Figures**: Same palette, Palatino font, rounded rectangles (rx:8), clean arrowhead markers, max 800px wide, no shadows or gradients.

**Math**: KaTeX CDN (v0.16.11) with auto-render, `$...$` inline, `$$...$$` display.

If the template doesn't need to match this style, the user should explicitly say so during requirements elicitation.

---

## 4. Registration

### 4.1 Add to examples/index.ts

Edit `packages/core/src/templates/examples/index.ts`:

```typescript
// Add export
export { myTemplate } from './my-template.js'

// Add import
import { myTemplate } from './my-template.js'

// Add to BUILTIN_TEMPLATES array
export const BUILTIN_TEMPLATES: UseCaseTemplate[] = [
  // ... existing templates ...
  myTemplate,
]

// Add to TEMPLATES_BY_CATEGORY
export const TEMPLATES_BY_CATEGORY: Record<string, UseCaseTemplate[]> = {
  'research-analysis': [/* ... */, myTemplate],  // or appropriate category
}
```

### 4.2 Add to templates/index.ts barrel (optional)

If you want the template available as a named export from `@astro/core/templates`:

```typescript
// In packages/core/src/templates/index.ts, add to the export block:
export {
  // ... existing ...
  myTemplate,
} from './examples/index.js'
```

---

## 5. Unit Tests — Complete Reference

### 5.1 File Location

```
packages/core/src/templates/__tests__/{name}.test.ts
```

### 5.2 Test Categories (all required)

Every template test suite must cover these categories:

```typescript
import { describe, it, expect } from 'vitest'
import { myTemplate } from '../examples/my-template.js'
import { BUILTIN_TEMPLATES, getTemplateById, BUILTIN_TEMPLATE_IDS } from '../examples/index.js'
import { interpolatePrompt } from '../interpolate.js'
import { deriveEffectiveSkills } from '../skill-resolution.js'
```

#### 5.2.1 Registration Tests

```typescript
describe('template registration', () => {
  it('is included in BUILTIN_TEMPLATES', () => {
    const ids = BUILTIN_TEMPLATES.map(t => t.id)
    expect(ids).toContain('astro--my-template')
  })

  it('is findable by ID', () => {
    const found = getTemplateById('astro--my-template')
    expect(found).toBeDefined()
    expect(found!.id).toBe('astro--my-template')
  })

  it('ID is in BUILTIN_TEMPLATE_IDS set', () => {
    expect(BUILTIN_TEMPLATE_IDS.has('astro--my-template')).toBe(true)
  })
})
```

#### 5.2.2 Parameter Schema Tests

```typescript
describe('parameter schema', () => {
  it('has [X] and [Y] as required', () => { ... })
  it('[param] has correct validation pattern', () => { ... })
  it('[param] defaults to [value]', () => { ... })
  it('[prominent params] are prominent', () => { ... })
  it('[non-prominent params] are NOT prominent', () => { ... })
  it('all parameter IDs are unique', () => {
    const all = [...template.requiredParameters, ...(template.optionalParameters ?? [])]
    const ids = all.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
```

#### 5.2.3 Interpolation Tests

**IMPORTANT**: The `interpolatePrompt()` function only processes keys present in the parameters object. To test empty-parameter line removal, you must pass all parameter keys with empty string values (mimicking what the backend does):

```typescript
// Correct: backend passes all keys, empty ones as ''
const REQUIRED_PARAMS = {
  workingDirectory: '/tmp/test',
  param1: 'value',
  optionalParam1: '',   // <-- must include with empty string
  optionalParam2: '',
}

// Wrong: missing keys won't be processed
const WRONG = {
  workingDirectory: '/tmp/test',
  param1: 'value',
  // optionalParam1 missing → {{optionalParam1}} stays in output!
}
```

Tests to include:

```typescript
describe('planGeneration interpolation', () => {
  it('substitutes all required parameters', () => { ... })
  it('substitutes all optional parameters when provided', () => { ... })
  it('removes lines with empty optional parameters', () => {
    // Verify no {{paramName}} remains
    expect(result).not.toContain('{{optionalParam1}}')
  })
  it('has no remaining placeholders with full params', () => {
    expect(result).not.toMatch(/\{\{[a-zA-Z]+\}\}/)
  })
  it('contains critical instructions (STOP, fallback, etc.)', () => { ... })
  it('contains data source URLs/endpoints', () => { ... })
})
```

#### 5.2.4 Shared Context Tests

```typescript
describe('sharedContext', () => {
  it('contains color palette', () => { ... })         // if visual output
  it('contains typography spec', () => { ... })        // if visual output
  it('contains corner case handling', () => { ... })   // always
  it('contains output folder structure', () => { ... })// always
  it('interpolates parameters correctly', () => { ... })
})
```

#### 5.2.5 Skill Resolution Tests

```typescript
describe('skill resolution', () => {
  it('derives [skill-name] as the skill', () => {
    const skills = deriveEffectiveSkills(myTemplate, fullParams)
    expect(skills).toContain('skill-name')
  })
  it('execution config references the skill', () => {
    expect(myTemplate.execution!.skills).toContain('skill-name')
  })
})
```

#### 5.2.6 Execution Config Tests

```typescript
describe('execution config', () => {
  it('uses [verification mode]', () => { ... })
  it('has reasonable budget per task', () => { ... })
  it('allows enough concurrent tasks', () => { ... })
})
```

#### 5.2.7 Full Pipeline Simulation

```typescript
describe('full plan-mode simulation', () => {
  it('assembles complete plan prompt (sharedContext + planGeneration)', () => {
    // This simulates the backend: server/routes/examples.ts:566-568
    const interpolatedShared = interpolatePrompt(sharedContext, FULL_PARAMS)
    const interpolatedPlan = interpolatePrompt(planGeneration, FULL_PARAMS)
    const fullDescription = `${interpolatedShared}\n\n---\n\n${interpolatedPlan}`

    expect(fullDescription).not.toMatch(/\{\{[a-zA-Z]+\}\}/) // no placeholders
    expect(fullDescription).toContain(/* critical instruction */)
  })

  it('handles minimal params (only required)', () => {
    // Same as above but with REQUIRED_PARAMS (empty optionals)
    // Verify critical instructions survive even without optional params
  })
})
```

### 5.3 Running Tests

```bash
# Run just this template's tests
npx vitest run packages/core/src/templates/__tests__/my-template.test.ts

# Run all tests
npm test
```

---

## 6. Build & Verification Checklist

After creating all files, verify:

```bash
# 1. TypeScript compiles cleanly (no errors)
npm run build

# 2. Tests pass
npx vitest run packages/core/src/templates/__tests__/{name}.test.ts

# 3. Lint passes
npm run lint

# 4. All existing tests still pass
npm test
```

Fix all errors before considering the template complete.

---

## 7. Existing Templates — Reference Examples

Study these before building a new template:

| Template | Category | Key Pattern |
|----------|----------|-------------|
| `academic-presentation` | research | Multi-deliverable (slides/blog/poster), inputParallelization on paper links, conditional skills (pdf/docx), 5 layout types |
| `academic-review` | research | 6-phase pipeline, 8-dimension scoring rubric, LaTeX report, SVG argument flow diagram |
| `moat-fragility` | finance | Data retrieval (SEC/Yahoo), 4-pillar quantitative scoring, 7 Powers framework, chart generation |
| `daily-paper-analysis` | research | API data source (HuggingFace), date validation with STOP, AlphaXiv fallback chain, additional user papers resolution, digest + in-depth dual deliverables |

Read the actual files for the full patterns:
```
packages/core/src/templates/examples/academic-presentation.ts
packages/core/src/templates/examples/academic-review.ts
packages/core/src/templates/examples/moat-fragility.ts
packages/core/src/templates/examples/daily-paper-analysis.ts
skills/academic-presentation/SKILL.md
skills/academic-review/SKILL.md
skills/moat-fragility/SKILL.md
skills/daily-paper-analysis/SKILL.md
```

---

## 8. Common Pitfalls

1. **Not asking enough questions**: Templates built on vague requirements always need rework. Spend time on Section 0.
2. **Forgetting empty-parameter line removal**: If a line has `{{param}}` and the param is empty, the entire line vanishes. Your prompt must still make sense after these lines are stripped. Test it.
3. **Not including STOP instructions**: If the data source can be empty, you MUST tell the agent to stop. Otherwise it generates a plan with no data to work with.
4. **Putting execution details in the template**: The template configures planning. The SKILL.md configures execution. Don't duplicate rendering specs in the planGeneration prompt — reference the SKILL.md instead.
5. **Not testing with minimal params**: Always test interpolation with empty optional params. The prompt should degrade gracefully.
6. **Forgetting to register**: The template must be added to `examples/index.ts` (BUILTIN_TEMPLATES array AND TEMPLATES_BY_CATEGORY) or it won't appear in the UI.
7. **Stale linter hooks**: Some environments auto-revert file changes. If your edits to `index.ts` keep disappearing, use `Bash` (shell writes) instead of the `Edit`/`Write` tools to bypass file watchers.
8. **Mismatched execution.skills and recommendedSkills**: Both should reference the same skill name. `execution.skills` controls what's injected at runtime; `recommendedSkills` controls what's shown in the UI during configuration.
9. **TypeScript strict mode**: `execution`, `parallelization`, and `planHints` are optional on the type. Use `!` non-null assertion in tests: `template.execution!.skills`.
10. **Category mismatch**: The template `category` field must be a valid `UseCaseCategory` from the type definition. Check the list in Section 2.3.
