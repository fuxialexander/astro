/**
 * Code Documentation Generator Template Validation
 *
 * This test suite validates the code-documentation template by:
 * 1. Verifying template identity and structure
 * 2. Testing prompt interpolation with real parameter values
 * 3. Validating parameter schemas and constraints
 * 4. Checking input parallelization configuration
 * 5. Running the template through the validator
 * 6. Providing example outputs for manual review
 *
 * Run with: npx vitest run packages/core/src/templates/examples/__tests__/code-documentation.validation.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { codeDocumentationTemplate } from '../code-documentation.js'
import { validateTemplate, formatValidationResult } from '../../template-validator.js'
import { BUILTIN_TEMPLATES, getTemplateById, getTemplatesByCategory } from '../index.js'
import type { UseCaseTemplate } from '../../../types/use-case-template.js'

// ────────────────────────────────────────────────────────────────────────────
// Test Repository: Hono (lightweight web framework)
// https://github.com/honojs/hono
// ────────────────────────────────────────────────────────────────────────────

const TEST_REPO = {
  repoUrls: 'https://github.com/honojs/hono',
  name: 'Hono',
  description: 'Lightweight, ultrafast web framework for Cloudflare Workers, Fastly, Deno, Bun, and Node.js',
  language: 'typescript',
  primaryModules: ['hono', 'hono/adapter', 'hono/middleware', 'hono/utils'],
}

const TEST_PARAMETERS = {
  repoUrls: TEST_REPO.repoUrls,
  language: 'typescript',
  branch: 'main',
  docFormat: 'docusaurus',
  docSections: ['api', 'architecture', 'quickstart', 'contributing'],
  includeExamples: true,
  audience: 'developers',
  existingDocs: 'augment',
  maxDepth: 'full',
}

const MULTI_REPO_PARAMETERS = {
  ...TEST_PARAMETERS,
  repoUrls: 'https://github.com/honojs/hono\nhttps://github.com/honojs/middleware\nhttps://github.com/honojs/vite-plugins',
}

// ────────────────────────────────────────────────────────────────────────────
// Expected Output Structure
// ────────────────────────────────────────────────────────────────────────────

/** Expected output structure for reference (used in example outputs below) */
export const EXPECTED_OUTPUT_STRUCTURE = {
  rootFiles: [
    'index.md',       // Landing page
    'sidebar.js',     // Navigation (Docusaurus)
  ],
  directories: {
    'getting-started': [
      'installation.md',
      'quickstart.md',
      'configuration.md',
    ],
    'api': [
      'overview.md',
      'modules/',
      'classes/',
      'functions/',
    ],
    'architecture': [
      'overview.md',
      'design-decisions.md',
      'data-flow.md',
    ],
    'contributing': [
      'development-setup.md',
      'testing.md',
      'pull-requests.md',
    ],
    'guides': [
      'basic-usage.md',
      'advanced.md',
    ],
  },
}

// ────────────────────────────────────────────────────────────────────────────
// Interpolation Helper
// ────────────────────────────────────────────────────────────────────────────

function interpolatePrompt(template: string, params: Record<string, unknown>): string {
  let result = template
  for (const [key, value] of Object.entries(params)) {
    const placeholder = `{{${key}}}`
    const strValue = Array.isArray(value) ? value.join(', ') : String(value ?? '')
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), strValue)
  }
  return result
}

// ────────────────────────────────────────────────────────────────────────────
// Template Structure Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Code Documentation Generator Template', () => {
  let template: UseCaseTemplate

  beforeAll(() => {
    template = codeDocumentationTemplate
  })

  describe('Template Identity', () => {
    it('has correct identity fields', () => {
      expect(template.id).toBe('astro/code-documentation')
      expect(template.name).toBe('Code Documentation Generator')
      expect(template.category).toBe('documentation')
      expect(template.version).toBe('1.0.0')
      expect(template.maturity).toBe('beta')
      expect(template.icon).toBe('📚')
    })

    it('has meaningful tags for search', () => {
      expect(template.tags).toContain('documentation')
      expect(template.tags).toContain('api-reference')
      expect(template.tags).toContain('github')
      expect(template.tags).toContain('markdown')
      expect(template.tags!.length).toBeGreaterThanOrEqual(4)
    })

    it('has valid metadata', () => {
      expect(template.source).toBe('builtin')
      expect(template.enabled).toBe(true)
      expect(template.domains).toBeDefined()
      expect(template.domains!.length).toBeGreaterThan(0)
    })

    it('has description within length limits', () => {
      expect(template.description.length).toBeGreaterThanOrEqual(50)
      expect(template.description.length).toBeLessThanOrEqual(2000)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Parameter Validation
  // ────────────────────────────────────────────────────────────────────────

  describe('Required Parameters', () => {
    it('has exactly 2 required parameters', () => {
      expect(template.requiredParameters).toHaveLength(2)
    })

    it('defines repoUrls parameter correctly', () => {
      const repoUrls = template.requiredParameters.find(p => p.id === 'repoUrls')
      expect(repoUrls).toBeDefined()
      expect(repoUrls!.type).toBe('string')
      expect(repoUrls!.required).toBe(true)
      expect(repoUrls!.validation?.pattern).toBeDefined()
      expect(repoUrls!.placeholder).toContain('github.com')
      expect(repoUrls!.group).toBe('source')
    })

    it('defines language parameter correctly', () => {
      const language = template.requiredParameters.find(p => p.id === 'language')
      expect(language).toBeDefined()
      expect(language!.type).toBe('select')
      expect(language!.required).toBe(true)
      expect(language!.default).toBe('typescript')
      expect(language!.options!.length).toBeGreaterThanOrEqual(6)

      // Verify all major languages are covered
      const languageValues = language!.options!.map(o => o.value)
      expect(languageValues).toContain('typescript')
      expect(languageValues).toContain('python')
      expect(languageValues).toContain('go')
      expect(languageValues).toContain('rust')
      expect(languageValues).toContain('java')
      expect(languageValues).toContain('cpp')
    })
  })

  describe('Optional Parameters', () => {
    it('has at least 6 optional parameters', () => {
      expect(template.optionalParameters.length).toBeGreaterThanOrEqual(6)
    })

    it('defines all expected optional parameters', () => {
      const paramIds = template.optionalParameters.map(p => p.id)
      expect(paramIds).toContain('branch')
      expect(paramIds).toContain('docFormat')
      expect(paramIds).toContain('docSections')
      expect(paramIds).toContain('includeExamples')
      expect(paramIds).toContain('audience')
      expect(paramIds).toContain('existingDocs')
      expect(paramIds).toContain('maxDepth')
    })

    it('defines docFormat with documentation site generators', () => {
      const docFormat = template.optionalParameters.find(p => p.id === 'docFormat')
      expect(docFormat).toBeDefined()
      expect(docFormat!.type).toBe('select')
      expect(docFormat!.default).toBe('docusaurus')

      const formatValues = docFormat!.options!.map(o => o.value)
      expect(formatValues).toContain('docusaurus')
      expect(formatValues).toContain('vitepress')
      expect(formatValues).toContain('mkdocs')
      expect(formatValues).toContain('markdown')
    })

    it('defines docSections as multi-select', () => {
      const docSections = template.optionalParameters.find(p => p.id === 'docSections')
      expect(docSections).toBeDefined()
      expect(docSections!.type).toBe('multi-select')
      expect(docSections!.default).toEqual(['api', 'architecture', 'quickstart', 'contributing'])

      const sectionValues = docSections!.options!.map(o => o.value)
      expect(sectionValues).toContain('api')
      expect(sectionValues).toContain('architecture')
      expect(sectionValues).toContain('quickstart')
      expect(sectionValues).toContain('tutorials')
      expect(sectionValues).toContain('contributing')
      expect(sectionValues).toContain('faq')
      expect(sectionValues).toContain('changelog')
    })

    it('defines includeExamples as boolean', () => {
      const includeExamples = template.optionalParameters.find(p => p.id === 'includeExamples')
      expect(includeExamples).toBeDefined()
      expect(includeExamples!.type).toBe('boolean')
      expect(includeExamples!.default).toBe(true)
    })

    it('all select parameters have options', () => {
      const selectParams = template.optionalParameters.filter(
        p => p.type === 'select' || p.type === 'multi-select'
      )
      for (const param of selectParams) {
        expect(param.options).toBeDefined()
        expect(param.options!.length).toBeGreaterThan(0)
        // Ensure each option has label and value
        for (const opt of param.options!) {
          expect(opt.label).toBeTruthy()
          expect(opt.value).toBeTruthy()
        }
      }
    })

    it('has no duplicate parameter IDs', () => {
      const allParams = [...template.requiredParameters, ...template.optionalParameters]
      const ids = allParams.map(p => p.id)
      const uniqueIds = new Set(ids)
      expect(ids.length).toBe(uniqueIds.size)
    })

    it('all parameters have groups and order', () => {
      const allParams = [...template.requiredParameters, ...template.optionalParameters]
      for (const param of allParams) {
        expect(param.group).toBeDefined()
        expect(param.order).toBeDefined()
      }
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Prompt Tests
  // ────────────────────────────────────────────────────────────────────────

  describe('Prompt Configuration', () => {
    it('has all four prompt types defined', () => {
      expect(template.prompts.planGeneration).toBeDefined()
      expect(template.prompts.taskExecution).toBeDefined()
      expect(template.prompts.planRefinement).toBeDefined()
      expect(template.prompts.sharedContext).toBeDefined()
    })

    it('prompts have substantial content', () => {
      expect(template.prompts.planGeneration.length).toBeGreaterThan(1000)
      expect(template.prompts.taskExecution!.length).toBeGreaterThan(500)
      expect(template.prompts.planRefinement!.length).toBeGreaterThan(100)
      expect(template.prompts.sharedContext!.length).toBeGreaterThan(500)
    })
  })

  describe('Prompt Interpolation', () => {
    it('interpolates planGeneration prompt with all parameters', () => {
      const prompt = interpolatePrompt(template.prompts.planGeneration, TEST_PARAMETERS)

      // Should contain the repo URL
      expect(prompt).toContain(TEST_REPO.repoUrls)
      // Should contain language
      expect(prompt).toContain('typescript')
      // Should contain format
      expect(prompt).toContain('docusaurus')
      // Should contain audience
      expect(prompt).toContain('developers')
      // Should contain doc sections
      expect(prompt).toContain('api')
      expect(prompt).toContain('architecture')
    })

    it('interpolates taskExecution prompt correctly', () => {
      const prompt = interpolatePrompt(template.prompts.taskExecution!, TEST_PARAMETERS)

      expect(prompt).toContain(TEST_REPO.repoUrls)
      expect(prompt).toContain('typescript')
      expect(prompt).toContain('docusaurus')
      expect(prompt).toContain('developers')
    })

    it('interpolates planRefinement prompt with context', () => {
      const prompt = interpolatePrompt(template.prompts.planRefinement!, TEST_PARAMETERS)

      expect(prompt).toContain(TEST_REPO.repoUrls)
      expect(prompt).toContain('typescript')
      expect(prompt).toContain('full')  // maxDepth
      expect(prompt).toContain('augment')  // existingDocs
    })

    it('handles empty optional parameters gracefully', () => {
      const params = {
        ...TEST_PARAMETERS,
        branch: '',
        docSections: [],
      }
      const prompt = interpolatePrompt(template.prompts.planGeneration, params)

      expect(prompt).toBeDefined()
      expect(prompt.length).toBeGreaterThan(1000)
    })

    it('handles multi-repo input in prompts', () => {
      const prompt = interpolatePrompt(template.prompts.planGeneration, MULTI_REPO_PARAMETERS)

      expect(prompt).toContain('honojs/hono')
      expect(prompt).toContain('honojs/middleware')
      expect(prompt).toContain('honojs/vite-plugins')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Plan Generation Prompt Quality
  // ────────────────────────────────────────────────────────────────────────

  describe('Plan Generation Prompt Quality', () => {
    it('includes milestone structure guidance', () => {
      const prompt = template.prompts.planGeneration

      expect(prompt).toContain('Repository Analysis')
      expect(prompt).toContain('Content Extraction')
      expect(prompt).toContain('Documentation Generation')
      expect(prompt).toContain('Assembly')
    })

    it('includes output directory structure', () => {
      const prompt = template.prompts.planGeneration

      expect(prompt).toContain('docs/')
      expect(prompt).toContain('index.md')
      expect(prompt).toContain('getting-started/')
      expect(prompt).toContain('api/')
      expect(prompt).toContain('architecture/')
      expect(prompt).toContain('contributing/')
    })

    it('includes parallelism guidance', () => {
      const prompt = template.prompts.planGeneration

      expect(prompt).toContain('parallel')
      expect(prompt).toMatch(/independent.*parallel|parallel.*independent/i)
    })

    it('includes multi-repo guidance', () => {
      const prompt = template.prompts.planGeneration

      expect(prompt).toContain('Multiple Repositories')
      expect(prompt).toContain('independent branch')
      expect(prompt).toContain('x offset of 260')
    })

    it('includes language-specific guidance', () => {
      const prompt = template.prompts.planGeneration

      expect(prompt).toContain('TypeScript')
      expect(prompt).toContain('TypeDoc')
      expect(prompt).toContain('Python')
      expect(prompt).toContain('Sphinx')
      expect(prompt).toContain('Go')
      expect(prompt).toContain('godoc')
      expect(prompt).toContain('Rust')
      expect(prompt).toContain('rustdoc')
    })

    it('includes task granularity guidance', () => {
      const prompt = template.prompts.planGeneration

      expect(prompt).toContain('Task Granularity')
      expect(prompt).toContain('1 task')
    })

    it('includes label definitions', () => {
      const prompt = template.prompts.planGeneration

      expect(prompt).toContain('l1=')
      expect(prompt).toContain('l2=')
      expect(prompt).toContain('l5=')
    })

    it('includes verification guidance', () => {
      const prompt = template.prompts.planGeneration

      expect(prompt).toContain('"auto"')
      expect(prompt).toContain('"human"')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Task Execution Prompt Quality
  // ────────────────────────────────────────────────────────────────────────

  describe('Task Execution Prompt Quality', () => {
    it('includes markdown conventions', () => {
      const prompt = template.prompts.taskExecution!

      expect(prompt).toContain('ATX-style')
      expect(prompt).toContain('code fences')
      expect(prompt).toContain('relative links')
    })

    it('includes API documentation format template', () => {
      const prompt = template.prompts.taskExecution!

      expect(prompt).toContain('functionName')
      expect(prompt).toContain('Parameters')
      expect(prompt).toContain('Returns')
      expect(prompt).toContain('Throws')
      expect(prompt).toContain('Example')
      expect(prompt).toContain('See Also')
    })

    it('includes architecture documentation guidance', () => {
      const prompt = template.prompts.taskExecution!

      expect(prompt).toContain('Mermaid')
      expect(prompt).toContain('design decisions')
      expect(prompt).toContain('module boundaries')
      expect(prompt).toContain('data flow')
    })

    it('includes format-specific guidance', () => {
      const prompt = template.prompts.taskExecution!

      expect(prompt).toContain('docusaurus')
      expect(prompt).toContain('vitepress')
      expect(prompt).toContain('mkdocs')
      expect(prompt).toContain('frontmatter')
    })

    it('includes code example standards', () => {
      const prompt = template.prompts.taskExecution!

      expect(prompt).toContain('runnable')
      expect(prompt).toContain('simple and complex')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Shared Context Quality
  // ────────────────────────────────────────────────────────────────────────

  describe('Shared Context Quality', () => {
    it('includes documentation quality principles', () => {
      const prompt = template.prompts.sharedContext!

      expect(prompt).toContain('Accuracy')
      expect(prompt).toContain('Completeness')
      expect(prompt).toContain('Clarity')
      expect(prompt).toContain('Examples')
      expect(prompt).toContain('Searchability')
    })

    it('includes code analysis strategies', () => {
      const prompt = template.prompts.sharedContext!

      expect(prompt).toContain('AST')
      expect(prompt).toContain('JSDoc')
      expect(prompt).toContain('docstrings')
      expect(prompt).toContain('test files')
    })

    it('includes repository structure analysis', () => {
      const prompt = template.prompts.sharedContext!

      expect(prompt).toContain('entry points')
      expect(prompt).toContain('module dependencies')
      expect(prompt).toContain('configuration files')
      expect(prompt).toContain('example directories')
    })

    it('includes common documentation gaps', () => {
      const prompt = template.prompts.sharedContext!

      expect(prompt).toContain('prerequisites')
      expect(prompt).toContain('environment variables')
      expect(prompt).toContain('migration guides')
      expect(prompt).toContain('error handling')
    })

    it('includes Mermaid diagram templates', () => {
      const prompt = template.prompts.sharedContext!

      expect(prompt).toContain('```mermaid')
      expect(prompt).toContain('graph TD')
      expect(prompt).toContain('sequenceDiagram')
      expect(prompt).toContain('classDiagram')
    })

    it('includes language-specific documentation conventions', () => {
      const prompt = template.prompts.sharedContext!

      expect(prompt).toContain('TypeDoc')
      expect(prompt).toContain('Sphinx')
      expect(prompt).toContain('godoc')
      expect(prompt).toContain('rustdoc')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Output Format
  // ────────────────────────────────────────────────────────────────────────

  describe('Output Format', () => {
    it('has markdown output type', () => {
      expect(template.outputFormat).toBeDefined()
      expect(template.outputFormat?.type).toBe('markdown')
    })

    it('has description of the output', () => {
      expect(template.outputFormat?.description).toBeDefined()
      expect(template.outputFormat?.description).toContain('documentation suite')
      expect(template.outputFormat?.description).toContain('markdown')
    })

    it('has a comprehensive example output', () => {
      const example = template.outputFormat?.example ?? ''

      // Should show frontmatter
      expect(example).toContain('sidebar_position')
      expect(example).toContain('title')

      // Should show API documentation format
      expect(example).toContain('Parameters')
      expect(example).toContain('Returns')
      expect(example).toContain('Example')

      // Should show code blocks
      expect(example).toContain('```typescript')

      // Should show class documentation
      expect(example).toContain('class Instance')
      expect(example).toContain('Methods')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Parallelization Configuration
  // ────────────────────────────────────────────────────────────────────────

  describe('Parallelization', () => {
    it('has parallelization config with appropriate concurrency', () => {
      expect(template.parallelization).toBeDefined()
      expect(template.parallelization?.maxConcurrentTasks).toBe(6)
      expect(template.parallelization?.autoDispatch).toBe(true)
      expect(template.parallelization?.defaultPriority).toBe('normal')
    })

    it('has retry configuration', () => {
      expect(template.parallelization?.retry).toBeDefined()
      expect(template.parallelization?.retry?.maxRetries).toBe(2)
      expect(template.parallelization?.retry?.exponentialBackoff).toBe(true)
    })

    it('uses priority-based machine selection', () => {
      expect(template.parallelization?.machineSelectionPolicy).toBe('priority')
    })
  })

  describe('Input Parallelization', () => {
    it('has input parallelization config', () => {
      expect(template.inputParallelization).toBeDefined()
    })

    it('parallelizes on repoUrls parameter', () => {
      expect(template.inputParallelization?.parameterId).toBe('repoUrls')
    })

    it('splits on newlines', () => {
      expect(template.inputParallelization?.splitStrategy).toBe('newline')
    })

    it('produces individual (independent) outputs per repo', () => {
      expect(template.inputParallelization?.mergeStrategy).toBe('individual')
    })

    it('has meaningful branch labels', () => {
      expect(template.inputParallelization?.branchLabelFormat).toContain('Repo')
      expect(template.inputParallelization?.branchLabelFormat).toContain('{{index}}')
      expect(template.inputParallelization?.branchLabelFormat).toContain('{{shortValue}}')
    })

    it('has reasonable branch limits', () => {
      expect(template.inputParallelization?.maxBranches).toBe(5)
      expect(template.inputParallelization?.minInputsForParallel).toBe(2)
    })

    it('does not add a merge task for individual outputs', () => {
      expect(template.inputParallelization?.addMergeTask).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Execution Configuration
  // ────────────────────────────────────────────────────────────────────────

  describe('Execution Config', () => {
    it('has execution configuration', () => {
      expect(template.execution).toBeDefined()
    })

    it('uses a capable model', () => {
      expect(template.execution?.preferredModel).toContain('claude')
    })

    it('has sufficient turns for documentation generation', () => {
      expect(template.execution?.maxTurns).toBeGreaterThanOrEqual(30)
    })

    it('has reasonable budget limits', () => {
      expect(template.execution?.maxBudgetPerTask).toBeGreaterThan(0)
      expect(template.execution?.maxBudgetPerTask).toBeLessThanOrEqual(100)
    })

    it('uses branch delivery mode (non-destructive)', () => {
      expect(template.execution?.deliveryMode).toBe('branch')
    })

    it('does not skip safety checks', () => {
      expect(template.execution?.skipSafetyCheck).toBe(false)
    })

    it('uses mixed verification', () => {
      expect(template.execution?.defaultVerification).toBe('mixed')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Plan Hints
  // ────────────────────────────────────────────────────────────────────────

  describe('Plan Hints', () => {
    it('has plan hints', () => {
      expect(template.planHints).toBeDefined()
    })

    it('targets reasonable node count', () => {
      const nodeCount = template.planHints?.targetNodeCount
      expect(nodeCount).toBeDefined()
      expect(nodeCount?.min).toBeGreaterThanOrEqual(6)
      expect(nodeCount?.max).toBeLessThanOrEqual(20)
      if (nodeCount) {
        expect(nodeCount.min).toBeLessThan(nodeCount.max)
      }
    })

    it('has four suggested milestones', () => {
      expect(template.planHints?.suggestedMilestones).toHaveLength(4)
    })

    it('milestone structure follows documentation workflow', () => {
      const milestones = template.planHints?.suggestedMilestones ?? []

      expect(milestones).toContainEqual(
        expect.objectContaining({ title: 'Repository Analyzed' })
      )
      expect(milestones).toContainEqual(
        expect.objectContaining({ title: 'Content Extracted' })
      )
      expect(milestones).toContainEqual(
        expect.objectContaining({ title: 'Documentation Generated' })
      )
      expect(milestones).toContainEqual(
        expect.objectContaining({ title: 'Documentation Assembled' })
      )
    })

    it('milestones have descriptions', () => {
      const milestones = template.planHints?.suggestedMilestones ?? []
      for (const milestone of milestones) {
        expect(milestone.description).toBeTruthy()
        expect(milestone.description.length).toBeGreaterThan(10)
      }
    })

    it('prefers parallel tasks', () => {
      expect(template.planHints?.preferParallelTasks).toBe(true)
    })

    it('has common labels defined', () => {
      expect(template.planHints?.commonLabels).toBeDefined()
      expect(template.planHints?.commonLabels!.length).toBeGreaterThan(0)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Template Validator Integration
  // ────────────────────────────────────────────────────────────────────────

  describe('Template Validation', () => {
    it('passes schema validation with no errors', () => {
      const result = validateTemplate(template)

      if (!result.valid) {
        console.error('Validation failed:', formatValidationResult(result))
      }

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('has acceptable warnings only', () => {
      const result = validateTemplate(template)

      // Some warnings are acceptable (e.g., large template prompt)
      // But there should be no critical warnings
      for (const warning of result.warnings) {
        // None of these should be EMPTY_PROMPT warnings
        expect(warning.code).not.toBe('EMPTY_PROMPT')
      }
    })

    it('all prompt parameter references are valid', () => {
      const result = validateTemplate(template)

      // Check for "unknown parameter" warnings
      const unknownParamWarnings = result.warnings.filter(w =>
        w.message.includes('unknown parameter')
      )

      if (unknownParamWarnings.length > 0) {
        console.warn('Unknown parameter references:', unknownParamWarnings)
      }

      // All referenced parameters should exist (except built-in ones)
      expect(unknownParamWarnings).toHaveLength(0)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Comparison with Other Templates
  // ────────────────────────────────────────────────────────────────────────

  describe('Cross-Template Consistency', () => {
    it('follows the same structure as other templates', () => {
      // Verify it has all the same top-level fields as web-app
      expect(template.id).toBeDefined()
      expect(template.name).toBeDefined()
      expect(template.description).toBeDefined()
      expect(template.category).toBeDefined()
      expect(template.version).toBeDefined()
      expect(template.requiredParameters).toBeDefined()
      expect(template.optionalParameters).toBeDefined()
      expect(template.prompts).toBeDefined()
      expect(template.parallelization).toBeDefined()
      expect(template.execution).toBeDefined()
      expect(template.planHints).toBeDefined()
      expect(template.source).toBeDefined()
      expect(template.enabled).toBeDefined()
    })

    it('uses consistent ID format', () => {
      expect(template.id).toMatch(/^astro\/[a-z-]+$/)
    })

    it('uses consistent version format', () => {
      expect(template.version).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('is a documentation category template (different from software-development)', () => {
      expect(template.category).toBe('documentation')
      expect(template.category).not.toBe('software-development')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Differentiation Tests (confirms different use case type works)
  // ────────────────────────────────────────────────────────────────────────

  describe('Use Case Differentiation', () => {
    it('has input parallelization (unlike web-app which does not)', () => {
      // This template supports multi-value input (multiple repos)
      expect(template.inputParallelization).toBeDefined()
      expect(template.inputParallelization?.parameterId).toBe('repoUrls')
    })

    it('uses markdown output format (unlike web-app which uses free)', () => {
      expect(template.outputFormat?.type).toBe('markdown')
    })

    it('has higher concurrency for parallel doc sections', () => {
      // Documentation sections are highly parallelizable
      expect(template.parallelization?.maxConcurrentTasks).toBeGreaterThanOrEqual(4)
    })

    it('does not require code safety checks for docs', () => {
      // Documentation generation is less risky than code generation
      // but we still keep safety checks enabled (skipSafetyCheck: false)
      // because the agent still reads/writes files
      expect(template.execution?.skipSafetyCheck).toBe(false)
    })

    it('labels differ from software-development templates', () => {
      // Documentation template uses l2 (Backend/extraction), l1 (Frontend/site), l5 (Research)
      // Software dev templates use l1-l4
      const labels = template.planHints?.commonLabels ?? []
      expect(labels).toContain('l5') // Research label for architecture analysis
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Registry Integration
  // (Validates the template is properly registered and discoverable)
  // ────────────────────────────────────────────────────────────────────────

  describe('Registry Integration', () => {
    it('is included in BUILTIN_TEMPLATES collection', () => {
      const found = BUILTIN_TEMPLATES.find(t => t.id === 'astro/code-documentation')
      expect(found).toBeDefined()
      expect(found).toBe(template) // Same reference
    })

    it('is retrievable by getTemplateById', () => {
      const found = getTemplateById('astro/code-documentation')
      expect(found).toBeDefined()
      expect(found!.id).toBe('astro/code-documentation')
      expect(found!.name).toBe('Code Documentation Generator')
    })

    it('is listed in the documentation category', () => {
      const categoryTemplates = getTemplatesByCategory('documentation')
      expect(categoryTemplates.length).toBeGreaterThanOrEqual(1)
      const ids = categoryTemplates.map(t => t.id)
      expect(ids).toContain('astro/code-documentation')
    })

    it('has unique ID in the global registry', () => {
      const allIds = BUILTIN_TEMPLATES.map(t => t.id)
      const count = allIds.filter(id => id === 'astro/code-documentation').length
      expect(count).toBe(1)
    })

    it('returns undefined for non-existent template ID', () => {
      const found = getTemplateById('astro/does-not-exist')
      expect(found).toBeUndefined()
    })

    it('returns empty array for non-existent category', () => {
      const templates = getTemplatesByCategory('non-existent-category')
      expect(templates).toHaveLength(0)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Infrastructure Compatibility
  // (Validates the template works with the same infrastructure as other
  //  templates — critical for proving the system supports multiple use cases)
  // ────────────────────────────────────────────────────────────────────────

  describe('Infrastructure Compatibility', () => {
    it('all prompt parameter references resolve to defined parameters or builtins', () => {
      const allPromptText = [
        template.prompts.planGeneration,
        template.prompts.taskExecution ?? '',
        template.prompts.planRefinement ?? '',
        // Note: sharedContext typically does not have interpolated params
      ].join(' ')

      const refs = Array.from(allPromptText.matchAll(/\{\{(\w+)\}\}/g)).map(m => m[1])
      const templateParamIds = new Set([
        ...template.requiredParameters.map(p => p.id),
        ...template.optionalParameters.map(p => p.id),
      ])
      const builtinParams = new Set([
        'projectName', 'visionDoc', 'repoContext', 'gitState', 'timestamp', 'userName',
      ])

      for (const ref of refs) {
        const isValid = templateParamIds.has(ref) || builtinParams.has(ref)
        expect(isValid).toBe(true)
      }
    })

    it('input parallelization references a valid required parameter', () => {
      const ip = template.inputParallelization!
      const requiredParamIds = template.requiredParameters.map(p => p.id)
      expect(requiredParamIds).toContain(ip.parameterId)
    })

    it('input parallelization config is internally consistent', () => {
      const ip = template.inputParallelization!
      // mergeStrategy='individual' means no merge task is needed
      if (ip.mergeStrategy === 'individual') {
        expect(ip.addMergeTask).toBe(false)
      }
      // maxBranches should be >= minInputsForParallel
      expect(ip.maxBranches!).toBeGreaterThanOrEqual(ip.minInputsForParallel!)
    })

    it('execution config values are all within validator bounds', () => {
      const exec = template.execution!
      expect(exec.maxTurns).toBeGreaterThanOrEqual(1)
      expect(exec.maxTurns).toBeLessThanOrEqual(200)
      expect(exec.maxBudgetPerTask).toBeGreaterThanOrEqual(0.01)
      expect(exec.maxBudgetPerTask).toBeLessThanOrEqual(100)
    })

    it('parallelization config values are within validator bounds', () => {
      const par = template.parallelization!
      expect(par.maxConcurrentTasks).toBeGreaterThanOrEqual(1)
      expect(par.maxConcurrentTasks).toBeLessThanOrEqual(50)
    })

    it('plan hints target node count is within validator bounds', () => {
      const hints = template.planHints!
      expect(hints.targetNodeCount!.min).toBeGreaterThanOrEqual(3)
      expect(hints.targetNodeCount!.min).toBeLessThanOrEqual(50)
      expect(hints.targetNodeCount!.max).toBeGreaterThanOrEqual(3)
      expect(hints.targetNodeCount!.max).toBeLessThanOrEqual(50)
    })

    it('simulates the full parameter resolution flow', () => {
      // This simulates what the server does when a user creates a project from this template
      const userInput: Record<string, unknown> = {
        repoUrls: 'https://github.com/honojs/hono',
        language: 'typescript',
        // Only required params provided — optionals should use defaults
      }

      const allParams = [...template.requiredParameters, ...template.optionalParameters]
      const resolved: Record<string, unknown> = {}

      for (const param of allParams) {
        if (userInput[param.id] !== undefined) {
          resolved[param.id] = userInput[param.id]
        } else if (param.default !== undefined) {
          resolved[param.id] = param.default
        }
      }

      // Required params are present
      expect(resolved.repoUrls).toBe('https://github.com/honojs/hono')
      expect(resolved.language).toBe('typescript')

      // Defaults are applied
      expect(resolved.docFormat).toBe('docusaurus')
      expect(resolved.includeExamples).toBe(true)
      expect(resolved.audience).toBe('developers')
      expect(resolved.existingDocs).toBe('augment')
      expect(resolved.maxDepth).toBe('full')
      expect(resolved.docSections).toEqual(['api', 'architecture', 'quickstart', 'contributing'])

      // Branch has no default, so it should not be in resolved
      expect(resolved.branch).toBeUndefined()

      // Now interpolate with resolved params — should produce a valid prompt
      const prompt = interpolatePrompt(template.prompts.planGeneration, resolved)
      expect(prompt).toContain('docusaurus')
      expect(prompt).toContain('developers')
      expect(prompt.length).toBeGreaterThan(1000)
    })

    it('all templates in BUILTIN_TEMPLATES pass validation', () => {
      // Run the validator on ALL templates to ensure the registry is healthy
      const knownIds = new Set(BUILTIN_TEMPLATES.map(t => t.id))

      for (const t of BUILTIN_TEMPLATES) {
        const result = validateTemplate(t, knownIds)
        if (!result.valid) {
          console.error(`Template ${t.id} failed validation:`, formatValidationResult(result))
        }
        expect(result.valid).toBe(true)
      }
    })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Generated Prompts (Manual Review)
// ────────────────────────────────────────────────────────────────────────────

describe('Generated Prompts (Manual Review)', () => {
  it('generates planGeneration prompt for Hono repository', () => {
    const prompt = interpolatePrompt(
      codeDocumentationTemplate.prompts.planGeneration,
      TEST_PARAMETERS
    )

    console.log('\n' + '='.repeat(80))
    console.log('PLAN GENERATION PROMPT (first 2000 chars)')
    console.log('='.repeat(80))
    console.log(prompt.slice(0, 2000))
    console.log('...')

    expect(prompt.length).toBeGreaterThan(2000)
  })

  it('generates taskExecution prompt for Hono repository', () => {
    const prompt = interpolatePrompt(
      codeDocumentationTemplate.prompts.taskExecution!,
      TEST_PARAMETERS
    )

    console.log('\n' + '='.repeat(80))
    console.log('TASK EXECUTION PROMPT (first 1500 chars)')
    console.log('='.repeat(80))
    console.log(prompt.slice(0, 1500))
    console.log('...')

    expect(prompt.length).toBeGreaterThan(500)
  })

  it('generates planRefinement prompt with context', () => {
    const prompt = interpolatePrompt(
      codeDocumentationTemplate.prompts.planRefinement!,
      TEST_PARAMETERS
    )

    console.log('\n' + '='.repeat(80))
    console.log('PLAN REFINEMENT PROMPT')
    console.log('='.repeat(80))
    console.log(prompt)

    expect(prompt.length).toBeGreaterThan(200)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Expected Plan Structure
// ────────────────────────────────────────────────────────────────────────────

describe('Expected Plan Structure', () => {
  it('documents the expected milestone structure', () => {
    const milestones = codeDocumentationTemplate.planHints?.suggestedMilestones ?? []

    expect(milestones).toContainEqual(
      expect.objectContaining({ title: 'Repository Analyzed' })
    )
    expect(milestones).toContainEqual(
      expect.objectContaining({ title: 'Content Extracted' })
    )
    expect(milestones).toContainEqual(
      expect.objectContaining({ title: 'Documentation Generated' })
    )
    expect(milestones).toContainEqual(
      expect.objectContaining({ title: 'Documentation Assembled' })
    )
  })

  it('documents expected task count range', () => {
    const hints = codeDocumentationTemplate.planHints

    expect(hints?.targetNodeCount?.min).toBe(8)
    expect(hints?.targetNodeCount?.max).toBe(16)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Example Output Files (Reference)
// ────────────────────────────────────────────────────────────────────────────

export const EXAMPLE_DOCUSAURUS_INDEX = `---
sidebar_position: 1
slug: /
---

# Hono Documentation

Hono is a lightweight, ultrafast web framework for Cloudflare Workers, Fastly Compute, Deno, Bun, and Node.js.

## Getting Started

- [Installation](./getting-started/installation.md)
- [Quick Start](./getting-started/quickstart.md)
- [Configuration](./getting-started/configuration.md)

## API Reference

- [API Overview](./api/overview.md)
- [Hono Class](./api/classes/hono.md)
- [Context](./api/classes/context.md)
- [Middleware](./api/modules/middleware.md)

## Architecture

- [Architecture Overview](./architecture/overview.md)
- [Design Decisions](./architecture/design-decisions.md)
- [Request/Response Flow](./architecture/data-flow.md)

## Contributing

- [Development Setup](./contributing/development-setup.md)
- [Testing Guide](./contributing/testing.md)
- [Pull Request Guide](./contributing/pull-requests.md)
`

export const EXAMPLE_API_MODULE = `---
sidebar_position: 2
title: Hono Class
---

# Hono Class

The main \`Hono\` class is the entry point for creating a web application.

## Constructor

### \`new Hono(options?)\`

Creates a new Hono application instance.

**Parameters:**
- \`options\` (HonoOptions, optional): Configuration options
  - \`strict\` (boolean, default: \`true\`): Strict mode for routing
  - \`router\` (Router): Custom router implementation
  - \`getPath\` (Function): Custom path extraction function

**Example:**

\`\`\`typescript
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.text('Hello Hono!'))

export default app
\`\`\`

## Methods

### \`app.get(path, ...handlers)\`

Register a GET route handler.

**Parameters:**
- \`path\` (string): Route path pattern
- \`handlers\` (...Handler): One or more handler functions

**Returns:**
- (Hono): The Hono instance (for chaining)

**Example:**

\`\`\`typescript
app.get('/users/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id, name: 'John' })
})
\`\`\`

### \`app.post(path, ...handlers)\`

Register a POST route handler.

**Parameters:**
- \`path\` (string): Route path pattern
- \`handlers\` (...Handler): One or more handler functions

**Returns:**
- (Hono): The Hono instance (for chaining)

### \`app.use(path?, ...middleware)\`

Register middleware for all or specific routes.

**Parameters:**
- \`path\` (string, optional): Route path pattern (default: all routes)
- \`middleware\` (...MiddlewareHandler): One or more middleware functions

**Example:**

\`\`\`typescript
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

app.use('*', logger())
app.use('/api/*', cors())
\`\`\`

**See Also:**
- [Middleware Guide](../guides/basic-usage.md#middleware)
- [Built-in Middleware](./modules/middleware.md)
`

export const EXAMPLE_ARCHITECTURE_OVERVIEW = `---
sidebar_position: 1
title: Architecture Overview
---

# Architecture Overview

## High-Level Architecture

Hono follows a lightweight middleware-based architecture similar to Express but optimized for edge computing environments.

\`\`\`mermaid
graph TD
    R[Request] --> Router
    Router --> MW1[Middleware 1]
    MW1 --> MW2[Middleware 2]
    MW2 --> H[Route Handler]
    H --> C[Context]
    C --> Response

    style Router fill:#f96,stroke:#333
    style C fill:#69f,stroke:#333
\`\`\`

## Key Components

### Router
The router is responsible for matching incoming requests to registered route handlers. Hono supports multiple router implementations:

- **TrieRouter**: Default trie-based router, good general performance
- **RegExpRouter**: Uses compiled RegExp for faster matching
- **SmartRouter**: Automatically selects the best router based on route patterns
- **LinearRouter**: Simple linear search, lowest memory usage

### Context
The \`Context\` object wraps the request and provides helper methods for building responses. It's created fresh for each request and passed through the middleware chain.

### Middleware
Middleware functions intercept requests before they reach route handlers. They can modify the request, short-circuit the response, or add functionality.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Multi-platform | Support Workers, Deno, Bun, Node.js |
| Routing | Trie-based (default) | O(k) lookup where k = path depth |
| Types | Strict generics | Type-safe route parameters and middleware |
| Size | Zero dependencies | Minimal bundle for edge deployment |
`

export const EXAMPLE_SIDEBAR_JS = `// @ts-check
/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'index',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/installation',
        'getting-started/quickstart',
        'getting-started/configuration',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/basic-usage',
        'guides/advanced',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api/overview',
        {
          type: 'category',
          label: 'Classes',
          items: ['api/classes/hono', 'api/classes/context'],
        },
        {
          type: 'category',
          label: 'Modules',
          items: ['api/modules/middleware', 'api/modules/utils'],
        },
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/overview',
        'architecture/design-decisions',
        'architecture/data-flow',
      ],
    },
    {
      type: 'category',
      label: 'Contributing',
      items: [
        'contributing/development-setup',
        'contributing/testing',
        'contributing/pull-requests',
      ],
    },
  ],
}

module.exports = sidebars
`
