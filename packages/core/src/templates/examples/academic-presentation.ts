/**
 * Example: Academic Paper Presentation Template
 *
 * Converts academic papers into multiple deliverables:
 * - Slides (PDF via HTML + Playwright)
 * - Blog posts (Markdown)
 * - Conference posters (PDF via HTML + Playwright)
 *
 * Uses HTML-based rendering with a low-saturation color palette.
 * Evolved from paper-to-slides.ts into a multi-deliverable template.
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const academicPresentationTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro/academic-presentation',
  name: 'Academic Paper Presentation',
  description:
    'Convert academic papers into polished slides (PDF), blog posts (Markdown), and conference posters (PDF). Uses HTML-based rendering with a low-saturation color palette, Playwright for PDF generation, and SVG figure generation. Supports multiple papers, customizable audience levels, and multiple output formats.',
  category: 'research',
  version: '1.0.0',
  icon: '🎓',
  tags: ['arxiv', 'presentation', 'academic', 'paper', 'slides', 'blog', 'poster', 'pdf', 'html'],
  maturity: 'stable',

  // ── Parameters ────────────────────────────────────────────────────────

  requiredParameters: [
    {
      id: 'paperSource',
      name: 'Paper Source(s)',
      description:
        'Path to a directory containing PDF files, OR arXiv links (one per line). When PDFs are provided, the PDF skill is used to extract content. For arXiv links, LaTeX source or HTML is fetched automatically.',
      type: 'string',
      required: true,
      placeholder: '/path/to/papers/  or  https://arxiv.org/abs/XXXX.XXXXX',
      validation: {
        min: 1,
        message: 'Provide a PDF directory path or arXiv URL(s)',
      },
      group: 'source',
      order: 0,
    },
    {
      id: 'deliverables',
      name: 'Output Deliverables',
      description: 'Which deliverables to generate from the paper(s). Select one or more.',
      type: 'multi-select',
      required: true,
      default: ['slides', 'blog-post', 'poster'],
      options: [
        { label: 'Slides (PDF)', value: 'slides', description: 'HTML slides rendered to PDF via Playwright. 5 layout types with low-saturation palette.' },
        { label: 'Blog Post (Markdown)', value: 'blog-post', description: 'Detailed or succinct Markdown blog post with citations and figures.' },
        { label: 'Conference Poster (PDF)', value: 'poster', description: 'Single-page HTML CSS grid poster rendered to A0 PDF via Playwright.' },
      ],
      group: 'deliverables',
      order: 0,
    },
  ],

  optionalParameters: [
    // ── Source group ──
    {
      id: 'githubUrl',
      name: 'Code Repository',
      description: 'GitHub URL for the paper\'s reference implementation. Used to extract code examples and architecture diagrams.',
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
      id: 'customRequirements',
      name: 'Custom Requirements',
      description: 'Additional emphasis areas, narrative direction, or multi-paper story arc. Use this to guide the content focus.',
      type: 'string',
      required: false,
      placeholder: 'Focus on the comparison between methods A and B. Emphasize practical implications for industry adoption.',
      group: 'source',
      order: 2,
    },

    // ── Slides group ──
    {
      id: 'slideCount',
      name: 'Slide Count',
      description: 'Approximate number of content slides.',
      type: 'select',
      required: false,
      default: 'detailed',
      options: [
        { label: 'Brief (8-12)', value: 'brief', description: 'Lightning talk / overview — key contributions only' },
        { label: 'Standard (15-25)', value: 'standard', description: 'Conference talk — covers all major sections' },
        { label: 'Detailed (30-45)', value: 'detailed', description: 'Lecture / deep dive — thorough per-section coverage' },
      ],
      visibleWhen: { parameterId: 'deliverables', operator: 'contains', value: 'slides' },
      group: 'slides',
      order: 0,
    },
    {
      id: 'targetAudience',
      name: 'Target Audience',
      description: 'Who will be viewing this presentation? Controls technical depth and explanation style.',
      type: 'select',
      required: false,
      default: 'researcher',
      options: [
        { label: 'ML Researchers', value: 'researcher', description: 'Expert audience — focus on technical novelty and comparisons to prior work' },
        { label: 'Graduate Students', value: 'graduate', description: 'Advanced students — include more context and intuition' },
        { label: 'Industry Engineers', value: 'engineer', description: 'Practitioners — emphasize implementation details and benchmarks' },
        { label: 'General Technical', value: 'general', description: 'Broad audience — high-level ideas and visual explanations' },
      ],
      visibleWhen: { parameterId: 'deliverables', operator: 'contains', value: 'slides' },
      group: 'slides',
      order: 1,
    },
    {
      id: 'slideTheme',
      name: 'Slide Theme',
      description: 'Light or dark color scheme for slides.',
      type: 'select',
      required: false,
      default: 'both',
      options: [
        { label: 'Light', value: 'light', description: 'Light background with soft accent colors' },
        { label: 'Dark', value: 'dark', description: 'Dark background with soft accent colors' },
        { label: 'Both', value: 'both', description: 'Generate both light and dark versions' },
      ],
      visibleWhen: { parameterId: 'deliverables', operator: 'contains', value: 'slides' },
      group: 'slides',
      order: 2,
    },

    // ── Blog group ──
    {
      id: 'blogStyle',
      name: 'Blog Style',
      description: 'Level of detail in the blog post.',
      type: 'select',
      required: false,
      default: 'detailed',
      options: [
        { label: 'Detailed', value: 'detailed', description: 'Comprehensive walkthrough with equations and figures (~2000-4000 words)' },
        { label: 'Succinct', value: 'succinct', description: 'Quick summary of key contributions (~800-1500 words)' },
      ],
      visibleWhen: { parameterId: 'deliverables', operator: 'contains', value: 'blog-post' },
      group: 'blog',
      order: 0,
    },

    // ── Poster group ──
    {
      id: 'posterOrientation',
      name: 'Poster Orientation',
      description: 'Layout orientation for the conference poster.',
      type: 'select',
      required: false,
      default: 'portrait',
      options: [
        { label: 'Portrait', value: 'portrait', description: '3-column CSS grid layout (A0 portrait)' },
        { label: 'Landscape', value: 'landscape', description: '4-column CSS grid layout (A0 landscape)' },
      ],
      visibleWhen: { parameterId: 'deliverables', operator: 'contains', value: 'poster' },
      group: 'poster',
      order: 0,
    },

  ],

  // ── Prompts ───────────────────────────────────────────────────────────

  prompts: {
    planGeneration: `You are an expert academic presentation designer who converts research papers into multiple polished deliverables.

## Paper Specification
- Paper Source: {{paperSource}}
- Code Repository: {{githubUrl}}
- Custom Requirements: {{customRequirements}}

## Deliverables: {{deliverables}}

## Configuration
- Slide Count: {{slideCount}}
- Target Audience: {{targetAudience}}
- Slide Theme: {{slideTheme}}
- Blog Style: {{blogStyle}}
- Poster Orientation: {{posterOrientation}}
## Skill Reference
This project uses the \`academic-presentation\` skill. The skill's SKILL.md contains the complete rendering specification including:
- 5 HTML slide layout types (title, section-divider, full-bullet, left-right-split, three-zone)
- Color palette definitions (emph, blue, muted, teal, gold) for light and dark themes
- Typography rules, box styles, SVG figure guidelines
- HTML→PDF rendering via Playwright
- Blog Markdown structure and poster CSS grid layout

**The SKILL.md is the single source of truth for all rendering details.** Reference it for slide CSS, color hex values, font sizes, and layout dimensions.

## Planning Guidelines

Decompose this paper presentation into a DAG of tasks. The output structure depends on which deliverables are selected.

### Narrative Arc
All deliverables follow this narrative structure:
1. **Motivation** — Why should the audience care? What gap exists?
2. **Methodology** — What is the proposed approach? Architecture/algorithm.
3. **Results** — Does it work? Quantitative evidence, comparisons.
4. **Discussion** — Implications, limitations, future directions.

### Task Structure

**Phase 1: Paper Analysis (shared across all deliverables)**
- Fetch and parse the paper source (PDF extraction or arXiv fetch)
- Extract structure: sections, equations, figures, bibliography
- Identify key contributions (3-5 points)
- If GitHub repo provided, clone and identify key code files

**Phase 2: Per-Deliverable Generation (parallel branches)**

For **slides** (when selected):
- Generate HTML slides using the 5 layout types from the skill
- Each slide is a self-contained HTML file with embedded CSS
- Use SVG for architecture diagrams and figure recreations
- Render to PDF via Playwright headless browser
- Target slide count: {{slideCount}}

For **blog-post** (when selected):
- Generate Markdown blog post with proper citations
- Include figure references and equation rendering (LaTeX in Markdown)
- Style: {{blogStyle}}

For **poster** (when selected):
- Generate single-page HTML with CSS grid layout
- Orientation: {{posterOrientation}} (3-col portrait / 4-col landscape)
- Render to A0 PDF via Playwright

**Phase 3: Assembly & Quality Check**
- Verify all outputs render correctly
- Cross-check content consistency across deliverables
- Run quality checklist from SKILL.md

### Parallelism
- Paper analysis must complete before any deliverable generation
- All deliverable branches can run in parallel
- Assembly depends on all branches completing

### Labels
- l1=Frontend (HTML/CSS rendering, Playwright)
- l5=Research (paper analysis, content extraction)

### Verification
- "auto" for file creation and rendering tasks
- "human" for content quality and narrative flow`,

    taskExecution: `You are generating academic presentation deliverables from a research paper.

## Context
- Paper Source: {{paperSource}}
- Code Repository: {{githubUrl}}
- Deliverables: {{deliverables}}
- Target Audience: {{targetAudience}}
## IMPORTANT: Skill Reference
This task uses the \`academic-presentation\` skill. Consult the skill's SKILL.md for:
- Complete HTML/CSS templates for each slide layout type
- Color hex values and usage rules
- Typography scale and font stacks
- Box style CSS classes
- SVG figure generation guidelines
- Playwright PDF rendering commands
- Blog Markdown structure
- Poster CSS grid layout

## General Rules
- One key idea per slide (max 6-8 bullet points)
- Use SVG for all generated figures — match the color palette
- Annotate equations with plain-English descriptions
- Max 2-3 accent colors per slide/section
- Every HTML slide must be self-contained with embedded CSS
- Use Playwright for all HTML→PDF conversion

## Content Depth by Audience
- researcher: Full technical detail, reference prior art by name
- graduate: Include intuition before formalism, define key terms
- engineer: Lead with practical implications, include benchmarks
- general: Use analogies, minimize notation, maximize visuals`,

    sharedContext: `Academic Paper Presentation shared context:

## Color Palette

### Light Mode
- Background: #FAF8F5 (warm off-white)
- Text: #3A3A3A (soft black)
- Emphasis/Red: #C4A882 (warm sand)
- Blue: #8FA8B8 (dusty blue)
- Muted/Green: #A8B8A0 (sage)
- Teal: #7FA8A0 (muted teal)
- Gold: #C8B878 (antique gold)

### Dark Mode
- Background: #2A2A2E (charcoal)
- Text: #E8E4E0 (warm white)
- Emphasis/Red: #D4B892 (warm sand, brightened)
- Blue: #9FB8C8 (dusty blue, brightened)
- Muted/Green: #B8C8B0 (sage, brightened)
- Teal: #8FB8B0 (muted teal, brightened)
- Gold: #D8C888 (antique gold, brightened)

### Usage Rules
- Max 2-3 accent colors per slide
- Use emphasis color for key takeaways and important terms
- Use blue for technical elements (code, equations, references)
- Use muted/green for supporting information
- Use teal sparingly for callouts
- Use gold for highlights and awards

## Typography
- Font stack: 'Palatino Linotype', 'Book Antiqua', Palatino, serif
- H1: 34px, bold
- H2: 28px, semibold
- Body: 22px, regular
- Caption: 16px, regular
- Code: 'Fira Code', 'Source Code Pro', monospace, 18px

## Box Styles
- box-blue: background #8FA8B8/15%, border-left 3px #8FA8B8
- box-green: background #A8B8A0/15%, border-left 3px #A8B8A0
- box-pink: background #C4A882/15%, border-left 3px #C4A882
- box-beige: background #C8B878/15%, border-left 3px #C8B878
- box-lavender: background #9B8FBF/15%, border-left 3px #9B8FBF

## 5 Slide Layout Types
1. Title Slide — centered title, authors, affiliation
2. Section Divider — full-page centered large text
3. Full Bullet — centered bullets with color-box highlighting
4. Left-Right Split — text 60% left, figure 40% right (figure top-aligned)
5. Three-Zone — top 70% left-right split, bottom 30% supplementary bar

## Quality Checklist
- [ ] One idea per slide, max 6-8 bullet points
- [ ] Key equations annotated with plain English
- [ ] Figures use SVG with matching color palette
- [ ] Max 2-3 accent colors per slide
- [ ] Narrative follows motivation → methodology → results → discussion
- [ ] All HTML slides are self-contained with embedded CSS
- [ ] Playwright renders clean PDFs without clipping
- [ ] Blog post includes proper citations and figure references
- [ ] Poster fits single A0 page without overflow`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'free',
    description:
      'Multiple output formats depending on selected deliverables: HTML slides rendered to PDF, Markdown blog post, HTML poster rendered to PDF. All outputs placed in a structured directory.',
    example: `output/
  slides/
    slide-01-title.html
    slide-02-motivation.html
    ...
    slides.pdf              # Combined PDF via Playwright
  blog/
    blog-post.md            # Markdown with citations
    figures/                # Referenced figures
  poster/
    poster.html             # Single-page HTML
    poster.pdf              # A0 PDF via Playwright`,
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

  // ── Input Parallelization ──────────────────────────────────────────────
  inputParallelization: {
    parameterId: 'paperSource',
    splitStrategy: 'newline',
    mergeStrategy: 'individual',
    branchLabelFormat: 'Paper {{index}}: {{shortValue}}',
    maxBranches: 5,
    minInputsForParallel: 2,
    addMergeTask: false,
  },

  // ── Execution ─────────────────────────────────────────────────────────
  execution: {
    preferredModel: 'claude-sonnet-4-20250514',
    maxTurns: 50,
    maxBudgetPerTask: 5.0,
    skills: ['academic-presentation'],
    deliveryMode: 'branch',
    skipSafetyCheck: false,
    defaultVerification: 'mixed',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 6, max: 20 },
    defaultEstimate: 'M',
    suggestedMilestones: [
      {
        title: 'Paper Analyzed',
        description: 'Source fetched, structure extracted, key contributions identified, figures cataloged',
      },
      {
        title: 'Slides Generated',
        description: 'All HTML slides generated with embedded CSS, SVG figures, and color palette',
      },
      {
        title: 'Blog Post Written',
        description: 'Markdown blog post with citations, figures, and appropriate depth',
      },
      {
        title: 'Poster Created',
        description: 'Single-page HTML poster with CSS grid layout, ready for PDF rendering',
      },
      {
        title: 'PDFs Rendered',
        description: 'All HTML deliverables rendered to PDF via Playwright, quality checked',
      },
    ],
    commonLabels: ['l1', 'l5'],
    preferParallelTasks: true,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['scientific-computing', 'web-development'],
  recommendedSkills: ['academic-presentation'],
  source: 'builtin',
  enabled: true,
}
