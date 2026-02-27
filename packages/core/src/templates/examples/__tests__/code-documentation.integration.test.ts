/**
 * Code Documentation Template — Integration Tests
 *
 * Tests that the code-documentation template integrates correctly with
 * the template infrastructure: registry, validator, loader, and cross-template
 * consistency. Validates that the same infrastructure built for software-development
 * templates works for documentation-category templates.
 *
 * Run with: npx vitest run packages/core/src/templates/examples/__tests__/code-documentation.integration.test.ts
 */

import { describe, it, expect } from 'vitest'

// Import from the public API (@astro/core/templates barrel)
import {
  codeDocumentationTemplate,
  BUILTIN_TEMPLATES,
  TEMPLATES_BY_CATEGORY,
  getTemplateById,
  getTemplatesByCategory,
  validateTemplate,
  formatValidationResult,
  templateToMarkdown,
  loadTemplateFromMarkdown,
} from '../../index.js'
import type { UseCaseTemplate } from '../../../types/use-case-template.js'

// ────────────────────────────────────────────────────────────────────────────
// Registry Integration Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Registry Integration', () => {
  it('is included in BUILTIN_TEMPLATES', () => {
    const found = BUILTIN_TEMPLATES.find(t => t.id === 'astro/code-documentation')
    expect(found).toBeDefined()
    expect(found).toBe(codeDocumentationTemplate)
  })

  it('is included in TEMPLATES_BY_CATEGORY under documentation', () => {
    const docTemplates = TEMPLATES_BY_CATEGORY['documentation']
    expect(docTemplates).toBeDefined()
    expect(docTemplates.length).toBeGreaterThan(0)
    expect(docTemplates).toContainEqual(codeDocumentationTemplate)
  })

  it('is findable by ID via getTemplateById', () => {
    const template = getTemplateById('astro/code-documentation')
    expect(template).toBeDefined()
    expect(template?.id).toBe('astro/code-documentation')
    expect(template).toBe(codeDocumentationTemplate)
  })

  it('is findable by category via getTemplatesByCategory', () => {
    const templates = getTemplatesByCategory('documentation')
    expect(templates.length).toBeGreaterThan(0)
    expect(templates.some(t => t.id === 'astro/code-documentation')).toBe(true)
  })

  it('has a unique ID across all templates', () => {
    const allIds = BUILTIN_TEMPLATES.map(t => t.id)
    const duplicates = allIds.filter((id, i) => allIds.indexOf(id) !== i)
    expect(duplicates).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Validator Integration Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Validator Integration', () => {
  it('passes validation with known template IDs', () => {
    const knownIds = new Set(BUILTIN_TEMPLATES.map(t => t.id))
    const result = validateTemplate(codeDocumentationTemplate, knownIds)

    if (!result.valid) {
      console.error('Validation failed:', formatValidationResult(result))
    }

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('all built-in templates pass validation', () => {
    const knownIds = new Set(BUILTIN_TEMPLATES.map(t => t.id))

    for (const template of BUILTIN_TEMPLATES) {
      const result = validateTemplate(template, knownIds)
      if (!result.valid) {
        console.error(`Template ${template.id} failed:`, formatValidationResult(result))
      }
      expect(result.valid).toBe(true)
    }
  })

  it('validates parameter uniqueness across required and optional', () => {
    const allParams = [
      ...codeDocumentationTemplate.requiredParameters,
      ...codeDocumentationTemplate.optionalParameters,
    ]
    const ids = allParams.map(p => p.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  it('validates input parallelization references a real parameter', () => {
    const ip = codeDocumentationTemplate.inputParallelization
    expect(ip).toBeDefined()

    const allParamIds = [
      ...codeDocumentationTemplate.requiredParameters.map(p => p.id),
      ...codeDocumentationTemplate.optionalParameters.map(p => p.id),
    ]
    expect(allParamIds).toContain(ip!.parameterId)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Loader Integration (Round-trip) Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Loader Integration (Round-trip)', () => {
  it('converts to markdown format containing essential fields', () => {
    // Convert to markdown
    const markdown = templateToMarkdown(codeDocumentationTemplate)

    // Verify markdown contains key information
    expect(markdown).toContain('astro/code-documentation')
    expect(markdown).toContain('Code Documentation Generator')
    expect(markdown).toContain('documentation')
    expect(markdown).toContain('1.0.0')

    // Verify the markdown is loadable (doesn't throw)
    const reloaded = loadTemplateFromMarkdown(markdown)
    expect(reloaded).toBeDefined()
    expect(reloaded.id).toBe(codeDocumentationTemplate.id)
    expect(reloaded.category).toBe(codeDocumentationTemplate.category)
    expect(reloaded.version).toBe(codeDocumentationTemplate.version)

    // Note: Full round-trip fidelity is not guaranteed for complex templates
    // because the markdown format is a simplified representation.
    // The TypeScript definition is the authoritative source.
  })

  it('markdown output contains all required parameters', () => {
    const markdown = templateToMarkdown(codeDocumentationTemplate)

    expect(markdown).toContain('repoUrls')
    expect(markdown).toContain('language')
  })

  it('markdown output contains prompts', () => {
    const markdown = templateToMarkdown(codeDocumentationTemplate)

    expect(markdown).toContain('Plan Generation')
    expect(markdown).toContain('expert technical writer')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Cross-Template Infrastructure Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Cross-Template Infrastructure Compatibility', () => {
  it('documentation template uses the same UseCaseTemplate type as web-app', () => {
    // Both should have the same structural shape
    const docTemplate = codeDocumentationTemplate
    const webApp = getTemplateById('astro/web-app')!

    // Same shape check
    expect(typeof docTemplate.id).toBe(typeof webApp.id)
    expect(typeof docTemplate.name).toBe(typeof webApp.name)
    expect(Array.isArray(docTemplate.requiredParameters)).toBe(true)
    expect(Array.isArray(docTemplate.optionalParameters)).toBe(true)
    expect(typeof docTemplate.prompts.planGeneration).toBe('string')
  })

  it('works with different categories than software-development templates', () => {
    const softwareDevTemplates = getTemplatesByCategory('software-development')
    const docTemplates = getTemplatesByCategory('documentation')

    // The categories should be disjoint
    const softwareDevIds = softwareDevTemplates.map(t => t.id)
    const docIds = docTemplates.map(t => t.id)

    for (const id of docIds) {
      expect(softwareDevIds).not.toContain(id)
    }
  })

  it('documentation template demonstrates input parallelization (fan-out pattern)', () => {
    // Web-app doesn't have input parallelization
    const webApp = getTemplateById('astro/web-app')!
    expect(webApp.inputParallelization).toBeUndefined()

    // Code-documentation does have it
    expect(codeDocumentationTemplate.inputParallelization).toBeDefined()
    expect(codeDocumentationTemplate.inputParallelization?.splitStrategy).toBe('newline')

    // Paper-to-slides also has it
    const paperToSlides = getTemplateById('astro/paper-to-slides')!
    expect(paperToSlides.inputParallelization).toBeDefined()
  })

  it('documentation template uses markdown output (unlike free-form code templates)', () => {
    const webApp = getTemplateById('astro/web-app')!
    expect(webApp.outputFormat?.type).toBe('free')

    expect(codeDocumentationTemplate.outputFormat?.type).toBe('markdown')
  })

  it('all templates in BUILTIN_TEMPLATES are enabled', () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.enabled).toBe(true)
    }
  })

  it('all templates in BUILTIN_TEMPLATES have valid source', () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.source).toBe('builtin')
    }
  })

  it('TEMPLATES_BY_CATEGORY covers all templates', () => {
    const categorizedIds = new Set<string>()
    for (const templates of Object.values(TEMPLATES_BY_CATEGORY)) {
      for (const t of templates) {
        categorizedIds.add(t.id)
      }
    }

    for (const template of BUILTIN_TEMPLATES) {
      expect(categorizedIds.has(template.id)).toBe(true)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Prompt System Integration Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Prompt System Integration', () => {
  it('planGeneration prompt references only valid parameters', () => {
    const allParamIds = [
      ...codeDocumentationTemplate.requiredParameters.map(p => p.id),
      ...codeDocumentationTemplate.optionalParameters.map(p => p.id),
    ]
    const builtinParams = ['projectName', 'visionDoc', 'repoContext', 'gitState', 'timestamp', 'userName']
    const validIds = new Set([...allParamIds, ...builtinParams])

    const references = Array.from(
      codeDocumentationTemplate.prompts.planGeneration.matchAll(/\{\{(\w+)\}\}/g)
    ).map(m => m[1])

    for (const ref of references) {
      expect(validIds.has(ref)).toBe(true)
    }
  })

  it('taskExecution prompt references only valid parameters', () => {
    const allParamIds = [
      ...codeDocumentationTemplate.requiredParameters.map(p => p.id),
      ...codeDocumentationTemplate.optionalParameters.map(p => p.id),
    ]
    const builtinParams = ['projectName', 'visionDoc', 'repoContext', 'gitState', 'timestamp', 'userName']
    const validIds = new Set([...allParamIds, ...builtinParams])

    const references = Array.from(
      (codeDocumentationTemplate.prompts.taskExecution ?? '').matchAll(/\{\{(\w+)\}\}/g)
    ).map(m => m[1])

    for (const ref of references) {
      expect(validIds.has(ref)).toBe(true)
    }
  })

  it('planRefinement prompt references only valid parameters', () => {
    const allParamIds = [
      ...codeDocumentationTemplate.requiredParameters.map(p => p.id),
      ...codeDocumentationTemplate.optionalParameters.map(p => p.id),
    ]
    const builtinParams = ['projectName', 'visionDoc', 'repoContext', 'gitState', 'timestamp', 'userName']
    const validIds = new Set([...allParamIds, ...builtinParams])

    const references = Array.from(
      (codeDocumentationTemplate.prompts.planRefinement ?? '').matchAll(/\{\{(\w+)\}\}/g)
    ).map(m => m[1])

    for (const ref of references) {
      expect(validIds.has(ref)).toBe(true)
    }
  })

  it('all four prompt sections are well-formed and non-empty', () => {
    const prompts = codeDocumentationTemplate.prompts

    // Plan generation is required
    expect(prompts.planGeneration.length).toBeGreaterThan(500)

    // Task execution is important for documentation templates
    expect(prompts.taskExecution).toBeDefined()
    expect(prompts.taskExecution!.length).toBeGreaterThan(200)

    // Plan refinement enables chat-based plan editing
    expect(prompts.planRefinement).toBeDefined()
    expect(prompts.planRefinement!.length).toBeGreaterThan(100)

    // Shared context provides domain knowledge
    expect(prompts.sharedContext).toBeDefined()
    expect(prompts.sharedContext!.length).toBeGreaterThan(300)
  })
})
