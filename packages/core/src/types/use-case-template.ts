/**
 * Use Case Template Types
 *
 * Defines the schema for reusable use case templates that guide plan generation.
 * Templates encapsulate domain-specific planning patterns — system prompts,
 * parameter schemas, output format specs, parallelization configs, and skill
 * requirements — so users can create well-structured plans with a single click.
 *
 * Templates serve two audiences:
 *   - **Builders** (software engineers): CI/CD pipelines, feature development,
 *     refactoring, migration, testing strategies, etc.
 *   - **Scientists** (researchers): experimental workflows, data analysis
 *     pipelines, HPC job orchestration, bioinformatics analyses, etc.
 *
 * Design principles:
 *   - JSON-serializable (no Date objects — ISO strings only in template defs)
 *   - Portable across local/dev/prod modes
 *   - Composable with the existing OpenClaw skill system
 *   - Compatible with the plan graph schema (PLAN_GRAPH_SCHEMA)
 *   - Follows the project's interface naming conventions (*Config, *Result, etc.)
 */

// ============================================================================
// Template Categories
// ============================================================================

/**
 * High-level category for organizing templates in the UI.
 * Maps to the two target user personas plus cross-cutting concerns.
 */
export type UseCaseCategory =
  | 'software-development'    // Feature dev, refactoring, migration, API design
  | 'devops-infrastructure'   // CI/CD, deployment, monitoring, IaC
  | 'testing-qa'              // Test strategy, coverage, E2E, performance testing
  | 'data-science'            // ML pipelines, data analysis, model training
  | 'research'                // Scientific workflows, experiments, literature review
  | 'bioinformatics'          // Genomics, proteomics, drug discovery (celltype tools)
  | 'hpc-computing'           // HPC/Slurm job orchestration, distributed computing
  | 'general'                 // Cross-cutting or uncategorized templates

// ============================================================================
// Template Parameters
// ============================================================================

/**
 * Supported parameter types for template variables.
 *
 * These map to form input types in the UI:
 *   - 'string' → text input
 *   - 'text' → multiline textarea
 *   - 'number' → numeric input
 *   - 'boolean' → toggle/checkbox
 *   - 'select' → dropdown with predefined options
 *   - 'multi-select' → multi-choice dropdown
 *   - 'file-path' → file/directory picker (with validation)
 *   - 'code' → code editor input (syntax-highlighted)
 *   - 'url' → URL input with validation
 */
export type TemplateParameterType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multi-select'
  | 'file-path'
  | 'code'
  | 'url'

/**
 * A single option for select/multi-select parameters.
 */
export interface TemplateParameterOption {
  /** Display label shown in the UI */
  label: string
  /** Value used in prompt substitution */
  value: string
  /** Optional description/tooltip */
  description?: string
}

/**
 * Validation rules for a template parameter.
 * Applied client-side before plan generation begins.
 */
export interface TemplateParameterValidation {
  /** Minimum value (number) or minimum length (string) */
  min?: number
  /** Maximum value (number) or maximum length (string) */
  max?: number
  /** Regex pattern the value must match (string types) */
  pattern?: string
  /** Human-readable error message when validation fails */
  message?: string
}

/**
 * Definition of a single template parameter.
 *
 * Parameters are substituted into prompt templates using `{{paramId}}` syntax.
 * Example: `{{targetGene}}` in a prompt gets replaced with the user's input.
 */
export interface TemplateParameter {
  /** Unique parameter ID within this template (used for `{{id}}` substitution) */
  id: string
  /** Human-readable parameter name */
  name: string
  /** Description shown as help text in the UI */
  description: string
  /** Parameter data type */
  type: TemplateParameterType
  /** Whether this parameter must be provided before plan generation */
  required: boolean
  /** Default value (must match the declared type) */
  default?: string | number | boolean | string[]
  /** Placeholder text for the input field */
  placeholder?: string
  /** Available options (required for 'select' and 'multi-select' types) */
  options?: TemplateParameterOption[]
  /** Validation rules */
  validation?: TemplateParameterValidation
  /** Group/section this parameter belongs to (for UI layout) */
  group?: string
  /**
   * Conditional visibility: parameter is shown only when the referenced
   * parameter has the specified value.
   * Example: { parameterId: 'useGpu', value: 'true' }
   */
  showWhen?: {
    parameterId: string
    value: string | string[]
  }
}

// ============================================================================
// Prompt Configuration
// ============================================================================

/**
 * Prompt templates that guide AI plan generation.
 *
 * All prompt fields support `{{paramId}}` variable substitution.
 * Variables are replaced with the user's parameter values before injection.
 *
 * Prompts are layered on top of Astro's base plan generation prompt
 * (from `buildPlanSystemPrompt` / `buildInteractivePlanPrompt`):
 *   1. Base Astro system prompt (node rules, edge rules, output format)
 *   2. Template system prompt (domain context, specialized instructions)
 *   3. Template plan generation prompt (specific goal + parameters)
 *   4. User's additional description (if any)
 */
export interface TemplatePromptConfig {
  /**
   * System prompt injected BEFORE the base plan generation prompt.
   * Use this for domain-specific context, terminology, constraints, and
   * expertise that should shape the AI's planning approach.
   *
   * Example (bioinformatics): "You are planning a computational biology
   * workflow. The user has access to celltype/cli tools for genomics,
   * proteomics, and drug discovery analyses..."
   */
  systemPrompt: string

  /**
   * Plan generation prompt — the main "user message" that describes
   * what plan to generate. Typically includes `{{param}}` variables.
   *
   * Example: "Create a plan to analyze differential gene expression in
   * {{dataset}} for {{targetGene}}, using {{analysisMethod}} with
   * significance threshold p < {{pValueThreshold}}."
   */
  planGenerationPrompt: string

  /**
   * Optional per-task execution prompt additions.
   * Injected into each task's execution context (alongside the vision doc
   * and dependency outputs). Use this for domain-specific execution
   * instructions that every task should follow.
   *
   * Example (HPC): "All compute-intensive tasks must use sbatch.
   * Never run directly on the login node."
   */
  taskExecutionPrompt?: string

  /**
   * Optional vision document template.
   * If provided, this is used as the project's vision document,
   * with `{{param}}` variables substituted.
   * If omitted, the user can write their own vision doc as usual.
   */
  visionDocTemplate?: string
}

// ============================================================================
// Output Format Specification
// ============================================================================

/**
 * Custom label definition for a template.
 * Templates can define domain-specific labels that replace or extend
 * the default set (l1=Frontend, l2=Backend, etc.).
 */
export interface TemplateLabel {
  /** Label ID (e.g., 'l1', 'l2', or custom like 'wet-lab', 'dry-lab') */
  id: string
  /** Display name */
  name: string
  /** Hex color */
  color: string
}

/**
 * Specifies the expected shape of the generated plan.
 * Guides the AI toward producing plans with the right granularity,
 * node types, and verification approach for this use case.
 */
export interface TemplateOutputFormat {
  /**
   * Suggested node count range. The AI aims for this range.
   * Default: { min: 6, max: 15 } (matches PLAN_GRAPH_SCHEMA constraint).
   */
  nodeCountRange?: {
    min: number
    max: number
  }

  /**
   * Default node types to favor in this template.
   * Example: a research template might favor 'task' + 'decision' nodes
   * (more human judgment points), while a CI/CD template favors
   * 'task' + 'milestone' (more automation).
   */
  preferredNodeTypes?: Array<'milestone' | 'task' | 'branch' | 'decision'>

  /**
   * Default verification mode for tasks in this template.
   * 'auto' = programmatically verifiable (tests, builds)
   * 'human' = requires human judgment
   * 'mixed' = AI decides per-task (default behavior)
   */
  defaultVerification?: 'auto' | 'human' | 'mixed'

  /**
   * Default task estimate for this template.
   * Useful when all tasks in a domain have similar expected effort.
   */
  defaultEstimate?: 'XS' | 'S' | 'M' | 'L' | 'XL'

  /**
   * Custom label set for this template.
   * If provided, replaces the default labels (Frontend, Backend, etc.)
   * with domain-specific labels.
   */
  labels?: TemplateLabel[]

  /**
   * Acceptance criteria templates — reusable criteria patterns.
   * The AI can reference these when generating acceptance criteria
   * for individual tasks.
   */
  acceptanceCriteriaTemplates?: Array<{
    /** Criteria template ID */
    id: string
    /** Human-readable description */
    description: string
    /** Criteria type */
    type: 'test' | 'build' | 'lint' | 'command' | 'manual'
    /** Command template (supports {{param}} substitution) */
    command?: string
    /** Whether this criteria can be auto-verified */
    autoVerifiable: boolean
  }>
}

// ============================================================================
// Parallelization & Dispatch Configuration
// ============================================================================

/**
 * Configuration for how tasks from this template should be dispatched
 * and parallelized. Maps to the dispatch engine configuration.
 */
export interface TemplateParallelizationConfig {
  /**
   * Maximum number of tasks that can execute concurrently.
   * Maps to `DispatchEngineConfig.maxConcurrentPerProject`.
   * Default: 1 (sequential execution).
   */
  maxConcurrentTasks?: number

  /**
   * Whether to auto-dispatch tasks when dependencies are met.
   * Maps to `DispatchEngineConfig.autoDispatch`.
   * Default: true.
   */
  autoDispatch?: boolean

  /**
   * Preferred compute backend for task execution.
   * 'local' = local machine (Claude Code, etc.)
   * 'slurm' = HPC cluster via Slurm adapter
   * 'cloud' = cloud provider (future)
   */
  preferredBackend?: 'local' | 'slurm' | 'cloud'

  /**
   * Machine selection policy for multi-machine environments.
   * Maps to `DispatchEngineConfig.machineSelectionPolicy`.
   */
  machineSelectionPolicy?: 'round-robin' | 'priority' | 'least-loaded' | 'manual'

  /**
   * Default AI model for task execution.
   * Example: 'claude-sonnet-4-20250514', 'claude-opus-4-20250514'
   */
  defaultModel?: string

  /**
   * Default maximum turns for agent execution per task.
   * Higher values allow more complex tasks but cost more.
   */
  defaultMaxTurns?: number

  /**
   * Default delivery mode for task results.
   * Maps to `DeliveryMode` type.
   */
  defaultDeliveryMode?: 'pr' | 'push' | 'branch' | 'copy' | 'direct'

  /**
   * Whether tasks should use isolated git worktrees.
   * Recommended for software development templates.
   */
  useWorktrees?: boolean

  /**
   * Maximum retries for failed tasks.
   * Maps to `DispatchEngineConfig.defaultMaxRetries`.
   */
  maxRetries?: number

  /**
   * Resource hints for HPC/Slurm dispatch.
   * Only relevant when preferredBackend is 'slurm'.
   */
  slurmDefaults?: {
    partition?: string
    timeLimit?: string           // e.g., '04:00:00'
    memory?: string              // e.g., '32G'
    cpusPerTask?: number
    gpus?: number
    gpuType?: string             // e.g., 'a100', 'v100'
    nodes?: number
    account?: string
  }
}

// ============================================================================
// Skill Requirements
// ============================================================================

/**
 * Specifies which OpenClaw skills are needed or recommended for this template.
 * Skills inject domain-specific instructions into the agent's prompt.
 */
export interface TemplateSkillRequirements {
  /**
   * Skills that MUST be available for this template to work.
   * Plan generation will warn if these skills are not installed/enabled.
   * References skill names from the OpenClaw format.
   */
  required?: string[]

  /**
   * Skills that enhance the template but aren't strictly necessary.
   * The UI may suggest installing these.
   */
  recommended?: string[]

  /**
   * Inline skill instructions to inject even if the skill isn't installed.
   * Useful for lightweight domain guidance that doesn't warrant a full skill.
   * Maps to the `instructions` field in OpenClawSkill.
   */
  inlineInstructions?: string
}

// ============================================================================
// Template Metadata
// ============================================================================

/**
 * Metadata about the template's origin and version.
 */
export interface TemplateMetadata {
  /** Template version (semver) */
  version: string
  /** Author name or identifier */
  author?: string
  /** URL for more information */
  homepage?: string
  /** License (e.g., 'MIT', 'Apache-2.0') */
  license?: string
  /** When this template was last updated (ISO 8601) */
  lastUpdated?: string
  /**
   * Minimum Astro version required.
   * Plan generation will warn if the current version is too old.
   */
  minAstroVersion?: string
  /** Freeform key-value metadata */
  extra?: Record<string, unknown>
}

// ============================================================================
// Example Configuration
// ============================================================================

/**
 * Pre-built example configuration for a template.
 * Shown in the UI as "Try this example" to help users understand
 * what the template does and how to fill in parameters.
 */
export interface TemplateExample {
  /** Example name (e.g., "BRCA1 Target Discovery") */
  name: string
  /** Short description of what this example demonstrates */
  description: string
  /** Pre-filled parameter values */
  parameterValues: Record<string, string | number | boolean | string[]>
}

// ============================================================================
// Main Template Interface
// ============================================================================

/**
 * A complete use case template definition.
 *
 * Templates are the primary mechanism for packaging domain expertise
 * into reusable planning patterns. They combine:
 *   - Parameter schemas (what the user needs to provide)
 *   - Prompt engineering (how to guide the AI planner)
 *   - Output specs (what shape the plan should take)
 *   - Dispatch config (how tasks should be executed)
 *   - Skill requirements (what tools are needed)
 *
 * Templates can be:
 *   - **Builtin** — shipped with Astro (general-purpose patterns)
 *   - **Community** — shared via a template registry (future)
 *   - **Custom** — created by users/teams for their specific workflows
 *
 * Storage:
 *   - Builtin templates are defined as TypeScript constants
 *   - Custom templates are stored in the `use_case_templates` DB table
 *   - Community templates are fetched from a registry (future)
 */
export interface UseCaseTemplate {
  /** Unique template ID (UUID for DB-stored, prefixed slug for builtins) */
  id: string

  /** Human-readable template name */
  name: string

  /**
   * URL-safe slug for routing and referencing.
   * Builtins use this as their canonical identifier.
   * Example: 'drug-target-discovery', 'react-feature-dev'
   */
  slug: string

  /** Template description (1-3 sentences, shown in template picker UI) */
  description: string

  /** High-level category for filtering/grouping */
  category: UseCaseCategory

  /** Emoji or icon identifier (displayed in template cards) */
  icon?: string

  /** Searchable tags for discovery */
  tags?: string[]

  // ── Core Configuration ──────────────────────────────────────────────

  /** Required parameters the user must fill in */
  parameters: TemplateParameter[]

  /** Prompt templates for plan generation and execution */
  prompts: TemplatePromptConfig

  /** Expected output format specification */
  outputFormat?: TemplateOutputFormat

  /** Parallelization and dispatch configuration */
  parallelization?: TemplateParallelizationConfig

  /** Skill/tool requirements */
  skills?: TemplateSkillRequirements

  // ── Examples & Documentation ────────────────────────────────────────

  /** Pre-built examples to demonstrate the template */
  examples?: TemplateExample[]

  // ── Metadata ────────────────────────────────────────────────────────

  /** Template source */
  source: 'builtin' | 'custom' | 'community'

  /** Whether the template is available for use */
  enabled: boolean

  /** Version and authorship metadata */
  metadata?: TemplateMetadata

  /** Team scope (null = global/personal) */
  teamId?: string

  /** Owner user ID (for custom templates) */
  ownerId?: string

  /** When the template was created (ISO 8601 for builtins, Date for DB) */
  createdAt?: string | Date

  /** When the template was last updated */
  updatedAt?: string | Date
}

// ============================================================================
// Runtime Types (used when applying a template)
// ============================================================================

/**
 * Resolved parameter values provided by the user.
 * Keys are parameter IDs, values match the declared parameter types.
 */
export type ResolvedTemplateParameters = Record<string, string | number | boolean | string[]>

/**
 * Result of validating user-provided parameters against the template schema.
 */
export interface TemplateValidationResult {
  /** Whether all validations passed */
  valid: boolean
  /** Per-parameter validation errors */
  errors: Array<{
    parameterId: string
    message: string
  }>
}

/**
 * A fully resolved template ready for plan generation.
 * All `{{param}}` variables have been substituted with user values.
 */
export interface ResolvedTemplate {
  /** Original template reference */
  templateId: string
  /** Template name (for display) */
  templateName: string
  /** Resolved prompts (variables substituted) */
  resolvedPrompts: {
    systemPrompt: string
    planGenerationPrompt: string
    taskExecutionPrompt?: string
    visionDoc?: string
  }
  /** Output format config (pass-through) */
  outputFormat?: TemplateOutputFormat
  /** Parallelization config (pass-through) */
  parallelization?: TemplateParallelizationConfig
  /** Resolved parameter values (for reference/audit) */
  parameters: ResolvedTemplateParameters
}

// ============================================================================
// Template Resolution Utilities (pure functions, no side effects)
// ============================================================================

/**
 * Substitute `{{paramId}}` variables in a prompt string.
 *
 * @param template - Prompt string containing `{{paramId}}` placeholders
 * @param params - Resolved parameter values
 * @returns Prompt with all variables substituted
 */
export function substituteTemplateVariables(
  template: string,
  params: ResolvedTemplateParameters
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, paramId: string) => {
    const value = params[paramId]
    if (value === undefined) return match // Leave unresolved variables as-is
    if (Array.isArray(value)) return value.join(', ')
    return String(value)
  })
}

/**
 * Validate user-provided parameters against a template's parameter schema.
 *
 * @param template - The use case template
 * @param params - User-provided parameter values
 * @returns Validation result with per-parameter errors
 */
export function validateTemplateParameters(
  template: UseCaseTemplate,
  params: ResolvedTemplateParameters
): TemplateValidationResult {
  const errors: TemplateValidationResult['errors'] = []

  for (const paramDef of template.parameters) {
    const value = params[paramDef.id]

    // Check required
    if (paramDef.required && (value === undefined || value === '' || value === null)) {
      errors.push({
        parameterId: paramDef.id,
        message: `${paramDef.name} is required`,
      })
      continue
    }

    // Skip validation for optional empty values
    if (value === undefined || value === '' || value === null) continue

    // Type-specific validation
    if (paramDef.type === 'number' && typeof value !== 'number') {
      errors.push({
        parameterId: paramDef.id,
        message: `${paramDef.name} must be a number`,
      })
      continue
    }

    if (paramDef.type === 'boolean' && typeof value !== 'boolean') {
      errors.push({
        parameterId: paramDef.id,
        message: `${paramDef.name} must be a boolean`,
      })
      continue
    }

    if (paramDef.type === 'select' && paramDef.options) {
      const validValues = paramDef.options.map((o) => o.value)
      if (!validValues.includes(String(value))) {
        errors.push({
          parameterId: paramDef.id,
          message: `${paramDef.name} must be one of: ${validValues.join(', ')}`,
        })
        continue
      }
    }

    if (paramDef.type === 'multi-select' && Array.isArray(value) && paramDef.options) {
      const validValues = paramDef.options.map((o) => o.value)
      const invalid = value.filter((v) => !validValues.includes(String(v)))
      if (invalid.length > 0) {
        errors.push({
          parameterId: paramDef.id,
          message: `${paramDef.name} contains invalid values: ${invalid.join(', ')}`,
        })
        continue
      }
    }

    // Custom validation rules
    if (paramDef.validation) {
      const v = paramDef.validation
      const strValue = String(value)

      if (v.min !== undefined) {
        if (typeof value === 'number' && value < v.min) {
          errors.push({
            parameterId: paramDef.id,
            message: v.message ?? `${paramDef.name} must be at least ${v.min}`,
          })
        } else if (typeof value === 'string' && value.length < v.min) {
          errors.push({
            parameterId: paramDef.id,
            message: v.message ?? `${paramDef.name} must be at least ${v.min} characters`,
          })
        }
      }

      if (v.max !== undefined) {
        if (typeof value === 'number' && value > v.max) {
          errors.push({
            parameterId: paramDef.id,
            message: v.message ?? `${paramDef.name} must be at most ${v.max}`,
          })
        } else if (typeof value === 'string' && value.length > v.max) {
          errors.push({
            parameterId: paramDef.id,
            message: v.message ?? `${paramDef.name} must be at most ${v.max} characters`,
          })
        }
      }

      if (v.pattern && typeof value === 'string') {
        const regex = new RegExp(v.pattern)
        if (!regex.test(strValue)) {
          errors.push({
            parameterId: paramDef.id,
            message: v.message ?? `${paramDef.name} does not match required format`,
          })
        }
      }
    }

    // URL validation
    if (paramDef.type === 'url' && typeof value === 'string') {
      try {
        new URL(value)
      } catch {
        errors.push({
          parameterId: paramDef.id,
          message: `${paramDef.name} must be a valid URL`,
        })
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Resolve a template by substituting all parameters into prompts.
 *
 * @param template - The use case template
 * @param params - Validated, user-provided parameter values
 * @returns Fully resolved template ready for plan generation
 * @throws Error if validation fails (call validateTemplateParameters first)
 */
export function resolveTemplate(
  template: UseCaseTemplate,
  params: ResolvedTemplateParameters
): ResolvedTemplate {
  const validation = validateTemplateParameters(template, params)
  if (!validation.valid) {
    const errorList = validation.errors.map((e) => `${e.parameterId}: ${e.message}`).join('; ')
    throw new Error(`Template parameter validation failed: ${errorList}`)
  }

  return {
    templateId: template.id,
    templateName: template.name,
    resolvedPrompts: {
      systemPrompt: substituteTemplateVariables(template.prompts.systemPrompt, params),
      planGenerationPrompt: substituteTemplateVariables(template.prompts.planGenerationPrompt, params),
      taskExecutionPrompt: template.prompts.taskExecutionPrompt
        ? substituteTemplateVariables(template.prompts.taskExecutionPrompt, params)
        : undefined,
      visionDoc: template.prompts.visionDocTemplate
        ? substituteTemplateVariables(template.prompts.visionDocTemplate, params)
        : undefined,
    },
    outputFormat: template.outputFormat,
    parallelization: template.parallelization,
    parameters: params,
  }
}
