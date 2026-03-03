# Use Case Template Schema Documentation

This document describes the **Use Case Template Schema** for Astro — the structured format for defining reusable project templates that guide AI-powered planning and task execution.

## Overview

Use case templates capture domain knowledge, prompt patterns, parameter schemas, and parallelization strategies for common project types. Unlike SKILL.md files (which inject instructions during execution), templates operate at a higher level — they configure **how Astro generates plans and dispatches tasks**.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Template** | A reusable pattern for project types (web app, ML pipeline, research analysis) |
| **Parameters** | User-configurable inputs that customize the generated plan |
| **Prompts** | System prompts for plan generation, task execution, and refinement |
| **Parallelization** | Configuration for concurrent task dispatch and machine selection |
| **Output Format** | Structured output schemas for tasks that need deterministic results |

## Schema Reference

### Template Identity

```typescript
interface UseCaseTemplate {
  // Required identity fields
  id: string          // Unique identifier (kebab-case, e.g., 'astro/web-app')
  name: string        // Human-readable name (2-5 words)
  description: string // Detailed description (10-2000 chars)
  category: UseCaseCategory  // Organizational category
  version: string     // Semantic version (e.g., '1.0.0')

  // Optional display fields
  icon?: string       // Emoji icon
  tags?: string[]     // Search/filter tags
  maturity?: 'stable' | 'beta' | 'experimental'
}
```

### Categories

Templates are organized into categories:

| Category | Description |
|----------|-------------|
| `software-development` | Web apps, APIs, libraries, CLI tools |
| `data-science` | Data analysis, visualization, ETL pipelines |
| `machine-learning` | Model training, inference, MLOps |
| `devops-infrastructure` | CI/CD, deployment, cloud infrastructure |
| `research-analysis` | Scientific research, literature review |
| `documentation` | Technical writing, API docs, guides |
| `testing-qa` | Test suites, QA automation, security testing |
| `security` | Security audits, vulnerability assessment |
| `computational-biology` | Bioinformatics, drug discovery, genomics |
| `custom` | User-defined templates |

### Parameters

Parameters define user-configurable inputs. They're rendered as a form in the UI and interpolated into prompts using `{{parameterName}}` syntax.

```typescript
interface UseCaseParameter {
  id: string              // Unique ID (used in prompt interpolation)
  name: string            // Display name
  description: string     // Help text
  type: ParameterType     // Value type (see below)
  required: boolean       // Whether value is mandatory
  default?: any           // Default value
  placeholder?: string    // Input placeholder
  options?: ParameterOption[]  // For select/multi-select
  validation?: ParameterValidation  // Constraints
  visibleWhen?: ParameterCondition  // Conditional visibility
  group?: string          // Display group
  order?: number          // Display order within group
}

type ParameterType =
  | 'string'      // Text input
  | 'number'      // Numeric input with min/max
  | 'boolean'     // Toggle switch
  | 'select'      // Dropdown (single selection)
  | 'multi-select' // Multi-select dropdown
  | 'file-path'   // File/directory picker
  | 'code'        // Code editor

interface ParameterValidation {
  min?: number     // Min value/length
  max?: number     // Max value/length
  pattern?: string // Regex pattern
  message?: string // Error message
}

interface ParameterCondition {
  parameterId: string
  operator: 'equals' | 'not-equals' | 'contains' | 'not-empty'
  value?: string | number | boolean
}
```

### Prompts

Templates provide prompt templates for different phases:

```typescript
interface PromptConfig {
  planGeneration: string   // REQUIRED: System prompt for plan generation
  taskExecution?: string   // System prompt for task execution
  planRefinement?: string  // System prompt for plan chat
  sharedContext?: string   // Domain context prepended to all prompts
}
```

**Built-in variables** available in all prompts:
- `{{projectName}}` — Project name
- `{{visionDoc}}` — Project vision document
- `{{repoContext}}` — Repository context (CLAUDE.md, README, file tree)
- `{{gitState}}` — Current git branch and dirty state
- `{{timestamp}}` — ISO 8601 timestamp
- `{{userName}}` — Current user's display name

### Output Format

Templates can specify structured output schemas:

```typescript
interface OutputFormatSpec {
  type: 'json_schema' | 'markdown' | 'free'
  schema?: Record<string, unknown>  // JSON Schema (for json_schema type)
  description?: string              // Human-readable description
  example?: string                  // Example output
}
```

### Parallelization

Configure how tasks are dispatched and executed:

```typescript
interface ParallelizationConfig {
  maxConcurrentTasks?: number      // Max concurrent tasks (default: 5)
  autoDispatch?: boolean           // Auto-dispatch when deps met (default: true)
  defaultPriority?: 'critical' | 'high' | 'normal' | 'low'
  retry?: {
    maxRetries: number
    retryDelayMs: number
    exponentialBackoff: boolean
  }
  machineSelectionPolicy?: 'round-robin' | 'priority' | 'least-loaded' | 'manual' | 'label-match'
  requiredMachineLabels?: string[] // e.g., ['gpu'] for GPU-only tasks
}
```

### Execution

Configure task execution behavior:

```typescript
interface ExecutionConfig {
  preferredModel?: string          // e.g., 'claude-sonnet-4-20250514'
  maxTurns?: number               // Max tool-use cycles (default: 30)
  maxBudgetPerTask?: number       // Max USD per task
  skills?: string[]               // OpenClaw skills to activate
  deliveryMode?: 'pr' | 'push' | 'branch' | 'copy' | 'direct'
  skipSafetyCheck?: boolean       // For text-only tasks
  defaultVerification?: 'auto' | 'human' | 'mixed'
}
```

### Plan Generation Hints

Guide the AI in structuring the plan:

```typescript
interface PlanGenerationHints {
  targetNodeCount?: { min: number; max: number }  // Target 6-15 nodes
  defaultEstimate?: 'XS' | 'S' | 'M' | 'L' | 'XL'
  suggestedMilestones?: Array<{ title: string; description: string }>
  commonLabels?: string[]         // l1=Frontend, l2=Backend, etc.
  preferParallelTasks?: boolean   // Encourage parallel task structures
}
```

## Creating a Template

### TypeScript Format

Create a `.ts` file exporting a `UseCaseTemplate` object:

```typescript
import type { UseCaseTemplate } from '@astro/core/types/use-case-template'

export const myTemplate: UseCaseTemplate = {
  id: 'custom/my-template',
  name: 'My Custom Template',
  description: 'Description of what this template does...',
  category: 'software-development',
  version: '1.0.0',

  requiredParameters: [
    {
      id: 'projectName',
      name: 'Project Name',
      description: 'Name of the project',
      type: 'string',
      required: true,
    }
  ],
  optionalParameters: [],

  prompts: {
    planGeneration: `You are planning a project called {{projectName}}...`,
  },

  source: 'custom',
  enabled: true,
}
```

### YAML/Markdown Format (TEMPLATE.md)

Templates can also be defined in YAML frontmatter format (similar to SKILL.md):

```yaml
---
id: custom/my-template
name: My Custom Template
description: Description of what this template does
category: software-development
version: 1.0.0
icon: "🔧"
tags: [example, custom]
maturity: beta

parameters:
  required:
    - id: projectName
      name: Project Name
      type: string
      description: Name of the project
  optional:
    - id: language
      name: Language
      type: select
      default: typescript
      options:
        - { label: TypeScript, value: typescript }
        - { label: Python, value: python }

parallelization:
  maxConcurrentTasks: 3
  autoDispatch: true

execution:
  maxTurns: 30
  deliveryMode: pr

planHints:
  targetNodeCount: { min: 6, max: 12 }
  preferParallelTasks: true
---

# My Custom Template

## Plan Generation Prompt

You are planning a project called {{projectName}} using {{language}}.

Create a DAG of tasks covering:
1. Setup and configuration
2. Core implementation
3. Testing and quality
4. Documentation

## Task Execution Prompt

Implement the task for {{projectName}}.

Follow these standards:
- Use {{language}} best practices
- Write tests alongside code
- Document public APIs

## Shared Context

This is a {{language}} project. Follow modern patterns and conventions.
```

## Relationship to SKILL.md

| Aspect | SKILL.md | UseCaseTemplate |
|--------|----------|-----------------|
| **Purpose** | Inject instructions during task execution | Configure plan generation and dispatch |
| **Scope** | Single capability or integration | Entire project type/workflow |
| **Format** | Markdown with YAML frontmatter | TypeScript or YAML/Markdown |
| **Parameters** | Limited metadata | Rich, typed parameter schemas |
| **Prompts** | Single instruction block | Multiple prompts (planning, execution, chat) |
| **Triggers** | Keyword-based activation | User selects template at project creation |

Templates and skills are **complementary**:
- Templates define **what** to plan and **how** to structure work
- Skills define **domain knowledge** for executing specific tasks
- A template can reference skills via `recommendedSkills` to activate them during execution

## Validation

Templates are validated against the JSON Schema at:
`packages/core/src/schemas/use-case-template.schema.json`

Validation errors include:
- `MISSING_REQUIRED` — Required field missing
- `INVALID_TYPE` — Wrong value type
- `INVALID_VALUE` — Value fails validation constraints
- `DUPLICATE_ID` — Parameter ID collision
- `CIRCULAR_DEPENDENCY` — Template extends itself
- `INVALID_REFERENCE` — Unknown template reference in `extends`

Validation warnings include:
- `EMPTY_PROMPT` — Prompt is unexpectedly short
- `MISSING_DESCRIPTION` — Parameter lacks description
- `LARGE_TEMPLATE` — Template exceeds size recommendations
- `DEPRECATED_FIELD` — Using deprecated field

## Built-in Templates

Astro includes built-in templates for common use cases:

| Template | Category | Description |
|----------|----------|-------------|
| `astro/web-app` | software-development | Full-stack web application |
| `astro/ml-pipeline` | machine-learning | ML training pipeline |
| `astro/drug-discovery` | computational-biology | Drug discovery analysis |

See `packages/core/src/templates/examples/` for full implementations.

## Best Practices

1. **Parameter Design**
   - Keep required parameters minimal (≤5)
   - Provide sensible defaults for optional parameters
   - Use conditional visibility (`visibleWhen`) for related options
   - Group related parameters for better UX

2. **Prompt Engineering**
   - Be specific about task granularity in `planGeneration`
   - Reference parameter values with `{{parameterName}}`
   - Include examples of expected output in `sharedContext`
   - Use "human" verification for subjective decisions

3. **Parallelization**
   - Set `maxConcurrentTasks` based on task independence
   - Use `label-match` policy for hardware-specific tasks (GPU, high-memory)
   - Enable `exponentialBackoff` for flaky tasks

4. **Plan Hints**
   - Target 6-15 nodes for manageable plans
   - Use milestones to create natural breakpoints
   - Set `preferParallelTasks: true` when tasks are independent
