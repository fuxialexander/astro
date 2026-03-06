/**
 * Tests for use case examples system
 *
 * Part 1: Unit tests for packages/core/src/templates/examples/
 *   - BUILTIN_EXAMPLES collection integrity
 *   - getExampleById / getExamplesByCategory lookups
 *   - EXAMPLES_BY_CATEGORY grouping
 *   - Backward-compatible aliases (BUILTIN_TEMPLATES, getTemplateById, etc.)
 *   - validateTemplate / validateExample
 *
 * Part 2: Integration tests for server/routes/examples.ts
 *   - GET /api/examples — list all examples, filter by category
 *   - GET /api/examples/categories — category listing with counts
 *   - GET /api/examples/:id — get single example by ID
 *   - POST /api/examples/:id/validate — parameter validation
 *   - POST /api/examples/:id/preview — preview interpolated prompts
 *   - POST /api/examples/:id/launch — create project from example
 *   - 404 for nonexistent example IDs
 *   - Edge cases: URL-encoded IDs, disabled templates, invalid JSON
 *
 * Uses PGlite (local mode) for integration tests.
 */

import { describe, it, expect, beforeAll } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════
// Part 1: Unit Tests for Core Examples Module
// ═══════════════════════════════════════════════════════════════════════

import {
  // Example names (primary — matches UI terminology)
  BUILTIN_EXAMPLES,
  EXAMPLES_BY_CATEGORY,
  getExampleById,
  getExamplesByCategory,
  validateExample,
  // Template names (backward compat — used in compat tests)
  BUILTIN_TEMPLATES,
  TEMPLATES_BY_CATEGORY,
  getTemplateById,
  getTemplatesByCategory,
  validateTemplate,
  type UseCaseTemplate,
} from '../packages/core/src/templates/index.js'

describe('Core Examples Module', () => {
  describe('BUILTIN_EXAMPLES', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(BUILTIN_EXAMPLES)).toBe(true)
      expect(BUILTIN_EXAMPLES.length).toBeGreaterThan(0)
    })

    it('every example has required identity fields', () => {
      for (const ex of BUILTIN_EXAMPLES) {
        expect(ex.id).toBeTruthy()
        expect(typeof ex.id).toBe('string')
        expect(ex.name).toBeTruthy()
        expect(typeof ex.name).toBe('string')
        expect(ex.description).toBeTruthy()
        expect(ex.category).toBeTruthy()
        expect(ex.version).toBeTruthy()
      }
    })

    it('every example has unique ID', () => {
      const ids = BUILTIN_EXAMPLES.map(e => e.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('every example has requiredParameters and optionalParameters arrays', () => {
      for (const ex of BUILTIN_EXAMPLES) {
        expect(Array.isArray(ex.requiredParameters)).toBe(true)
        expect(Array.isArray(ex.optionalParameters)).toBe(true)
      }
    })

    it('every example has prompts.planGeneration', () => {
      for (const ex of BUILTIN_EXAMPLES) {
        expect(ex.prompts).toBeDefined()
        expect(typeof ex.prompts.planGeneration).toBe('string')
        expect(ex.prompts.planGeneration.length).toBeGreaterThan(0)
      }
    })

    it('every parameter has required fields (id, name, type)', () => {
      for (const ex of BUILTIN_EXAMPLES) {
        const allParams = [...ex.requiredParameters, ...ex.optionalParameters]
        for (const param of allParams) {
          expect(param.id).toBeTruthy()
          expect(param.name).toBeTruthy()
          expect(param.type).toBeTruthy()
        }
      }
    })

    it('parameter IDs are unique within each example', () => {
      for (const ex of BUILTIN_EXAMPLES) {
        const allParams = [...ex.requiredParameters, ...ex.optionalParameters]
        const ids = allParams.map(p => p.id)
        const unique = new Set(ids)
        expect(unique.size).toBe(ids.length)
      }
    })

    it('select/multi-select parameters have options', () => {
      for (const ex of BUILTIN_EXAMPLES) {
        const allParams = [...ex.requiredParameters, ...ex.optionalParameters]
        for (const param of allParams) {
          if (param.type === 'select' || param.type === 'multi-select') {
            expect(param.options).toBeDefined()
            expect(param.options!.length).toBeGreaterThan(0)
          }
        }
      }
    })
  })

  describe('getExampleById', () => {
    it('returns matching example for valid ID', () => {
      const first = BUILTIN_EXAMPLES[0]
      const result = getExampleById(first.id)
      expect(result).toBeDefined()
      expect(result!.id).toBe(first.id)
      expect(result!.name).toBe(first.name)
    })

    it('returns undefined for nonexistent ID', () => {
      expect(getExampleById('nonexistent-id-12345')).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
      expect(getExampleById('')).toBeUndefined()
    })

    it('is case-sensitive', () => {
      const first = BUILTIN_EXAMPLES[0]
      expect(getExampleById(first.id.toUpperCase())).toBeUndefined()
    })
  })

  describe('getExamplesByCategory', () => {
    it('returns examples for a valid category from EXAMPLES_BY_CATEGORY', () => {
      // getExamplesByCategory uses EXAMPLES_BY_CATEGORY keys, not template.category
      const categoryKeys = Object.keys(EXAMPLES_BY_CATEGORY)
      expect(categoryKeys.length).toBeGreaterThan(0)
      const results = getExamplesByCategory(categoryKeys[0])
      expect(results.length).toBeGreaterThan(0)
    })

    it('returns empty array for nonexistent category', () => {
      expect(getExamplesByCategory('nonexistent-category')).toEqual([])
    })

    it('returns empty array for empty string', () => {
      expect(getExamplesByCategory('')).toEqual([])
    })
  })

  describe('EXAMPLES_BY_CATEGORY', () => {
    it('is a non-empty object', () => {
      expect(typeof EXAMPLES_BY_CATEGORY).toBe('object')
      expect(Object.keys(EXAMPLES_BY_CATEGORY).length).toBeGreaterThan(0)
    })

    it('every category has at least one example', () => {
      for (const [, examples] of Object.entries(EXAMPLES_BY_CATEGORY)) {
        expect(examples.length).toBeGreaterThan(0)
        for (const ex of examples) {
          expect(ex.id).toBeTruthy()
        }
      }
    })
  })

  describe('Backward-compatible aliases', () => {
    it('BUILTIN_TEMPLATES is the same reference as BUILTIN_EXAMPLES', () => {
      expect(BUILTIN_TEMPLATES).toBe(BUILTIN_EXAMPLES)
    })

    it('TEMPLATES_BY_CATEGORY is the same reference as EXAMPLES_BY_CATEGORY', () => {
      expect(TEMPLATES_BY_CATEGORY).toBe(EXAMPLES_BY_CATEGORY)
    })

    it('getTemplateById is the same function as getExampleById', () => {
      expect(getTemplateById).toBe(getExampleById)
      const first = BUILTIN_EXAMPLES[0]
      expect(getTemplateById(first.id)).toBe(getExampleById(first.id))
    })

    it('getTemplatesByCategory is the same function as getExamplesByCategory', () => {
      expect(getTemplatesByCategory).toBe(getExamplesByCategory)
    })

    it('validateExample is the same function as validateTemplate', () => {
      expect(validateExample).toBe(validateTemplate)
    })
  })

  describe('validateTemplate / validateExample', () => {
    it('returns structured validation result for each built-in example', () => {
      for (const ex of BUILTIN_EXAMPLES) {
        const result = validateExample(ex)
        expect(typeof result.valid).toBe('boolean')
        expect(Array.isArray(result.errors)).toBe(true)
        expect(Array.isArray(result.warnings)).toBe(true)
      }
    })

    it('returns errors for a template missing required fields', () => {
      const bad = { id: '', name: '', description: '' } as unknown as UseCaseTemplate
      const result = validateTemplate(bad)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part 2: Integration Tests for Examples API Routes
// ═══════════════════════════════════════════════════════════════════════

import {
  setupTestServer,
  request,
  postJson,
} from './helpers/test-server.js'

beforeAll(async () => {
  await setupTestServer()
}, 30000)

describe('GET /api/examples', () => {
  it('returns 200 with templates array', async () => {
    const res = await request('/api/examples')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.templates).toBeDefined()
    expect(Array.isArray(data.templates)).toBe(true)
    expect(data.count).toBeGreaterThan(0)
    expect(data.count).toBe(data.templates.length)
  })

  it('returns summary objects (not full templates)', async () => {
    const res = await request('/api/examples')
    const data = await res.json()
    const first = data.templates[0]
    // Summaries should have these fields
    expect(first.id).toBeTruthy()
    expect(first.name).toBeTruthy()
    expect(first.description).toBeTruthy()
    expect(first.category).toBeTruthy()
    expect(typeof first.parameterCount).toBe('number')
    // Summaries should NOT have full parameter arrays
    expect(first.requiredParameters).toBeUndefined()
    expect(first.optionalParameters).toBeUndefined()
    expect(first.prompts).toBeUndefined()
  })

  it('returns only enabled templates', async () => {
    const res = await request('/api/examples')
    const data = await res.json()
    // All returned templates should be summaries of enabled ones
    for (const t of data.templates) {
      const full = getExampleById(t.id)
      expect(full).toBeDefined()
      expect(full!.enabled).toBe(true)
    }
  })

  it('filters by category when query param is provided', async () => {
    // Get a valid category first
    const catRes = await request('/api/examples/categories')
    const catData = await catRes.json()
    if (catData.categories.length === 0) return // skip if no categories

    const category = catData.categories[0].category
    const res = await request(`/api/examples?category=${encodeURIComponent(category)}`)
    expect(res.status).toBe(200)
    const data = await res.json()
    // All returned should be in the requested category
    for (const t of data.templates) {
      expect(t.category).toBe(category)
    }
  })

  it('returns empty array for nonexistent category', async () => {
    const res = await request('/api/examples?category=no-such-category-xyz')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.templates).toEqual([])
    expect(data.count).toBe(0)
  })

  it('includes categories list in response', async () => {
    const res = await request('/api/examples')
    const data = await res.json()
    expect(Array.isArray(data.categories)).toBe(true)
  })
})

describe('GET /api/examples/categories', () => {
  it('returns 200 with categories array', async () => {
    const res = await request('/api/examples/categories')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.categories).toBeDefined()
    expect(Array.isArray(data.categories)).toBe(true)
  })

  it('each category has count and templates', async () => {
    const res = await request('/api/examples/categories')
    const data = await res.json()
    for (const cat of data.categories) {
      expect(cat.category).toBeTruthy()
      expect(typeof cat.count).toBe('number')
      expect(cat.count).toBeGreaterThan(0)
      expect(Array.isArray(cat.templates)).toBe(true)
      expect(cat.templates.length).toBe(cat.count)
      for (const t of cat.templates) {
        expect(t.id).toBeTruthy()
        expect(t.name).toBeTruthy()
      }
    }
  })

  it('category counts are consistent with category listing', async () => {
    const catRes = await request('/api/examples/categories')
    const catData = await catRes.json()
    // Each category should have a positive count matching its templates array length
    for (const cat of catData.categories) {
      expect(cat.count).toBe(cat.templates.length)
      expect(cat.count).toBeGreaterThan(0)
    }
  })
})

describe('GET /api/examples/:id', () => {
  it('returns 200 with full template for valid ID', async () => {
    const first = BUILTIN_EXAMPLES.find(e => e.enabled)!
    const res = await request(`/api/examples/${encodeURIComponent(first.id)}`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.template).toBeDefined()
    expect(data.template.id).toBe(first.id)
    expect(data.template.name).toBe(first.name)
    // Full template should include parameters and prompts
    expect(data.template.requiredParameters).toBeDefined()
    expect(data.template.optionalParameters).toBeDefined()
    expect(data.template.prompts).toBeDefined()
  })

  it('includes validation result', async () => {
    const first = BUILTIN_EXAMPLES.find(e => e.enabled)!
    const res = await request(`/api/examples/${encodeURIComponent(first.id)}`)
    const data = await res.json()
    expect(data.validation).toBeDefined()
    expect(typeof data.validation.valid).toBe('boolean')
    expect(Array.isArray(data.validation.errors)).toBe(true)
  })

  it('returns 404 for nonexistent ID', async () => {
    const res = await request('/api/examples/nonexistent-id-12345')
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toBe('Example not found')
  })

  it('handles URL-encoded IDs', async () => {
    const first = BUILTIN_EXAMPLES.find(e => e.enabled)!
    // Double-encode to simulate browser behavior
    const encoded = encodeURIComponent(first.id)
    const res = await request(`/api/examples/${encoded}`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.template.id).toBe(first.id)
  })
})

describe('POST /api/examples/:id/validate', () => {
  const getFirstExample = () => BUILTIN_EXAMPLES.find(e => e.enabled)!

  it('returns valid=true with correct required parameters', async () => {
    const ex = getFirstExample()
    // Build minimal valid params: defaults for all, provide required
    const params: Record<string, unknown> = {}
    for (const p of ex.requiredParameters) {
      if (p.default !== undefined) {
        params[p.id] = p.default
      } else if (p.type === 'string' || p.type === 'textarea') {
        params[p.id] = 'test value'
      } else if (p.type === 'number') {
        params[p.id] = 42
      } else if (p.type === 'boolean') {
        params[p.id] = true
      } else if (p.type === 'select' && p.options?.length) {
        params[p.id] = p.options[0].value
      } else if (p.type === 'multi-select' && p.options?.length) {
        params[p.id] = [p.options[0].value]
      }
    }

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/validate`, { parameters: params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.valid).toBe(true)
    expect(data.errors).toEqual([])
  })

  it('returns valid=false when required parameter is missing', async () => {
    const ex = getFirstExample()
    // Find a required parameter without a default
    const requiredNoDefault = ex.requiredParameters.find(p => p.required && p.default === undefined)
    if (!requiredNoDefault) return // skip if all have defaults

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/validate`, { parameters: {} })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.valid).toBe(false)
    expect(data.errors.length).toBeGreaterThan(0)
    expect(data.errors[0].code).toBe('MISSING_REQUIRED')
  })

  it('returns 404 for nonexistent example', async () => {
    const res = await postJson('/api/examples/nonexistent/validate', { parameters: {} })
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid JSON body', async () => {
    const ex = getFirstExample()
    const res = await request(`/api/examples/${encodeURIComponent(ex.id)}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Invalid JSON body')
  })

  it('returns resolvedParameters with defaults applied', async () => {
    const ex = getFirstExample()
    // Find a param with a default
    const allParams = [...ex.requiredParameters, ...ex.optionalParameters]
    const paramWithDefault = allParams.find(p => p.default !== undefined)
    if (!paramWithDefault) return

    // Provide minimal required params
    const params: Record<string, unknown> = {}
    for (const p of ex.requiredParameters) {
      if (p.default !== undefined) {
        // Don't send it — let the server apply the default
      } else if (p.type === 'string' || p.type === 'textarea') {
        params[p.id] = 'test'
      } else if (p.type === 'multi-select' && p.options?.length) {
        params[p.id] = [p.options[0].value]
      }
    }

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/validate`, { parameters: params })
    const data = await res.json()
    expect(data.resolvedParameters).toBeDefined()
    // Check that the default was applied
    if (data.valid && paramWithDefault.default !== undefined) {
      expect(data.resolvedParameters[paramWithDefault.id]).toBeDefined()
    }
  })

  it('validates select parameter with invalid option', async () => {
    const ex = getFirstExample()
    const selectParam = [...ex.requiredParameters, ...ex.optionalParameters].find(p => p.type === 'select')
    if (!selectParam) return

    // Build valid params first, then override the select with bad value
    const params: Record<string, unknown> = {}
    for (const p of ex.requiredParameters) {
      if (p.default !== undefined) {
        params[p.id] = p.default
      } else if (p.type === 'string' || p.type === 'textarea') {
        params[p.id] = 'test'
      } else if (p.type === 'multi-select' && p.options?.length) {
        params[p.id] = [p.options[0].value]
      }
    }
    params[selectParam.id] = 'totally-invalid-option-xyz'

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/validate`, { parameters: params })
    const data = await res.json()
    expect(data.valid).toBe(false)
    const err = data.errors.find((e: { parameterId: string }) => e.parameterId === selectParam.id)
    expect(err).toBeDefined()
    expect(err.code).toBe('INVALID_VALUE')
  })

  it('validates type mismatch — number param gets string', async () => {
    const ex = getFirstExample()
    const numberParam = [...ex.requiredParameters, ...ex.optionalParameters].find(p => p.type === 'number')
    if (!numberParam) return

    const params: Record<string, unknown> = {}
    for (const p of ex.requiredParameters) {
      if (p.default !== undefined) params[p.id] = p.default
      else if (p.type === 'string' || p.type === 'textarea') params[p.id] = 'test'
      else if (p.type === 'multi-select' && p.options?.length) params[p.id] = [p.options[0].value]
    }
    params[numberParam.id] = 'not-a-number'

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/validate`, { parameters: params })
    const data = await res.json()
    expect(data.valid).toBe(false)
    const err = data.errors.find((e: { parameterId: string }) => e.parameterId === numberParam.id)
    expect(err).toBeDefined()
    expect(err.code).toBe('INVALID_TYPE')
  })

  it('validates multi-select with invalid array items', async () => {
    const ex = getFirstExample()
    const multiParam = [...ex.requiredParameters, ...ex.optionalParameters].find(p => p.type === 'multi-select')
    if (!multiParam) return

    const params: Record<string, unknown> = {}
    for (const p of ex.requiredParameters) {
      if (p.default !== undefined) params[p.id] = p.default
      else if (p.type === 'string' || p.type === 'textarea') params[p.id] = 'test'
    }
    params[multiParam.id] = ['valid-maybe', 'definitely-invalid-xyz']

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/validate`, { parameters: params })
    const data = await res.json()
    // Should fail if the invalid values aren't in options
    if (multiParam.options) {
      const validValues = multiParam.options.map(o => o.value)
      if (!validValues.includes('valid-maybe') || !validValues.includes('definitely-invalid-xyz')) {
        expect(data.valid).toBe(false)
        const err = data.errors.find((e: { parameterId: string }) => e.parameterId === multiParam.id)
        expect(err).toBeDefined()
        expect(err.code).toBe('INVALID_VALUE')
      }
    }
  })

  it('validates multi-select type — expects array, gets string', async () => {
    const ex = getFirstExample()
    const multiParam = [...ex.requiredParameters, ...ex.optionalParameters].find(p => p.type === 'multi-select')
    if (!multiParam) return

    const params: Record<string, unknown> = {}
    for (const p of ex.requiredParameters) {
      if (p.default !== undefined) params[p.id] = p.default
      else if (p.type === 'string' || p.type === 'textarea') params[p.id] = 'test'
    }
    params[multiParam.id] = 'not-an-array'

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/validate`, { parameters: params })
    const data = await res.json()
    expect(data.valid).toBe(false)
    const err = data.errors.find((e: { parameterId: string }) => e.parameterId === multiParam.id)
    expect(err).toBeDefined()
    expect(err.code).toBe('INVALID_TYPE')
  })

  it('validates boolean type — expects boolean, gets string', async () => {
    const ex = getFirstExample()
    const boolParam = [...ex.requiredParameters, ...ex.optionalParameters].find(p => p.type === 'boolean')
    if (!boolParam) return

    const params: Record<string, unknown> = {}
    for (const p of ex.requiredParameters) {
      if (p.default !== undefined) params[p.id] = p.default
      else if (p.type === 'string' || p.type === 'textarea') params[p.id] = 'test'
      else if (p.type === 'multi-select' && p.options?.length) params[p.id] = [p.options[0].value]
    }
    params[boolParam.id] = 'true' // string, not boolean

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/validate`, { parameters: params })
    const data = await res.json()
    expect(data.valid).toBe(false)
    const err = data.errors.find((e: { parameterId: string }) => e.parameterId === boolParam.id)
    expect(err).toBeDefined()
    expect(err.code).toBe('INVALID_TYPE')
  })

  it('validates string parameter with pattern constraint', async () => {
    const ex = getFirstExample()
    const patternParam = [...ex.requiredParameters, ...ex.optionalParameters].find(
      p => p.validation?.pattern
    )
    if (!patternParam) return

    const params: Record<string, unknown> = {}
    for (const p of ex.requiredParameters) {
      if (p.default !== undefined) params[p.id] = p.default
      else if (p.type === 'string' || p.type === 'textarea') params[p.id] = 'test'
      else if (p.type === 'multi-select' && p.options?.length) params[p.id] = [p.options[0].value]
    }
    params[patternParam.id] = '!!!invalid-for-most-patterns!!!'

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/validate`, { parameters: params })
    const data = await res.json()
    // If this violates the pattern, it should fail
    const regex = new RegExp(patternParam.validation!.pattern!)
    if (!regex.test('!!!invalid-for-most-patterns!!!')) {
      expect(data.valid).toBe(false)
      const err = data.errors.find((e: { parameterId: string }) => e.parameterId === patternParam.id)
      expect(err).toBeDefined()
      expect(err.code).toBe('INVALID_PATTERN')
    }
  })

  it('handles empty parameters object gracefully', async () => {
    const ex = getFirstExample()
    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/validate`, { parameters: {} })
    expect(res.status).toBe(200)
    const data = await res.json()
    // Should still return a structured response (may be valid if all have defaults)
    expect(typeof data.valid).toBe('boolean')
    expect(Array.isArray(data.errors)).toBe(true)
  })

  it('handles missing parameters key — defaults to empty object', async () => {
    const ex = getFirstExample()
    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/validate`, {})
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(typeof data.valid).toBe('boolean')
  })
})

describe('POST /api/examples/:id/preview', () => {
  const getFirstExample = () => BUILTIN_EXAMPLES.find(e => e.enabled)!

  it('returns 200 with interpolated prompts for valid parameters', async () => {
    const ex = getFirstExample()
    const params: Record<string, unknown> = {}
    for (const p of [...ex.requiredParameters, ...ex.optionalParameters]) {
      if (p.default !== undefined) {
        params[p.id] = p.default
      } else if (p.required) {
        if (p.type === 'string' || p.type === 'textarea') params[p.id] = 'test value'
        else if (p.type === 'multi-select' && p.options?.length) params[p.id] = [p.options[0].value]
      }
    }

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/preview`, { parameters: params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.templateId).toBe(ex.id)
    expect(data.templateName).toBe(ex.name)
    expect(data.resolvedParameters).toBeDefined()
    expect(data.interpolatedPrompts).toBeDefined()
    expect(data.interpolatedPrompts.planGeneration).toBeTruthy()
  })

  it('returns 404 for nonexistent example', async () => {
    const res = await postJson('/api/examples/nonexistent/preview', { parameters: {} })
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid parameters', async () => {
    const ex = getFirstExample()
    const requiredNoDefault = ex.requiredParameters.find(p => p.required && p.default === undefined)
    if (!requiredNoDefault) return

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/preview`, { parameters: {} })
    // Should return 400 for parameter validation failure
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Parameter validation failed')
  })

  it('returns 400 for invalid JSON body', async () => {
    const ex = getFirstExample()
    const res = await request(`/api/examples/${encodeURIComponent(ex.id)}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken json',
    })
    expect(res.status).toBe(400)
  })

  it('includes planHints and execution config if template has them', async () => {
    const ex = getFirstExample()
    const params: Record<string, unknown> = {}
    for (const p of [...ex.requiredParameters, ...ex.optionalParameters]) {
      if (p.default !== undefined) params[p.id] = p.default
      else if (p.required) {
        if (p.type === 'string' || p.type === 'textarea') params[p.id] = 'test'
        else if (p.type === 'multi-select' && p.options?.length) params[p.id] = [p.options[0].value]
      }
    }

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/preview`, { parameters: params })
    const data = await res.json()
    // These should be present (may be null/undefined, but the key should exist)
    expect('planHints' in data).toBe(true)
    expect('executionConfig' in data).toBe(true)
  })
})

describe('POST /api/examples/:id/launch', () => {
  const getFirstExample = () => BUILTIN_EXAMPLES.find(e => e.enabled)!

  function buildValidParams(ex: UseCaseTemplate): Record<string, unknown> {
    const params: Record<string, unknown> = {}
    for (const p of [...ex.requiredParameters, ...ex.optionalParameters]) {
      if (p.default !== undefined) {
        params[p.id] = p.default
      } else if (p.required) {
        if (p.type === 'string' || p.type === 'textarea') params[p.id] = 'test value'
        else if (p.type === 'number') params[p.id] = 1
        else if (p.type === 'boolean') params[p.id] = true
        else if (p.type === 'select' && p.options?.length) params[p.id] = p.options[0].value
        else if (p.type === 'multi-select' && p.options?.length) params[p.id] = [p.options[0].value]
      }
    }
    return params
  }

  it('creates project and returns 201 with valid parameters', async () => {
    const ex = getFirstExample()
    const params = buildValidParams(ex)
    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/launch`, {
      parameters: params,
      projectName: 'Test Launch Project',
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.project).toBeDefined()
    expect(data.project.id).toBeTruthy()
    expect(data.project.name).toBe('Test Launch Project')
    expect(data.templateUsed).toBeDefined()
    expect(data.templateUsed.id).toBe(ex.id)
    expect(data.resolvedParameters).toBeDefined()
    expect(data.planGenerationRequest).toBeDefined()
    expect(data.planGenerationRequest.projectId).toBe(data.project.id)
  })

  it('uses template name + "Project" when projectName not provided', async () => {
    const ex = getFirstExample()
    const params = buildValidParams(ex)
    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/launch`, {
      parameters: params,
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.project.name).toBeTruthy()
  })

  it('returns 404 for nonexistent example', async () => {
    const res = await postJson('/api/examples/nonexistent/launch', {
      parameters: {},
      projectName: 'Test',
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 when required parameters are missing', async () => {
    const ex = getFirstExample()
    const requiredNoDefault = ex.requiredParameters.find(p => p.required && p.default === undefined)
    if (!requiredNoDefault) return

    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/launch`, {
      parameters: {},
      projectName: 'Test',
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Parameter validation failed')
    expect(data.details.length).toBeGreaterThan(0)
  })

  it('returns 400 for invalid JSON body', async () => {
    const ex = getFirstExample()
    const res = await request(`/api/examples/${encodeURIComponent(ex.id)}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for path traversal in workingDirectory', async () => {
    const ex = getFirstExample()
    const params = buildValidParams(ex)
    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/launch`, {
      parameters: params,
      projectName: 'Test',
      workingDirectory: '/home/user/../../../etc/passwd',
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Invalid input')
  })

  it('includes source metadata on created project', async () => {
    const ex = getFirstExample()
    const params = buildValidParams(ex)
    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/launch`, {
      parameters: params,
      projectName: 'Source Metadata Test',
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    const project = data.project
    // source should track template origin
    expect(project.source).toBeDefined()
    const source = typeof project.source === 'string' ? JSON.parse(project.source) : project.source
    expect(source.type).toBe('template')
    expect(source.templateId).toBe(ex.id)
  })

  it('uses custom visionDoc when provided', async () => {
    const ex = getFirstExample()
    const params = buildValidParams(ex)
    const customVision = 'This is my custom vision doc for testing'
    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/launch`, {
      parameters: params,
      projectName: 'Vision Doc Test',
      visionDoc: customVision,
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.project.visionDoc).toBe(customVision)
  })

  it('passes workingDirectory and targetMachineId to planGenerationRequest', async () => {
    const ex = getFirstExample()
    const params = buildValidParams(ex)
    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/launch`, {
      parameters: params,
      projectName: 'WD Test',
      workingDirectory: '/home/user/project',
      targetMachineId: 'machine-123',
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.planGenerationRequest.workingDirectory).toBe('/home/user/project')
    expect(data.planGenerationRequest.targetMachineId).toBe('machine-123')
  })

  it('passes model and preferredProvider to planGenerationRequest', async () => {
    const ex = getFirstExample()
    const params = buildValidParams(ex)
    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/launch`, {
      parameters: params,
      projectName: 'Provider Test',
      model: 'claude-sonnet-4-20250514',
      preferredProvider: 'anthropic',
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.planGenerationRequest.model).toBe('claude-sonnet-4-20250514')
    expect(data.planGenerationRequest.preferredProvider).toBe('anthropic')
  })

  it('validates projectName max length', async () => {
    const ex = getFirstExample()
    const params = buildValidParams(ex)
    const longName = 'a'.repeat(201) // exceeds 200 char limit
    const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/launch`, {
      parameters: params,
      projectName: longName,
    })
    expect(res.status).toBe(400)
  })

  it('each launch creates a unique project ID', async () => {
    const ex = getFirstExample()
    const params = buildValidParams(ex)
    const ids = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const res = await postJson(`/api/examples/${encodeURIComponent(ex.id)}/launch`, {
        parameters: params,
        projectName: `Unique ID Test ${i}`,
      })
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(ids.has(data.project.id)).toBe(false)
      ids.add(data.project.id)
    }
    expect(ids.size).toBe(3)
  })
})
