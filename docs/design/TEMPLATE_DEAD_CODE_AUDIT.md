# Template System Dead Code Audit

Comprehensive audit of all template-related code, identifying dead code for removal and the resulting pathway simplification.

**Last updated:** 2026-03-05

---

## 1. Terminology Clarification

The UI calls them **"Examples"** (the `/examples` page shows 3 curated cards). The code internally uses **"templates"** everywhere — stores, types, API routes, components. This document uses "template" to match the code, but note the user-facing term is "Examples."

---

## 2. What's Active (Keep)

### Frontend — Active Components

| File | Used By | Purpose |
|------|---------|---------|
| `src/pages/examples.tsx` | Route `/examples` | Examples page — shows 3 curated cards |
| `src/components/templates/template-picker-dialog.tsx` | `examples.tsx`, `project-new-plan.tsx` | Multi-step wizard: Browse -> Configure -> Launch |
| `src/components/templates/template-gallery.tsx` | `template-picker-dialog.tsx` | Template card grid with search/filter |
| `src/components/templates/template-card.tsx` | `template-gallery.tsx` | Individual template card |
| `src/components/templates/template-parameter-form.tsx` | `template-picker-dialog.tsx` | Parameter input form with validation |
| `src/stores/template-store.ts` | `examples.tsx`, `project-new-plan.tsx`, `dashboard.tsx`, picker dialog | Zustand store — templates, selection, validation |
| `src/lib/api-client.ts` (partial) | template-store, picker dialog | API functions (see active list below) |

### Frontend — Active API Client Functions

| Function | Called By | Backend Route |
|----------|-----------|---------------|
| `getTemplates()` | template-store `load()` | GET `/api/templates` |
| `getTemplateCategories()` | template-store `load()` | GET `/api/templates/categories` |
| `getTemplate(id)` | template-store `selectTemplate()` | GET `/api/templates/:id` |
| `validateTemplateParams()` | template-store `validateParameters()` | POST `/api/templates/:id/validate` |
| `previewTemplate()` | template-picker-dialog `handlePrefillPlan()` | POST `/api/templates/:id/preview` |
| `launchTemplate()` | template-store `launchTemplate()` | POST `/api/templates/:id/launch` |

### Backend — Active Routes

| Route | Purpose | Frontend Caller |
|-------|---------|-----------------|
| GET `/api/templates` | List all templates | template-store `load()` |
| GET `/api/templates/categories` | List categories | template-store `load()` |
| GET `/api/templates/:id` | Get full template | template-store `selectTemplate()` |
| POST `/api/templates/:id/validate` | Validate params | template-store `validateParameters()` |
| POST `/api/templates/:id/preview` | Preview interpolated prompts | template-picker-dialog |
| POST `/api/templates/:id/launch` | Create project from template | template-store `launchTemplate()` |

### Built-in Templates — Active (3)

| File | ID | Category |
|------|-----|----------|
| `packages/core/src/templates/examples/academic-presentation.ts` | `astro/academic-presentation` | research-analysis |
| `packages/core/src/templates/examples/academic-review.ts` | `astro/academic-review` | research-analysis |
| `packages/core/src/templates/examples/moat-fragility.ts` | `astro/moat-fragility` | data-science |

### Active Flow Summary

```
Examples page (/examples)
  -> TemplatePickerDialog (skipBrowse, onPrefillPlan)
    -> Resolves template params
    -> Navigates to /plan with prefilled form data
      -> User clicks "Start Planning"
        -> [Pathway 3] startPlanSession() — full interactive plan

Project New Plan page (/plan)
  -> TemplatePickerDialog (onLaunchSuccess)
    -> launchTemplate() API — creates project in DB
    -> startPlanSessionForProject() — [Pathway 3] interactive plan
```

Both paths end at **Pathway 3 (Interactive Plan)**. Pathway 5 is never invoked.

---

## 3. Dead Code — Frontend Components (3 files)

### 3a. `use-template-sheet.tsx` (339 lines) — DEAD

**What it does:** Slide-over panel for applying a template to an *existing* project. Generates plan nodes via `generatePlan()` (Pathway 5) and adds them below existing nodes.

**Why it's dead:** Never imported or rendered by any page/component.

**What it calls (also dead chains):**
- `applyTemplate()` from api-client -> POST `/api/templates/:id/apply`
- `generatePlan()` from api-client -> POST `/api/agent/generate-plan`
- `TemplatePreview` component (sole consumer)

### 3b. `save-as-template-dialog.tsx` (349 lines) — DEAD

**What it does:** Dialog to save the current project/plan as a reusable custom template. Extracts parameters from plan nodes, generates template metadata, calls custom template CRUD API.

**Why it's dead:** Never imported or rendered by any page/component.

**What it calls (also dead chains):**
- `createCustomTemplate()` from api-client -> POST `/api/templates/custom`

### 3c. `featured-template-chips.tsx` (113 lines) — DEAD

**What it does:** Horizontal row of clickable template chips for quick access. Dashboard already has its own inline featured templates section.

**Why it's dead:** Never imported or rendered by any page/component.

---

## 4. Dead Code — Frontend Functions

### 4a. `startGeneration()` in `agent-store.ts` — DEAD

**Location:** `src/stores/agent-store.ts`, line 394

**What it does:** Calls `generatePlan()` (Pathway 5) to generate a plan via SSE streaming.

**Why it's dead:** Defined in the store interface but never called from any UI component. The plan page uses `startPlanSession()` from execution-store (Pathway 3) instead.

### 4b. `generatePlan()` in `api-client.ts` — DEAD (all callers dead)

**Location:** `src/lib/api-client.ts`, line 82

**What it does:** SSE streaming call to POST `/api/agent/generate-plan` (Pathway 5).

**Callers:**
1. `use-template-sheet.tsx` line 131 — dead component
2. `agent-store.ts` line 439 (`startGeneration`) — dead function

### 4c. `applyTemplate()` in `api-client.ts` — DEAD (sole caller dead)

**Location:** `src/lib/api-client.ts`, line 1378

**What it does:** POST `/api/templates/:id/apply` to apply template to existing project.

**Sole caller:** `use-template-sheet.tsx` line 117 — dead component

### 4d. `getTemplateSchema()` in `api-client.ts` — DEAD (never imported)

**Location:** `src/lib/api-client.ts`, line 1248

**What it does:** GET `/api/templates/:id/schema`

**Callers:** None. Exported but never imported by any file.

### 4e. Custom template CRUD in `api-client.ts` — DEAD (UI never calls store methods)

| Function | Location | Store Method | UI Caller |
|----------|----------|-------------|-----------|
| `getCustomTemplates()` | api-client:1499 | `refreshCustomTemplates()` | None |
| `getCustomTemplate()` | api-client:1516 | (none) | None |
| `createCustomTemplate()` | api-client:1536 | `createCustomTemplate()` | `save-as-template-dialog.tsx` (dead) |
| `updateCustomTemplate()` | api-client:1560 | `updateCustomTemplate()` | None |
| `deleteCustomTemplate()` | api-client:1592 | `deleteCustomTemplate()` | None |

The store defines CRUD methods, but no UI component ever calls them. `save-as-template-dialog.tsx` (dead) is the only external caller for `createCustomTemplate`.

### 4f. `template-preview.tsx` — DEAD (sole consumer dead)

**Location:** `src/components/templates/template-preview.tsx`

**Sole consumer:** `use-template-sheet.tsx` (dead)

---

## 5. Dead Code — Backend Routes

### 5a. POST `/api/agent/generate-plan` (Pathway 5) — DEAD from UI

**Location:** `server/routes/agent.ts`, line 423

**Frontend callers:** All dead (see 4b above).

**Note:** The route itself works correctly. It could be called from CLI or external tools. But no UI path reaches it.

### 5b. POST `/api/templates/:id/apply` — DEAD from UI

**Location:** `server/routes/templates.ts`, line 852

**Sole frontend caller:** `use-template-sheet.tsx` (dead)

### 5c. GET `/api/templates/:id/schema` — DEAD from UI

**Location:** `server/routes/templates.ts`

**Frontend caller:** `getTemplateSchema()` in api-client — never imported.

### 5d. Custom template CRUD routes — DEAD from UI

| Route | Purpose | Status |
|-------|---------|--------|
| GET `/api/templates/custom` | List user's custom templates | No UI reaches this |
| GET `/api/templates/custom/:id` | Get custom template | No UI reaches this |
| POST `/api/templates/custom` | Create custom template | Only `save-as-template-dialog.tsx` (dead) |
| PUT `/api/templates/custom/:id` | Update custom template | No UI reaches this |
| DELETE `/api/templates/custom/:id` | Delete custom template | No UI reaches this |

### 5e. `custom_templates` database table — No active writer

**Location:** `packages/core/src/db/schema.ts`, lines 711-802; migration: `supabase/migrations/20260303100000_add_custom_templates.sql`

The table exists and has RLS policies, but no active UI path writes to it. Only `save-as-template-dialog.tsx` (dead) would create rows.

---

## 6. Dead Code — Built-in Template Files (9 files, ~155 KB)

These template definition files exist on disk but are not imported in `index.ts`:

| File | Size | Category |
|------|------|----------|
| `web-app.ts` | 11 KB | software-development |
| `ml-pipeline.ts` | 12 KB | machine-learning |
| `api-development.ts` | 12 KB | software-development |
| `data-pipeline.ts` | 14 KB | data-science |
| `code-documentation.ts` | 23 KB | documentation |
| `security-audit.ts` | 14 KB | security |
| `benchmark-runner.ts` | 23 KB | testing-qa |
| `literature-review.ts` | 24 KB | research |
| `paper-to-slides.ts` | 26 KB | research-analysis |

Also: `docs/paper-to-slides-validation.md`, `docs/paper-to-slides-cli-validation.md`

---

## 7. Summary — What to Remove

### Tier 1: Clearly dead frontend components (safe, no backend impact)

| File | Lines | Reason |
|------|-------|--------|
| `src/components/templates/use-template-sheet.tsx` | 339 | Never rendered |
| `src/components/templates/save-as-template-dialog.tsx` | 349 | Never rendered |
| `src/components/templates/featured-template-chips.tsx` | 113 | Never rendered |
| `src/components/templates/template-preview.tsx` | ~150 | Only used by dead `use-template-sheet` |

**Total: ~951 lines**

### Tier 2: Dead frontend functions (safe, no backend impact)

| Location | Function | Lines |
|----------|----------|-------|
| `src/stores/agent-store.ts` | `startGeneration()` | ~50 |
| `src/lib/api-client.ts` | `generatePlan()` | ~40 |
| `src/lib/api-client.ts` | `applyTemplate()` | ~30 |
| `src/lib/api-client.ts` | `getTemplateSchema()` | ~20 |
| `src/lib/api-client.ts` | Custom template CRUD (5 functions) | ~100 |
| `src/stores/template-store.ts` | Custom template CRUD methods + `refreshCustomTemplates` | ~80 |

**Total: ~320 lines**

### Tier 3: Backend routes with no active frontend callers (keep or remove)

| Route | Recommendation |
|-------|---------------|
| POST `/api/agent/generate-plan` | **Keep** — functional Pathway 5, could be used by CLI/API |
| POST `/api/templates/:id/apply` | **Remove** — only purpose was use-template-sheet |
| GET `/api/templates/:id/schema` | **Remove** — never used |
| Custom template CRUD (5 routes) | **Keep but deprioritize** — future feature when "Save as Template" is wired up |
| `custom_templates` table + migration | **Keep** — schema is fine, no cost to having the table |

### Tier 4: Inactive built-in templates (keep or remove)

| Recommendation | Reason |
|---------------|--------|
| **Keep on disk** | Templates are well-written and could be re-enabled by uncommenting imports. No runtime cost since they're not imported. |
| Alternative: Move to `examples/_inactive/` | Clarifies intent without deleting work |

---

## 8. Pathway Simplification

After removing dead code, the AI pathway map simplifies:

**Before (16 pathways):**
```
P1  Task Execution
P2  Playground
P3  Interactive Plan          <-- active, used by examples
P4  HPC/Slurm
P5  Plan Generation (structured)  <-- DEAD from UI
P6  Project Chat
P7  Plan Chat
P8  Task Chat
P9  Compact
P10 Task Summary
P11 Title Generation
P12 Refine
P13 Label Suggestion
P14 Steering
P15 Plan Extraction Retry
P16 Server-Side Summary
```

**After removing P5 from active pathways (15 pathways):**

Pathway 5 backend route remains functional but is reclassified as **"internal/API-only"** — not reachable from UI. The effective user-facing pathway count drops from 14 to 13.

The template/examples system simplifies to a single flow:
```
Examples page -> TemplatePickerDialog -> Configure -> Plan page -> [P3] Interactive Plan
```

No more dual-path confusion between P3 and P5 for plan creation.

---

## 9. Unused Props in Active Components

While not dead code, these props are defined but never passed by any active caller:

| Component | Prop | Status |
|-----------|------|--------|
| `TemplateGallery` | `onTemplateEdit` | Defined, never passed (edit/delete buttons inert) |
| `TemplateGallery` | `onTemplateDelete` | Defined, never passed |
| `TemplateCard` | `onEdit` | Defined, only passed from gallery (but gallery never receives it) |
| `TemplateCard` | `onDelete` | Same |

These could be cleaned up but are harmless (no runtime effect).
