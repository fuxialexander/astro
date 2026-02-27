/**
 * Template Validator
 *
 * Validates use case templates against the schema and provides
 * helpful error messages for template authors.
 */

import type {
  UseCaseTemplate,
  UseCaseParameter,
  TemplateValidationResult,
  TemplateValidationError,
  TemplateValidationWarning,
} from '../types/use-case-template.js'

// ============================================================================
// Validation Constants
// ============================================================================

const VALID_CATEGORIES = [
  'software-development',
  'data-science',
  'machine-learning',
  'devops-infrastructure',
  'research-analysis',
  'documentation',
  'testing-qa',
  'security',
  'computational-biology',
  'custom',
] as const

const VALID_PARAMETER_TYPES = [
  'string',
  'number',
  'boolean',
  'select',
  'multi-select',
  'file-path',
  'code',
] as const

const VALID_MATURITY_LEVELS = ['stable', 'beta', 'experimental'] as const
const VALID_SOURCES = ['builtin', 'workspace', 'community', 'custom'] as const
const VALID_PRIORITIES = ['critical', 'high', 'normal', 'low'] as const
const VALID_ESTIMATES = ['XS', 'S', 'M', 'L', 'XL'] as const
const VALID_DELIVERY_MODES = ['pr', 'push', 'branch', 'copy', 'direct'] as const
const VALID_VERIFICATION_MODES = ['auto', 'human', 'mixed'] as const
const VALID_MACHINE_POLICIES = ['round-robin', 'priority', 'least-loaded', 'manual', 'label-match'] as const

const ID_PATTERN = /^[a-z0-9][a-z0-9-/]*[a-z0-9]$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const PARAMETER_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validate a use case template.
 *
 * @param template - The template to validate
 * @param knownTemplateIds - Set of known template IDs (for extends validation)
 * @returns Validation result with errors and warnings
 */
export function validateTemplate(
  template: Partial<UseCaseTemplate>,
  knownTemplateIds: Set<string> = new Set()
): TemplateValidationResult {
  const errors: TemplateValidationError[] = []
  const warnings: TemplateValidationWarning[] = []

  // ── Required Fields ───────────────────────────────────────────────────
  if (!template.id) {
    errors.push({
      path: 'id',
      message: 'Template ID is required',
      code: 'MISSING_REQUIRED',
    })
  } else {
    if (template.id.length < 2) {
      errors.push({
        path: 'id',
        message: 'Template ID must be at least 2 characters',
        code: 'INVALID_VALUE',
      })
    }
    if (!ID_PATTERN.test(template.id)) {
      errors.push({
        path: 'id',
        message: 'Template ID must be kebab-case (e.g., "astro/web-app")',
        code: 'INVALID_VALUE',
      })
    }
  }

  if (!template.name) {
    errors.push({
      path: 'name',
      message: 'Template name is required',
      code: 'MISSING_REQUIRED',
    })
  } else if (template.name.length < 2 || template.name.length > 80) {
    errors.push({
      path: 'name',
      message: 'Template name must be 2-80 characters',
      code: 'INVALID_VALUE',
    })
  }

  if (!template.description) {
    errors.push({
      path: 'description',
      message: 'Template description is required',
      code: 'MISSING_REQUIRED',
    })
  } else if (template.description.length < 10 || template.description.length > 2000) {
    errors.push({
      path: 'description',
      message: 'Template description must be 10-2000 characters',
      code: 'INVALID_VALUE',
    })
  }

  if (!template.category) {
    errors.push({
      path: 'category',
      message: 'Template category is required',
      code: 'MISSING_REQUIRED',
    })
  } else if (!(VALID_CATEGORIES as readonly string[]).includes(template.category)) {
    errors.push({
      path: 'category',
      message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
      code: 'INVALID_VALUE',
    })
  }

  if (!template.version) {
    errors.push({
      path: 'version',
      message: 'Template version is required',
      code: 'MISSING_REQUIRED',
    })
  } else if (!VERSION_PATTERN.test(template.version)) {
    errors.push({
      path: 'version',
      message: 'Version must be semver format (e.g., "1.0.0")',
      code: 'INVALID_VALUE',
    })
  }

  // ── Optional Fields Validation ────────────────────────────────────────
  if (template.maturity && !(VALID_MATURITY_LEVELS as readonly string[]).includes(template.maturity)) {
    errors.push({
      path: 'maturity',
      message: `Invalid maturity level. Must be one of: ${VALID_MATURITY_LEVELS.join(', ')}`,
      code: 'INVALID_VALUE',
    })
  }

  if (template.source && !(VALID_SOURCES as readonly string[]).includes(template.source)) {
    errors.push({
      path: 'source',
      message: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`,
      code: 'INVALID_VALUE',
    })
  }

  // ── Parameters Validation ─────────────────────────────────────────────
  const parameterIds = new Set<string>()

  if (template.requiredParameters) {
    template.requiredParameters.forEach((param, index) => {
      const paramErrors = validateParameter(param, `requiredParameters[${index}]`, parameterIds)
      errors.push(...paramErrors.errors)
      warnings.push(...paramErrors.warnings)
    })
  }

  if (template.optionalParameters) {
    template.optionalParameters.forEach((param, index) => {
      const paramErrors = validateParameter(param, `optionalParameters[${index}]`, parameterIds)
      errors.push(...paramErrors.errors)
      warnings.push(...paramErrors.warnings)
    })
  }

  // ── Prompts Validation ────────────────────────────────────────────────
  if (!template.prompts) {
    errors.push({
      path: 'prompts',
      message: 'Prompts configuration is required',
      code: 'MISSING_REQUIRED',
    })
  } else {
    if (!template.prompts.planGeneration) {
      errors.push({
        path: 'prompts.planGeneration',
        message: 'Plan generation prompt is required',
        code: 'MISSING_REQUIRED',
      })
    } else if (template.prompts.planGeneration.length < 50) {
      warnings.push({
        path: 'prompts.planGeneration',
        message: 'Plan generation prompt is very short — consider adding more guidance',
        code: 'EMPTY_PROMPT',
      })
    }

    // Validate parameter references in prompts
    const allPromptText = [
      template.prompts.planGeneration || '',
      template.prompts.taskExecution || '',
      template.prompts.planRefinement || '',
      template.prompts.sharedContext || '',
    ].join(' ')

    const referencedParams = Array.from(allPromptText.matchAll(/\{\{(\w+)\}\}/g)).map((m) => m[1])
    const builtinParams = ['projectName', 'visionDoc', 'repoContext', 'gitState', 'timestamp', 'userName']

    for (const ref of referencedParams) {
      if (!parameterIds.has(ref) && !builtinParams.includes(ref)) {
        warnings.push({
          path: 'prompts',
          message: `Prompt references unknown parameter "{{${ref}}}"`,
          code: 'MISSING_DESCRIPTION',
        })
      }
    }
  }

  // ── Parallelization Validation ────────────────────────────────────────
  if (template.parallelization) {
    const p = template.parallelization
    if (p.maxConcurrentTasks !== undefined && (p.maxConcurrentTasks < 1 || p.maxConcurrentTasks > 50)) {
      errors.push({
        path: 'parallelization.maxConcurrentTasks',
        message: 'maxConcurrentTasks must be between 1 and 50',
        code: 'INVALID_VALUE',
      })
    }
    if (p.defaultPriority && !(VALID_PRIORITIES as readonly string[]).includes(p.defaultPriority)) {
      errors.push({
        path: 'parallelization.defaultPriority',
        message: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`,
        code: 'INVALID_VALUE',
      })
    }
    if (p.machineSelectionPolicy && !(VALID_MACHINE_POLICIES as readonly string[]).includes(p.machineSelectionPolicy)) {
      errors.push({
        path: 'parallelization.machineSelectionPolicy',
        message: `Invalid machine selection policy. Must be one of: ${VALID_MACHINE_POLICIES.join(', ')}`,
        code: 'INVALID_VALUE',
      })
    }
  }

  // ── Execution Validation ──────────────────────────────────────────────
  if (template.execution) {
    const e = template.execution
    if (e.maxTurns !== undefined && (e.maxTurns < 1 || e.maxTurns > 200)) {
      errors.push({
        path: 'execution.maxTurns',
        message: 'maxTurns must be between 1 and 200',
        code: 'INVALID_VALUE',
      })
    }
    if (e.maxBudgetPerTask !== undefined && (e.maxBudgetPerTask < 0.01 || e.maxBudgetPerTask > 100)) {
      errors.push({
        path: 'execution.maxBudgetPerTask',
        message: 'maxBudgetPerTask must be between $0.01 and $100',
        code: 'INVALID_VALUE',
      })
    }
    if (e.deliveryMode && !(VALID_DELIVERY_MODES as readonly string[]).includes(e.deliveryMode)) {
      errors.push({
        path: 'execution.deliveryMode',
        message: `Invalid delivery mode. Must be one of: ${VALID_DELIVERY_MODES.join(', ')}`,
        code: 'INVALID_VALUE',
      })
    }
    if (e.defaultVerification && !(VALID_VERIFICATION_MODES as readonly string[]).includes(e.defaultVerification)) {
      errors.push({
        path: 'execution.defaultVerification',
        message: `Invalid verification mode. Must be one of: ${VALID_VERIFICATION_MODES.join(', ')}`,
        code: 'INVALID_VALUE',
      })
    }
  }

  // ── Plan Hints Validation ─────────────────────────────────────────────
  if (template.planHints) {
    const h = template.planHints
    if (h.targetNodeCount) {
      if (h.targetNodeCount.min < 3 || h.targetNodeCount.min > 50) {
        errors.push({
          path: 'planHints.targetNodeCount.min',
          message: 'targetNodeCount.min must be between 3 and 50',
          code: 'INVALID_VALUE',
        })
      }
      if (h.targetNodeCount.max < 3 || h.targetNodeCount.max > 50) {
        errors.push({
          path: 'planHints.targetNodeCount.max',
          message: 'targetNodeCount.max must be between 3 and 50',
          code: 'INVALID_VALUE',
        })
      }
      if (h.targetNodeCount.min > h.targetNodeCount.max) {
        errors.push({
          path: 'planHints.targetNodeCount',
          message: 'targetNodeCount.min cannot be greater than targetNodeCount.max',
          code: 'INVALID_VALUE',
        })
      }
    }
    if (h.defaultEstimate && !(VALID_ESTIMATES as readonly string[]).includes(h.defaultEstimate)) {
      errors.push({
        path: 'planHints.defaultEstimate',
        message: `Invalid estimate. Must be one of: ${VALID_ESTIMATES.join(', ')}`,
        code: 'INVALID_VALUE',
      })
    }
  }

  // ── Extends Validation ────────────────────────────────────────────────
  if (template.extends) {
    if (template.extends === template.id) {
      errors.push({
        path: 'extends',
        message: 'Template cannot extend itself',
        code: 'CIRCULAR_DEPENDENCY',
      })
    }
    if (knownTemplateIds.size > 0 && !knownTemplateIds.has(template.extends)) {
      errors.push({
        path: 'extends',
        message: `Unknown parent template: "${template.extends}"`,
        code: 'INVALID_REFERENCE',
      })
    }
  }

  // ── Size Warnings ─────────────────────────────────────────────────────
  const totalPromptLength = [
    template.prompts?.planGeneration || '',
    template.prompts?.taskExecution || '',
    template.prompts?.planRefinement || '',
    template.prompts?.sharedContext || '',
  ].join('').length

  if (totalPromptLength > 10000) {
    warnings.push({
      path: 'prompts',
      message: 'Total prompt length exceeds 10,000 characters — consider splitting into smaller templates',
      code: 'LARGE_TEMPLATE',
    })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ============================================================================
// Parameter Validation
// ============================================================================

function validateParameter(
  param: Partial<UseCaseParameter>,
  path: string,
  existingIds: Set<string>
): { errors: TemplateValidationError[]; warnings: TemplateValidationWarning[] } {
  const errors: TemplateValidationError[] = []
  const warnings: TemplateValidationWarning[] = []

  // Required fields
  if (!param.id) {
    errors.push({
      path: `${path}.id`,
      message: 'Parameter ID is required',
      code: 'MISSING_REQUIRED',
    })
  } else {
    if (!PARAMETER_ID_PATTERN.test(param.id)) {
      errors.push({
        path: `${path}.id`,
        message: 'Parameter ID must start with a letter and contain only letters, numbers, and underscores',
        code: 'INVALID_VALUE',
      })
    }
    if (existingIds.has(param.id)) {
      errors.push({
        path: `${path}.id`,
        message: `Duplicate parameter ID: "${param.id}"`,
        code: 'DUPLICATE_ID',
      })
    }
    existingIds.add(param.id)
  }

  if (!param.name) {
    errors.push({
      path: `${path}.name`,
      message: 'Parameter name is required',
      code: 'MISSING_REQUIRED',
    })
  }

  if (!param.description) {
    warnings.push({
      path: `${path}.description`,
      message: 'Parameter description is recommended',
      code: 'MISSING_DESCRIPTION',
    })
  }

  if (!param.type) {
    errors.push({
      path: `${path}.type`,
      message: 'Parameter type is required',
      code: 'MISSING_REQUIRED',
    })
  } else if (!(VALID_PARAMETER_TYPES as readonly string[]).includes(param.type)) {
    errors.push({
      path: `${path}.type`,
      message: `Invalid parameter type. Must be one of: ${VALID_PARAMETER_TYPES.join(', ')}`,
      code: 'INVALID_VALUE',
    })
  }

  // Validate select/multi-select have options
  if ((param.type === 'select' || param.type === 'multi-select') && (!param.options || param.options.length === 0)) {
    errors.push({
      path: `${path}.options`,
      message: `${param.type} parameters must have at least one option`,
      code: 'MISSING_REQUIRED',
    })
  }

  // Validate visibleWhen references
  if (param.visibleWhen) {
    if (!param.visibleWhen.parameterId) {
      errors.push({
        path: `${path}.visibleWhen.parameterId`,
        message: 'visibleWhen requires a parameterId',
        code: 'MISSING_REQUIRED',
      })
    }
    if (!param.visibleWhen.operator) {
      errors.push({
        path: `${path}.visibleWhen.operator`,
        message: 'visibleWhen requires an operator',
        code: 'MISSING_REQUIRED',
      })
    }
  }

  return { errors, warnings }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format validation result as a human-readable string.
 */
export function formatValidationResult(result: TemplateValidationResult): string {
  const lines: string[] = []

  if (result.valid) {
    lines.push('✓ Template is valid')
  } else {
    lines.push('✗ Template validation failed')
  }

  if (result.errors.length > 0) {
    lines.push('\nErrors:')
    for (const error of result.errors) {
      lines.push(`  • [${error.code}] ${error.path}: ${error.message}`)
    }
  }

  if (result.warnings.length > 0) {
    lines.push('\nWarnings:')
    for (const warning of result.warnings) {
      lines.push(`  ⚠ [${warning.code}] ${warning.path}: ${warning.message}`)
    }
  }

  return lines.join('\n')
}
