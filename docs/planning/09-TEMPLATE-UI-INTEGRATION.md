# Template UI Integration: Frontend Design

## Current State

- **Backend**: Fully implemented — 7 API endpoints at `/api/templates/*` (list, categories, get, schema, validate, launch, preview)
- **Frontend**: Templates are **completely absent** from the UI. No template browser, no parameter form, no launch flow.
- **New Project page** (`/projects/new`): Only supports blank project creation with description + directory

## Design Goals

1. **Templates accessible from project creation** — "From Template" option alongside "Blank Project"
2. **Templates accessible from plan view** — Button that lets you apply a template to an existing project
3. **Custom template creation** — Users can save their current plan as a reusable template
4. **Smooth parameter flow** — Auto-generated forms from template parameter schemas

## Proposed UI Integration

### A. New Project Page Enhancement

Modify `/projects/new` to include a template selection step:

```
/projects/new
├── Step 1: Choose how to start
│   ├── [Blank Project]        ← Current behavior
│   ├── [From Template]        ← NEW: Opens template picker
│   └── [Import Plan]          ← Existing import functionality
│
├── Step 2 (if "From Template"):
│   ├── Template Gallery
│   │   ├── Category tabs (Software, Research, ML, DevOps, ...)
│   │   ├── Search bar
│   │   ├── Template cards:
│   │   │   ├── Icon + Name
│   │   │   ├── Description (1-2 lines)
│   │   │   ├── Category badge
│   │   │   └── Maturity badge (stable/beta/experimental)
│   │   └── Click → select template
│   │
│   └── Selected: Show template name + "Change" link
│
├── Step 3 (if template selected):
│   ├── Parameter Form (auto-generated from template schema)
│   │   ├── Required parameters (prominently displayed)
│   │   │   Each parameter renders based on type:
│   │   │   ├── string → text input
│   │   │   ├── textarea → multi-line text area
│   │   │   ├── number → number input with min/max
│   │   │   ├── boolean → toggle switch
│   │   │   ├── select → dropdown
│   │   │   ├── multi-select → checkbox group
│   │   │   ├── file-path → file picker / text input
│   │   │   └── code → code editor (Monaco mini)
│   │   ├── Optional parameters (collapsible section)
│   │   └── Conditional visibility (show/hide based on other param values)
│   ├── Project Name (auto-generated from template + params, editable)
│   ├── Working Directory (optional)
│   └── [Preview Plan] [Launch]
│
├── Preview (optional, calls POST /api/templates/:id/preview):
│   ├── Interpolated system prompt preview
│   ├── Expected plan structure
│   └── Estimated task count
│
└── Launch (calls POST /api/templates/:id/launch):
    ├── Creates project
    ├── Navigates to /project/:id/plan
    └── Auto-starts plan generation (SSE streaming)
```

### B. Plan View Template Button

Add a "Use Template" button in the plan-view page for applying templates to existing projects:

```
Plan View Header:
[+ Add Task] [Generate Plan ▾] [Use Template] [Export] [Publish]
                                     ↑ NEW

Clicking "Use Template":
├── Opens slide-over panel (Sheet component)
├── Template Gallery (same as step 2 above)
├── Select template → show parameter form
├── Preview → shows what nodes will be added
└── Apply → adds nodes to existing plan (doesn't replace)
```

### C. Custom Template Creation ("Save as Template")

From the plan view, let users save their current plan as a reusable template:

```
Plan View Header: [...] menu → "Save as Template"

Dialog:
├── Template Name
├── Category (dropdown)
├── Description
├── Parameters to Extract:
│   ├── System shows each unique value across nodes
│   ├── User clicks to "parameterize" a value
│   │   e.g., "Convert 'arxiv.org/abs/2401.12345' to parameter 'paperUrl'"
│   ├── Each parameterized value becomes a template parameter
│   └── Preview: "{{paperUrl}}" shown in context
├── Tags
└── [Save Template] — Stores as custom template (source: 'custom')
```

## Component Architecture

### New Components

```
src/components/templates/
├── template-gallery.tsx          # Grid of template cards with search/filter
├── template-card.tsx             # Individual template card
├── template-parameter-form.tsx   # Auto-generated form from parameter schema
├── template-preview.tsx          # Preview interpolated prompts
├── template-picker-dialog.tsx    # Full dialog wrapping gallery + form
└── save-as-template-dialog.tsx   # Save current plan as template
```

### Template Parameter Form

The key component — auto-generates a form from the template's parameter schema:

```typescript
interface TemplateParameterFormProps {
  parameters: UseCaseParameter[]
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  errors?: Record<string, string>
}

function TemplateParameterForm({ parameters, values, onChange, errors }: TemplateParameterFormProps) {
  // For each parameter:
  // 1. Check visibleWhen condition
  // 2. Render appropriate input based on parameter.type
  // 3. Show validation errors
  // 4. Apply default values
}
```

### Template Store

```typescript
// src/stores/template-store.ts
interface TemplateState {
  templates: UseCaseTemplateSummary[]
  categories: { category: string; count: number }[]
  selectedTemplate: UseCaseTemplate | null
  parameterValues: Record<string, unknown>
  isLoading: boolean

  // Actions
  fetchTemplates: (category?: string) => Promise<void>
  fetchTemplate: (id: string) => Promise<void>
  setParameterValue: (id: string, value: unknown) => void
  validateParameters: () => Promise<ValidationResult>
  launchTemplate: (projectName: string, workDir?: string) => Promise<Project>
  previewTemplate: () => Promise<PreviewResult>
}
```

## Implementation Plan

### Phase 1: Template Store + API Client (2-3 days)

1. Create `src/stores/template-store.ts`
2. Add template methods to `src/lib/api-client.ts`:
   ```typescript
   getTemplates(category?: string): Promise<TemplateSummary[]>
   getTemplate(id: string): Promise<UseCaseTemplate>
   getTemplateSchema(id: string): Promise<ParameterSchema>
   validateTemplateParams(id: string, params: Record<string, unknown>): Promise<ValidationResult>
   launchTemplate(id: string, params: LaunchParams): Promise<LaunchResult>
   previewTemplate(id: string, params: Record<string, unknown>): Promise<PreviewResult>
   ```

### Phase 2: Template Components (3-4 days)

1. `TemplateCard` — Card component with icon, name, description, category
2. `TemplateGallery` — Grid with category tabs, search, sorting
3. `TemplateParameterForm` — Dynamic form generator
4. `TemplatePickerDialog` — Full dialog combining gallery + form

### Phase 3: Project New Integration (2-3 days)

1. Add "From Template" option to project-new page
2. Wire template selection → parameter form → launch flow
3. Navigate to plan view after launch
4. Handle SSE streaming for plan generation

### Phase 4: Plan View Integration (2-3 days)

1. Add "Use Template" button to plan-view header
2. Sheet panel with template gallery
3. "Apply" action that adds nodes to existing plan
4. "Publish" button (connects to community feature)

### Phase 5: Save as Template (3-4 days)

1. "Save as Template" dialog
2. Parameter extraction UI (click to parameterize values)
3. Save as custom template (stored in database)
4. Show custom templates alongside built-in ones

## Total Estimated Effort

- **Phase 1-3** (Minimum viable): ~2 weeks
- **Phase 4-5** (Full feature): ~1 additional week
- **Testing and polish**: ~3-4 days

**Recommendation**: Start with Phase 1-3 to get templates into the UI as quickly as possible. Phase 4-5 can follow once the basic flow works.
