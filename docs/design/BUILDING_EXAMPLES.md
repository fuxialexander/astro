# Building Examples

> Design document for how example templates, SKILL.md files, and the plan page work together.

> **Status (March 2026):** Architecture defined. Implementation pending.

## Overview

Example templates are the primary on-ramp for new users. Each example pairs a **template** (parameter form, plan generation prompt, execution config) with a **SKILL.md** (domain-specific agent instructions). When a user picks an example, the SKILL.md content becomes the project's editable `skill.md` (stored as `visionDoc`), giving users full control over the agent context before and during execution.

## Architecture

### Core Principle: SKILL.md = Project skill.md

Each example template references a SKILL.md file in `skills/`. When the user launches an example, the SKILL.md content is loaded as the project's `visionDoc` — the `skill.md` field visible in the project overview. This is the **only** path for injecting domain context into agent prompts for that project.

```
skills/academic-presentation/SKILL.md     (source of truth for example)
         |
         | User picks "Academic Presentation" example
         v
Template apply endpoint
         |
         | Loads SKILL.md content -> sets project.visionDoc
         v
Project created with visionDoc = SKILL.md content
         |
         | User can view/edit skill.md in project overview
         v
User revises @SKILL.md (optional)
         |
         v
Plan generation / Task dispatch
         |
         | visionDoc injected into agent system prompt
         v
Agent executes with project-specific context
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Example Template                            │
│  packages/core/src/templates/examples/academic-presentation.ts  │
│                                                                 │
│  - id: 'academic-presentation'                                  │
│  - parameters: [paperSource, audienceLevel, ...]                │
│  - prompts.planGeneration: "Create a presentation..."           │
│  - execution.skills: ['academic-presentation']  ◄── skill ref   │
│  - description: "Convert papers into slides..."                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      │  POST /api/templates/:id/apply
                      │  (or POST /api/templates/:id/generate)
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                   Apply Endpoint                                │
│                                                                 │
│  1. Resolve template parameters                                 │
│  2. Look up execution.skills[0] -> 'academic-presentation'      │
│  3. Load skills/academic-presentation/SKILL.md from disk (or DB)│
│  4. Set project.visionDoc = SKILL.md content                    │
│  5. Interpolate planGeneration prompt with parameters            │
│  6. Return { projectId, description, visionDoc }                │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                     Project                                     │
│                                                                 │
│  - visionDoc: full SKILL.md content (editable by user)          │
│  - description: interpolated plan prompt                        │
│                                                                 │
│  User sees "skill.md" in project overview -> can edit freely    │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      │  At dispatch time
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                Agent System Prompt                              │
│                                                                 │
│  - visionDoc (project-level, user-edited SKILL.md)              │
│  - Global skills injection (other enabled skills, NOT the one   │
│    already in visionDoc — avoid duplication)                    │
│  - Task-specific context (dependencies, descriptions)           │
└─────────────────────────────────────────────────────────────────┘
```

### Parameter → Prompt Transformation

Template parameters are **not** passed as structured data to the AI. They are interpolated into prompt text via mustache-style `{{paramName}}` placeholders, then the entire rendered string becomes the project's `visionDoc`.

#### Pipeline

```
┌──────────────────────────────────────────────────────────────────┐
│  1. User fills parameter form                                    │
│                                                                  │
│     parameterValues (Zustand store):                             │
│     {                                                            │
│       paperSource: "https://arxiv.org/abs/2401.12345",           │
│       deliverables: ["slides", "blog-post"],                     │
│       slideCount: "standard",    ← from default                  │
│       targetAudience: "researcher", ← from default               │
│       ...                                                        │
│     }                                                            │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  2. POST /api/templates/:id/launch                               │
│                                                                  │
│     Backend receives { parameters, projectName, workDir }        │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  3. validateParameters(template, params)                         │
│                                                                  │
│     - Iterates all required + optional parameters                │
│     - If value provided → validate type, pattern, range          │
│     - If no value + has default → use default                    │
│     - If required + no value + no default → error                │
│     - Output: resolvedParameters (clean Record<string, ...>)     │
│                                                                  │
│     server/routes/templates.ts:60-129                            │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  4. interpolatePrompt(planGeneration, resolvedParams)            │
│                                                                  │
│     Template prompt:                                             │
│       "- Paper Source: {{paperSource}}"                           │
│       "- Deliverables: {{deliverables}}"                         │
│       "- Slide Count: {{slideCount}}"                            │
│                                                                  │
│     After interpolation:                                         │
│       "- Paper Source: https://arxiv.org/abs/2401.12345"         │
│       "- Deliverables: slides, blog-post"                        │
│       "- Slide Count: standard"                                  │
│                                                                  │
│     Arrays are joined with ", ". All values become strings.      │
│                                                                  │
│     server/routes/templates.ts:309-317                           │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  5. Prepend sharedContext (if present)                            │
│                                                                  │
│     fullDescription =                                            │
│       sharedContext          ← color palette, slide layouts, etc. │
│       + "\n\n---\n\n"                                            │
│       + interpolated plan prompt                                 │
│                                                                  │
│     server/routes/templates.ts:707-709                           │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  6. Create project with visionDoc = fullDescription              │
│                                                                  │
│     The entire rendered prompt is stored as visionDoc.           │
│     User can view/edit it in the project overview.               │
│                                                                  │
│     server/routes/templates.ts:723                               │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  7. Frontend calls /api/agent/generate-plan                      │
│                                                                  │
│     planGenerationRequest = {                                    │
│       projectId,                                                 │
│       description: fullDescription,                              │
│       visionDoc: fullDescription                                 │
│     }                                                            │
│                                                                  │
│     Claude receives the full prompt with all parameter values    │
│     baked into the text. It never sees the parameter schema.     │
└──────────────────────────────────────────────────────────────────┘
```

#### Default Values & Advanced Options

Each parameter can define a `default` value. When the user selects a template, all defaults are populated into the form immediately (`template-store.ts:selectTemplate`). The user sees pre-selected values and only changes what they need.

Advanced Options (optional parameters) are collapsed by default. The count label reflects only **currently visible** parameters — parameters hidden by `visibleWhen` conditions are excluded from the count.

#### Default Values by Template

**Academic Presentation** (`astro/academic-presentation`)

| Parameter | Default | Prompt placeholder |
|-----------|---------|-------------------|
| `deliverables` | `['slides', 'blog-post', 'poster']` | `{{deliverables}}` |
| `slideCount` | `'detailed'` (30-45 slides) | `{{slideCount}}` |
| `targetAudience` | `'researcher'` | `{{targetAudience}}` |
| `slideTheme` | `'both'` (light + dark) | `{{slideTheme}}` |
| `blogStyle` | `'detailed'` | `{{blogStyle}}` |
| `posterOrientation` | `'portrait'` | `{{posterOrientation}}` |
| `githubUrl` | — (no default) | `{{githubUrl}}` |
| `customRequirements` | — (no default) | `{{customRequirements}}` |

**Academic Review** (`astro/academic-review`)

| Parameter | Default | Prompt placeholder |
|-----------|---------|-------------------|
| `documentType` | `'paper'` | `{{documentType}}` |
| `sourceFormat` | `'pdf'` | `{{sourceFormat}}` |
| `reviewDepth` | `'comprehensive'` | `{{reviewDepth}}` |
| `reviewerExpertise` | `'expert'` | `{{reviewerExpertise}}` |
| `focusAreas` | `['novelty', 'math', 'experiments', 'writing']` (all) | `{{focusAreas}}` |
| `reportFormat` | `'latex-pdf'` | `{{reportFormat}}` |
| `includeDiagrams` | `'yes'` | `{{includeDiagrams}}` |
| `literatureSearch` | `'enabled'` | `{{literatureSearch}}` |
| `targetVenue` | — (no default) | `{{targetVenue}}` |

**Moat & Fragility** (`astro/moat-fragility`)

| Parameter | Default | Prompt placeholder |
|-----------|---------|-------------------|
| `analysisDepth` | `'comprehensive'` | `{{analysisDepth}}` |
| `timeHorizon` | `'10year'` (most thorough) | `{{timeHorizon}}` |
| `sectorFocus` | `'auto'` | `{{sectorFocus}}` |
| `reportStyle` | `'professional'` | `{{reportStyle}}` |
| `supplementaryDocs` | — (no default) | `{{supplementaryDocs}}` |
| `comparisonTickers` | — (no default) | `{{comparisonTickers}}` |

#### Visibility Conditions

Some parameters are conditionally visible based on other parameter values:

- Academic Presentation: `slideCount`, `targetAudience`, `slideTheme` only visible when `deliverables` contains `'slides'`. `blogStyle` visible when `deliverables` contains `'blog-post'`. `posterOrientation` visible when `deliverables` contains `'poster'`.
- Academic Review and Moat & Fragility: No conditional visibility — all optional parameters are always visible.

### Deduplication at Dispatch

When a project's `visionDoc` was loaded from a SKILL.md (e.g., `academic-presentation`), the dispatch route should **skip** injecting that same skill via `SkillManager.getSkillPromptInjection()`. This avoids sending duplicate instructions.

**Approach**: Store the source skill name on the project (e.g., `sourceSkill: 'academic-presentation'`), or compare the `execution.skills` array against the global injection list. At dispatch time, filter out skills whose name matches the project's source skill.

## Plan Page UX

### Current State (before)

```
┌────────────────────────────────────────────────┐
│  What do you want to build or accomplish?       │
│                                                 │
│           OR START WITH A USE CASE              │
│  [Academic Presentation] [Moat Analysis]        │
│           [Academic Review]                     │
│                    OR                            │
│  Browse All Templates     Resume Session        │
└────────────────────────────────────────────────┘
```

### Target State (after)

```
┌────────────────────────────────────────────────┐
│  What do you want to build or accomplish?       │
│                                                 │
│                    OR                            │
│  Start from an Example    Resume a Session      │
└────────────────────────────────────────────────┘
```

**Changes:**
1. **Remove the 3 inline example cards** — redundant with the examples page
2. **Rename "Browse All Templates"** to **"Start from an Example"** — clicking navigates to `/examples`
3. **Rename "Resume Session"** to **"Resume a Session"**

### Examples Page

When the user clicks "Start from an Example", they land on the examples page (`/examples`). Each example card should show:

- Template name and icon
- **Short description** (the template's `description` field)
- Category badge

When the user clicks a card, they go to the template configuration page. This page should:

1. **Show the template description** at the top (currently missing)
2. Show the parameter form
3. Show execution config (model, budget, etc.)
4. On submit: create project with SKILL.md loaded as `visionDoc`

## Built-in Examples (5 skills, 3 with examples)

| Skill | Has Example Template | Used As |
|-------|---------------------|---------|
| `academic-presentation` | Yes | Template + visionDoc source |
| `academic-review` | Yes | Template + visionDoc source |
| `moat-fragility` | Yes | Template + visionDoc source |
| `kubernetes-workflow` | No | Global skill injection only |
| `skypilot-workflow` | No | Global skill injection only |

## Implementation Plan

### Phase 1: Plan Page Cleanup
- Remove 3 inline example cards from plan page
- Rename buttons: "Start from an Example" + "Resume a Session"

### Phase 2: Example Detail Page
- Show template description on the configuration/parameter page
- Ensure description is visible before user fills parameters

### Phase 3: SKILL.md -> visionDoc Wiring
- Modify template apply endpoint to load SKILL.md content from `skills/{name}/SKILL.md`
- Set loaded content as `project.visionDoc`
- Remove `sharedContext` from template definitions (replaced by SKILL.md content)
- Add deduplication logic at dispatch to skip skills already in visionDoc

### Phase 4: Template Cleanup
- Remove `sharedContext` field from the 3 example templates (content moves to SKILL.md)
- Ensure SKILL.md files contain all necessary context (color palettes, typography rules, etc.)
- The `execution.skills` array becomes the link between template and SKILL.md

## Key Files

| File | Role |
|------|------|
| `skills/*/SKILL.md` | Source of truth for agent instructions per example |
| `packages/core/src/templates/examples/*.ts` | Template definitions (parameters, prompts, execution config) |
| `server/routes/templates.ts` | Apply/generate endpoints — will load SKILL.md into visionDoc |
| `server/routes/dispatch.ts` | Dispatch — injects visionDoc + global skills (with dedup) |
| `src/pages/project-new-plan.tsx` | Plan page — remove inline examples, rename buttons |
| `src/pages/examples.tsx` | Examples gallery — ensure descriptions are visible |
| `src/components/vision-doc-dialog.tsx` | skill.md editor dialog — user edits the loaded SKILL.md |
| `src/pages/project-overview.tsx` | Project overview — shows skill.md field |
