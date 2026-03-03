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
import { eq, and } from 'drizzle-orm'
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
} from '@astro/core/templates'

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
  parameters: z.record(z.unknown()).default({}),

  // Optional project configuration overrides
  projectName: z.string().max(200).optional(),
  workingDirectory: z.string().max(1000).refine(
    (path) => !path.includes('..'),
    { message: 'Path traversal not allowed' }
  ).optional(),

  // Machine targeting (for plan generation)
  targetMachineId: z.string().max(100).optional(),

  // Model preferences
  model: z.string().max(100).optional(),

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
 *
 * Query parameters:
 * - category: Filter by category
 * - enabled: Filter by enabled status (default: true)
 */
templatesRoute.get('/', async (c) => {
  const user = c.get('user')! as AuthUser
  const category = c.req.query('category')
  const enabledParam = c.req.query('enabled')
  const enabled = enabledParam === undefined ? true : enabledParam === 'true'

  let templates: UseCaseTemplate[]

  // Get built-in templates
  if (category) {
    templates = getTemplatesByCategory(category)
  } else {
    templates = [...BUILTIN_TEMPLATES]
  }

  // Filter built-in templates by enabled status
  if (enabled !== undefined) {
    templates = templates.filter(t => t.enabled === enabled)
  }

  // Fetch custom templates from database
  try {
    const customTemplateRows = await db.select().from(customTemplates).where(
      and(
        user.teamId ? eq(customTemplates.teamId, user.teamId) : eq(customTemplates.ownerId, user.id),
        enabled !== undefined ? eq(customTemplates.enabled, enabled) : undefined
      )
    )

    // Convert custom templates to UseCaseTemplate format
    const customTemplateObjects = customTemplateRows.map((row): UseCaseTemplate => ({
      ...(row.templateData as unknown as UseCaseTemplate),
      id: row.id,
      source: 'custom' as const,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))

    // Filter by category if specified
    if (category) {
      templates = [...templates, ...customTemplateObjects.filter(t => t.category === category)]
    } else {
      templates = [...templates, ...customTemplateObjects]
    }
  } catch (error) {
    console.error('[templates] Failed to fetch custom templates:', error)
    // Continue with just built-in templates
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
 */
templatesRoute.get('/categories', async (c) => {
  const categoryCounts: Record<string, number> = {}

  for (const template of BUILTIN_TEMPLATES) {
    if (template.enabled) {
      categoryCounts[template.category] = (categoryCounts[template.category] || 0) + 1
    }
  }

  const categories = Object.entries(categoryCounts).map(([category, count]) => ({
    category,
    count,
    templates: getTemplatesByCategory(category)
      .filter(t => t.enabled)
      .map(t => ({ id: t.id, name: t.name, icon: t.icon })),
  }))

  return c.json({ categories })
})

/**
 * GET /api/templates/:id
 *
 * Get full template details including parameter schema.
 * Returns the complete template definition for rendering the parameter form.
 */
templatesRoute.get('/:id', async (c) => {
  const user = c.get('user')! as AuthUser
  const templateId = c.req.param('id')

  // Decode URL-encoded template IDs (e.g., "astro%2Fweb-app" -> "astro/web-app")
  const decodedId = decodeURIComponent(templateId)

  // First check if it's a built-in template
  let template = getTemplateById(decodedId)

  // If not found in built-in, check custom templates
  if (!template) {
    try {
      const [customTemplate] = await db.select().from(customTemplates).where(
        and(
          eq(customTemplates.id, decodedId),
          user.teamId ? eq(customTemplates.teamId, user.teamId) : eq(customTemplates.ownerId, user.id)
        )
      )

      if (customTemplate) {
        template = {
          ...(customTemplate.templateData as unknown as UseCaseTemplate),
          id: customTemplate.id,
          source: 'custom' as const,
          createdAt: customTemplate.createdAt,
          updatedAt: customTemplate.updatedAt,
        }
      }
    } catch (error) {
      console.error('[templates] Failed to fetch custom template:', error)
    }
  }

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
 */
templatesRoute.get('/:id/schema', async (c) => {
  const templateId = c.req.param('id')
  const decodedId = decodeURIComponent(templateId)

  const template = getTemplateById(decodedId)

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
 */
templatesRoute.post('/:id/validate', async (c) => {
  const templateId = c.req.param('id')
  const decodedId = decodeURIComponent(templateId)

  const template = getTemplateById(decodedId)

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

  const template = getTemplateById(decodedId)

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

  const projectData = {
    id: projectId,
    ownerId: user.id,
    teamId: user.teamId,
    name: projectName,
    description: (resolvedParams['appDescription'] as string) ||
      (resolvedParams['description'] as string) ||
      template.description,
    visionDoc: fullDescription,
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
 */
templatesRoute.post('/:id/preview', async (c) => {
  const templateId = c.req.param('id')
  const decodedId = decodeURIComponent(templateId)

  const template = getTemplateById(decodedId)

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
 * POST /api/templates
 *
 * Save a custom template to the database.
 * Custom templates are user-created templates based on existing projects.
 */
templatesRoute.post('/', async (c) => {
  const user = c.get('user')! as AuthUser

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Validate required fields
  const { name, description, category, tags, icon, version, enabled, requiredParameters, optionalParameters, prompts, nodes, planHints } = body

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return c.json({ error: 'Template name is required' }, 400)
  }

  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return c.json({ error: 'Template description is required' }, 400)
  }

  if (!category || typeof category !== 'string') {
    return c.json({ error: 'Template category is required' }, 400)
  }

  // Build the template data structure
  const templateData = {
    name: name.trim(),
    description: description.trim(),
    category,
    icon: icon || '📋',
    tags: Array.isArray(tags) ? tags : [],
    version: version || '1.0.0',
    source: 'custom' as const,
    enabled: enabled !== false,
    requiredParameters: requiredParameters || [],
    optionalParameters: optionalParameters || [],
    prompts: prompts || { planGeneration: '' },
    planHints: planHints || {},
    nodes: nodes || [],
  }

  try {
    // Save to database
    const [savedTemplate] = await db.insert(customTemplates).values({
      name: templateData.name,
      description: templateData.description,
      category: templateData.category,
      icon: templateData.icon,
      tags: templateData.tags,
      version: templateData.version,
      enabled: templateData.enabled,
      templateData: templateData,
      ownerId: user.id,
      teamId: user.teamId || null,
    }).returning()

    return c.json({
      success: true,
      template: {
        id: savedTemplate.id,
        name: savedTemplate.name,
        description: savedTemplate.description,
        category: savedTemplate.category,
        icon: savedTemplate.icon,
        tags: savedTemplate.tags,
        version: savedTemplate.version,
        source: 'custom' as const,
        createdAt: savedTemplate.createdAt,
      },
    }, 201)
  } catch (error) {
    console.error('[templates] Failed to save custom template:', error)
    return c.json({ error: 'Failed to save template', message: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})

// ============================================================================
// Helper Functions
// ============================================================================

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
