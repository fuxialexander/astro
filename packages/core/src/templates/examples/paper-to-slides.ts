/**
 * Example: Paper-to-Slides Template
 *
 * Converts academic papers (arXiv, GitHub repos, PDFs) into Slidev-format
 * presentation decks. Demonstrates multi-phase content extraction workflows,
 * modular per-section slide generation, and markdown output specification
 * matching the 2025_looped_transformer_modular structure.
 *
 * The pipeline:
 * 1. Fetch paper source (arXiv LaTeX/PDF or GitHub repo)
 * 2. Analyze paper structure (sections, key contributions, equations, figures)
 * 3. Create slide outline (section mapping, narrative arc)
 * 4. Generate per-section slide groups (title, content, diagrams)
 * 5. Assemble final Slidev deck with theme, transitions, and speaker notes
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const paperToSlidesTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro/paper-to-slides',
  name: 'Paper to Slides',
  description:
    'Convert academic papers into polished Slidev presentation decks. Fetches arXiv LaTeX/PDF or GitHub repositories, analyzes paper structure, extracts key equations and figures, and generates a modular slide deck with per-section slides, speaker notes, and LaTeX math rendering. Supports customizable audience levels, slide counts, and visual themes.',
  category: 'research-analysis',
  version: '1.0.0',
  icon: '📑',
  tags: ['arxiv', 'slidev', 'presentation', 'academic', 'paper', 'latex', 'slides'],
  maturity: 'beta',

  // ── Parameters ────────────────────────────────────────────────────────

  requiredParameters: [
    {
      id: 'paperSource',
      name: 'Paper Source',
      description:
        'URL to the paper. Supports arXiv abstract pages (https://arxiv.org/abs/XXXX.XXXXX), arXiv PDF links, or GitHub repository URLs containing a paper (LaTeX source, README, or PDF).',
      type: 'string',
      required: true,
      placeholder: 'https://arxiv.org/abs/2502.15872',
      validation: {
        pattern: '^https?://.+',
        message: 'Must be a valid URL (arXiv link, GitHub repo, or direct PDF link)',
      },
      group: 'source',
      order: 0,
    },
    {
      id: 'targetAudience',
      name: 'Target Audience',
      description: 'Who will be watching this presentation? This controls the technical depth, assumed background knowledge, and explanation style.',
      type: 'select',
      required: true,
      default: 'researcher',
      options: [
        {
          label: 'ML Researchers',
          value: 'researcher',
          description: 'Expert audience familiar with the field — focus on technical novelty, proofs, and comparisons to prior work',
        },
        {
          label: 'Graduate Students',
          value: 'graduate',
          description: 'Advanced students with general ML/CS background — include more context and intuition',
        },
        {
          label: 'Industry Engineers',
          value: 'engineer',
          description: 'Practitioners focused on applicability — emphasize implementation details, benchmarks, and practical implications',
        },
        {
          label: 'General Technical',
          value: 'general',
          description: 'Broad technical audience — emphasize high-level ideas, intuitions, and visual explanations over formal notation',
        },
      ],
      group: 'audience',
      order: 0,
    },
  ],

  optionalParameters: [
    {
      id: 'githubUrl',
      name: 'Code Repository',
      description: 'GitHub URL for the paper\'s reference implementation (if separate from paper source). Used to extract code examples and architecture diagrams.',
      type: 'string',
      required: false,
      placeholder: 'https://github.com/author/paper-code',
      validation: {
        pattern: '^https?://github\\.com/.+',
        message: 'Must be a GitHub URL',
      },
      group: 'source',
      order: 1,
    },
    {
      id: 'slideCount',
      name: 'Target Slide Count',
      description: 'Approximate number of content slides (excluding title and references). More slides = more granular coverage.',
      type: 'select',
      required: false,
      default: 'standard',
      options: [
        { label: 'Brief (8-12)', value: 'brief', description: 'Lightning talk / overview — hit only key contributions' },
        { label: 'Standard (15-25)', value: 'standard', description: 'Conference talk length — cover all major sections' },
        { label: 'Detailed (30-45)', value: 'detailed', description: 'Lecture / deep dive — thorough per-section coverage with derivations' },
      ],
      group: 'format',
      order: 0,
    },
    {
      id: 'slideStyle',
      name: 'Visual Style',
      description: 'Slidev theme and visual treatment for the generated deck.',
      type: 'select',
      required: false,
      default: 'academic',
      options: [
        { label: 'Academic', value: 'academic', description: 'Clean, professional academic style with serif math fonts' },
        { label: 'Minimal', value: 'minimal', description: 'Minimalist design with maximum whitespace and focus on content' },
        { label: 'Tech', value: 'tech', description: 'Modern tech conference style with dark code blocks and vibrant accents' },
        { label: 'Seriph', value: 'seriph', description: 'Slidev Seriph theme — elegant serif typography' },
      ],
      group: 'format',
      order: 1,
    },
    {
      id: 'emphasisAreas',
      name: 'Emphasis Areas',
      description: 'Which aspects of the paper should receive extra attention in the slides?',
      type: 'multi-select',
      required: false,
      default: ['method', 'results'],
      options: [
        { label: 'Method/Architecture', value: 'method', description: 'Core methodology, model architecture, algorithmic innovations' },
        { label: 'Results/Experiments', value: 'results', description: 'Experimental setup, benchmarks, ablation studies, comparison tables' },
        { label: 'Theory/Proofs', value: 'theory', description: 'Theoretical analysis, proofs, convergence guarantees' },
        { label: 'Code/Implementation', value: 'code', description: 'Implementation details, pseudocode, code snippets from the repo' },
      ],
      group: 'content',
      order: 0,
    },
    {
      id: 'includeEquations',
      name: 'Equation Handling',
      description: 'How to handle mathematical equations from the paper.',
      type: 'select',
      required: false,
      default: 'key',
      options: [
        { label: 'Key Equations Only', value: 'key', description: 'Include only the 3-5 most important equations with explanations' },
        { label: 'Comprehensive', value: 'comprehensive', description: 'Include most equations with progressive build-up and annotations' },
        { label: 'Minimal / Intuitive', value: 'minimal', description: 'Replace equations with intuitive explanations and diagrams where possible' },
      ],
      group: 'content',
      order: 1,
    },
    {
      id: 'speakerNotes',
      name: 'Speaker Notes',
      description: 'Generate detailed speaker notes for each slide with talking points and timing cues.',
      type: 'boolean',
      required: false,
      default: true,
      group: 'format',
      order: 2,
    },
    {
      id: 'paperTitle',
      name: 'Paper Title Override',
      description: 'Override the paper title (useful if the fetch can\'t extract it cleanly, or you want a custom title).',
      type: 'string',
      required: false,
      placeholder: 'Looped Transformers for Length Generalization',
      group: 'content',
      order: 2,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────

  prompts: {
    planGeneration: `You are an expert academic presentation designer who converts research papers into compelling Slidev slide decks.

## Paper Specification
- Paper Source: {{paperSource}}
- Code Repository: {{githubUrl}}
- Paper Title Override: {{paperTitle}}

## Presentation Specification
- Target Audience: {{targetAudience}}
- Slide Count: {{slideCount}}
- Visual Style: {{slideStyle}}
- Emphasis Areas: {{emphasisAreas}}
- Equation Handling: {{includeEquations}}
- Speaker Notes: {{speakerNotes}}

## Planning Guidelines

Decompose this paper-to-slides conversion into a DAG of tasks and milestones. The output is a **single Slidev markdown project** with the following modular structure:

### Target Output Structure (2025_looped_transformer_modular pattern)

The final deliverable is a directory with this structure:
\`\`\`
slides/
  slides.md              # Main Slidev entry point (frontmatter + section imports)
  sections/
    00-title.md          # Title slide with paper metadata
    01-motivation.md     # Problem statement, motivation, and background
    02-background.md     # Related work and prerequisite concepts
    03-method.md         # Core methodology / architecture (may be multiple files)
    04-theory.md         # Theoretical analysis (if applicable)
    05-experiments.md    # Experimental setup and results
    06-results.md        # Detailed results, ablations, comparisons
    07-discussion.md     # Discussion, limitations, future work
    08-conclusion.md     # Summary and takeaways
    09-references.md     # Key references
  assets/
    figures/             # Extracted or recreated figures
    diagrams/            # Mermaid/TikZ diagram source files
  package.json           # Slidev project config
  README.md              # Build and present instructions
\`\`\`

### Milestone Structure

1. **Paper Acquisition & Parsing**
   - Fetch the paper from the source URL (arXiv LaTeX via /e-print, PDF via /pdf, or GitHub clone)
   - Extract raw text, section structure, equations, figure references, and bibliography
   - If a GitHub repo is provided, clone it and identify key code files

2. **Content Analysis & Outline**
   - Identify the paper's key contributions (typically 3-5)
   - Map paper sections to slide sections
   - Determine which equations are essential vs. supplementary
   - Catalog all figures and decide which to include/recreate
   - Draft a slide-level outline: for each section, list the slides and their purpose

3. **Per-Section Slide Generation** (main parallel phase)
   - Generate title slide (00-title.md) with paper metadata, authors, venue
   - Generate motivation section (01-motivation.md) with problem framing
   - Generate background section (02-background.md) with prerequisites
   - Generate method section (03-method.md) with architecture/algorithm slides
   - Generate theory section (04-theory.md) if paper has theoretical content
   - Generate experiments section (05-experiments.md) with setup and protocol
   - Generate results section (06-results.md) with tables, charts, comparisons
   - Generate discussion section (07-discussion.md) with limitations and future work
   - Generate conclusion section (08-conclusion.md) with takeaways
   - Generate references section (09-references.md) with key citations

4. **Assembly & Polish**
   - Create the main slides.md with Slidev frontmatter and section imports
   - Create package.json with Slidev dependencies and theme configuration
   - Create README.md with build/present instructions
   - Review all sections for narrative flow and consistent style
   - Verify LaTeX equations render correctly in KaTeX
   - Ensure Mermaid diagrams are valid

### Task Granularity

Each task should produce one or two markdown files. A section like "method" might be split into multiple tasks if the paper's methodology section is complex (e.g., separate tasks for "model architecture" and "training procedure").

### Parallelism

- Paper fetching and parsing must complete before analysis
- Content analysis must complete before any slide generation
- Per-section slide generation tasks can ALL run in parallel (they depend only on the analysis output)
- Assembly depends on ALL section generation tasks completing

### Labels
- l1=Frontend (Slidev markup, CSS, theme configuration)
- l5=Research (paper analysis, content extraction, equation selection)

### Verification
- Use "auto" for structural tasks (file creation, markdown validity, LaTeX syntax)
- Use "human" for content quality tasks (narrative flow, accuracy, audience appropriateness)

### Slidev Markdown Conventions

Each section file must use this format:
\`\`\`markdown
---
layout: section
---

# Section Title

---

## Slide Title

Content with **emphasis** and LaTeX: $E = mc^2$

$$
\\mathcal{L}(\\theta) = \\sum_{i=1}^{N} \\log p(x_i | \\theta)
$$

<!-- Speaker notes go here -->

---

## Next Slide

- Bullet points for key ideas
- Use \`code blocks\` for implementation details
\`\`\`

Key Slidev features to use:
- \`layout: cover\` for title slide
- \`layout: section\` for section dividers
- \`layout: two-cols\` for side-by-side comparisons
- \`layout: image-right\` or \`layout: image-left\` for figure slides
- \`v-click\` directives for progressive reveal
- \`<arrow>\` components for annotation
- Mermaid code blocks for architecture diagrams
- KaTeX for all mathematical notation
- \`class: text-sm\` for dense content slides`,

    taskExecution: `You are generating Slidev markdown slides from an academic paper.

## Context
- Paper Source: {{paperSource}}
- Code Repository: {{githubUrl}}
- Target Audience: {{targetAudience}}
- Visual Style: {{slideStyle}}
- Equation Handling: {{includeEquations}}
- Speaker Notes: {{speakerNotes}}

## Slidev Markdown Standards

Follow these conventions strictly:

### Slide Separation
- Use \`---\` (three dashes on a line by itself) to separate slides
- Each slide should have a clear purpose: one key idea per slide

### Frontmatter (per-slide)
- Use YAML frontmatter between \`---\` markers for layout configuration:
  \`\`\`
  ---
  layout: two-cols
  ---
  \`\`\`

### LaTeX Equations
- Inline math: \`$x^2$\` renders via KaTeX
- Display math: use \`$$...$$\` blocks
- For equation numbering, use \`\\tag{1}\` inside display math
- Annotate key equations with plain-English descriptions above or below
- For the {{targetAudience}} audience, {{includeEquations}} equation handling applies

### Figures and Diagrams
- Use Mermaid for architecture diagrams, flowcharts, and process flows:
  \`\`\`mermaid
  graph LR
    A[Input] --> B[Encoder] --> C[Decoder] --> D[Output]
  \`\`\`
- Reference paper figures as \`![Figure caption](./assets/figures/fig-N.png)\`
- For complex figures that can't be rendered in Mermaid, describe them textually and note "[Figure to be added]"

### Speaker Notes
- Add speaker notes below each slide's content using HTML comments:
  \`\`\`
  <!--
  Speaker notes:
  - Key talking point 1
  - Key talking point 2
  - Timing: ~2 minutes
  -->
  \`\`\`

### Progressive Reveal
- Use \`<v-click>\` for items you want to reveal one at a time
- Use \`<v-clicks>\` to wrap a list where each item reveals sequentially

### Code Blocks
- Use fenced code blocks with language specifier: \`\`\`python
- Use \`{all|1-3|5-7}\` line highlighting syntax for code walkthrough
- Keep code snippets focused: max 15-20 lines per slide

### Content Depth by Audience
- researcher: Full technical detail, assume domain familiarity, reference prior art by name
- graduate: Include intuition before formalism, briefly define key terms
- engineer: Lead with "what does this enable?", include benchmarks and implementation notes
- general: Use analogies, minimize notation, maximize visual explanations`,

    planRefinement: `You are refining a paper-to-slides conversion plan. The user may want to:

- Adjust which paper sections get more or fewer slides
- Change the narrative structure or ordering
- Add or remove specific content (e.g., "skip the proofs", "add more ablation results")
- Adjust technical depth for the audience level
- Request specific Slidev features (animations, layouts, interactive elements)

When the user suggests changes:
1. Identify which tasks/sections are affected
2. Propose specific modifications to the task DAG
3. Estimate the impact on total slide count
4. Suggest whether new tasks need to be added or existing ones can be modified`,

    sharedContext: `Paper-to-Slides conversion context:

## Content Extraction Priorities
- Key contributions (the "what's new" — typically 3-5 points)
- Core equations (the mathematical heart of the paper)
- Architecture/method diagrams (visual summary of the approach)
- Main results table/chart (quantitative evidence)
- Comparison with baselines (positioning in the field)

## Narrative Arc for Academic Presentations
1. Hook: Why should the audience care? (1-2 slides)
2. Problem: What's the gap in existing work? (2-3 slides)
3. Background: What do they need to know? (2-4 slides)
4. Method: What's the proposed solution? (4-8 slides, most detail here)
5. Results: Does it work? (3-5 slides with tables/charts)
6. Discussion: What are the implications and limitations? (1-2 slides)
7. Conclusion: Key takeaways (1 slide)

## arXiv Paper Fetching
- LaTeX source: \`https://arxiv.org/e-print/XXXX.XXXXX\` (tar.gz of .tex files)
- PDF: \`https://arxiv.org/pdf/XXXX.XXXXX\`
- Abstract page: \`https://arxiv.org/abs/XXXX.XXXXX\`
- HTML (experimental): \`https://arxiv.org/html/XXXX.XXXXX\`
- Extract arXiv ID from any URL format: \`/abs/\`, \`/pdf/\`, \`/html/\`
- Prefer LaTeX source over PDF for equation extraction accuracy

## Slidev Project Setup
- Slidev uses Vite + Vue 3 under the hood
- Install: \`npm init slidev@latest\`
- Themes: @slidev/theme-default, @slidev/theme-seriph, @slidev/theme-apple-basic
- Math rendering: KaTeX (built-in, no extra config needed)
- Diagrams: Mermaid (built-in), PlantUML (plugin)
- Code highlighting: Shiki (built-in, supports line highlighting)
- Export: \`slidev export\` for PDF, \`slidev export --format png\` for images

## Quality Checklist
- [ ] Every slide has a clear title
- [ ] No slide has more than 6-8 bullet points
- [ ] Key equations are numbered and annotated
- [ ] Figures have descriptive captions
- [ ] Speaker notes provide context beyond what's on the slide
- [ ] Transitions between sections feel natural
- [ ] The deck stands alone without reading the paper
- [ ] Technical depth matches the target audience`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'markdown',
    description:
      'Slidev-format markdown presentation organized as modular per-section files. The main slides.md imports section files from a sections/ subdirectory. Each section file contains one or more slides separated by --- markers, with YAML frontmatter for layout configuration, KaTeX for math, and Mermaid for diagrams.',
    example: `# Main entry: slides.md

---
theme: seriph
title: "Looped Transformers for Length Generalization"
info: |
  Paper: arXiv:2502.15872
  Generated by Astro Paper-to-Slides
class: text-center
drawings:
  persist: false
transition: slide-left
mdc: true
---

# Looped Transformers for Length Generalization

**A. Author, B. Author, C. Author**

*Conference Name 2025*

<div class="abs-br m-6 flex gap-2">
  <a href="https://arxiv.org/abs/2502.15872" target="_blank" class="text-xl">📄 Paper</a>
  <a href="https://github.com/author/code" target="_blank" class="text-xl">💻 Code</a>
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

# Section file example: sections/03-method.md

---
layout: section
---

# Method

## Looped Transformer Architecture

---

## Core Architecture

<div class="grid grid-cols-2 gap-4">
<div>

### Standard Transformer
- Fixed depth (L layers)
- Each layer has unique parameters
- Parameter count scales with depth

</div>
<div>

### Looped Transformer
- Shared parameters across iterations
- Variable computation depth at inference
- <span v-mark.circle.orange>Length generalization</span>

</div>
</div>

---

## Key Equation: Iterative Refinement

The looped transformer applies the same block $f_\\theta$ repeatedly:

$$
h^{(t+1)} = f_\\theta(h^{(t)}, x) \\tag{1}
$$

where $h^{(0)} = \\text{Embed}(x)$ and the final output is $h^{(T)}$.

<v-click>

**Key insight:** By decoupling depth from parameters, the model can generalize to longer sequences by simply running more iterations.

</v-click>

<!--
Speaker notes:
- This is the core idea: weight sharing across layers
- Compare to Universal Transformers (Dehghani et al., 2019) but with key differences
- The iteration count T can be increased at inference time
- Timing: ~3 minutes on this slide
-->

---

## Architecture Diagram

\`\`\`mermaid
graph TD
    X[Input Sequence x] --> E[Embedding]
    E --> H0["h⁰"]
    H0 --> F["f_θ (Shared Block)"]
    F --> H1["h¹"]
    H1 --> F
    F --> HT["h^T"]
    HT --> O[Output]

    style F fill:#f96,stroke:#333
\`\`\``,
  },

  // ── Parallelization ───────────────────────────────────────────────────
  parallelization: {
    maxConcurrentTasks: 4,
    autoDispatch: true,
    defaultPriority: 'normal',
    retry: {
      maxRetries: 2,
      retryDelayMs: 5000,
      exponentialBackoff: true,
    },
    machineSelectionPolicy: 'priority',
  },

  // ── Execution ─────────────────────────────────────────────────────────
  execution: {
    preferredModel: 'claude-sonnet-4-20250514',
    maxTurns: 35,
    maxBudgetPerTask: 5.0,
    deliveryMode: 'branch',
    skipSafetyCheck: false,
    defaultVerification: 'mixed',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 8, max: 18 },
    defaultEstimate: 'S',
    suggestedMilestones: [
      {
        title: 'Paper Acquired & Parsed',
        description: 'Source fetched, sections identified, equations cataloged, figures inventoried',
      },
      {
        title: 'Outline Approved',
        description: 'Slide-level outline with section-to-slide mapping and narrative arc reviewed',
      },
      {
        title: 'Sections Generated',
        description: 'All per-section Slidev markdown files generated with equations, diagrams, and speaker notes',
      },
      {
        title: 'Deck Assembled',
        description: 'Main slides.md assembled, theme configured, all sections linked, quality checks passed',
      },
    ],
    commonLabels: ['l1', 'l5'],
    preferParallelTasks: true,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['scientific-computing', 'web-development'],
  recommendedSkills: [],
  source: 'builtin',
  enabled: true,
}
