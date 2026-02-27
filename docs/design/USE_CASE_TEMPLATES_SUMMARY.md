# Use Case Template Schema - Task Summary

> **Task**: Design Use Case Template Schema
> **Status**: Complete - Schema already implemented
> **Date**: 2025-02-26

---

## Executive Summary

The use case template schema for Astro is **already fully designed and implemented**. This document summarizes the existing schema, its relationship to SKILL.md, and confirms all requirements are met.

---

## Requirements Checklist

| # | Requirement | Status | Implementation |
|---|-------------|--------|----------------|
| 1 | Unique ID | ✅ Met | `id: string` with kebab-case pattern |
| 2 | Name | ✅ Met | `name: string` (2-80 chars) |
| 3 | Description | ✅ Met | `description: string` (10-2000 chars) |
| 4 | Category | ✅ Met | `category: UseCaseCategory` (10 enum values) |
| 5 | Required parameters (with types and descriptions) | ✅ Met | `requiredParameters: UseCaseParameter[]` |
| 6 | Optional parameters | ✅ Met | `optionalParameters: UseCaseParameter[]` |
| 7 | Pre-written system prompt | ✅ Met | `prompts.planGeneration` + `prompts.taskExecution` |
| 8 | Plan generation prompt | ✅ Met | `prompts.planGeneration: string` (min 50 chars) |
| 9 | Output format specification | ✅ Met | `outputFormat: OutputFormatSpec` |
| 10 | Parallelization configuration | ✅ Met | `parallelization: ParallelizationConfig` |

---

## Schema Overview

### File Inventory

| File | Purpose |
|------|---------|
| `packages/core/src/types/use-case-template.ts` | TypeScript type definitions (745 lines) |
| `packages/core/src/schemas/use-case-template.schema.json` | JSON Schema for validation (459 lines) |
| `packages/core/src/templates/template-loader.ts` | Multi-format template loader (597 lines) |
| `packages/core/src/templates/template-validator.ts` | Validation with errors/warnings (497 lines) |
| `packages/core/src/templates/README.md` | Developer documentation |
| `docs/design/USE_CASE_TEMPLATES.md` | Comprehensive design document |

### Built-in Template Examples

| Template | Category | Description |
|----------|----------|-------------|
| `astro/web-app` | software-development | Full-stack web application |
| `astro/api-development` | software-development | REST/GraphQL API |
| `astro/ml-pipeline` | machine-learning | ML training pipeline |
| `astro/data-pipeline` | data-science | ETL data pipeline |
| `astro/drug-discovery` | computational-biology | Drug discovery analysis |
| `astro/security-audit` | security | Security assessment |
| `astro/paper-to-slides` | research-analysis | Academic paper to slides |

---

## Core Schema Types

### UseCaseTemplate (Main Interface)

```typescript
interface UseCaseTemplate {
  // Identity (required)
  id: string              // Unique ID (kebab-case, e.g., 'astro/web-app')
  name: string            // Display name (2-80 chars)
  description: string     // Detailed description (10-2000 chars)
  category: UseCaseCategory  // Organizational category
  version: string         // Semantic version (e.g., '1.0.0')

  // Display (optional)
  icon?: string           // Emoji icon
  tags?: string[]         // Search/filter tags
  maturity?: 'stable' | 'beta' | 'experimental'

  // Parameters (required)
  requiredParameters: UseCaseParameter[]   // Must be filled
  optionalParameters: UseCaseParameter[]   // Have defaults

  // Prompts (required)
  prompts: PromptConfig

  // Execution (optional)
  outputFormat?: OutputFormatSpec
  parallelization?: ParallelizationConfig
  execution?: ExecutionConfig
  planHints?: PlanGenerationHints

  // Relationships (optional)
  domains?: DomainExpertise[]
  recommendedSkills?: string[]
  extends?: string        // Parent template ID

  // Metadata (required)
  source: 'builtin' | 'workspace' | 'community' | 'custom'
  enabled: boolean
  author?: string
  homepage?: string
}
```

### Parameter System

```typescript
interface UseCaseParameter {
  id: string              // Unique ID for {{interpolation}}
  name: string            // Display name
  description: string     // Help text
  type: ParameterType     // string | number | boolean | select | multi-select | file-path | code
  required: boolean
  default?: any
  placeholder?: string
  options?: ParameterOption[]  // For select/multi-select
  validation?: {
    min?: number
    max?: number
    pattern?: string
    message?: string
  }
  visibleWhen?: {         // Conditional visibility
    parameterId: string
    operator: 'equals' | 'not-equals' | 'contains' | 'not-empty'
    value?: any
  }
  group?: string          // Display grouping
  order?: number          // Order within group
}
```

### Prompt Configuration

```typescript
interface PromptConfig {
  planGeneration: string   // REQUIRED: System prompt for plan generation
  taskExecution?: string   // System prompt for task execution
  planRefinement?: string  // System prompt for plan refinement chat
  sharedContext?: string   // Domain knowledge prepended to all prompts
}
```

Built-in interpolation variables:
- `{{projectName}}` - Project name
- `{{visionDoc}}` - Project vision document
- `{{repoContext}}` - Repository context (CLAUDE.md, README, file tree)
- `{{gitState}}` - Current git branch and dirty state
- `{{timestamp}}` - ISO 8601 timestamp
- `{{userName}}` - Current user's display name

### Output Format Specification

```typescript
interface OutputFormatSpec {
  type: 'json_schema' | 'markdown' | 'free'
  schema?: Record<string, unknown>  // JSON Schema (for json_schema type)
  description?: string
  example?: string
}
```

### Parallelization Configuration

```typescript
interface ParallelizationConfig {
  maxConcurrentTasks?: number         // 1-50, default 5
  autoDispatch?: boolean              // default true
  defaultPriority?: 'critical' | 'high' | 'normal' | 'low'
  retry?: {
    maxRetries: number                // 0-10
    retryDelayMs: number              // 1000-300000
    exponentialBackoff: boolean
  }
  machineSelectionPolicy?: 'round-robin' | 'priority' | 'least-loaded' | 'manual' | 'label-match'
  requiredMachineLabels?: string[]    // e.g., ['gpu']
}
```

### Execution Configuration

```typescript
interface ExecutionConfig {
  preferredModel?: string             // e.g., 'claude-sonnet-4-20250514'
  maxTurns?: number                   // 1-200, default 30
  maxBudgetPerTask?: number           // $0.01-$100
  skills?: string[]                   // OpenClaw skills to activate
  deliveryMode?: 'pr' | 'push' | 'branch' | 'copy' | 'direct'
  skipSafetyCheck?: boolean           // For text-only tasks
  defaultVerification?: 'auto' | 'human' | 'mixed'
}
```

### Plan Generation Hints

```typescript
interface PlanGenerationHints {
  targetNodeCount?: { min: number; max: number }  // 3-50
  defaultEstimate?: 'XS' | 'S' | 'M' | 'L' | 'XL'
  suggestedMilestones?: Array<{ title: string; description: string }>
  commonLabels?: string[]             // l1-l5
  preferParallelTasks?: boolean
}
```

---

## SKILL.md vs UseCaseTemplate Comparison

| Aspect | SKILL.md (OpenClaw) | UseCaseTemplate (Astro) |
|--------|---------------------|------------------------|
| **Scope** | Execution-time instruction injection | Planning + dispatch + execution |
| **Format** | Markdown with YAML frontmatter | TypeScript interface + JSON Schema |
| **Purpose** | Tool/capability instructions | Project template configuration |
| **Parameters** | Limited metadata | Rich, typed parameter forms |
| **Prompts** | Single instruction block | Multiple prompts (plan, execute, refine, context) |
| **Triggers** | Keyword-based activation | User selects at project creation |
| **Parallelization** | Not applicable | Full dispatch configuration |
| **Output Format** | Not applicable | JSON Schema / Markdown / Free |
| **Validation** | Basic metadata validation | Comprehensive schema validation |

**Key Insight**: Templates and skills are **complementary**:
- Templates configure **planning and dispatch** (project-level)
- Skills inject **domain knowledge** (task-level)
- A template can reference skills via `recommendedSkills`

---

## Template Authoring Formats

### 1. TypeScript (Recommended)

```typescript
import type { UseCaseTemplate } from '@astro/core/types/use-case-template'

export const myTemplate: UseCaseTemplate = {
  id: 'custom/my-template',
  name: 'My Template',
  description: 'Description here...',
  category: 'software-development',
  version: '1.0.0',
  requiredParameters: [...],
  optionalParameters: [...],
  prompts: {
    planGeneration: '...',
  },
  source: 'custom',
  enabled: true,
}
```

### 2. YAML/Markdown (TEMPLATE.md)

```yaml
---
id: custom/my-template
name: My Template
description: Description here
category: software-development
version: 1.0.0

parameters:
  required:
    - id: projectName
      name: Project Name
      type: string
      description: Name of the project

parallelization:
  maxConcurrentTasks: 3
---

# My Template

## Plan Generation Prompt

You are planning a project called {{projectName}}...

## Task Execution Prompt

Implement the task for {{projectName}}...
```

### 3. JSON

Direct JSON serialization of the schema for programmatic generation.

---

## Validation

Templates are validated with detailed error/warning codes:

**Errors**:
- `MISSING_REQUIRED` - Required field missing
- `INVALID_TYPE` - Wrong value type
- `INVALID_VALUE` - Value fails validation
- `DUPLICATE_ID` - Parameter ID collision
- `CIRCULAR_DEPENDENCY` - Template extends itself
- `INVALID_REFERENCE` - Unknown template reference

**Warnings**:
- `EMPTY_PROMPT` - Prompt is unexpectedly short
- `MISSING_DESCRIPTION` - Parameter lacks description
- `LARGE_TEMPLATE` - Exceeds size recommendations
- `DEPRECATED_FIELD` - Using deprecated field

---

## Usage Example

```typescript
import {
  UseCaseTemplate,
  validateTemplate,
  getTemplateById,
  loadTemplateFromMarkdown,
} from '@astro/core/templates'

// Get a built-in template
const webApp = getTemplateById('astro/web-app')

// Validate a custom template
const result = validateTemplate(myTemplate)
if (!result.valid) {
  console.error(result.errors)
}

// Load from markdown
const template = loadTemplateFromMarkdown(markdownContent)
```

---

## Conclusion

The use case template schema is **fully implemented** and production-ready. It:

1. Meets all specified requirements (ID, name, description, category, parameters, prompts, output format, parallelization)
2. Provides a rich parameter system with types, validation, and conditional visibility
3. Supports multiple authoring formats (TypeScript, YAML/Markdown, JSON)
4. Includes comprehensive validation with helpful error messages
5. Has 7 built-in example templates across different domains
6. Is fully documented with design decisions and ADRs

**No additional schema design work is needed.** The existing implementation exceeds the requirements.
