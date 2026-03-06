/**
 * Use Case Templates API Routes
 *
 * Provides endpoints for listing, viewing, and launching use case templates.
 * Templates are pre-configured project patterns that generate plans automatically.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import crypto from 'crypto'
import { db } from '../lib/db/index.js'
import { projects, customTemplates } from '../lib/db/schema.js'
import { eq, and, or, isNull, desc } from 'drizzle-orm'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import {
  // Built-in templates
  BUILTIN_TEMPLATES,
  getTemplateById,
  getTemplatesByCategory,

  // Validation
  validateTemplate,

  // Types
  type UseCaseTemplate,
  type UseCaseTemplateSummary,
  type UseCaseParameter,
  type ResolvedParameters,
} from '../../packages/core/src/templates/index.js'

// ============================================================================
// Parameter Validation
// ============================================================================

/**
 * Validation error for a single parameter
 */
interface ParameterValidationError {
  parameterId: string
  message: string
  code: 'MISSING_REQUIRED' | 'INVALID_TYPE' | 'INVALID_VALUE' | 'INVALID_PATTERN' | 'OUT_OF_RANGE'
}

/**
 * Result of validating parameters against a template's schema
 */
interface ParameterValidationResult {
  valid: boolean
  errors: ParameterValidationError[]
  resolvedParameters: ResolvedParameters
}

/**
 * Validate user-provided parameters against a template's parameter schema.
 *
 * @param template - The template definition
 * @param providedParams - User-provided parameter values
 * @returns Validation result with resolved parameters (including defaults)
 */
function validateParameters(
  template: UseCaseTemplate,
  providedParams: Record<string, unknown>
): ParameterValidationResult {
  const errors: ParameterValidationError[] = []
  const resolvedParameters: ResolvedParameters = {}

  const allParameters = [...template.requiredParameters, ...template.optionalParameters]

  for (const param of allParameters) {
    const providedValue = providedParams[param.id]
    const hasValue = providedValue !== undefined && providedValue !== null && providedValue !== ''

    // Check required parameters
    if (param.required && !hasValue) {
      // Check if there's a default value
      if (param.default !== undefined) {
        resolvedParameters[param.id] = param.default as string | number | boolean | string[]
        continue
      }

      // Check visibility condition - skip if conditionally hidden
      if (param.visibleWhen) {
        const conditionParam = providedParams[param.visibleWhen.parameterId]
        const conditionMet = evaluateCondition(param.visibleWhen, conditionParam)
        if (!conditionMet) {
          continue
        }
      }

      errors.push({
        parameterId: param.id,
        message: `Required parameter "${param.name}" is missing`,
        code: 'MISSING_REQUIRED',
      })
      continue
    }

    // Use default if not provided
    if (!hasValue) {
      if (param.default !== undefined) {
        resolvedParameters[param.id] = param.default as string | number | boolean | string[]
      }
      continue
    }

    // Type validation
    const typeError = validateParameterType(param, providedValue)
    if (typeError) {
      errors.push(typeError)
      continue
    }

    // Value validation (pattern, min/max, etc.)
    const valueError = validateParameterValue(param, providedValue)
    if (valueError) {
      errors.push(valueError)
      continue
    }

    // Store the resolved value
    resolvedParameters[param.id] = providedValue as string | number | boolean | string[]
  }

  return {
    valid: errors.length === 0,
    errors,
    resolvedParameters,
  }
}

/**
 * Evaluate a parameter visibility condition
 */
function evaluateCondition(
  condition: NonNullable<UseCaseParameter['visibleWhen']>,
  conditionValue: unknown
): boolean {
  switch (condition.operator) {
    case 'equals':
      return conditionValue === condition.value
    case 'not-equals':
      return conditionValue !== condition.value
    case 'contains':
      if (Array.isArray(conditionValue)) {
        return conditionValue.includes(condition.value)
      }
      if (typeof conditionValue === 'string') {
        return conditionValue.includes(String(condition.value))
      }
      return false
    case 'not-empty':
      return conditionValue !== undefined && conditionValue !== null && conditionValue !== ''
    default:
      return true
  }
}

/**
 * Validate parameter type
 */
function validateParameterType(
  param: UseCaseParameter,
  value: unknown
): ParameterValidationError | null {
  switch (param.type) {
    case 'string':
    case 'file-path':
    case 'code':
      if (typeof value !== 'string') {
        return {
          parameterId: param.id,
          message: `Parameter "${param.name}" must be a string`,
          code: 'INVALID_TYPE',
        }
      }
      break

    case 'number':
      if (typeof value !== 'number' && isNaN(Number(value))) {
        return {
          parameterId: param.id,
          message: `Parameter "${param.name}" must be a number`,
          code: 'INVALID_TYPE',
        }
      }
      break

    case 'boolean':
      if (typeof value !== 'boolean') {
        return {
          parameterId: param.id,
          message: `Parameter "${param.name}" must be a boolean`,
          code: 'INVALID_TYPE',
        }
      }
      break

    case 'select':
      if (typeof value !== 'string') {
        return {
          parameterId: param.id,
          message: `Parameter "${param.name}" must be a string`,
          code: 'INVALID_TYPE',
        }
      }
      // Validate option exists
      if (param.options && !param.options.some(opt => opt.value === value)) {
        return {
          parameterId: param.id,
          message: `Invalid option for "${param.name}". Valid options: ${param.options.map(o => o.value).join(', ')}`,
          code: 'INVALID_VALUE',
        }
      }
      break

    case 'multi-select':
      if (!Array.isArray(value)) {
        return {
          parameterId: param.id,
          message: `Parameter "${param.name}" must be an array`,
          code: 'INVALID_TYPE',
        }
      }
      // Validate all options exist
      if (param.options) {
        const validValues = param.options.map(o => o.value)
        const invalidValues = (value as string[]).filter(v => !validValues.includes(v))
        if (invalidValues.length > 0) {
          return {
            parameterId: param.id,
            message: `Invalid options for "${param.name}": ${invalidValues.join(', ')}`,
            code: 'INVALID_VALUE',
          }
        }
      }
      break
  }

  return null
}

/**
 * Validate parameter value against validation constraints
 */
function validateParameterValue(
  param: UseCaseParameter,
  value: unknown
): ParameterValidationError | null {
  if (!param.validation) {
    return null
  }

  const { min, max, pattern, message } = param.validation

  // String length validation
  if ((param.type === 'string' || param.type === 'code' || param.type === 'file-path') && typeof value === 'string') {
    if (min !== undefined && value.length < min) {
      return {
        parameterId: param.id,
        message: message || `Parameter "${param.name}" must be at least ${min} characters`,
        code: 'OUT_OF_RANGE',
      }
    }
    if (max !== undefined && value.length > max) {
      return {
        parameterId: param.id,
        message: message || `Parameter "${param.name}" must be at most ${max} characters`,
        code: 'OUT_OF_RANGE',
      }
    }
    if (pattern) {
      const regex = new RegExp(pattern)
      if (!regex.test(value)) {
        return {
          parameterId: param.id,
          message: message || `Parameter "${param.name}" does not match required pattern`,
          code: 'INVALID_PATTERN',
        }
      }
    }
  }

  // Number range validation
  if (param.type === 'number') {
    const numValue = typeof value === 'number' ? value : Number(value)
    if (min !== undefined && numValue < min) {
      return {
        parameterId: param.id,
        message: message || `Parameter "${param.name}" must be at least ${min}`,
        code: 'OUT_OF_RANGE',
      }
    }
    if (max !== undefined && numValue > max) {
      return {
        parameterId: param.id,
        message: message || `Parameter "${param.name}" must be at most ${max}`,
        code: 'OUT_OF_RANGE',
      }
    }
  }

  return null
}

/**
 * Interpolate template parameters into a prompt string.
 * Uses {{paramName}} mustache-style placeholders.
 */
function interpolatePrompt(prompt: string, parameters: ResolvedParameters): string {
  let result = prompt
  for (const [key, value] of Object.entries(parameters)) {
    const placeholder = `{{${key}}}`
    const stringValue = Array.isArray(value) ? value.join(', ') : String(value)
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), stringValue)
  }
  return result
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert a template to a summary (for list views)
 */
function toSummary(template: UseCaseTemplate): UseCaseTemplateSummary {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    icon: template.icon,
    tags: template.tags,
    maturity: template.maturity,
    source: template.source,
    domains: template.domains,
    parameterCount: template.requiredParameters.length + template.optionalParameters.length,
    version: template.version,
  }
}

// ============================================================================
// Zod Schemas
// ============================================================================

const launchTemplateSchema = z.object({
  // Parameters to pass to the template
  parameters: z.record(z.string(), z.unknown()).default({}),

  // Optional project configuration overrides
  projectName: z.string().max(200).optional(),
  workingDirectory: z.string().max(1000).refine(
    (path) => !path.includes('..'),
    { message: 'Path traversal not allowed' }
  ).optional(),

  // Machine targeting (for plan generation)
  targetMachineId: z.string().max(100).optional(),

  // Optional vision doc override (e.g. skill instructions from recommended skills)
  // When provided, this becomes the project's visionDoc instead of the interpolated template prompt
  visionDoc: z.string().max(500000).optional(),

  // Model / provider preferences
  model: z.string().max(100).optional(),
  preferredProvider: z.string().max(100).optional(),

  // Repository context (sent from client)
  fileTree: z.array(z.string().max(1000)).max(10000).optional(),
  keyFiles: z.object({
    claudeMd: z.string().max(100000).optional(),
    readmeMd: z.string().max(100000).optional(),
    packageInfo: z.string().max(100000).optional(),
  }).optional(),
  gitState: z.object({
    currentBranch: z.string().max(200),
    targetBranch: z.string().max(200),
    isDirty: z.boolean(),
    dirtyDetails: z.object({
      staged: z.number(),
      unstaged: z.number(),
      untracked: z.number(),
    }).optional(),
  }).optional(),
})

// ============================================================================
// Routes
// ============================================================================

const templatesRoute = new Hono()

// Apply authentication middleware to all routes
templatesRoute.use('/*', requireAuth)

/**
 * GET /api/templates
 *
 * List all available use case templates.
 * Returns template summaries (not full definitions) for efficient listing.
 * Merges built-in templates with user's custom templates.
 *
 * Query parameters:
 * - category: Filter by category
 * - enabled: Filter by enabled status (default: true)
 * - source: Filter by source ('builtin' | 'custom' | 'all', default: 'all')
 */
templatesRoute.get('/', async (c) => {
  const user = c.get('user')! as AuthUser
  const category = c.req.query('category')
  const enabledParam = c.req.query('enabled')
  const sourceFilter = c.req.query('source') || 'all'
  const enabled = enabledParam === undefined ? true : enabledParam === 'true'

  let templates: UseCaseTemplate[] = []

  // Fetch built-in templates
  if (sourceFilter === 'all' || sourceFilter === 'builtin') {
    if (category) {
      templates = getTemplatesByCategory(category)
    } else {
      templates = [...BUILTIN_TEMPLATES]
    }
  }

  // Fetch custom templates from database
  if (sourceFilter === 'all' || sourceFilter === 'custom') {
    const customTemplateRows = await db.select().from(customTemplates).where(
      and(
        or(
          eq(customTemplates.authorId, user.id),
          user.teamId ? eq(customTemplates.teamId, user.teamId) : isNull(customTemplates.teamId)
        ),
        category ? eq(customTemplates.category, category) : undefined
      )
    ).orderBy(desc(customTemplates.updatedAt))

    // Convert custom templates to UseCaseTemplate format
    const customTemplatesFormatted = customTemplateRows.map(row => dbRowToTemplate(row))
    templates = [...templates, ...customTemplatesFormatted]
  }

  // Filter by enabled status
  if (enabled !== undefined) {
    templates = templates.filter(t => t.enabled === enabled)
  }

  // Convert to summaries
  const summaries = templates.map(toSummary)

  return c.json({
    templates: summaries,
    count: summaries.length,
    categories: [...new Set(templates.map(t => t.category))],
  })
})

/**
 * GET /api/templates/categories
 *
 * List all available template categories with counts.
 * Includes both built-in and custom templates.
 */
templatesRoute.get('/categories', async (c) => {
  const user = c.get('user')! as AuthUser
  const categoryCounts: Record<string, number> = {}
  const categoryTemplates: Record<string, Array<{ id: string; name: string; icon?: string }>> = {}

  // Count built-in templates
  for (const template of BUILTIN_TEMPLATES) {
    if (template.enabled) {
      categoryCounts[template.category] = (categoryCounts[template.category] || 0) + 1
      if (!categoryTemplates[template.category]) {
        categoryTemplates[template.category] = []
      }
      categoryTemplates[template.category].push({ id: template.id, name: template.name, icon: template.icon })
    }
  }

  // Count custom templates
  const customRows = await db.select().from(customTemplates).where(
    and(
      eq(customTemplates.enabled, true),
      or(
        eq(customTemplates.authorId, user.id),
        user.teamId ? eq(customTemplates.teamId, user.teamId) : isNull(customTemplates.teamId)
      )
    )
  )

  for (const row of customRows) {
    categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1
    if (!categoryTemplates[row.category]) {
      categoryTemplates[row.category] = []
    }
    categoryTemplates[row.category].push({
      id: `custom/${row.id}`,
      name: row.name,
      icon: row.icon ?? undefined,
    })
  }

  const categories = Object.entries(categoryCounts).map(([category, count]) => ({
    category,
    count,
    templates: categoryTemplates[category] || [],
  }))

  return c.json({ categories })
})

/**
 * GET /api/templates/:id
 *
 * Get full template details including parameter schema.
 * Returns the complete template definition for rendering the parameter form.
 * Supports both built-in and custom templates (custom templates have 'custom/' prefix).
 */
templatesRoute.get('/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const templateId = c.req.param('id')
  // Decode URL-encoded template IDs (e.g., "custom%2Fuuid" -> "custom/uuid")
  const decodedId = decodeURIComponent(templateId)

  // Check if this is a custom template
  if (decodedId.startsWith('custom/')) {
    const customId = decodedId.replace('custom/', '')
    const [row] = await db.select().from(customTemplates).where(
      and(
        eq(customTemplates.id, customId),
        or(
          eq(customTemplates.authorId, user.id),
          user.teamId ? eq(customTemplates.teamId, user.teamId) : isNull(customTemplates.teamId)
        )
      )
    )

    if (!row) {
      return c.json({ error: 'Template not found', templateId: decodedId }, 404)
    }

    const template = dbRowToTemplate(row)
    return c.json({
      template,
      validation: { valid: true, errors: [], warnings: [] },
      isOwner: row.authorId === user.id,
      canEdit: row.authorId === user.id || (row.teamId && row.teamId === user.teamId),
    })
  }

  // Look up built-in template
  const template = getTemplateById(decodedId)

  if (!template) {
    return c.json({ error: 'Template not found', templateId: decodedId }, 404)
  }

  return c.json({
    template,
    // Include validation result for the template itself
    validation: validateTemplate(template),
  })
})

templatesRoute.post('/:id/validate', async (c) => {
  const user = c.get('user')! as AuthUser
  const templateId = c.req.param('id')
  const decodedId = decodeURIComponent(templateId)

  const template = await getTemplateByIdWithCustom(decodedId, user)

  if (!template) {
    return c.json({ error: 'Template not found', templateId: decodedId }, 404)
  }

  let body: { parameters: Record<string, unknown> }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const validationResult = validateParameters(template, body.parameters || {})

  return c.json({
    valid: validationResult.valid,
    errors: validationResult.errors,
    resolvedParameters: validationResult.resolvedParameters,
  })
})

/**
 * POST /api/templates/:id/launch
 *
 * Launch a use case with provided parameters.
 * Creates a new project and triggers plan generation.
 * Supports both built-in and custom templates.
 *
 * Returns:
 * - project: The created project
 * - resolvedParameters: Parameters with defaults applied
 * - generatedPrompt: The interpolated plan generation prompt (for debugging)
 *
 * The client uses the returned data to prefill the Plan page,
 * then starts an interactive plan session (Pathway 3) via dispatch.
 */
templatesRoute.post('/:id/launch', async (c) => {
  const user = c.get('user')! as AuthUser
  const templateId = c.req.param('id')
  const decodedId = decodeURIComponent(templateId)

  const template = await getTemplateByIdWithCustom(decodedId, user)

  if (!template) {
    return c.json({ error: 'Template not found', templateId: decodedId }, 404)
  }

  if (!template.enabled) {
    return c.json({ error: 'Template is disabled', templateId: decodedId }, 400)
  }

  // Parse and validate request body
  let body: z.infer<typeof launchTemplateSchema>
  try {
    const rawBody = await c.req.json()
    body = launchTemplateSchema.parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Validate parameters against template schema
  const paramValidation = validateParameters(template, body.parameters)

  if (!paramValidation.valid) {
    return c.json({
      error: 'Parameter validation failed',
      details: paramValidation.errors,
    }, 400)
  }

  const resolvedParams = paramValidation.resolvedParameters

  // Generate project name from template or parameters
  const projectName = body.projectName ||
    (resolvedParams['appName'] as string) ||
    (resolvedParams['projectName'] as string) ||
    `${template.name} Project`

  // Generate the description from the template prompt with interpolated parameters
  const generatedDescription = interpolatePrompt(template.prompts.planGeneration, resolvedParams)

  // Add shared context if available
  const fullDescription = template.prompts.sharedContext
    ? `${template.prompts.sharedContext}\n\n---\n\n${generatedDescription}`
    : generatedDescription

  // Create the project
  const projectId = crypto.randomUUID()
  const now = new Date()

  // Vision doc: use client-provided visionDoc (e.g. skill instructions) if present,
  // otherwise fall back to the interpolated template prompt
  const projectVisionDoc = body.visionDoc || fullDescription

  const projectData = {
    id: projectId,
    ownerId: user.id,
    teamId: user.teamId,
    name: projectName,
    description: (resolvedParams['appDescription'] as string) ||
      (resolvedParams['description'] as string) ||
      template.description,
    visionDoc: projectVisionDoc,
    status: 'active' as const,
    icon: template.icon || '📋',
    workingDirectory: body.workingDirectory || null,
    source: {
      type: 'template' as const,
      templateId: template.id,
      templateVersion: template.version,
      parameters: resolvedParams,
      launchedAt: now.toISOString(),
    },
    deliveryMode: template.execution?.deliveryMode || null,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await db.insert(projects).values(projectData)
  } catch (err) {
    console.error('[templates] Failed to create project:', err)
    return c.json({ error: 'Failed to create project' }, 500)
  }

  // Fetch the created project
  const [createdProject] = await db.select().from(projects).where(eq(projects.id, projectId))

  // Prepare the plan generation request
  const planGenerationRequest = {
    projectId,
    description: fullDescription,
    visionDoc: fullDescription,
    model: body.model,
    preferredProvider: body.preferredProvider,
    workingDirectory: body.workingDirectory,
    targetMachineId: body.targetMachineId,
    fileTree: body.fileTree,
    keyFiles: body.keyFiles,
    gitState: body.gitState,
  }

  return c.json({
    project: createdProject,
    templateUsed: {
      id: template.id,
      name: template.name,
      version: template.version,
    },
    resolvedParameters: resolvedParams,
    // Include plan generation hints
    planHints: template.planHints,
    // Include execution config for the dispatch engine
    executionConfig: template.execution,
    parallelizationConfig: template.parallelization,
    // The client uses this to prefill the Plan page for interactive planning
    planGenerationRequest,
  }, 201)
})

/**
 * POST /api/templates/:id/preview
 *
 * Preview what a template launch would produce without actually creating anything.
 * Returns the interpolated prompts and project configuration.
 * Supports both built-in and custom templates.
 */
templatesRoute.post('/:id/preview', async (c) => {
  const user = c.get('user')! as AuthUser
  const templateId = c.req.param('id')
  const decodedId = decodeURIComponent(templateId)

  const template = await getTemplateByIdWithCustom(decodedId, user)

  if (!template) {
    return c.json({ error: 'Template not found', templateId: decodedId }, 404)
  }

  let body: { parameters: Record<string, unknown> }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Validate parameters
  const paramValidation = validateParameters(template, body.parameters || {})

  if (!paramValidation.valid) {
    return c.json({
      error: 'Parameter validation failed',
      details: paramValidation.errors,
    }, 400)
  }

  const resolvedParams = paramValidation.resolvedParameters

  // Generate interpolated prompts
  const interpolatedPrompts = {
    planGeneration: interpolatePrompt(template.prompts.planGeneration, resolvedParams),
    taskExecution: template.prompts.taskExecution
      ? interpolatePrompt(template.prompts.taskExecution, resolvedParams)
      : undefined,
    planRefinement: template.prompts.planRefinement
      ? interpolatePrompt(template.prompts.planRefinement, resolvedParams)
      : undefined,
    sharedContext: template.prompts.sharedContext
      ? interpolatePrompt(template.prompts.sharedContext, resolvedParams)
      : undefined,
  }

  return c.json({
    templateId: template.id,
    templateName: template.name,
    resolvedParameters: resolvedParams,
    interpolatedPrompts,
    planHints: template.planHints,
    executionConfig: template.execution,
    parallelizationConfig: template.parallelization,
  })
})
// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert a database row to a UseCaseTemplate
 */
function dbRowToTemplate(row: typeof customTemplates.$inferSelect): UseCaseTemplate {
  return {
    id: `custom/${row.id}`,
    name: row.name,
    description: row.description,
    category: row.category as UseCaseTemplate['category'],
    version: row.version,
    icon: row.icon ?? undefined,
    tags: row.tags ?? [],
    maturity: (row.maturity as UseCaseTemplate['maturity']) ?? 'stable',
    requiredParameters: (row.requiredParameters ?? []) as UseCaseParameter[],
    optionalParameters: (row.optionalParameters ?? []) as UseCaseParameter[],
    prompts: row.prompts as UseCaseTemplate['prompts'],
    execution: row.execution as UseCaseTemplate['execution'],
    parallelization: row.parallelization as UseCaseTemplate['parallelization'],
    planHints: row.planHints as UseCaseTemplate['planHints'],
    source: 'custom',
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Get a template by ID, supporting both built-in and custom templates.
 * Custom templates have IDs prefixed with 'custom/'.
 */
async function getTemplateByIdWithCustom(decodedId: string, user: AuthUser): Promise<UseCaseTemplate | undefined> {
  // Check if this is a custom template
  if (decodedId.startsWith('custom/')) {
    const customId = decodedId.replace('custom/', '')
    const [row] = await db.select().from(customTemplates).where(
      and(
        eq(customTemplates.id, customId),
        or(
          eq(customTemplates.authorId, user.id),
          user.teamId ? eq(customTemplates.teamId, user.teamId) : isNull(customTemplates.teamId)
        )
      )
    )

    if (row) {
      return dbRowToTemplate(row)
    }
    return undefined
  }

  // Look up built-in template
  return getTemplateById(decodedId)
}


export { templatesRoute }
