/**
 * Use Case Template Schema
 *
 * Use case templates are structured definitions for common project types that
 * Astro can plan and execute. They capture the domain knowledge, prompt patterns,
 * parameter schemas, and parallelization strategies needed to decompose a project
 * goal into an executable plan graph.
 *
 * Design decisions:
 *
 * 1. SKILL.md Relationship: Skills inject instructions into agent prompts during
 *    execution. Use case templates operate at a higher level — they configure HOW
 *    Astro generates plans and dispatches tasks. A template may reference skills
 *    that should be activated during execution.
 *
 * 2. Parameter System: Uses a typed parameter schema inspired by JSON Schema but
 *    simplified for UI rendering. Parameters support validation, defaults, and
 *    conditional visibility (e.g., show "SLURM partition" only when execution
 *    strategy is "slurm").
 *
 * 3. Prompt Templates: Each template carries a system prompt for plan generation
 *    and an optional execution system prompt. Prompts use {{paramName}} mustache-
 *    style interpolation with the resolved parameter values.
 *
 * 4. Parallelization: Templates declare how aggressively tasks can run in parallel,
 *    with per-template overrides for the dispatch engine's concurrency settings.
 *
 * 5. Output Format: Templates can specify structured output schemas (JSON Schema)
 *    for tasks that need deterministic output (e.g., data analysis → JSON report).
 */

import type { Priority, Estimate, DomainExpertise } from '../types.js'
import type { DispatchPriority } from '../dispatch/types.js'

// ============================================================================
// Template Identity & Metadata
// ============================================================================

/**
 * Categories for organizing use case templates.
 *
 * Categories are hierarchical — a template belongs to exactly one category.
 * The UI groups templates by category in the template picker.
 */
export type UseCaseCategory =
  | 'software-development'
  | 'data-science'
  | 'machine-learning'
  | 'devops-infrastructure'
  | 'research-analysis'
  | 'documentation'
  | 'testing-qa'
  | 'security'
  | 'computational-biology'
  | 'custom'

/**
 * Template maturity level.
 *
 * Controls visibility and warnings in the UI.
 */
export type TemplateMaturity = 'stable' | 'beta' | 'experimental'

/**
 * Where the template was loaded from.
 */
export type TemplateSource = 'builtin' | 'workspace' | 'community' | 'custom'

// ============================================================================
// Parameter Schema
// ============================================================================

/**
 * Supported parameter value types.
 *
 * Maps to UI input components:
 * - string  → text input or textarea
 * - number  → number input with optional min/max
 * - boolean → toggle switch
 * - select  → dropdown with predefined options
 * - multi-select → multi-select dropdown/checkbox group
 * - file-path → file picker (with glob pattern suggestions)
 * - code    → code editor (Monaco) with language hint
 */
export type ParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multi-select'
  | 'file-path'
  | 'code'

/**
 * A single option in a select/multi-select parameter.
 */
export interface ParameterOption {
  /** Display label in the UI */
  label: string
  /** Actual value used in prompt interpolation */
  value: string
  /** Optional description shown as tooltip or helper text */
  description?: string
}

/**
 * Validation constraints for a parameter.
 */
export interface ParameterValidation {
  /** Minimum value (number) or minimum length (string) */
  min?: number
  /** Maximum value (number) or maximum length (string) */
  max?: number
  /** Regex pattern the value must match (string parameters) */
  pattern?: string
  /** Human-readable validation error message */
  message?: string
}

/**
 * Condition under which a parameter is visible/applicable.
 *
 * When specified, the parameter is only shown in the UI when the referenced
 * parameter has a matching value. This enables dynamic forms (e.g., show
 * "SLURM partition" only when executionStrategy === 'slurm').
 */
export interface ParameterCondition {
  /** ID of the parameter this condition depends on */
  parameterId: string
  /** Operator for the condition check */
  operator: 'equals' | 'not-equals' | 'contains' | 'not-empty'
  /** Value to compare against (not needed for 'not-empty') */
  value?: string | number | boolean
}

/**
 * Definition of a template parameter.
 *
 * Parameters are the user-configurable inputs that customize how a template
 * generates plans. They're rendered as a form in the UI and their values are
 * interpolated into prompt templates.
 */
export interface UseCaseParameter {
  /** Unique identifier within this template (used in prompt interpolation as {{id}}) */
  id: string
  /** Human-readable parameter name */
  name: string
  /** Detailed description of what this parameter controls */
  description: string
  /** Value type — determines UI component and validation */
  type: ParameterType
  /** Whether the user must provide a value */
  required: boolean
  /** Default value (must match the parameter type) */
  default?: string | number | boolean | string[]
  /** Placeholder text for the input field */
  placeholder?: string
  /** Available options (required for 'select' and 'multi-select' types) */
  options?: ParameterOption[]
  /** Validation constraints */
  validation?: ParameterValidation
  /** Condition for when this parameter is visible */
  visibleWhen?: ParameterCondition
  /** Display group — parameters with the same group are rendered together */
  group?: string
  /** Display order within the group (lower = first) */
  order?: number
}

// ============================================================================
// Prompt Configuration
// ============================================================================

/**
 * Prompt templates for plan generation and task execution.
 *
 * Prompts use {{parameterName}} mustache-style interpolation. The following
 * built-in variables are always available:
 *
 * - {{projectName}}    — The project name
 * - {{visionDoc}}      — The project vision document (if provided)
 * - {{repoContext}}    — Repository context (CLAUDE.md, README, file tree)
 * - {{gitState}}       — Current git branch and dirty state
 * - {{timestamp}}      — Current ISO 8601 timestamp
 * - {{userName}}       — Current user's display name
 *
 * Custom parameters defined in `parameters` are also available by their `id`.
 */
export interface PromptConfig {
  /**
   * System prompt for plan generation.
   *
   * This is the primary prompt that guides the AI in decomposing a project
   * into a plan graph. It replaces or extends the default buildPlanSystemPrompt()
   * when this template is active.
   *
   * Should include:
   * - Domain-specific planning instructions
   * - Node type guidance (what kinds of tasks to create)
   * - Dependency pattern guidance (what can run in parallel)
   * - Quality criteria for the generated plan
   */
  planGeneration: string

  /**
   * System prompt for task execution.
   *
   * Injected as the system prompt when individual tasks from this template's
   * plan are dispatched for execution. If not provided, the default
   * buildTaskExecutionPrompt() is used.
   *
   * Should include:
   * - Domain-specific execution instructions
   * - Quality standards and verification criteria
   * - Tool usage guidance
   */
  taskExecution?: string

  /**
   * System prompt for plan refinement chat.
   *
   * Used when the user chats about refining the generated plan. If not provided,
   * the default buildChatSystemPrompt() is used.
   */
  planRefinement?: string

  /**
   * Additional context to prepend to all prompts.
   *
   * Use this for domain knowledge, terminology definitions, or constraints
   * that apply to both planning and execution phases.
   */
  sharedContext?: string
}

// ============================================================================
// Output Format Specification
// ============================================================================

/**
 * Output format specification for task results.
 *
 * When specified, tasks generated by this template will request structured
 * output from the AI agent. This is passed through to the Claude SDK's
 * `outputFormat` parameter or equivalent for other providers.
 */
export interface OutputFormatSpec {
  /**
   * Output format type.
   *
   * - 'json_schema': Enforce a JSON Schema on the output. The agent MUST
   *   produce valid JSON matching the schema.
   * - 'markdown': Output should be well-structured markdown (no schema enforcement,
   *   but the prompt should guide the structure).
   * - 'free': No output format constraint (default behavior).
   */
  type: 'json_schema' | 'markdown' | 'free'

  /**
   * JSON Schema for structured output.
   *
   * Only used when type is 'json_schema'. Passed directly to the provider's
   * structured output mechanism (e.g., Claude SDK's outputFormat.schema).
   */
  schema?: Record<string, unknown>

  /**
   * Human-readable description of the expected output.
   *
   * Shown in the UI and can be included in prompts to guide the agent.
   */
  description?: string

  /**
   * Example output for reference.
   *
   * Included in the prompt as a few-shot example when provided.
   */
  example?: string
}

// ============================================================================
// Input Parallelization Configuration
// ============================================================================

/**
 * Strategy for splitting a multi-value input parameter into separate values.
 *
 * - 'comma': Split on commas (e.g., "url1,url2,url3")
 * - 'newline': Split on newlines (for multi-line text inputs)
 * - 'line': Split on any line separator (newline, carriage return, or both)
 * - 'json-array': Parse as JSON array (e.g., '["url1","url2"]')
 * - 'space': Split on whitespace
 * - 'semicolon': Split on semicolons
 * - 'custom': Use a custom regex pattern (requires splitPattern)
 */
export type InputSplitStrategy =
  | 'comma'
  | 'newline'
  | 'line'
  | 'json-array'
  | 'space'
  | 'semicolon'
  | 'custom'

/**
 * Strategy for merging outputs from parallel branches.
 *
 * - 'concatenate': Join all outputs into a single combined result
 * - 'aggregate': Collect outputs into an array/list structure
 * - 'individual': Keep outputs separate (each branch produces independent deliverable)
 * - 'merge-directories': For file outputs, merge into a single directory structure
 */
export type OutputMergeStrategy =
  | 'concatenate'
  | 'aggregate'
  | 'individual'
  | 'merge-directories'

/**
 * Configuration for input-based parallelization.
 *
 * When a template parameter accepts multiple values (e.g., multiple arXiv URLs),
 * this configuration tells Astro how to:
 * 1. Split the input into individual values
 * 2. Generate parallel plan branches for each value
 * 3. Merge the outputs from all branches
 *
 * Example: Paper-to-Slides with 3 arXiv URLs generates 3 parallel branches,
 * each processing one paper independently, then optionally merging into a
 * combined slide deck or keeping them separate.
 */
export interface InputParallelizationConfig {
  /**
   * The parameter ID that triggers parallelization when it contains multiple values.
   *
   * Must reference a parameter defined in requiredParameters or optionalParameters.
   * Typically a 'string' type parameter that can contain multiple URLs, file paths,
   * or other delimited values.
   */
  parameterId: string

  /**
   * How to split the parameter value into individual inputs.
   *
   * @default 'newline'
   */
  splitStrategy: InputSplitStrategy

  /**
   * Custom regex pattern for splitting (only used when splitStrategy is 'custom').
   *
   * The pattern is used with String.split(), so it should match the delimiter.
   * Example: '\\s*[,;]\\s*' to split on comma or semicolon with optional whitespace.
   */
  splitPattern?: string

  /**
   * How to merge outputs from all parallel branches.
   *
   * @default 'individual'
   */
  mergeStrategy: OutputMergeStrategy

  /**
   * Format string for naming parallel branches in the plan graph.
   *
   * Supports placeholders:
   * - {{index}}: 1-based index of the input (1, 2, 3, ...)
   * - {{value}}: The input value (may be truncated for display)
   * - {{total}}: Total number of inputs
   * - {{shortValue}}: Truncated value (first 30 chars)
   *
   * @default 'Branch {{index}}/{{total}}'
   */
  branchLabelFormat?: string

  /**
   * Maximum number of parallel branches to generate.
   *
   * If the input has more values than this limit, extra values are ignored
   * with a warning. This prevents accidentally generating huge plans from
   * malformed input.
   *
   * @default 10
   */
  maxBranches?: number

  /**
   * Minimum number of inputs required to trigger parallelization.
   *
   * If fewer inputs are provided, the plan is generated without parallel
   * branches (single-input mode). Set to 1 to always use parallel structure
   * even for single inputs.
   *
   * @default 2
   */
  minInputsForParallel?: number

  /**
   * Whether to add a merge task at the end that combines all branch outputs.
   *
   * When true and mergeStrategy is not 'individual', a final merge task is
   * automatically added to the plan that depends on all parallel branches.
   *
   * @default true (for non-individual merge strategies)
   */
  addMergeTask?: boolean

  /**
   * Description of the merge task (if addMergeTask is true).
   *
   * @default 'Merge results from all parallel branches'
   */
  mergeTaskDescription?: string
}

// ============================================================================
// Parallelization Configuration
// ============================================================================

/**
 * Parallelization strategy for tasks generated by this template.
 *
 * These settings override the dispatch engine's defaults when this template
 * is active. This allows domain-specific tuning — e.g., a data pipeline
 * template might allow high parallelism for independent ETL stages, while
 * a security audit template might enforce sequential execution.
 */
export interface ParallelizationConfig {
  /**
   * Maximum number of tasks that can execute concurrently for this template's project.
   *
   * Overrides DispatchEngineConfig.maxConcurrentPerProject.
   * Set to 1 for strictly sequential execution.
   *
   * @default Uses dispatch engine default (5)
   */
  maxConcurrentTasks?: number

  /**
   * Whether to automatically dispatch tasks when their dependencies are met.
   *
   * When true, the dispatch engine will automatically start tasks as soon as
   * all upstream dependencies are completed. When false, tasks must be manually
   * dispatched even after dependencies are met.
   *
   * @default true
   */
  autoDispatch?: boolean

  /**
   * Default priority for tasks generated by this template.
   *
   * Individual tasks in the plan can override this, but this sets the baseline.
   */
  defaultPriority?: DispatchPriority

  /**
   * Default retry configuration for failed tasks.
   */
  retry?: {
    /** Maximum retry attempts per task */
    maxRetries: number
    /** Base delay between retries in milliseconds */
    retryDelayMs: number
    /** Whether to use exponential backoff */
    exponentialBackoff: boolean
  }

  /**
   * Machine selection policy for task assignment.
   *
   * - 'round-robin': Distribute tasks evenly across available machines
   * - 'priority': Assign to highest-priority available machine
   * - 'least-loaded': Assign to machine with fewest running tasks
   * - 'manual': Require manual machine assignment
   * - 'label-match': Match task labels to machine labels (e.g., GPU tasks → GPU machines)
   *
   * @default Uses dispatch engine default ('priority')
   */
  machineSelectionPolicy?: 'round-robin' | 'priority' | 'least-loaded' | 'manual' | 'label-match'

  /**
   * Required machine labels for tasks from this template.
   *
   * When specified, tasks will only be dispatched to machines that have ALL
   * of these labels. Useful for templates that require specific hardware
   * (e.g., GPU, high-memory) or environments (e.g., production access).
   */
  requiredMachineLabels?: string[]
}

// ============================================================================
// Execution Configuration
// ============================================================================

/**
 * Execution-level settings for tasks generated by this template.
 */
export interface ExecutionConfig {
  /**
   * Preferred AI model for task execution.
   *
   * Can be overridden per-task in the plan. When not specified, uses the
   * project or user default.
   *
   * Examples: 'claude-sonnet-4-20250514', 'gpt-4o', 'deepseek-v3'
   */
  preferredModel?: string

  /**
   * Maximum turns (tool-use cycles) per task execution.
   *
   * Limits how many tool calls the agent can make before the session ends.
   * Lower values for simple tasks, higher for complex multi-step work.
   *
   * @default 30
   */
  maxTurns?: number

  /**
   * Maximum budget in USD per task execution.
   *
   * Passed to the Claude SDK's maxBudgetUsd parameter. The agent is
   * automatically terminated if this limit is exceeded.
   */
  maxBudgetPerTask?: number

  /**
   * Skills to activate during task execution.
   *
   * These OpenClaw skill names will be injected into the agent prompt
   * when tasks from this template are executed.
   */
  skills?: string[]

  /**
   * Delivery mode for task results.
   *
   * - 'pr': Create a pull request
   * - 'push': Push to remote branch
   * - 'branch': Commit to local branch only
   * - 'copy': Copy files to worktree
   * - 'direct': Modify files in-place
   */
  deliveryMode?: 'pr' | 'push' | 'branch' | 'copy' | 'direct'

  /**
   * Whether to skip safety checks for text-only tasks.
   *
   * When true, tasks are treated as text generation (no file system access).
   * Only appropriate for research/analysis templates that don't modify code.
   *
   * @default false
   */
  skipSafetyCheck?: boolean

  /**
   * Verification strategy for completed tasks.
   *
   * - 'auto': Programmatic verification (test results, build status)
   * - 'human': Requires human judgment
   * - 'mixed': Auto-verify where possible, human review for the rest
   *
   * @default 'mixed'
   */
  defaultVerification?: 'auto' | 'human' | 'mixed'
}

// ============================================================================
// Plan Generation Hints
// ============================================================================

/**
 * Hints for the plan generation AI about how to structure the plan.
 *
 * These are soft guidance — the AI uses them to produce better plans but
 * isn't strictly bound by them. They encode domain knowledge about typical
 * project structures.
 */
export interface PlanGenerationHints {
  /**
   * Target number of tasks in the generated plan.
   *
   * The plan generation prompt enforces 6-15 nodes by default. Templates
   * can narrow this range based on the typical complexity of their use case.
   */
  targetNodeCount?: {
    min: number
    max: number
  }

  /**
   * Suggested task size calibration.
   *
   * Guides how granular tasks should be. The default is ~20 minutes of
   * expert work time per task.
   */
  defaultEstimate?: Estimate

  /**
   * Common milestone patterns for this use case.
   *
   * The AI uses these as a starting framework for the plan structure.
   * Each entry is a milestone name/description that commonly appears
   * in plans of this type.
   */
  suggestedMilestones?: Array<{
    title: string
    description: string
  }>

  /**
   * Label IDs that are commonly relevant for this template.
   *
   * From the standard set: l1=Frontend, l2=Backend, l3=Testing,
   * l4=Infrastructure, l5=Research.
   */
  commonLabels?: string[]

  /**
   * Whether the generated plan should favor parallel task structures.
   *
   * When true, the AI is encouraged to create independent task branches
   * that can execute concurrently. When false, tasks are more sequential.
   *
   * @default true for most templates
   */
  preferParallelTasks?: boolean
}

// ============================================================================
// Use Case Template (Main Interface)
// ============================================================================

/**
 * A use case template defines a reusable pattern for Astro projects.
 *
 * Templates capture domain knowledge about how to plan and execute a
 * specific type of work — from web application development to ML training
 * pipelines to security audits.
 *
 * Users select a template when creating a new project. The template
 * pre-populates:
 * - A parameter form for project-specific customization
 * - System prompts tuned for the domain
 * - Parallelization and execution settings
 * - Output format expectations
 *
 * Templates are composable with skills — a template configures the planning
 * and dispatch layer, while skills configure the execution layer.
 */
export interface UseCaseTemplate {
  // ── Identity ──────────────────────────────────────────────────────────

  /**
   * Unique template identifier.
   *
   * Format: kebab-case, globally unique. Built-in templates use the
   * 'astro/' prefix (e.g., 'astro/web-app', 'astro/ml-pipeline').
   * Community templates use 'community/' prefix.
   * Custom templates use no prefix.
   */
  id: string

  /**
   * Human-readable template name.
   *
   * Shown in the template picker. Should be concise (2-5 words).
   */
  name: string

  /**
   * Detailed description of what this template is for.
   *
   * Shown in the template detail view. Should explain:
   * - What kind of project this template is designed for
   * - What the generated plan will look like
   * - Any prerequisites or assumptions
   */
  description: string

  /**
   * Template category for organization.
   */
  category: UseCaseCategory

  /**
   * Semantic version of this template.
   *
   * Follows semver. Increment major for breaking parameter changes,
   * minor for new features, patch for prompt improvements.
   */
  version: string

  // ── Display ───────────────────────────────────────────────────────────

  /** Emoji icon for the template (shown in picker and breadcrumbs) */
  icon?: string

  /** Tags for search and filtering */
  tags?: string[]

  /** Template maturity level */
  maturity?: TemplateMaturity

  // ── Parameters ────────────────────────────────────────────────────────

  /**
   * Required parameters that the user must provide.
   *
   * These parameters have `required: true` and must be filled before the
   * template can generate a plan. They represent the core inputs that
   * define the project scope.
   */
  requiredParameters: UseCaseParameter[]

  /**
   * Optional parameters for fine-tuning.
   *
   * These parameters have sensible defaults and can be left as-is for
   * most projects. Power users can adjust them for specific needs.
   */
  optionalParameters: UseCaseParameter[]

  // ── Prompts ───────────────────────────────────────────────────────────

  /**
   * Prompt configuration for plan generation and task execution.
   */
  prompts: PromptConfig

  // ── Output & Execution ────────────────────────────────────────────────

  /**
   * Output format specification for task results.
   *
   * When provided, tasks generated by this template request structured
   * output from the AI agent.
   */
  outputFormat?: OutputFormatSpec

  /**
   * Parallelization and dispatch configuration.
   */
  parallelization?: ParallelizationConfig

  /**
   * Input-based parallelization configuration.
   *
   * When configured, Astro generates parallel plan branches when the specified
   * parameter contains multiple values. For example, if a Paper-to-Slides
   * template receives 3 arXiv URLs, it generates 3 parallel branches that
   * each process one paper independently.
   */
  inputParallelization?: InputParallelizationConfig

  /**
   * Execution-level settings.
   */
  execution?: ExecutionConfig

  /**
   * Plan generation hints for the AI.
   */
  planHints?: PlanGenerationHints

  // ── Relationships ─────────────────────────────────────────────────────

  /**
   * Domain expertise areas this template is designed for.
   *
   * Used for recommendation — templates matching the user's domain expertise
   * are shown first in the template picker.
   */
  domains?: DomainExpertise[]

  /**
   * Skill names that this template recommends activating.
   *
   * These are suggestions — the user can override. Skills are referenced
   * by their OpenClaw name (e.g., 'astro-plan-bridge', 'github').
   */
  recommendedSkills?: string[]

  /**
   * IDs of templates that this template extends or refines.
   *
   * When extending, the child template inherits parameters and prompts
   * from the parent, with overrides taking precedence.
   */
  extends?: string

  // ── Metadata ──────────────────────────────────────────────────────────

  /** Where this template was loaded from */
  source: TemplateSource

  /** Whether this template is active and selectable */
  enabled: boolean

  /** Template author (for community templates) */
  author?: string

  /** URL to template documentation or source */
  homepage?: string

  /** Creation timestamp */
  createdAt?: Date

  /** Last modification timestamp */
  updatedAt?: Date
}

// ============================================================================
// Template Registry Types
// ============================================================================

/**
 * Resolved parameter values after user input.
 *
 * Maps parameter IDs to their values. Used to interpolate prompt templates.
 */
export type ResolvedParameters = Record<string, string | number | boolean | string[]>

/**
 * A template instance — a template with resolved parameters, ready for
 * plan generation.
 */
export interface UseCaseTemplateInstance {
  /** The template being instantiated */
  templateId: string

  /** Template version at time of instantiation */
  templateVersion: string

  /** Resolved parameter values */
  parameters: ResolvedParameters

  /** The project this instance is associated with */
  projectId: string

  /** Timestamp when the instance was created */
  createdAt: Date
}

/**
 * Summary of a template for list/picker views.
 *
 * Contains only the fields needed for display, not the full template.
 */
export interface UseCaseTemplateSummary {
  id: string
  name: string
  description: string
  category: UseCaseCategory
  icon?: string
  tags?: string[]
  maturity?: TemplateMaturity
  source: TemplateSource
  domains?: DomainExpertise[]
  parameterCount: number
  version: string
}

// ============================================================================
// Template Validation
// ============================================================================

/**
 * Result of validating a template definition.
 */
export interface TemplateValidationResult {
  valid: boolean
  errors: TemplateValidationError[]
  warnings: TemplateValidationWarning[]
}

export interface TemplateValidationError {
  path: string
  message: string
  code: 'MISSING_REQUIRED' | 'INVALID_TYPE' | 'INVALID_VALUE' | 'DUPLICATE_ID' | 'CIRCULAR_DEPENDENCY' | 'INVALID_REFERENCE'
}

export interface TemplateValidationWarning {
  path: string
  message: string
  code: 'EMPTY_PROMPT' | 'MISSING_DESCRIPTION' | 'LARGE_TEMPLATE' | 'DEPRECATED_FIELD'
}
