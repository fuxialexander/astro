/**
 * Template Loader
 *
 * Loads use case templates from various formats:
 * - TypeScript/JavaScript modules (.ts, .js)
 * - YAML/Markdown files (TEMPLATE.md)
 * - JSON files (.json)
 *
 * This enables templates to be defined in multiple formats:
 * - TypeScript for type safety and IDE support
 * - YAML/Markdown for simpler authoring and portability
 * - JSON for programmatic generation
 */

import type {
  UseCaseTemplate,
  UseCaseParameter,
  PromptConfig,
  ParallelizationConfig,
  ExecutionConfig,
  PlanGenerationHints,
  OutputFormatSpec,
  UseCaseCategory,
  TemplateSource,
  TemplateMaturity,
} from '../types/use-case-template.js'

// ============================================================================
// YAML/Markdown Template Format
// ============================================================================

/**
 * Raw parsed YAML frontmatter structure.
 *
 * This is the shape of the data extracted from TEMPLATE.md files.
 */
export interface TemplateYamlFrontmatter {
  id: string
  name: string
  description: string
  category: string
  version: string
  icon?: string
  tags?: string[]
  maturity?: string

  parameters?: {
    required?: Array<{
      id: string
      name: string
      type: string
      description: string
      required?: boolean
      default?: unknown
      placeholder?: string
      options?: Array<{ label: string; value: string; description?: string }>
      validation?: {
        min?: number
        max?: number
        pattern?: string
        message?: string
      }
      visibleWhen?: {
        parameterId: string
        operator: string
        value?: unknown
      }
      group?: string
      order?: number
    }>
    optional?: Array<{
      id: string
      name: string
      type: string
      description: string
      required?: boolean
      default?: unknown
      placeholder?: string
      options?: Array<{ label: string; value: string; description?: string }>
      validation?: {
        min?: number
        max?: number
        pattern?: string
        message?: string
      }
      visibleWhen?: {
        parameterId: string
        operator: string
        value?: unknown
      }
      group?: string
      order?: number
    }>
  }

  outputFormat?: {
    type: string
    schema?: Record<string, unknown>
    description?: string
    example?: string
  }

  parallelization?: {
    maxConcurrentTasks?: number
    autoDispatch?: boolean
    defaultPriority?: string
    retry?: {
      maxRetries: number
      retryDelayMs: number
      exponentialBackoff: boolean
    }
    machineSelectionPolicy?: string
    requiredMachineLabels?: string[]
  }

  execution?: {
    preferredModel?: string
    maxTurns?: number
    maxBudgetPerTask?: number
    skills?: string[]
    deliveryMode?: string
    skipSafetyCheck?: boolean
    defaultVerification?: string
  }

  planHints?: {
    targetNodeCount?: { min: number; max: number }
    defaultEstimate?: string
    suggestedMilestones?: Array<{ title: string; description: string }>
    commonLabels?: string[]
    preferParallelTasks?: boolean
  }

  domains?: string[]
  recommendedSkills?: string[]
  extends?: string
  source?: string
  enabled?: boolean
  author?: string
  homepage?: string
}

/**
 * Parsed markdown content sections from TEMPLATE.md body.
 */
export interface TemplateMarkdownSections {
  planGeneration?: string
  taskExecution?: string
  planRefinement?: string
  sharedContext?: string
}

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse YAML frontmatter from a markdown file.
 *
 * Expected format:
 * ```
 * ---
 * id: template-id
 * name: Template Name
 * ...
 * ---
 *
 * # Markdown Content
 * ```
 */
export function parseYamlFrontmatter(content: string): {
  frontmatter: TemplateYamlFrontmatter
  body: string
} {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!frontmatterMatch) {
    throw new Error('Invalid TEMPLATE.md format: missing YAML frontmatter')
  }

  const [, yamlContent, body] = frontmatterMatch

  // Simple YAML parsing (for basic templates)
  // Production implementation should use a proper YAML parser like js-yaml
  const frontmatter = parseSimpleYaml(yamlContent)

  return { frontmatter: frontmatter as unknown as TemplateYamlFrontmatter, body }
}

/**
 * Simple YAML parser for basic structures.
 *
 * NOTE: This is a simplified parser for demonstration. In production,
 * use a proper YAML library like js-yaml.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = yaml.split('\n')
  // Note: These variables are reserved for future nested parsing support
  // let currentKey = ''
  // let currentIndent = 0
  // const stack: Array<{ key: string; value: Record<string, unknown>; indent: number }> = []

  for (const line of lines) {
    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) continue

    // Simple key-value parsing
    const kvMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/)
    if (kvMatch) {
      const [, , key, value] = kvMatch
      const trimmedValue = value.trim()

      if (trimmedValue === '' || trimmedValue === '|' || trimmedValue === '>') {
        // Nested object or multiline value - simplified handling
        result[key] = {}
      } else if (trimmedValue.startsWith('"') || trimmedValue.startsWith("'")) {
        // Quoted string
        result[key] = trimmedValue.slice(1, -1)
      } else if (trimmedValue === 'true') {
        result[key] = true
      } else if (trimmedValue === 'false') {
        result[key] = false
      } else if (!isNaN(Number(trimmedValue))) {
        result[key] = Number(trimmedValue)
      } else if (trimmedValue.startsWith('[')) {
        // Inline array - parse JSON-style
        try {
          result[key] = JSON.parse(trimmedValue.replace(/'/g, '"'))
        } catch {
          result[key] = trimmedValue
        }
      } else {
        result[key] = trimmedValue
      }
    }
  }

  return result
}

/**
 * Parse markdown sections for prompt content.
 *
 * Looks for headers like:
 * - ## Plan Generation Prompt
 * - ## Task Execution Prompt
 * - ## Plan Refinement Prompt
 * - ## Shared Context
 */
export function parseMarkdownSections(body: string): TemplateMarkdownSections {
  const sections: TemplateMarkdownSections = {}

  // Define section patterns
  const sectionPatterns = [
    { key: 'planGeneration', patterns: ['Plan Generation Prompt', 'Plan Generation', 'Planning Prompt'] },
    { key: 'taskExecution', patterns: ['Task Execution Prompt', 'Task Execution', 'Execution Prompt'] },
    { key: 'planRefinement', patterns: ['Plan Refinement Prompt', 'Plan Refinement', 'Refinement Prompt'] },
    { key: 'sharedContext', patterns: ['Shared Context', 'Context', 'Domain Context'] },
  ] as const

  for (const { key, patterns } of sectionPatterns) {
    for (const pattern of patterns) {
      const regex = new RegExp(`##\\s*${pattern}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i')
      const match = body.match(regex)
      if (match) {
        sections[key] = match[1].trim()
        break
      }
    }
  }

  return sections
}

// ============================================================================
// Conversion Functions
// ============================================================================

/**
 * Convert YAML frontmatter and markdown sections to UseCaseTemplate.
 */
export function convertToUseCaseTemplate(
  frontmatter: TemplateYamlFrontmatter,
  sections: TemplateMarkdownSections,
  source: TemplateSource = 'workspace'
): UseCaseTemplate {
  // Convert required parameters
  const requiredParameters: UseCaseParameter[] = (frontmatter.parameters?.required || []).map(
    (p) => ({
      ...p,
      type: p.type as UseCaseParameter['type'],
      required: true,
      visibleWhen: p.visibleWhen
        ? {
            ...p.visibleWhen,
            operator: p.visibleWhen.operator as UseCaseParameter['visibleWhen'] extends infer T
              ? T extends { operator: infer O } ? O : never
              : never,
          }
        : undefined,
    } as UseCaseParameter)
  )

  // Convert optional parameters
  const optionalParameters: UseCaseParameter[] = (frontmatter.parameters?.optional || []).map(
    (p) => ({
      ...p,
      type: p.type as UseCaseParameter['type'],
      required: false,
      visibleWhen: p.visibleWhen
        ? {
            ...p.visibleWhen,
            operator: p.visibleWhen.operator as UseCaseParameter['visibleWhen'] extends infer T
              ? T extends { operator: infer O } ? O : never
              : never,
          }
        : undefined,
    } as UseCaseParameter)
  )

  // Build prompts from frontmatter or markdown sections
  const prompts: PromptConfig = {
    planGeneration: sections.planGeneration || 'Generate a plan for this project.',
    taskExecution: sections.taskExecution,
    planRefinement: sections.planRefinement,
    sharedContext: sections.sharedContext,
  }

  // Build output format
  const outputFormat: OutputFormatSpec | undefined = frontmatter.outputFormat
    ? {
        type: frontmatter.outputFormat.type as OutputFormatSpec['type'],
        schema: frontmatter.outputFormat.schema,
        description: frontmatter.outputFormat.description,
        example: frontmatter.outputFormat.example,
      }
    : undefined

  // Build parallelization config
  const parallelization: ParallelizationConfig | undefined = frontmatter.parallelization
    ? {
        maxConcurrentTasks: frontmatter.parallelization.maxConcurrentTasks,
        autoDispatch: frontmatter.parallelization.autoDispatch,
        defaultPriority: frontmatter.parallelization.defaultPriority as ParallelizationConfig['defaultPriority'],
        retry: frontmatter.parallelization.retry,
        machineSelectionPolicy: frontmatter.parallelization.machineSelectionPolicy as ParallelizationConfig['machineSelectionPolicy'],
        requiredMachineLabels: frontmatter.parallelization.requiredMachineLabels,
      }
    : undefined

  // Build execution config
  const execution: ExecutionConfig | undefined = frontmatter.execution
    ? {
        preferredModel: frontmatter.execution.preferredModel,
        maxTurns: frontmatter.execution.maxTurns,
        maxBudgetPerTask: frontmatter.execution.maxBudgetPerTask,
        skills: frontmatter.execution.skills,
        deliveryMode: frontmatter.execution.deliveryMode as ExecutionConfig['deliveryMode'],
        skipSafetyCheck: frontmatter.execution.skipSafetyCheck,
        defaultVerification: frontmatter.execution.defaultVerification as ExecutionConfig['defaultVerification'],
      }
    : undefined

  // Build plan hints
  const planHints: PlanGenerationHints | undefined = frontmatter.planHints
    ? {
        targetNodeCount: frontmatter.planHints.targetNodeCount,
        defaultEstimate: frontmatter.planHints.defaultEstimate as PlanGenerationHints['defaultEstimate'],
        suggestedMilestones: frontmatter.planHints.suggestedMilestones,
        commonLabels: frontmatter.planHints.commonLabels,
        preferParallelTasks: frontmatter.planHints.preferParallelTasks,
      }
    : undefined

  return {
    // Identity
    id: frontmatter.id,
    name: frontmatter.name,
    description: frontmatter.description,
    category: frontmatter.category as UseCaseCategory,
    version: frontmatter.version,

    // Display
    icon: frontmatter.icon,
    tags: frontmatter.tags,
    maturity: frontmatter.maturity as TemplateMaturity,

    // Parameters
    requiredParameters,
    optionalParameters,

    // Prompts
    prompts,

    // Output & Execution
    outputFormat,
    parallelization,
    execution,
    planHints,

    // Relationships
    domains: frontmatter.domains as UseCaseTemplate['domains'],
    recommendedSkills: frontmatter.recommendedSkills,
    extends: frontmatter.extends,

    // Metadata
    source: (frontmatter.source as TemplateSource) || source,
    enabled: frontmatter.enabled ?? true,
    author: frontmatter.author,
    homepage: frontmatter.homepage,
  }
}

// ============================================================================
// Main Loader Function
// ============================================================================

/**
 * Load a use case template from markdown content.
 *
 * @param content - Raw markdown content with YAML frontmatter
 * @param source - Template source (builtin, workspace, community, custom)
 * @returns Parsed UseCaseTemplate
 */
export function loadTemplateFromMarkdown(
  content: string,
  source: TemplateSource = 'workspace'
): UseCaseTemplate {
  const { frontmatter, body } = parseYamlFrontmatter(content)
  const sections = parseMarkdownSections(body)
  return convertToUseCaseTemplate(frontmatter, sections, source)
}

/**
 * Convert a UseCaseTemplate to markdown format.
 *
 * This is useful for exporting templates or generating documentation.
 */
export function templateToMarkdown(template: UseCaseTemplate): string {
  const lines: string[] = ['---']

  // Identity
  lines.push(`id: ${template.id}`)
  lines.push(`name: "${template.name}"`)
  lines.push(`description: "${template.description.replace(/"/g, '\\"')}"`)
  lines.push(`category: ${template.category}`)
  lines.push(`version: ${template.version}`)

  // Display
  if (template.icon) lines.push(`icon: "${template.icon}"`)
  if (template.tags?.length) lines.push(`tags: [${template.tags.map((t) => `"${t}"`).join(', ')}]`)
  if (template.maturity) lines.push(`maturity: ${template.maturity}`)

  // Parameters section
  if (template.requiredParameters.length > 0 || template.optionalParameters.length > 0) {
    lines.push('\nparameters:')
    if (template.requiredParameters.length > 0) {
      lines.push('  required:')
      for (const p of template.requiredParameters) {
        lines.push(`    - id: ${p.id}`)
        lines.push(`      name: "${p.name}"`)
        lines.push(`      type: ${p.type}`)
        lines.push(`      description: "${p.description.replace(/"/g, '\\"')}"`)
        if (p.default !== undefined) {
          if (typeof p.default === 'string') {
            lines.push(`      default: "${p.default}"`)
          } else {
            lines.push(`      default: ${JSON.stringify(p.default)}`)
          }
        }
        if (p.placeholder) lines.push(`      placeholder: "${p.placeholder}"`)
        if (p.options?.length) {
          lines.push('      options:')
          for (const opt of p.options) {
            lines.push(`        - { label: "${opt.label}", value: "${opt.value}"${opt.description ? `, description: "${opt.description}"` : ''} }`)
          }
        }
        if (p.group) lines.push(`      group: ${p.group}`)
        if (p.order !== undefined) lines.push(`      order: ${p.order}`)
      }
    }
    if (template.optionalParameters.length > 0) {
      lines.push('  optional:')
      for (const p of template.optionalParameters) {
        lines.push(`    - id: ${p.id}`)
        lines.push(`      name: "${p.name}"`)
        lines.push(`      type: ${p.type}`)
        lines.push(`      description: "${p.description.replace(/"/g, '\\"')}"`)
        if (p.default !== undefined) {
          if (typeof p.default === 'string') {
            lines.push(`      default: "${p.default}"`)
          } else {
            lines.push(`      default: ${JSON.stringify(p.default)}`)
          }
        }
        if (p.placeholder) lines.push(`      placeholder: "${p.placeholder}"`)
        if (p.options?.length) {
          lines.push('      options:')
          for (const opt of p.options) {
            lines.push(`        - { label: "${opt.label}", value: "${opt.value}"${opt.description ? `, description: "${opt.description}"` : ''} }`)
          }
        }
        if (p.group) lines.push(`      group: ${p.group}`)
        if (p.order !== undefined) lines.push(`      order: ${p.order}`)
      }
    }
  }

  // Parallelization
  if (template.parallelization) {
    lines.push('\nparallelization:')
    const p = template.parallelization
    if (p.maxConcurrentTasks !== undefined) lines.push(`  maxConcurrentTasks: ${p.maxConcurrentTasks}`)
    if (p.autoDispatch !== undefined) lines.push(`  autoDispatch: ${p.autoDispatch}`)
    if (p.defaultPriority) lines.push(`  defaultPriority: ${p.defaultPriority}`)
    if (p.machineSelectionPolicy) lines.push(`  machineSelectionPolicy: ${p.machineSelectionPolicy}`)
    if (p.requiredMachineLabels?.length) lines.push(`  requiredMachineLabels: [${p.requiredMachineLabels.map((l) => `"${l}"`).join(', ')}]`)
    if (p.retry) {
      lines.push('  retry:')
      lines.push(`    maxRetries: ${p.retry.maxRetries}`)
      lines.push(`    retryDelayMs: ${p.retry.retryDelayMs}`)
      lines.push(`    exponentialBackoff: ${p.retry.exponentialBackoff}`)
    }
  }

  // Execution
  if (template.execution) {
    lines.push('\nexecution:')
    const e = template.execution
    if (e.preferredModel) lines.push(`  preferredModel: ${e.preferredModel}`)
    if (e.maxTurns !== undefined) lines.push(`  maxTurns: ${e.maxTurns}`)
    if (e.maxBudgetPerTask !== undefined) lines.push(`  maxBudgetPerTask: ${e.maxBudgetPerTask}`)
    if (e.skills?.length) lines.push(`  skills: [${e.skills.map((s) => `"${s}"`).join(', ')}]`)
    if (e.deliveryMode) lines.push(`  deliveryMode: ${e.deliveryMode}`)
    if (e.skipSafetyCheck !== undefined) lines.push(`  skipSafetyCheck: ${e.skipSafetyCheck}`)
    if (e.defaultVerification) lines.push(`  defaultVerification: ${e.defaultVerification}`)
  }

  // Plan hints
  if (template.planHints) {
    lines.push('\nplanHints:')
    const h = template.planHints
    if (h.targetNodeCount) lines.push(`  targetNodeCount: { min: ${h.targetNodeCount.min}, max: ${h.targetNodeCount.max} }`)
    if (h.defaultEstimate) lines.push(`  defaultEstimate: ${h.defaultEstimate}`)
    if (h.preferParallelTasks !== undefined) lines.push(`  preferParallelTasks: ${h.preferParallelTasks}`)
    if (h.commonLabels?.length) lines.push(`  commonLabels: [${h.commonLabels.map((l) => `"${l}"`).join(', ')}]`)
    if (h.suggestedMilestones?.length) {
      lines.push('  suggestedMilestones:')
      for (const m of h.suggestedMilestones) {
        lines.push(`    - { title: "${m.title}", description: "${m.description.replace(/"/g, '\\"')}" }`)
      }
    }
  }

  // Relationships
  if (template.domains?.length) lines.push(`\ndomains: [${template.domains.map((d) => `"${d}"`).join(', ')}]`)
  if (template.recommendedSkills?.length) lines.push(`recommendedSkills: [${template.recommendedSkills.map((s) => `"${s}"`).join(', ')}]`)
  if (template.extends) lines.push(`extends: ${template.extends}`)

  // Metadata
  lines.push(`\nsource: ${template.source}`)
  lines.push(`enabled: ${template.enabled}`)
  if (template.author) lines.push(`author: "${template.author}"`)
  if (template.homepage) lines.push(`homepage: ${template.homepage}`)

  lines.push('---\n')

  // Markdown body with prompt sections
  lines.push(`# ${template.name}\n`)

  if (template.prompts.planGeneration) {
    lines.push('## Plan Generation Prompt\n')
    lines.push(template.prompts.planGeneration)
    lines.push('')
  }

  if (template.prompts.taskExecution) {
    lines.push('## Task Execution Prompt\n')
    lines.push(template.prompts.taskExecution)
    lines.push('')
  }

  if (template.prompts.planRefinement) {
    lines.push('## Plan Refinement Prompt\n')
    lines.push(template.prompts.planRefinement)
    lines.push('')
  }

  if (template.prompts.sharedContext) {
    lines.push('## Shared Context\n')
    lines.push(template.prompts.sharedContext)
    lines.push('')
  }

  return lines.join('\n')
}
