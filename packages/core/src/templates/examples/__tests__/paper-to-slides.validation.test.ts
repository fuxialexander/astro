/**
 * Paper-to-Slides Template Validation
 *
 * This script validates the paper-to-slides template by:
 * 1. Testing prompt interpolation with real parameter values
 * 2. Validating the expected output structure
 * 3. Providing example outputs for manual review
 *
 * Run with: npx vitest run packages/core/src/templates/examples/__tests__/paper-to-slides.validation.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { paperToSlidesTemplate } from '../paper-to-slides.js'
import type { UseCaseTemplate } from '../../../types/use-case-template.js'

// ────────────────────────────────────────────────────────────────────────────
// Test Paper: "Understanding Reasoning in Chain-of-Thought from the Hopfieldian View"
// arXiv:2410.03595
// ────────────────────────────────────────────────────────────────────────────

const TEST_PAPER = {
  paperSource: 'https://arxiv.org/abs/2410.03595',
  paperTitle: 'Understanding Reasoning in Chain-of-Thought from the Hopfieldian View',
  authors: 'Lijie Hu, Liang Liu, Shu Yang, Xin Chen, Zhen Tan, Muhammad Asif Ali, Mengdi Li, Di Wang',
  abstract: `Large Language Models have demonstrated remarkable abilities across various tasks, with Chain-of-Thought (CoT) prompting emerging as a key technique to enhance reasoning capabilities. However, existing research primarily focuses on improving performance, lacking a comprehensive framework to explain and understand the fundamental factors behind CoT's success. To bridge this gap, we introduce a novel perspective grounded in the Hopfieldian view of cognition in cognitive neuroscience. We establish a connection between CoT reasoning and key cognitive elements such as stimuli, actions, neural populations, and representation spaces. From our view, we can understand the reasoning process as the movement between these representation spaces. Building on this insight, we develop a method for localizing reasoning errors in the response of CoTs. Moreover, we propose the Representation-of-Thought (RoT) framework, which leverages the robustness of low-dimensional representation spaces to enhance the robustness of the reasoning process in CoTs. Experimental results demonstrate that RoT improves the robustness and interpretability of CoT reasoning while offering fine-grained control over the reasoning process.`,
  venue: 'ICLR 2025 (under review)',
  categories: ['cs.AI', 'cs.CL'],
}

const TEST_PARAMETERS = {
  paperSource: TEST_PAPER.paperSource,
  targetAudience: 'researcher',
  githubUrl: '', // No code repo for this paper
  slideCount: 'standard',
  slideStyle: 'academic',
  emphasisAreas: ['method', 'results'],
  includeEquations: 'key',
  speakerNotes: true,
  paperTitle: '',
}

// ────────────────────────────────────────────────────────────────────────────
// Expected Output Structure
// ────────────────────────────────────────────────────────────────────────────

/** Expected output structure for reference (used in example outputs) */
export const EXPECTED_OUTPUT_STRUCTURE = {
  rootFiles: [
    'slides.md',        // Main Slidev entry point
    'package.json',     // Slidev project config
    'README.md',        // Build instructions
  ],
  directories: {
    sections: [
      '00-title.md',
      '01-motivation.md',
      '02-background.md',
      '03-method.md',       // Core: Hopfieldian view, representation spaces
      '04-theory.md',       // Theory of CoT reasoning
      '05-experiments.md',
      '06-results.md',
      '07-discussion.md',
      '08-conclusion.md',
      '09-references.md',
    ],
    assets: {
      figures: [], // Will contain extracted figures
      diagrams: [], // Will contain Mermaid diagrams
    },
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
    result = result.replace(new RegExp(placeholder, 'g'), strValue)
  }
  return result
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Paper-to-Slides Template', () => {
  let template: UseCaseTemplate

  beforeAll(() => {
    template = paperToSlidesTemplate
  })

  describe('Template Structure', () => {
    it('has correct identity fields', () => {
      expect(template.id).toBe('astro/paper-to-slides')
      expect(template.name).toBe('Paper to Slides')
      expect(template.category).toBe('research-analysis')
      expect(template.maturity).toBe('beta')
    })

    it('has required parameters defined', () => {
      expect(template.requiredParameters).toHaveLength(2)
      const paramIds = template.requiredParameters.map(p => p.id)
      expect(paramIds).toContain('paperSource')
      expect(paramIds).toContain('targetAudience')
    })

    it('has optional parameters defined', () => {
      expect(template.optionalParameters.length).toBeGreaterThanOrEqual(5)
      const paramIds = template.optionalParameters.map(p => p.id)
      expect(paramIds).toContain('githubUrl')
      expect(paramIds).toContain('slideCount')
      expect(paramIds).toContain('slideStyle')
      expect(paramIds).toContain('emphasisAreas')
      expect(paramIds).toContain('speakerNotes')
    })

    it('has all prompt types defined', () => {
      expect(template.prompts.planGeneration).toBeDefined()
      expect(template.prompts.taskExecution).toBeDefined()
      expect(template.prompts.planRefinement).toBeDefined()
      expect(template.prompts.sharedContext).toBeDefined()
    })

    it('has output format specification', () => {
      expect(template.outputFormat).toBeDefined()
      expect(template.outputFormat?.type).toBe('markdown')
    })

    it('has parallelization config', () => {
      expect(template.parallelization).toBeDefined()
      expect(template.parallelization?.maxConcurrentTasks).toBe(4)
      expect(template.parallelization?.autoDispatch).toBe(true)
    })

    it('has plan hints', () => {
      expect(template.planHints).toBeDefined()
      expect(template.planHints?.targetNodeCount).toEqual({ min: 8, max: 18 })
      expect(template.planHints?.suggestedMilestones).toHaveLength(4)
    })
  })

  describe('Prompt Interpolation', () => {
    it('interpolates planGeneration prompt correctly', () => {
      const prompt = interpolatePrompt(template.prompts.planGeneration, TEST_PARAMETERS)

      // Should contain the paper source
      expect(prompt).toContain(TEST_PAPER.paperSource)

      // Should contain audience
      expect(prompt).toContain('researcher')

      // Should contain slide count
      expect(prompt).toContain('standard')

      // Should contain style
      expect(prompt).toContain('academic')

      // Should contain emphasis areas
      expect(prompt).toContain('method')
      expect(prompt).toContain('results')

      // Should NOT contain uninterpolated placeholders
      expect(prompt).not.toMatch(/\{\{[a-zA-Z]+\}\}/)
    })

    it('interpolates taskExecution prompt correctly', () => {
      const prompt = interpolatePrompt(template.prompts.taskExecution!, TEST_PARAMETERS)

      expect(prompt).toContain(TEST_PAPER.paperSource)
      expect(prompt).toContain('researcher')
      expect(prompt).not.toMatch(/\{\{[a-zA-Z]+\}\}/)
    })

    it('handles empty optional parameters', () => {
      const params = {
        ...TEST_PARAMETERS,
        githubUrl: '',
        paperTitle: '',
      }
      const prompt = interpolatePrompt(template.prompts.planGeneration, params)

      // Should still interpolate without errors
      expect(prompt).toBeDefined()
      expect(prompt.length).toBeGreaterThan(1000)
    })
  })

  describe('Plan Generation Prompt Quality', () => {
    it('includes milestone structure guidance', () => {
      const prompt = template.prompts.planGeneration

      expect(prompt).toContain('Paper Acquisition')
      expect(prompt).toContain('Content Analysis')
      expect(prompt).toContain('Per-Section Slide Generation')
      expect(prompt).toContain('Assembly')
    })

    it('includes output directory structure', () => {
      const prompt = template.prompts.planGeneration

      expect(prompt).toContain('slides.md')
      expect(prompt).toContain('sections/')
      expect(prompt).toContain('00-title.md')
      expect(prompt).toContain('03-method.md')
      expect(prompt).toContain('assets/')
    })

    it('includes Slidev conventions', () => {
      const prompt = template.prompts.planGeneration

      expect(prompt).toContain('layout: section')
      expect(prompt).toContain('layout: cover')
      expect(prompt).toContain('v-click')
      expect(prompt).toContain('Mermaid')
      expect(prompt).toContain('KaTeX')
    })

    it('includes parallelism guidance', () => {
      const prompt = template.prompts.planGeneration

      expect(prompt).toContain('parallel')
      expect(prompt).toMatch(/per-section.*parallel|parallel.*per-section/i)
    })
  })

  describe('Task Execution Prompt Quality', () => {
    it('includes LaTeX equation guidance', () => {
      const prompt = template.prompts.taskExecution!

      expect(prompt).toContain('LaTeX')
      expect(prompt).toContain('KaTeX')
      expect(prompt).toContain('$')
      expect(prompt).toContain('$$')
    })

    it('includes figure handling guidance', () => {
      const prompt = template.prompts.taskExecution!

      expect(prompt).toContain('Mermaid')
      expect(prompt).toContain('figure')
      expect(prompt).toContain('diagram')
    })

    it('includes speaker notes guidance', () => {
      const prompt = template.prompts.taskExecution!

      expect(prompt).toContain('Speaker notes')
      expect(prompt).toContain('<!--')
    })

    it('includes audience-specific guidance', () => {
      const prompt = template.prompts.taskExecution!

      expect(prompt).toContain('researcher')
      expect(prompt).toContain('graduate')
      expect(prompt).toContain('engineer')
      expect(prompt).toContain('general')
    })
  })

  describe('Shared Context Quality', () => {
    it('includes arXiv fetching guidance', () => {
      const prompt = template.prompts.sharedContext!

      expect(prompt).toContain('arxiv.org')
      expect(prompt).toContain('/e-print/')
      expect(prompt).toContain('/pdf/')
      expect(prompt).toContain('LaTeX source')
    })

    it('includes narrative arc guidance', () => {
      const prompt = template.prompts.sharedContext!

      expect(prompt).toContain('Hook')
      expect(prompt).toContain('Problem')
      expect(prompt).toContain('Background')
      expect(prompt).toContain('Method')
      expect(prompt).toContain('Results')
      expect(prompt).toContain('Conclusion')
    })

    it('includes quality checklist', () => {
      const prompt = template.prompts.sharedContext!

      expect(prompt).toContain('Checklist')
      expect(prompt).toContain('title')
      expect(prompt).toContain('bullet points')
      expect(prompt).toContain('equations')
    })
  })

  describe('Output Specification', () => {
    it('matches expected structure in example', () => {
      const example = template.outputFormat?.example ?? ''

      // Main file structure
      expect(example).toContain('slides.md')
      expect(example).toContain('sections/')

      // Frontmatter
      expect(example).toContain('theme:')
      expect(example).toContain('title:')

      // Section imports
      expect(example).toContain('src: ./sections/')
    })

    it('shows Slidev syntax examples', () => {
      const example = template.outputFormat?.example ?? ''

      // Layout directives
      expect(example).toContain('layout: section')

      // Math
      expect(example).toContain('$')

      // Mermaid
      expect(example).toContain('mermaid')

      // Click animations
      expect(example).toContain('v-click')
    })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Generate Example Interpolated Prompts (for manual review)
// ────────────────────────────────────────────────────────────────────────────

describe('Generated Prompts (Manual Review)', () => {
  it('generates planGeneration prompt for test paper', () => {
    const prompt = interpolatePrompt(
      paperToSlidesTemplate.prompts.planGeneration,
      TEST_PARAMETERS
    )

    // Log for manual review
    console.log('\n' + '='.repeat(80))
    console.log('PLAN GENERATION PROMPT (first 2000 chars)')
    console.log('='.repeat(80))
    console.log(prompt.slice(0, 2000))
    console.log('...')

    expect(prompt.length).toBeGreaterThan(2000)
  })

  it('generates taskExecution prompt for test paper', () => {
    const prompt = interpolatePrompt(
      paperToSlidesTemplate.prompts.taskExecution!,
      TEST_PARAMETERS
    )

    console.log('\n' + '='.repeat(80))
    console.log('TASK EXECUTION PROMPT (first 1500 chars)')
    console.log('='.repeat(80))
    console.log(prompt.slice(0, 1500))
    console.log('...')

    expect(prompt.length).toBeGreaterThan(1000)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Expected Plan Structure
// ────────────────────────────────────────────────────────────────────────────

describe('Expected Plan Structure', () => {
  it('documents the expected milestone structure', () => {
    const milestones = paperToSlidesTemplate.planHints?.suggestedMilestones ?? []

    expect(milestones).toContainEqual(
      expect.objectContaining({ title: 'Paper Acquired & Parsed' })
    )
    expect(milestones).toContainEqual(
      expect.objectContaining({ title: 'Outline Approved' })
    )
    expect(milestones).toContainEqual(
      expect.objectContaining({ title: 'Sections Generated' })
    )
    expect(milestones).toContainEqual(
      expect.objectContaining({ title: 'Deck Assembled' })
    )
  })

  it('documents expected task count range', () => {
    const hints = paperToSlidesTemplate.planHints

    expect(hints?.targetNodeCount?.min).toBe(8)
    expect(hints?.targetNodeCount?.max).toBe(18)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Example Output Files (Reference)
// ────────────────────────────────────────────────────────────────────────────

export const EXAMPLE_SLIDES_MD = `---
theme: seriph
title: "Understanding Reasoning in Chain-of-Thought from the Hopfieldian View"
info: |
  Paper: arXiv:2410.03595
  Authors: Lijie Hu, Liang Liu, et al.
  Generated by Astro Paper-to-Slides
class: text-center
drawings:
  persist: false
transition: slide-left
mdc: true
---

# Understanding Reasoning in Chain-of-Thought from the Hopfieldian View

**Lijie Hu, Liang Liu, Shu Yang, Xin Chen, Zhen Tan, Muhammad Asif Ali, Mengdi Li, Di Wang**

*ICLR 2025 (under review)*

<div class="abs-br m-6 flex gap-2">
  <a href="https://arxiv.org/abs/2410.03595" target="_blank" class="text-xl">📄 Paper</a>
</div>

---
src: ./sections/01-motivation.md
---

---
src: ./sections/02-background.md
---

---
src: ./sections/03-method.md
---

---
src: ./sections/04-theory.md
---

---
src: ./sections/05-experiments.md
---

---
src: ./sections/06-results.md
---

---
src: ./sections/07-discussion.md
---

---
src: ./sections/08-conclusion.md
---

---
src: ./sections/09-references.md
---
`

export const EXAMPLE_METHOD_SECTION = `---
layout: section
---

# Method

## The Hopfieldian View of Chain-of-Thought

---

## Key Insight: CoT as Movement in Representation Space

<div class="grid grid-cols-2 gap-4">
<div>

### Traditional View
- CoT = sequence of reasoning steps
- Each step: text generation
- Focus on linguistic structure

</div>
<div>

### Hopfieldian View
- CoT = trajectory in representation space
- Each step: attractor navigation
- Focus on <span v-mark.circle.orange>cognitive structure</span>

</div>
</div>

---

## Core Framework

The Hopfieldian perspective connects:

$$
\\text{Stimulus} \\xrightarrow{\\text{encoding}} \\text{Representation Space} \\xrightarrow{\\text{dynamics}} \\text{Action}
$$

<v-clicks>

- **Stimuli**: Input tokens / problem statement
- **Representation Space**: Hidden states in transformer layers
- **Actions**: Generated CoT steps

</v-clicks>

<!--
Speaker notes:
- This maps directly to Hopfield network energy landscapes
- Each reasoning step = finding a new energy minimum
- Errors occur when the trajectory gets stuck in local minima
- Timing: ~3 minutes
-->

---

## Architecture Diagram

\`\`\`mermaid
graph TD
    I[Input Prompt] --> E[Encoder]
    E --> R1["Representation Space 1"]
    R1 --> |"CoT Step 1"| R2["Representation Space 2"]
    R2 --> |"CoT Step 2"| R3["Representation Space 3"]
    R3 --> |"..."| RN["Final Representation"]
    RN --> D[Decoder]
    D --> O[Output Answer]

    style R1 fill:#f9f,stroke:#333
    style R2 fill:#f9f,stroke:#333
    style R3 fill:#f9f,stroke:#333
    style RN fill:#f9f,stroke:#333
\`\`\`

---

## Representation-of-Thought (RoT) Framework

<v-clicks>

1. **Project** reasoning steps to low-dimensional space
2. **Track** trajectory through representation manifold
3. **Detect** errors via trajectory analysis
4. **Correct** by steering toward robust regions

</v-clicks>

$$
\\text{RoT}(x) = \\text{Project}(\\text{CoT}(x)) \\in \\mathbb{R}^d \\quad (d \\ll D)
$$

<!--
Speaker notes:
- Low-dimensional projection preserves key structural information
- Enables visualization and analysis of reasoning
- Error detection: trajectory deviation from expected path
- Timing: ~4 minutes
-->
`

export const EXAMPLE_PACKAGE_JSON = `{
  "name": "cot-hopfieldian-slides",
  "private": true,
  "scripts": {
    "dev": "slidev --open",
    "build": "slidev build",
    "export": "slidev export"
  },
  "dependencies": {
    "@slidev/cli": "^0.49.0",
    "@slidev/theme-seriph": "^0.25.0"
  }
}
`
