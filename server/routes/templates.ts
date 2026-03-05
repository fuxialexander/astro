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

/**
 * GET /api/templates/:id/schema
 *
 * Get only the parameter schema for a template.
 * Useful for form generation without the full template definition.
 * Supports both built-in and custom templates.
 */
templatesRoute.get('/:id/schema', async (c) => {
  const user = c.get('user')! as AuthUser
  const templateId = c.req.param('id')
  const decodedId = decodeURIComponent(templateId)

  let template: UseCaseTemplate | undefined

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
      template = dbRowToTemplate(row)
    }
  } else {
    template = getTemplateById(decodedId)
  }

  if (!template) {
    return c.json({ error: 'Template not found', templateId: decodedId }, 404)
  }

  return c.json({
    templateId: template.id,
    templateName: template.name,
    requiredParameters: template.requiredParameters,
    optionalParameters: template.optionalParameters,
    // Group parameters by their group field
    parameterGroups: groupParameters(template),
  })
})

/**
 * POST /api/templates/:id/validate
 *
 * Validate parameters against a template's schema without launching.
 * Useful for real-time form validation.
 * Supports both built-in and custom templates.
 */
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
 * The client should then call /api/agent/generate-plan with the project ID
 * and the generated prompt to complete the plan generation.
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
    // The client should call /api/agent/generate-plan with this
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

/**
 * POST /api/templates/:id/apply
 *
 * Apply a template to an existing project.
 * Generates a plan generation request that the frontend can use to add template nodes.
 * Returns the interpolated prompt and metadata for the frontend to call /api/agent/generate-plan.
 * Supports both built-in and custom templates.
 */
templatesRoute.post('/:id/apply', async (c) => {
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

  // Parse request body
  const applySchema = z.object({
    projectId: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  })

  let body: z.infer<typeof applySchema>
  try {
    const rawBody = await c.req.json()
    body = applySchema.parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Verify user has access to the project
  const [project] = await db.select().from(projects).where(
    and(
      eq(projects.id, body.projectId),
      or(
        eq(projects.teamId, user.teamId),
        and(isNull(projects.teamId), eq(projects.ownerId, user.id))
      )
    )
  )

  if (!project) {
    return c.json({ error: 'Project not found or access denied' }, 404)
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

  // Generate the description from the template prompt with interpolated parameters
  const generatedDescription = interpolatePrompt(template.prompts.planGeneration, resolvedParams)

  // Add shared context if available
  const fullDescription = template.prompts.sharedContext
    ? `${interpolatePrompt(template.prompts.sharedContext, resolvedParams)}\n\n---\n\n${generatedDescription}`
    : generatedDescription

  // Prepare the plan generation request (to be used by frontend with /api/agent/generate-plan)
  // The frontend will call generate-plan with appendToExisting: true
  return c.json({
    projectId: project.id,
    description: fullDescription,
    visionDoc: project.visionDoc || undefined,
    resolvedParameters: resolvedParams,
    templateUsed: {
      id: template.id,
      name: template.name,
      version: template.version,
    },
    // Include hints for the frontend
    planHints: template.planHints,
  })
})

// ============================================================================
// Custom Template CRUD Routes
// ============================================================================

/**
 * Zod schema for creating/updating custom templates
 */
const customTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  category: z.string().max(50).default('custom'),
  version: z.string().max(20).default('1.0.0'),
  icon: z.string().max(10).optional(),
  tags: z.array(z.string().max(50)).max(10).default([]),
  maturity: z.enum(['stable', 'beta', 'experimental']).default('stable'),
  enabled: z.boolean().default(true),
  requiredParameters: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    type: z.string(),
    required: z.boolean(),
    default: z.unknown().optional(),
    placeholder: z.string().optional(),
    options: z.array(z.object({
      label: z.string(),
      value: z.string(),
      description: z.string().optional(),
    })).optional(),
    validation: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
      message: z.string().optional(),
    }).optional(),
    visibleWhen: z.object({
      parameterId: z.string(),
      operator: z.string(),
      value: z.unknown().optional(),
    }).optional(),
    group: z.string().optional(),
    order: z.number().optional(),
  })).default([]),
  optionalParameters: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    type: z.string(),
    required: z.boolean(),
    default: z.unknown().optional(),
    placeholder: z.string().optional(),
    options: z.array(z.object({
      label: z.string(),
      value: z.string(),
      description: z.string().optional(),
    })).optional(),
    validation: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
      message: z.string().optional(),
    }).optional(),
    visibleWhen: z.object({
      parameterId: z.string(),
      operator: z.string(),
      value: z.unknown().optional(),
    }).optional(),
    group: z.string().optional(),
    order: z.number().optional(),
  })).default([]),
  prompts: z.object({
    planGeneration: z.string(),
    taskExecution: z.string().optional(),
    planRefinement: z.string().optional(),
    sharedContext: z.string().optional(),
  }),
  execution: z.object({
    preferredModel: z.string().optional(),
    maxTurns: z.number().optional(),
    maxBudgetPerTask: z.number().optional(),
    skills: z.array(z.string()).optional(),
    deliveryMode: z.string().optional(),
    skipSafetyCheck: z.boolean().optional(),
    defaultVerification: z.string().optional(),
  }).optional(),
  parallelization: z.object({
    maxConcurrentTasks: z.number().optional(),
    autoDispatch: z.boolean().optional(),
    defaultPriority: z.string().optional(),
    retry: z.object({
      maxRetries: z.number(),
      retryDelayMs: z.number(),
      exponentialBackoff: z.boolean(),
    }).optional(),
    machineSelectionPolicy: z.string().optional(),
    requiredMachineLabels: z.array(z.string()).optional(),
  }).optional(),
  planHints: z.object({
    targetNodeCount: z.object({ min: z.number(), max: z.number() }).optional(),
    defaultEstimate: z.string().optional(),
    suggestedMilestones: z.array(z.object({ title: z.string(), description: z.string() })).optional(),
    commonLabels: z.array(z.string()).optional(),
    preferParallelTasks: z.boolean().optional(),
  }).optional(),
  sourceProjectId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
})

/**
 * GET /api/templates/custom
 *
 * List all custom templates for the current user (including team templates).
 */
templatesRoute.get('/custom', async (c) => {
  const user = c.get('user')! as AuthUser

  const rows = await db.select().from(customTemplates).where(
    or(
      eq(customTemplates.authorId, user.id),
      user.teamId ? eq(customTemplates.teamId, user.teamId) : isNull(customTemplates.teamId)
    )
  ).orderBy(desc(customTemplates.updatedAt))

  const templates = rows.map(row => ({
    ...dbRowToTemplate(row),
    // Include ownership info for edit/delete permissions
    isOwner: row.authorId === user.id,
    canEdit: row.authorId === user.id || (row.teamId && row.teamId === user.teamId),
  }))

  return c.json({
    templates,
    count: templates.length,
  })
})

/**
 * GET /api/templates/custom/:id
 *
 * Get a specific custom template by ID.
 */
templatesRoute.get('/custom/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const templateId = c.req.param('id')

  const [row] = await db.select().from(customTemplates).where(
    and(
      eq(customTemplates.id, templateId),
      or(
        eq(customTemplates.authorId, user.id),
        user.teamId ? eq(customTemplates.teamId, user.teamId) : isNull(customTemplates.teamId)
      )
    )
  )

  if (!row) {
    return c.json({ error: 'Template not found' }, 404)
  }

  const template = dbRowToTemplate(row)

  return c.json({
    template,
    isOwner: row.authorId === user.id,
    canEdit: row.authorId === user.id || (row.teamId && row.teamId === user.teamId),
  })
})

/**
 * POST /api/templates/custom
 *
 * Create a new custom template.
 */
templatesRoute.post('/custom', async (c) => {
  const user = c.get('user')! as AuthUser

  let body: z.infer<typeof customTemplateSchema>
  try {
    const rawBody = await c.req.json()
    body = customTemplateSchema.parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // If teamId is provided, verify user is a member of the team
  if (body.teamId && body.teamId !== user.teamId) {
    return c.json({ error: 'Cannot create template for a team you are not a member of' }, 403)
  }

  const now = new Date()
  const templateData = {
    name: body.name,
    description: body.description,
    category: body.category,
    version: body.version,
    icon: body.icon,
    tags: body.tags,
    maturity: body.maturity,
    enabled: body.enabled,
    requiredParameters: body.requiredParameters,
    optionalParameters: body.optionalParameters,
    prompts: body.prompts,
    execution: body.execution,
    parallelization: body.parallelization,
    planHints: body.planHints,
    sourceProjectId: body.sourceProjectId,
    authorId: user.id,
    teamId: body.teamId,
    createdAt: now,
    updatedAt: now,
  }

  try {
    const [created] = await db.insert(customTemplates).values(templateData).returning()
    return c.json({
      template: dbRowToTemplate(created),
      message: 'Template created successfully',
    }, 201)
  } catch (err) {
    console.error('[templates] Failed to create custom template:', err)
    return c.json({ error: 'Failed to create template' }, 500)
  }
})

/**
 * PUT /api/templates/custom/:id
 *
 * Update an existing custom template.
 */
templatesRoute.put('/custom/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const templateId = c.req.param('id')

  // First check if template exists and user has permission
  const [existing] = await db.select().from(customTemplates).where(
    eq(customTemplates.id, templateId)
  )

  if (!existing) {
    return c.json({ error: 'Template not found' }, 404)
  }

  // Only owner or team member can edit
  const canEdit = existing.authorId === user.id ||
    (existing.teamId && existing.teamId === user.teamId)

  if (!canEdit) {
    return c.json({ error: 'Permission denied' }, 403)
  }

  let body: Partial<z.infer<typeof customTemplateSchema>>
  try {
    const rawBody = await c.req.json()
    body = customTemplateSchema.partial().parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Don't allow changing authorId
  const updateData: Record<string, unknown> = {
    ...body,
    updatedAt: new Date(),
  }
  delete updateData.sourceProjectId // Can't change source project

  try {
    const [updated] = await db.update(customTemplates)
      .set(updateData)
      .where(eq(customTemplates.id, templateId))
      .returning()

    return c.json({
      template: dbRowToTemplate(updated),
      message: 'Template updated successfully',
    })
  } catch (err) {
    console.error('[templates] Failed to update custom template:', err)
    return c.json({ error: 'Failed to update template' }, 500)
  }
})

/**
 * DELETE /api/templates/custom/:id
 *
 * Delete a custom template. Only the author can delete.
 */
templatesRoute.delete('/custom/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const templateId = c.req.param('id')

  // First check if template exists
  const [existing] = await db.select().from(customTemplates).where(
    eq(customTemplates.id, templateId)
  )

  if (!existing) {
    return c.json({ error: 'Template not found' }, 404)
  }

  // Only the author can delete
  if (existing.authorId !== user.id) {
    return c.json({ error: 'Only the template author can delete it' }, 403)
  }

  try {
    await db.delete(customTemplates).where(eq(customTemplates.id, templateId))
    return c.json({ message: 'Template deleted successfully' })
  } catch (err) {
    console.error('[templates] Failed to delete custom template:', err)
    return c.json({ error: 'Failed to delete template' }, 500)
  }
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

/**
 * Group parameters by their group field
 */
function groupParameters(template: UseCaseTemplate): Record<string, UseCaseParameter[]> {
  const groups: Record<string, UseCaseParameter[]> = {}
  const allParams = [...template.requiredParameters, ...template.optionalParameters]

  for (const param of allParams) {
    const group = param.group || 'default'
    if (!groups[group]) {
      groups[group] = []
    }
    groups[group].push(param)
  }

  // Sort parameters within each group by order
  for (const group of Object.keys(groups)) {
    groups[group].sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
  }

  return groups
}

export { templatesRoute }
