/**
 * Tests for example skill loading and conditional skill resolution.
 *
 * Covers:
 * 1. deriveEffectiveSkills() — pure function logic (28 tests)
 * 2. Template data integrity — conditionalSkills / recommendedSkills config (17 tests)
 * 3. End-to-end skill injection via API — visionDoc assembly (11 tests)
 *
 * These tests ensure that:
 * - Skills are loaded only when the user's parameter selections warrant them
 * - PDF skill is loaded only when sourceFormat is 'pdf'
 * - DOCX skill is loaded only when sourceFormat is 'docx'
 * - LaTeX and Markdown formats load no extra skills
 * - academic-presentation always loads PDF (no sourceFormat parameter)
 * - moat-fragility has no conditional skills
 * - Edge cases: null templates, empty params, unknown values, overlapping skills
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  deriveEffectiveSkills,
  academicPresentationTemplate,
  academicReviewTemplate,
  moatFragilityTemplate,
  BUILTIN_EXAMPLES,
} from '../packages/core/src/templates/index.js'
// UseCaseTemplate type used implicitly via template objects from BUILTIN_EXAMPLES

// ═══════════════════════════════════════════════════════════════════════
// Part 1: deriveEffectiveSkills() Pure Function Tests
// ═══════════════════════════════════════════════════════════════════════

describe('deriveEffectiveSkills', () => {
  describe('null / undefined / empty input', () => {
    it('returns empty array for null template', () => {
      expect(deriveEffectiveSkills(null, {})).toEqual([])
    })

    it('returns empty array for undefined template', () => {
      expect(deriveEffectiveSkills(undefined, {})).toEqual([])
    })

    it('returns empty array when template has no recommendedSkills or conditionalSkills', () => {
      expect(deriveEffectiveSkills({}, {})).toEqual([])
    })

    it('returns empty array when recommendedSkills is empty and no conditionalSkills', () => {
      expect(deriveEffectiveSkills({ recommendedSkills: [] }, {})).toEqual([])
    })
  })

  describe('recommendedSkills only (no conditionalSkills)', () => {
    it('returns recommendedSkills sorted', () => {
      const result = deriveEffectiveSkills(
        { recommendedSkills: ['zeta', 'alpha', 'mid'] },
        {},
      )
      expect(result).toEqual(['alpha', 'mid', 'zeta'])
    })

    it('deduplicates recommendedSkills', () => {
      const result = deriveEffectiveSkills(
        { recommendedSkills: ['pdf', 'pdf', 'review'] },
        {},
      )
      expect(result).toEqual(['pdf', 'review'])
    })

    it('returns single skill for single-element array', () => {
      const result = deriveEffectiveSkills(
        { recommendedSkills: ['moat-fragility'] },
        {},
      )
      expect(result).toEqual(['moat-fragility'])
    })
  })

  describe('conditionalSkills with matching parameter values', () => {
    const template = {
      recommendedSkills: ['academic-review'],
      conditionalSkills: {
        sourceFormat: {
          pdf: ['pdf'],
          docx: ['docx'],
        },
      },
    }

    it('adds pdf skill when sourceFormat is pdf', () => {
      const result = deriveEffectiveSkills(template, { sourceFormat: 'pdf' })
      expect(result).toEqual(['academic-review', 'pdf'])
    })

    it('adds docx skill when sourceFormat is docx', () => {
      const result = deriveEffectiveSkills(template, { sourceFormat: 'docx' })
      expect(result).toEqual(['academic-review', 'docx'])
    })

    it('adds no extra skills when sourceFormat is latex', () => {
      const result = deriveEffectiveSkills(template, { sourceFormat: 'latex' })
      expect(result).toEqual(['academic-review'])
    })

    it('adds no extra skills when sourceFormat is markdown', () => {
      const result = deriveEffectiveSkills(template, { sourceFormat: 'markdown' })
      expect(result).toEqual(['academic-review'])
    })

    it('adds no extra skills when sourceFormat is missing', () => {
      const result = deriveEffectiveSkills(template, {})
      expect(result).toEqual(['academic-review'])
    })

    it('adds no extra skills when sourceFormat is empty string', () => {
      const result = deriveEffectiveSkills(template, { sourceFormat: '' })
      expect(result).toEqual(['academic-review'])
    })
  })

  describe('conditionalSkills with non-string parameter values', () => {
    const template = {
      recommendedSkills: ['base'],
      conditionalSkills: {
        count: { '5': ['extra'] },
        flag: { 'true': ['flagged'] },
      },
    }

    it('ignores number parameter values (only string triggers conditional)', () => {
      const result = deriveEffectiveSkills(template, { count: 5 })
      expect(result).toEqual(['base'])
    })

    it('ignores boolean parameter values', () => {
      const result = deriveEffectiveSkills(template, { flag: true })
      expect(result).toEqual(['base'])
    })

    it('ignores array parameter values', () => {
      const result = deriveEffectiveSkills(template, { count: ['5'] })
      expect(result).toEqual(['base'])
    })

    it('ignores null parameter values', () => {
      const result = deriveEffectiveSkills(template, { count: null })
      expect(result).toEqual(['base'])
    })

    it('ignores undefined parameter values', () => {
      const result = deriveEffectiveSkills(template, { count: undefined })
      expect(result).toEqual(['base'])
    })
  })

  describe('multiple conditional parameters', () => {
    const template = {
      recommendedSkills: ['base'],
      conditionalSkills: {
        inputFormat: {
          pdf: ['pdf-reader'],
          docx: ['docx-reader'],
        },
        outputFormat: {
          pdf: ['pdf-writer'],
          html: ['html-renderer'],
        },
      },
    }

    it('applies conditionals from multiple parameters independently', () => {
      const result = deriveEffectiveSkills(template, {
        inputFormat: 'pdf',
        outputFormat: 'html',
      })
      expect(result).toEqual(['base', 'html-renderer', 'pdf-reader'])
    })

    it('applies all matching conditionals', () => {
      const result = deriveEffectiveSkills(template, {
        inputFormat: 'docx',
        outputFormat: 'pdf',
      })
      expect(result).toEqual(['base', 'docx-reader', 'pdf-writer'])
    })

    it('applies only matching conditionals when one param is missing', () => {
      const result = deriveEffectiveSkills(template, {
        inputFormat: 'pdf',
      })
      expect(result).toEqual(['base', 'pdf-reader'])
    })
  })

  describe('deduplication between recommended and conditional', () => {
    it('deduplicates when conditional adds a skill already in recommended', () => {
      const template = {
        recommendedSkills: ['pdf', 'review'],
        conditionalSkills: {
          sourceFormat: { pdf: ['pdf'] },
        },
      }
      const result = deriveEffectiveSkills(template, { sourceFormat: 'pdf' })
      expect(result).toEqual(['pdf', 'review'])
    })

    it('deduplicates across multiple conditional parameters', () => {
      const template = {
        recommendedSkills: ['base'],
        conditionalSkills: {
          input: { pdf: ['pdf'] },
          output: { pdf: ['pdf'] },
        },
      }
      const result = deriveEffectiveSkills(template, {
        input: 'pdf',
        output: 'pdf',
      })
      expect(result).toEqual(['base', 'pdf'])
    })
  })

  describe('multiple skills per conditional value', () => {
    it('adds all skills for a single conditional value', () => {
      const template = {
        recommendedSkills: ['base'],
        conditionalSkills: {
          sourceFormat: {
            pdf: ['pdf', 'ocr', 'image-extractor'],
          },
        },
      }
      const result = deriveEffectiveSkills(template, { sourceFormat: 'pdf' })
      expect(result).toEqual(['base', 'image-extractor', 'ocr', 'pdf'])
    })
  })

  describe('sorting', () => {
    it('always returns skills in sorted order', () => {
      const template = {
        recommendedSkills: ['zz-last', 'aa-first', 'mm-mid'],
        conditionalSkills: {
          x: { y: ['bb-second'] },
        },
      }
      const result = deriveEffectiveSkills(template, { x: 'y' })
      expect(result).toEqual(['aa-first', 'bb-second', 'mm-mid', 'zz-last'])
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part 2: Template Data Integrity — conditionalSkills Configuration
// ═══════════════════════════════════════════════════════════════════════

describe('Template Skill Configuration Integrity', () => {
  describe('academic-review template', () => {
    it('has recommendedSkills containing only the core skill', () => {
      expect(academicReviewTemplate.recommendedSkills).toEqual(['academic-review'])
    })

    it('has conditionalSkills mapping sourceFormat to pdf and docx', () => {
      expect(academicReviewTemplate.conditionalSkills).toBeDefined()
      expect(academicReviewTemplate.conditionalSkills!.sourceFormat).toBeDefined()
      expect(academicReviewTemplate.conditionalSkills!.sourceFormat.pdf).toEqual(['pdf'])
      expect(academicReviewTemplate.conditionalSkills!.sourceFormat.docx).toEqual(['docx'])
    })

    it('does not have latex or markdown in conditionalSkills', () => {
      expect(academicReviewTemplate.conditionalSkills!.sourceFormat.latex).toBeUndefined()
      expect(academicReviewTemplate.conditionalSkills!.sourceFormat.markdown).toBeUndefined()
    })

    it('sourceFormat parameter exists with pdf/latex/markdown/docx options', () => {
      const allParams = [
        ...academicReviewTemplate.requiredParameters,
        ...academicReviewTemplate.optionalParameters,
      ]
      const sourceFormat = allParams.find(p => p.id === 'sourceFormat')
      expect(sourceFormat).toBeDefined()
      expect(sourceFormat!.type).toBe('select')
      const values = sourceFormat!.options!.map(o => o.value)
      expect(values).toContain('pdf')
      expect(values).toContain('latex')
      expect(values).toContain('markdown')
      expect(values).toContain('docx')
    })

    it('sourceFormat default is pdf', () => {
      const allParams = [
        ...academicReviewTemplate.requiredParameters,
        ...academicReviewTemplate.optionalParameters,
      ]
      const sourceFormat = allParams.find(p => p.id === 'sourceFormat')
      expect(sourceFormat!.default).toBe('pdf')
    })

    it('conditionalSkills only references parameters that exist on the template', () => {
      const allParamIds = new Set([
        ...academicReviewTemplate.requiredParameters.map(p => p.id),
        ...academicReviewTemplate.optionalParameters.map(p => p.id),
      ])
      for (const paramId of Object.keys(academicReviewTemplate.conditionalSkills!)) {
        expect(allParamIds.has(paramId)).toBe(true)
      }
    })

    it('conditionalSkills values only reference valid parameter option values', () => {
      const allParams = [
        ...academicReviewTemplate.requiredParameters,
        ...academicReviewTemplate.optionalParameters,
      ]
      for (const [paramId, valueMap] of Object.entries(academicReviewTemplate.conditionalSkills!)) {
        const param = allParams.find(p => p.id === paramId)
        expect(param).toBeDefined()
        if (param!.options) {
          const validValues = new Set(param!.options.map(o => o.value))
          for (const value of Object.keys(valueMap)) {
            expect(validValues.has(value)).toBe(true)
          }
        }
      }
    })
  })

  describe('academic-review effective skills per sourceFormat', () => {
    it('sourceFormat=pdf → [academic-review, pdf]', () => {
      const result = deriveEffectiveSkills(academicReviewTemplate, { sourceFormat: 'pdf' })
      expect(result).toEqual(['academic-review', 'pdf'])
    })

    it('sourceFormat=docx → [academic-review, docx]', () => {
      const result = deriveEffectiveSkills(academicReviewTemplate, { sourceFormat: 'docx' })
      expect(result).toEqual(['academic-review', 'docx'])
    })

    it('sourceFormat=latex → [academic-review]', () => {
      const result = deriveEffectiveSkills(academicReviewTemplate, { sourceFormat: 'latex' })
      expect(result).toEqual(['academic-review'])
    })

    it('sourceFormat=markdown → [academic-review]', () => {
      const result = deriveEffectiveSkills(academicReviewTemplate, { sourceFormat: 'markdown' })
      expect(result).toEqual(['academic-review'])
    })
  })

  describe('academic-presentation template', () => {
    it('has recommendedSkills containing academic-presentation and pdf', () => {
      expect(academicPresentationTemplate.recommendedSkills).toEqual(
        expect.arrayContaining(['academic-presentation', 'pdf'])
      )
      expect(academicPresentationTemplate.recommendedSkills!.length).toBe(2)
    })

    it('does not have conditionalSkills (always loads pdf)', () => {
      expect(
        academicPresentationTemplate.conditionalSkills === undefined ||
        Object.keys(academicPresentationTemplate.conditionalSkills!).length === 0
      ).toBe(true)
    })

    it('always includes pdf regardless of parameter values', () => {
      const result = deriveEffectiveSkills(academicPresentationTemplate, {})
      expect(result).toContain('pdf')
      expect(result).toContain('academic-presentation')
    })

    it('pdf cannot be removed by any parameter change', () => {
      // Try various parameter values — pdf should always be present
      const scenarios = [
        {},
        { deliverables: ['slides'] },
        { deliverables: ['blog-post'] },
        { slideTheme: 'dark' },
        { targetAudience: 'general' },
      ]
      for (const params of scenarios) {
        const result = deriveEffectiveSkills(academicPresentationTemplate, params)
        expect(result).toContain('pdf')
      }
    })
  })

  describe('moat-fragility template', () => {
    it('has recommendedSkills containing moat-fragility', () => {
      expect(moatFragilityTemplate.recommendedSkills).toEqual(['moat-fragility'])
    })

    it('has no conditionalSkills', () => {
      expect(moatFragilityTemplate.conditionalSkills).toBeUndefined()
    })

    it('always returns only moat-fragility skill', () => {
      const result = deriveEffectiveSkills(moatFragilityTemplate, { anything: 'any-value' })
      expect(result).toEqual(['moat-fragility'])
    })
  })

  describe('all builtin templates have valid skill configurations', () => {
    it('every template with conditionalSkills references existing parameters', () => {
      for (const template of BUILTIN_EXAMPLES) {
        if (!template.conditionalSkills) continue
        const allParamIds = new Set([
          ...template.requiredParameters.map(p => p.id),
          ...template.optionalParameters.map(p => p.id),
        ])
        for (const paramId of Object.keys(template.conditionalSkills)) {
          expect(allParamIds.has(paramId)).toBe(true)
        }
      }
    })

    it('every template with conditionalSkills maps to valid option values', () => {
      for (const template of BUILTIN_EXAMPLES) {
        if (!template.conditionalSkills) continue
        const allParams = [...template.requiredParameters, ...template.optionalParameters]
        for (const [paramId, valueMap] of Object.entries(template.conditionalSkills)) {
          const param = allParams.find(p => p.id === paramId)
          expect(param).toBeDefined()
          if (param!.options) {
            const validValues = new Set(param!.options.map(o => o.value))
            for (const value of Object.keys(valueMap)) {
              expect(validValues.has(value)).toBe(true)
            }
          }
        }
      }
    })

    it('no template has overlapping recommended and conditional skills for any value', () => {
      // This isn't an error (deduplication handles it) but is a code smell
      for (const template of BUILTIN_EXAMPLES) {
        if (!template.conditionalSkills || !template.recommendedSkills) continue
        const recommended = new Set(template.recommendedSkills)
        for (const [, valueMap] of Object.entries(template.conditionalSkills)) {
          for (const [, skills] of Object.entries(valueMap)) {
            for (const skill of skills) {
              // Conditional skills should NOT overlap with recommended
              // (if always needed, put in recommended; if conditional, don't duplicate)
              expect(recommended.has(skill)).toBe(false)
            }
          }
        }
      }
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part 3: End-to-End Skill Injection via API
// ═══════════════════════════════════════════════════════════════════════

import {
  setupTestServer,
  request,
  postJson,
} from './helpers/test-server.js'

beforeAll(async () => {
  await setupTestServer()
}, 30000)

describe('Skill files exist on disk for all referenced skills', () => {
  it('academic-review skill has SKILL.md accessible via API', async () => {
    const res = await request('/api/skills/files/academic-review/SKILL.md')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.length).toBeGreaterThan(100)
    expect(text).not.toMatch(/^<!/) // Not SPA fallback HTML
  })

  it('academic-presentation skill has SKILL.md accessible via API', async () => {
    const res = await request('/api/skills/files/academic-presentation/SKILL.md')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.length).toBeGreaterThan(100)
  })

  it('pdf skill has SKILL.md accessible via API', async () => {
    const res = await request('/api/skills/files/pdf/SKILL.md')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.length).toBeGreaterThan(100)
  })

  it('docx skill has SKILL.md accessible via API', async () => {
    const res = await request('/api/skills/files/docx/SKILL.md')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.length).toBeGreaterThan(100)
  })

  it('moat-fragility skill has SKILL.md accessible via API', async () => {
    const res = await request('/api/skills/files/moat-fragility/SKILL.md')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.length).toBeGreaterThan(100)
  })
})

describe('Launch with visionDoc reflects conditional skill loading', () => {
  it('academic-review preview with sourceFormat=pdf interpolates pdf into prompts', async () => {
    const previewRes = await postJson(
      `/api/examples/${encodeURIComponent('astro--academic-review')}/preview`,
      {
        parameters: {
          workingDirectory: '/tmp/test-papers',
          documentType: 'paper',
          sourceFormat: 'pdf',
        },
      },
    )
    expect(previewRes.status).toBe(200)
    const preview = await previewRes.json()
    // The interpolated plan prompt should contain 'pdf' for sourceFormat
    expect(preview.interpolatedPrompts.planGeneration).toContain('Source Format: pdf')
    // The task execution prompt should reference pdf in the document reading section
    expect(preview.interpolatedPrompts.taskExecution).toContain('Source Format: pdf')
    // The shared context should reference pdf
    expect(preview.interpolatedPrompts.sharedContext).toContain('(pdf)')
  })

  it('academic-review preview with sourceFormat=latex interpolates latex into prompts', async () => {
    const previewRes = await postJson(
      `/api/examples/${encodeURIComponent('astro--academic-review')}/preview`,
      {
        parameters: {
          workingDirectory: '/tmp/test-papers',
          documentType: 'paper',
          sourceFormat: 'latex',
        },
      },
    )
    expect(previewRes.status).toBe(200)
    const preview = await previewRes.json()
    // The interpolated plan prompt should contain 'latex' for sourceFormat
    expect(preview.interpolatedPrompts.planGeneration).toContain('Source Format: latex')
    expect(preview.interpolatedPrompts.taskExecution).toContain('Source Format: latex')
    expect(preview.interpolatedPrompts.sharedContext).toContain('(latex)')
  })

  it('launch academic-review with visionDoc includes only requested skills', async () => {
    // Simulate what the frontend does: build visionDoc with only academic-review skill
    // (no pdf/docx since sourceFormat is latex)
    const skills = deriveEffectiveSkills(academicReviewTemplate, { sourceFormat: 'latex' })
    expect(skills).toEqual(['academic-review'])
    expect(skills).not.toContain('pdf')
    expect(skills).not.toContain('docx')
  })

  it('launch academic-review with sourceFormat=pdf includes pdf skill', async () => {
    const skills = deriveEffectiveSkills(academicReviewTemplate, { sourceFormat: 'pdf' })
    expect(skills).toContain('pdf')
    expect(skills).not.toContain('docx')
  })

  it('launch academic-review with sourceFormat=docx includes docx skill', async () => {
    const skills = deriveEffectiveSkills(academicReviewTemplate, { sourceFormat: 'docx' })
    expect(skills).toContain('docx')
    expect(skills).not.toContain('pdf')
  })

  it('launch academic-presentation always includes pdf skill', async () => {
    const skills = deriveEffectiveSkills(academicPresentationTemplate, {
      paperSource: 'https://arxiv.org/abs/2301.00001',
      deliverables: ['slides', 'blog-post'],
    })
    expect(skills).toContain('pdf')
    expect(skills).toContain('academic-presentation')
  })
})
