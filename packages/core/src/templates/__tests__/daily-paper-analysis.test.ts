/**
 * Tests for the Daily Paper Analysis template.
 *
 * Verifies:
 * - Template registration in BUILTIN_TEMPLATES
 * - Prompt interpolation with all parameters
 * - Empty parameter line removal (optional params)
 * - Corner case instructions in interpolated prompts
 * - Skill resolution
 * - Parameter schema correctness
 */

import { describe, it, expect } from 'vitest'
import { dailyPaperAnalysisTemplate } from '../examples/daily-paper-analysis.js'
import {
  BUILTIN_TEMPLATES,
  getTemplateById,
  BUILTIN_TEMPLATE_IDS,
} from '../examples/index.js'
import { interpolatePrompt } from '../interpolate.js'
import { deriveEffectiveSkills } from '../skill-resolution.js'

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Minimal parameters simulating what the backend passes when only required
 * fields are filled. The backend resolves all parameter keys, setting empty
 * string for unset optionals, so we mirror that here.
 */
const REQUIRED_PARAMS = {
  workingDirectory: '/tmp/daily-papers',
  date: '2025-03-10',
  topN: '',
  additionalPapers: '',
  customRequirements: '',
  analysisDepth: '',
  filterKeywords: '',
}

/** Full parameter set including all optionals */
const FULL_PARAMS = {
  workingDirectory: '/tmp/daily-papers',
  date: '2025-03-10',
  topN: '10',
  additionalPapers:
    'https://arxiv.org/abs/2501.12345\nAttention Is All You Need',
  customRequirements: 'Focus on LLM agent papers',
  analysisDepth: 'comprehensive',
  filterKeywords: 'LLM, agent, reasoning',
}

// ── Registration ─────────────────────────────────────────────────────────

describe('template registration', () => {
  it('is included in BUILTIN_TEMPLATES', () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id)
    expect(ids).toContain('astro--daily-paper-analysis')
  })

  it('is findable by ID', () => {
    const found = getTemplateById('astro--daily-paper-analysis')
    expect(found).toBeDefined()
    expect(found!.id).toBe('astro--daily-paper-analysis')
  })

  it('ID is in BUILTIN_TEMPLATE_IDS set', () => {
    expect(BUILTIN_TEMPLATE_IDS.has('astro--daily-paper-analysis')).toBe(true)
  })
})

// ── Parameter Schema ─────────────────────────────────────────────────────

describe('parameter schema', () => {
  const { requiredParameters, optionalParameters } =
    dailyPaperAnalysisTemplate

  it('has workingDirectory and date as required', () => {
    const ids = requiredParameters.map((p) => p.id)
    expect(ids).toContain('workingDirectory')
    expect(ids).toContain('date')
  })

  it('date has YYYY-MM-DD validation pattern', () => {
    const dateParam = requiredParameters.find((p) => p.id === 'date')!
    expect(dateParam.validation?.pattern).toBeDefined()
    const re = new RegExp(dateParam.validation!.pattern!)
    expect(re.test('2025-03-10')).toBe(true)
    expect(re.test('not-a-date')).toBe(false)
    expect(re.test('2025/03/10')).toBe(false)
  })

  it('topN defaults to 10', () => {
    const topN = optionalParameters!.find((p) => p.id === 'topN')!
    expect(topN.default).toBe('10')
  })

  it('analysisDepth defaults to comprehensive', () => {
    const depth = optionalParameters!.find((p) => p.id === 'analysisDepth')!
    expect(depth.default).toBe('comprehensive')
  })

  it('customRequirements and additionalPapers are prominent', () => {
    const custom = optionalParameters!.find(
      (p) => p.id === 'customRequirements',
    )!
    const additional = optionalParameters!.find(
      (p) => p.id === 'additionalPapers',
    )!
    expect(custom.prominent).toBe(true)
    expect(additional.prominent).toBe(true)
  })

  it('topN, analysisDepth, filterKeywords are NOT prominent', () => {
    const topN = optionalParameters!.find((p) => p.id === 'topN')!
    const depth = optionalParameters!.find((p) => p.id === 'analysisDepth')!
    const filter = optionalParameters!.find((p) => p.id === 'filterKeywords')!
    expect(topN.prominent).toBeFalsy()
    expect(depth.prominent).toBeFalsy()
    expect(filter.prominent).toBeFalsy()
  })

  it('all parameter IDs are unique', () => {
    const all = [...requiredParameters, ...(optionalParameters ?? [])]
    const ids = all.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ── Prompt Interpolation: planGeneration ─────────────────────────────────

describe('planGeneration interpolation', () => {
  const prompt = dailyPaperAnalysisTemplate.prompts.planGeneration

  it('substitutes all required parameters', () => {
    const result = interpolatePrompt(prompt, REQUIRED_PARAMS)
    expect(result).toContain('/tmp/daily-papers')
    expect(result).toContain('2025-03-10')
  })

  it('substitutes all optional parameters when provided', () => {
    const result = interpolatePrompt(prompt, FULL_PARAMS)
    expect(result).toContain('10') // topN
    expect(result).toContain('https://arxiv.org/abs/2501.12345')
    expect(result).toContain('Focus on LLM agent papers')
    expect(result).toContain('comprehensive')
    expect(result).toContain('LLM, agent, reasoning')
  })

  it('removes lines with empty optional parameters', () => {
    const result = interpolatePrompt(prompt, REQUIRED_PARAMS)
    // Lines with unfilled placeholders should be stripped entirely
    expect(result).not.toContain('{{additionalPapers}}')
    expect(result).not.toContain('{{customRequirements}}')
    expect(result).not.toContain('{{filterKeywords}}')
    expect(result).not.toContain('{{topN}}')
    expect(result).not.toContain('{{analysisDepth}}')
  })

  it('contains HuggingFace API endpoint', () => {
    const result = interpolatePrompt(prompt, FULL_PARAMS)
    expect(result).toContain(
      'https://huggingface.co/api/daily_papers?date=2025-03-10',
    )
  })

  it('contains AlphaXiv endpoints', () => {
    const result = interpolatePrompt(prompt, FULL_PARAMS)
    expect(result).toContain('alphaxiv.org/overview/')
    expect(result).toContain('alphaxiv.org/abs/')
  })

  it('contains STOP instruction for empty API response', () => {
    const result = interpolatePrompt(prompt, FULL_PARAMS)
    expect(result).toMatch(/STOP/)
    expect(result).toContain('No HuggingFace Daily Papers found')
  })

  it('contains paper resolution instructions for additional papers', () => {
    const result = interpolatePrompt(prompt, FULL_PARAMS)
    expect(result).toContain('arXiv links')
    expect(result).toContain('GitHub links')
    expect(result).toContain('Paper titles')
    expect(result).toContain('Could not resolve')
  })

  it('contains AlphaXiv fallback instructions', () => {
    const result = interpolatePrompt(prompt, FULL_PARAMS)
    expect(result).toContain('AlphaXiv fallback')
    expect(result).toContain('ai_summary')
  })

  it('contains worktree copy instruction', () => {
    const result = interpolatePrompt(prompt, FULL_PARAMS)
    expect(result).toContain('worktree')
  })

  it('has no remaining unsubstituted placeholders with full params', () => {
    const result = interpolatePrompt(prompt, FULL_PARAMS)
    expect(result).not.toMatch(/\{\{[a-zA-Z]+\}\}/)
  })
})

// ── Prompt Interpolation: sharedContext ───────────────────────────────────

describe('sharedContext interpolation', () => {
  const sharedContext = dailyPaperAnalysisTemplate.prompts.sharedContext!

  it('contains color palette', () => {
    expect(sharedContext).toContain('#FAF8F5')
    expect(sharedContext).toContain('#C4A882')
    expect(sharedContext).toContain('#8FA8B8')
    expect(sharedContext).toContain('#A8B8A0')
  })

  it('contains typography spec', () => {
    expect(sharedContext).toContain('Palatino')
    expect(sharedContext).toContain('Fira Code')
  })

  it('contains box style names', () => {
    expect(sharedContext).toContain('box-pink')
    expect(sharedContext).toContain('box-blue')
    expect(sharedContext).toContain('box-green')
    expect(sharedContext).toContain('box-gold')
    expect(sharedContext).toContain('box-lavender')
    expect(sharedContext).toContain('box-red')
  })

  it('contains output folder structure', () => {
    expect(sharedContext).toContain('daily-digest-')
    expect(sharedContext).toContain('papers/')
    expect(sharedContext).toContain('figures/')
    expect(sharedContext).toContain('daily-papers.json')
  })

  it('contains corner case handling section', () => {
    expect(sharedContext).toContain('Corner Cases')
    expect(sharedContext).toContain('No papers for date')
    expect(sharedContext).toContain('API error')
    expect(sharedContext).toContain('AlphaXiv unavailable')
    expect(sharedContext).toContain('User paper not resolvable')
    expect(sharedContext).toContain('Fewer papers than topN')
  })

  it('contains user-specified paper handling', () => {
    expect(sharedContext).toContain('User-Specified Papers')
    expect(sharedContext).toContain('not in HF Daily Papers')
    expect(sharedContext).toContain('deduplicate')
  })

  it('interpolates date placeholder in sharedContext', () => {
    const result = interpolatePrompt(sharedContext, FULL_PARAMS)
    expect(result).toContain('2025-03-10')
    // Date placeholder should be substituted
    expect(result).not.toContain('{{date}}')
  })
})

// ── Skill Resolution ─────────────────────────────────────────────────────

describe('skill resolution', () => {
  it('derives daily-paper-analysis as the skill', () => {
    const skills = deriveEffectiveSkills(
      dailyPaperAnalysisTemplate,
      FULL_PARAMS,
    )
    expect(skills).toContain('daily-paper-analysis')
  })

  it('has no conditional skills', () => {
    expect(dailyPaperAnalysisTemplate.conditionalSkills).toBeUndefined()
  })

  it('execution config references the skill', () => {
    expect(dailyPaperAnalysisTemplate.execution!.skills).toContain(
      'daily-paper-analysis',
    )
  })
})

// ── Execution Config ─────────────────────────────────────────────────────

describe('execution config', () => {
  it('uses mixed verification', () => {
    expect(dailyPaperAnalysisTemplate.execution!.defaultVerification).toBe(
      'mixed',
    )
  })

  it('has reasonable budget per task', () => {
    expect(
      dailyPaperAnalysisTemplate.execution!.maxBudgetPerTask,
    ).toBeGreaterThan(0)
    expect(
      dailyPaperAnalysisTemplate.execution!.maxBudgetPerTask,
    ).toBeLessThanOrEqual(10)
  })

  it('allows enough concurrent tasks for parallel paper analysis', () => {
    expect(
      dailyPaperAnalysisTemplate.parallelization!.maxConcurrentTasks,
    ).toBeGreaterThanOrEqual(4)
  })
})

// ── Plan Hints ───────────────────────────────────────────────────────────

describe('plan hints', () => {
  it('has reasonable node count range', () => {
    const { min, max } =
      dailyPaperAnalysisTemplate.planHints!.targetNodeCount!
    expect(min).toBeGreaterThanOrEqual(3)
    expect(max).toBeLessThanOrEqual(20)
    expect(max).toBeGreaterThan(min)
  })

  it('has suggested milestones', () => {
    const milestones =
      dailyPaperAnalysisTemplate.planHints!.suggestedMilestones!
    expect(milestones.length).toBeGreaterThanOrEqual(3)
    // First milestone should be about data retrieval/validation
    expect(milestones[0].title).toMatch(/data|retriev|validat/i)
  })

  it('prefers parallel tasks', () => {
    expect(dailyPaperAnalysisTemplate.planHints!.preferParallelTasks).toBe(
      true,
    )
  })
})

// ── Full Pipeline Simulation ─────────────────────────────────────────────

describe('full plan-mode simulation', () => {
  it('assembles complete plan prompt (sharedContext + planGeneration)', () => {
    // Simulates what the backend does in server/routes/examples.ts:566-568
    const sharedContext = dailyPaperAnalysisTemplate.prompts.sharedContext!
    const planGeneration = dailyPaperAnalysisTemplate.prompts.planGeneration

    const interpolatedShared = interpolatePrompt(sharedContext, FULL_PARAMS)
    const interpolatedPlan = interpolatePrompt(planGeneration, FULL_PARAMS)

    const fullDescription = `${interpolatedShared}\n\n---\n\n${interpolatedPlan}`

    // Should contain both sections
    expect(fullDescription).toContain('Color Palette')
    expect(fullDescription).toContain('Planning Guidelines')

    // Should have concrete date throughout
    expect(fullDescription).toContain('2025-03-10')

    // Should have no remaining placeholders
    expect(fullDescription).not.toMatch(/\{\{[a-zA-Z]+\}\}/)

    // Should contain the critical stop instruction
    expect(fullDescription).toContain('STOP')

    // Should reference the working directory
    expect(fullDescription).toContain('/tmp/daily-papers')
  })

  it('handles minimal params (only required, optionals empty)', () => {
    const sharedContext = dailyPaperAnalysisTemplate.prompts.sharedContext!
    const planGeneration = dailyPaperAnalysisTemplate.prompts.planGeneration

    const interpolatedShared = interpolatePrompt(sharedContext, REQUIRED_PARAMS)
    const interpolatedPlan = interpolatePrompt(planGeneration, REQUIRED_PARAMS)

    const fullDescription = `${interpolatedShared}\n\n---\n\n${interpolatedPlan}`

    // Required params present
    expect(fullDescription).toContain('/tmp/daily-papers')
    expect(fullDescription).toContain('2025-03-10')

    // No leftover placeholder syntax
    expect(fullDescription).not.toMatch(/\{\{[a-zA-Z]+\}\}/)

    // Critical instructions still present even without optional params
    expect(fullDescription).toContain('STOP')
    expect(fullDescription).toContain('AlphaXiv')
    expect(fullDescription).toContain('huggingface.co/api/daily_papers')
  })
})
