# Use Case Template Schema Design

> Design document for Astro's use case template system — structured definitions for common project types that configure plan generation, task dispatch, and execution behavior.

**Status**: Schema defined (TypeScript types + JSON Schema + examples)
**Location**: `packages/core/src/types/use-case-template.ts`
**JSON Schema**: `packages/core/src/schemas/use-case-template.schema.json`
**Examples**: `packages/core/src/templates/examples/`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Relationship to Existing Systems](#2-relationship-to-existing-systems)
3. [Schema Architecture](#3-schema-architecture)
4. [Parameter System](#4-parameter-system)
5. [Prompt Configuration](#5-prompt-configuration)
6. [Output Format Specification](#6-output-format-specification)
7. [Parallelization Configuration](#7-parallelization-configuration)
8. [Template Lifecycle](#8-template-lifecycle)
9. [Design Decisions](#9-design-decisions)
10. [Future Work](#10-future-work)

---

## 1. Overview

Use case templates solve a key UX problem: **new projects start from a blank slate**. Users must write a vision document, configure execution settings, and hope the AI generates a sensible plan.

Templates provide **domain-specific starting points** that:
- Pre-fill parameter forms for project customization
- Inject tuned system prompts for plan generation
- Configure parallelization for the domain's task patterns
- Specify structured output formats where applicable
- Recommend skills to activate during execution

### Example Flow

```
User selects "ML Training Pipeline" template
  → Template presents parameter form:
      - Experiment name: ____
      - ML task: [Classification ▼]
      - Dataset description: ____
      - Framework: [PyTorch ▼]
      - GPUs: [1]
  → User fills in parameters
  → Astro interpolates parameters into the plan generation prompt
  → AI generates a plan graph tuned for ML pipelines
  → Tasks are dispatched with ML-specific settings
      (GPU machine labels, higher maxTurns, branch delivery mode)
```

---

## 2. Relationship to Existing Systems

### Skills vs Templates

| Aspect | Skills (SKILL.md) | Templates (UseCaseTemplate) |
|--------|-------------------|----------------------------|
| **Scope** | Execution-time | Planning + dispatch + execution |
| **What they configure** | Agent prompt injection | Plan generation, task dispatch, parallelization |
| **User interaction** | Activated per-session | Selected per-project |
| **Format** | Markdown with YAML frontmatter | TypeScript interface + JSON Schema |
| **Parameters** | None (static instructions) | Typed, validated parameter forms |
| **Composability** | Injected into any execution | Can recommend skills to co-activate |

**Key insight**: Templates and skills are complementary, not competing. A template configures the project-level planning and dispatch, while skills inject specific capabilities during task execution. A template can `recommendedSkills: ['github']` to suggest the GitHub skill be active when its tasks run.

### Prompt Templates

The existing `prompt-templates.ts` provides functions like `buildPlanSystemPrompt()` and `buildTaskExecutionPrompt()`. Templates don't replace these — they **extend** them:

- Template's `prompts.planGeneration` replaces the generic planning prompt
- Template's `prompts.taskExecution` overrides the default execution prompt
- Template's `prompts.sharedContext` is prepended to both
- Built-in variables (`{{visionDoc}}`, `{{repoContext}}`, `{{gitState}}`) remain available

### Dispatch Engine

Templates integrate with the dispatch engine through `parallelization` and `execution` configs:

```
UseCaseTemplate.parallelization → overrides DispatchEngineConfig
UseCaseTemplate.execution       → maps to TaskDispatch fields
```

The `ParallelizationConfig` in a template overrides the global `DispatchEngineConfig` values for that project. This allows domain-specific tuning without global config changes.

---

## 3. Schema Architecture

### Type Hierarchy

```
UseCaseTemplate
├── Identity (id, name, description, category, version)
├── Display (icon, tags, maturity)
├── requiredParameters: UseCaseParameter[]
├── optionalParameters: UseCaseParameter[]
├── prompts: PromptConfig
│   ├── planGeneration (required)
│   ├── taskExecution (optional)
│   ├── planRefinement (optional)
│   └── sharedContext (optional)
├── outputFormat?: OutputFormatSpec
├── parallelization?: ParallelizationConfig
├── execution?: ExecutionConfig
├── planHints?: PlanGenerationHints
├── Relationships (domains, recommendedSkills, extends)
└── Metadata (source, enabled, author, homepage)
```

### Supporting Types

```
UseCaseParameter
├── id, name, description, type, required
├── default, placeholder
├── options: ParameterOption[] (for select/multi-select)
├── validation: ParameterValidation
├── visibleWhen: ParameterCondition
└── group, order

ResolvedParameters = Record<string, string | number | boolean | string[]>

UseCaseTemplateInstance
├── templateId, templateVersion
├── parameters: ResolvedParameters
└── projectId, createdAt

UseCaseTemplateSummary (for list views)
TemplateValidationResult (for authoring)
```

---

## 4. Parameter System

### Parameter Types

| Type | UI Component | Validation | Example |
|------|-------------|------------|---------|
| `string` | Text input / textarea | min/max length, regex | App name, description |
| `number` | Number input | min/max value | GPU count |
| `boolean` | Toggle switch | — | Enable feature flag |
| `select` | Dropdown | Must be from options | Framework choice |
| `multi-select` | Checkbox group | Must be from options | Tissue types |
| `file-path` | File picker | Pattern matching | Data directory |
| `code` | Monaco editor | Language-specific | Custom config |

### Conditional Visibility

Parameters can be conditionally visible based on other parameter values:

```typescript
{
  id: 'slurmPartition',
  name: 'SLURM Partition',
  type: 'string',
  required: false,
  visibleWhen: {
    parameterId: 'executionStrategy',
    operator: 'equals',
    value: 'slurm',
  },
}
```

The UI hides this parameter unless `executionStrategy === 'slurm'`. The operator supports `equals`, `not-equals`, `contains`, and `not-empty`.

### Parameter Groups

Parameters are organized into visual groups:

```typescript
{ id: 'appName', group: 'basics', order: 0 }
{ id: 'appDescription', group: 'basics', order: 1 }
{ id: 'framework', group: 'stack', order: 0 }
{ id: 'backend', group: 'stack', order: 1 }
```

The UI renders groups as collapsible sections, with parameters sorted by `order` within each group.

### Prompt Interpolation

Parameter values are interpolated into prompts via `{{parameterId}}`:

```
prompt: "Build a {{framework}} app called {{appName}}"
parameters: { framework: "react", appName: "my-app" }
result: "Build a react app called my-app"
```

Built-in variables are always available regardless of template parameters:
- `{{projectName}}`, `{{visionDoc}}`, `{{repoContext}}`, `{{gitState}}`, `{{timestamp}}`, `{{userName}}`

---

## 5. Prompt Configuration

### Plan Generation Prompt

The most important prompt. It replaces the generic `buildPlanSystemPrompt()` with domain-specific instructions:

```typescript
prompts: {
  planGeneration: `You are a senior ML engineer planning a training pipeline.

## Experiment Specification
- Experiment: {{experimentName}}
- Framework: {{framework}}
...

## Planning Guidelines
1. Milestone Structure: Data Prep → Model Dev → Training → Results
2. Task Granularity: One task per logical unit (data loading, model arch, etc.)
3. Parallelism: Data tasks sequential, model dev parallel with preprocessing
...`
}
```

### Task Execution Prompt

Injected as the system prompt when individual tasks are dispatched:

```typescript
prompts: {
  taskExecution: `You are implementing part of an ML pipeline.
  Framework: {{framework}}.
  Standards: Set random seeds, use data loaders, log hyperparameters...`
}
```

### Shared Context

Domain knowledge prepended to all prompts (planning, execution, refinement):

```typescript
prompts: {
  sharedContext: `ML engineering best practices:
  - Split data before preprocessing
  - Normalize with training set statistics only
  - Use early stopping...`
}
```

---

## 6. Output Format Specification

For tasks that need deterministic structured output (e.g., experiment results, data analysis reports):

```typescript
outputFormat: {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      experimentName: { type: 'string' },
      metrics: { type: 'object', properties: { ... } },
      status: { type: 'string', enum: ['success', 'partial', 'failure'] },
    },
    required: ['experimentName', 'metrics', 'status'],
  },
  description: 'Training results as structured JSON',
  example: '{ "experimentName": "v2", "metrics": { ... }, "status": "success" }',
}
```

This maps directly to the existing `TaskDispatch.outputFormat` field and the Claude SDK's `outputFormat` parameter.

Three modes:
- `json_schema`: Strict JSON output matching a schema
- `markdown`: Guided markdown structure (no enforcement)
- `free`: No constraints (default)

---

## 7. Parallelization Configuration

Templates can override the dispatch engine's global settings:

```typescript
parallelization: {
  maxConcurrentTasks: 2,        // ML pipeline: low parallelism
  autoDispatch: true,
  defaultPriority: 'high',
  retry: {
    maxRetries: 1,
    retryDelayMs: 10000,
    exponentialBackoff: false,
  },
  machineSelectionPolicy: 'label-match',
  requiredMachineLabels: ['gpu'],   // Only dispatch to GPU machines
}
```

### Machine Selection Policies

| Policy | Use Case |
|--------|----------|
| `round-robin` | Even load distribution for homogeneous tasks |
| `priority` | Prefer best-available machine (default) |
| `least-loaded` | Minimize queue depth per machine |
| `manual` | User explicitly assigns machines |
| `label-match` | Match task requirements to machine labels (e.g., GPU) |

### Retry Configuration

Templates control retry behavior per-domain:
- ML training: Low retries (failures are usually systematic)
- Web development: Higher retries (often transient issues)
- Research analysis: Medium retries with longer delays

---

## 8. Template Lifecycle

### Creation

```
1. Author writes TypeScript template (or JSON matching the schema)
2. Template is validated against TemplateValidationResult
3. Template is registered in the template registry
4. Template appears in the UI template picker
```

### Selection & Instantiation

```
1. User browses templates in the picker (filtered by category, tags, domains)
2. User selects a template
3. UI renders the parameter form (requiredParameters + optionalParameters)
4. User fills in parameters
5. System creates a UseCaseTemplateInstance (templateId + resolvedParameters)
6. System interpolates parameters into prompts
7. Plan generation runs with the customized prompt
```

### Sources

| Source | Description | How Loaded |
|--------|-------------|------------|
| `builtin` | Shipped with Astro | `packages/core/src/templates/examples/` |
| `workspace` | Project-local templates | `.astro/templates/` in project root |
| `community` | Shared via template registry | Future: community hub |
| `custom` | User-created via UI | Stored in database |

---

## 9. Design Decisions

### ADR-010: Templates are typed TypeScript objects, not markdown files

**Context**: Skills use SKILL.md (markdown with YAML frontmatter). Should templates use the same format?

**Decision**: Templates use TypeScript interfaces with JSON Schema validation.

**Rationale**: Templates have significantly more structure than skills:
- Typed parameters with validation, conditionals, and options
- JSON Schema output specifications
- Nested configuration objects (parallelization, execution, plan hints)

Markdown frontmatter cannot express this richness. TypeScript provides compile-time type safety. JSON Schema enables validation for community-contributed templates in any language.

### ADR-011: Required and optional parameters are separate arrays

**Context**: Parameters could be a single array with `required: boolean`, or two separate arrays.

**Decision**: Two separate arrays (`requiredParameters`, `optionalParameters`).

**Rationale**: The UI renders required parameters prominently (top of form, always visible) and optional parameters in a collapsible "Advanced" section. Separating them in the schema makes this UI behavior explicit and prevents bugs where required parameters are accidentally hidden.

### ADR-012: Prompt interpolation uses mustache-style {{param}}

**Context**: Prompts could use template literals (`${param}`), XML tags (`<param/>`), or mustache syntax (`{{param}}`).

**Decision**: `{{param}}` mustache-style interpolation.

**Rationale**:
- Template literals conflict with TypeScript/JavaScript string interpolation
- XML tags conflict with the security delimiters already used (`<user_vision>`)
- Mustache is widely recognized, doesn't conflict with existing patterns, and is simple to implement with a regex

### ADR-013: Templates can extend other templates

**Context**: Some templates are variations of others (e.g., "React App" extends "Web App").

**Decision**: Support single inheritance via `extends: 'parent-template-id'`.

**Rationale**: Reduces duplication. A "React App" template can inherit the Web App's parameter structure and prompts, overriding only the framework-specific parts. Single inheritance keeps the model simple — no diamond problem.

### ADR-014: Parallelization is optional with sensible defaults

**Context**: Should every template specify parallelization settings?

**Decision**: `parallelization` is optional. When omitted, the dispatch engine's global defaults apply.

**Rationale**: Most templates work fine with the default settings (5 concurrent tasks, auto-dispatch, priority-based machine selection). Only specialized domains (ML with GPU requirements, security with sequential analysis) need custom settings.

---

## 10. Future Work

### Template Registry & Discovery (Phase 4+)

- Community template hub for sharing
- Template versioning and migration
- Template analytics (which templates are most used, success rates)
- AI-assisted template creation from natural language descriptions

### Template Marketplace

- Rating system for community templates
- Usage statistics per template
- Template forking and customization

### AI Template Selection

- Given a project description, automatically suggest the best template
- Parameter auto-fill from vision document analysis
- Template recommendation based on user's domain expertise

### Template Composition

- Combine multiple templates for cross-domain projects
- Template "mixins" for shared parameter groups (e.g., "CI/CD mixin")
- Template inheritance chains for specialization

### Runtime Template Adaptation

- Templates that evolve based on plan generation feedback
- Parameter suggestions based on repository analysis
- Dynamic prompts that adapt to project complexity

---

## Appendix: File Inventory

| File | Purpose |
|------|---------|
| `packages/core/src/types/use-case-template.ts` | TypeScript type definitions (main schema) |
| `packages/core/src/schemas/use-case-template.schema.json` | JSON Schema for external validation |
| `packages/core/src/templates/examples/web-app.ts` | Example: Web Application template |
| `packages/core/src/templates/examples/ml-pipeline.ts` | Example: ML Training Pipeline template |
| `packages/core/src/templates/examples/drug-discovery.ts` | Example: Drug Discovery Pipeline template |
| `packages/core/src/templates/examples/index.ts` | Template exports and registry |
| `packages/core/src/index.ts` | Updated to export template types |
| `docs/design/USE_CASE_TEMPLATES.md` | This design document |
