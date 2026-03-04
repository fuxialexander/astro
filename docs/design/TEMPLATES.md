# Templates System Design

This document describes the architecture and design of Astro's template system, including the "Save as Template" feature, custom template management, and future directions for template sharing.

## Overview

Templates are reusable project patterns that help users quickly bootstrap new projects with pre-configured plans. The template system has two components:

1. **Built-in Templates** — Shipped with Astro, covering common use cases (web apps, ML pipelines, research projects)
2. **Custom Templates** — User-created templates saved from existing projects

## Architecture

### Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Built-in       │     │  Database        │     │  Frontend       │
│  Templates      │────>│  (customTemplates│────>│  Template Store │
│  (YAML/JSON)    │     │   table)         │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │
                                │  GET /api/templates
                                │  (merged response)
                                v
                        ┌──────────────────┐
                        │  Template Gallery│
                        │  Component       │
                        └──────────────────┘
```

### Database Schema

Custom templates are stored in the `custom_templates` table:

```sql
custom_templates (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'custom',
  version TEXT NOT NULL DEFAULT '1.0.0',
  icon TEXT,
  tags TEXT[],
  maturity TEXT DEFAULT 'stable',
  enabled BOOLEAN DEFAULT true,

  -- Parameter schema (JSONB)
  required_parameters JSONB,
  optional_parameters JSONB,

  -- Prompt configuration (JSONB)
  prompts JSONB NOT NULL,

  -- Execution config (JSONB)
  execution JSONB,
  parallelization JSONB,
  plan_hints JSONB,

  -- Source tracking
  source_project_id UUID REFERENCES projects(id),

  -- Ownership
  author_id UUID NOT NULL REFERENCES user_profiles(id),
  team_id UUID REFERENCES teams(id),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/templates` | GET | List all templates (built-in + custom) |
| `/api/templates/categories` | GET | List categories with counts |
| `/api/templates/:id` | GET | Get template details |
| `/api/templates/:id/launch` | POST | Create project from template |
| `/api/templates/:id/preview` | POST | Preview interpolated prompts |
| `/api/templates/:id/validate` | POST | Validate parameters |
| `/api/templates/custom` | GET | List user's custom templates |
| `/api/templates/custom` | POST | Create custom template |
| `/api/templates/custom/:id` | GET | Get custom template details |
| `/api/templates/custom/:id` | PUT | Update custom template |
| `/api/templates/custom/:id` | DELETE | Delete custom template |

### Template ID Format

- **Built-in templates**: `astro/{template-name}` (e.g., `astro/web-app`)
- **Custom templates**: `custom/{uuid}` (e.g., `custom/a1b2c3d4-...`)

The ID prefix determines how the API routes requests.

## Components

### SaveAsTemplateDialog

A 3-step wizard for creating templates from existing projects:

1. **Details Step**: Name, description, category, icon, tags
2. **Parameters Step**: Review and configure extracted parameters
3. **Preview Step**: Review the generated template before saving

```tsx
<SaveAsTemplateDialog
  open={isOpen}
  onOpenChange={setIsOpen}
  project={{ id, name, description, visionDoc }}
  nodes={planNodes}
  onSuccess={(templateId) => navigate(`/templates/${templateId}`)}
/>
```

### TemplateCard

Displays template information in a card format with:
- Icon and name
- Description (2-line truncated)
- Category badge
- Difficulty indicator (based on parameter count)
- Tags
- **For custom templates**: Edit/Delete actions menu

```tsx
<TemplateCard
  template={template}
  onClick={handleSelect}
  onEdit={handleEdit}
  onDelete={handleDelete}
/>
```

### TemplateGallery

Grid layout for browsing templates with:
- Category filter tabs
- Search input
- Sort options (A-Z, Newest, Popular)
- Loading skeleton
- Empty states

## Template Store (Zustand)

The `useTemplateStore` manages template state:

```typescript
interface TemplateStore {
  // State
  templates: UseCaseTemplateSummary[]
  categories: TemplateCategory[]
  selectedTemplate: UseCaseTemplate | null
  parameterValues: Record<string, unknown>
  validationErrors: ParameterValidationError[]
  previewResult: PreviewTemplateResult | null
  isLoading: boolean
  loaded: boolean
  error: string | null

  // Actions
  load(): Promise<void>
  reset(): void
  fetchTemplates(category?: string): Promise<void>
  fetchCategories(): Promise<void>
  fetchTemplate(id: string): Promise<void>
  selectTemplate(id: string): Promise<void>
  setParameterValue(key: string, value: unknown): void
  validateParameters(): Promise<boolean>
  previewTemplate(): Promise<void>
  launchTemplate(projectName: string, workDir?: string): Promise<LaunchTemplateResult>

  // Custom template CRUD
  createCustomTemplate(input: CustomTemplateInput): Promise<string | undefined>
  updateCustomTemplate(id: string, input: Partial<CustomTemplateInput>): Promise<boolean>
  deleteCustomTemplate(id: string): Promise<boolean>
  refreshCustomTemplates(): Promise<void>
}
```

## Permissions Model

| Action | Personal Template | Team Template |
|--------|-------------------|---------------|
| View | Author only | All team members |
| Edit | Author only | All team members |
| Delete | Author only | Author only |
| Launch | Author only | All team members |

When `teamId` is set on a custom template, it becomes a team template visible to all team members.

## Future Directions

### 1. Template Editing UI (Planned)

A dedicated template editor with:
- Live preview of interpolated prompts
- Parameter form builder (drag-and-drop)
- Version history and rollback
- Test launch (dry-run mode)

### 2. Template Sharing Across Teams (Planned)

Allow sharing templates between teams:
- "Publish to team" action
- Team template library view
- Import/export template definitions
- Template forking

### 3. Template Versioning (Planned)

Track template changes over time:
- Automatic version bumping on edits
- Changelog generation
- Version comparison view
- Rollback to previous versions

### 4. Community Templates (Future)

Public template marketplace:
- Template discovery and search
- Ratings and reviews
- Usage analytics
- Template certification program

## Implementation Checklist

### Phase 1: Core Infrastructure (Complete)
- [x] Database schema for custom templates
- [x] API endpoints for CRUD operations
- [x] Template store updates
- [x] SaveAsTemplateDialog component
- [x] Edit/Delete UI in TemplateCard

### Phase 2: Edit Dialog (Planned)
- [ ] EditTemplateDialog component
- [ ] Parameter form builder
- [ ] Prompt editor with preview
- [ ] Category/tag management

### Phase 3: Team Sharing (Planned)
- [ ] "Share with team" action
- [ ] Team templates filter
- [ ] Permission UI indicators
- [ ] Audit logging for template changes

### Phase 4: Versioning (Planned)
- [ ] Version tracking in schema
- [ ] Changelog generation
- [ ] Version history UI
- [ ] Rollback functionality

## Related Files

- `packages/core/src/db/schema.ts` — Database schema
- `packages/core/src/types/use-case-template.ts` — Type definitions
- `server/routes/templates.ts` — API routes
- `src/stores/template-store.ts` — Frontend state
- `src/lib/api-client.ts` — API client functions
- `src/components/templates/` — UI components
  - `template-gallery.tsx`
  - `template-card.tsx`
  - `template-parameter-form.tsx`
  - `template-picker-dialog.tsx`
  - `save-as-template-dialog.tsx`
