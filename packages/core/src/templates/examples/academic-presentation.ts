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
  id: 'astro--academic-presentation',
  name: 'Academic Paper Presentation',
  description:
    'Turn your research papers into presentation-ready deliverables. Provide paper files in a working directory or a link to fetch from (e.g., arXiv), select the source format, and get polished slide decks, blog posts, and conference posters — all generated as PDFs. Supports customizable audience levels (researchers, students, engineers) and multiple papers at once.',
  category: 'research',
  version: '1.0.0',
  icon: '🎓',
  tags: ['arxiv', 'presentation', 'academic', 'paper', 'slides', 'blog', 'poster', 'pdf', 'html', 'latex', 'docx'],
  maturity: 'stable',

  // ── Parameters ────────────────────────────────────────────────────────

  requiredParameters: [
    {
      id: 'workingDirectory',
      name: 'Working Directory',
      description:
        'Path to the directory containing the paper file(s). The directory should contain files in the selected source format. Output deliverables will also be saved here.',
      type: 'string',
      required: true,
      placeholder: '/path/to/papers/',
      validation: {
        min: 1,
        message: 'Provide a path to the directory containing the paper(s)',
      },
      group: 'source',
      order: 0,
    },
    {
      id: 'sourceFormat',
      name: 'Source Format',
      description:
        'File format of the source paper(s). This determines which extraction tool is used. PDF files use the PDF skill; DOCX files use the DOCX skill; LaTeX and Markdown are read directly.',
      type: 'select',
      required: true,
      default: 'pdf',
      options: [
        { label: 'PDF', value: 'pdf', description: 'Uses the PDF skill for extraction' },
        { label: 'LaTeX (.tex)', value: 'latex', description: 'LaTeX source files — read and parsed directly' },
        { label: 'Markdown (.md)', value: 'markdown', description: 'Markdown files — read directly' },
        { label: 'Word (.docx)', value: 'docx', description: 'Uses the DOCX skill for extraction' },
      ],
      group: 'source',
      order: 1,
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
      id: 'paperLink',
      name: 'Paper Link(s)',
      description:
        'External link(s) to fetch papers from. Leave blank if files are already in the working directory.',
      type: 'textarea',
      required: false,
      prominent: true,
      placeholder: 'One link per line\nhttps://arxiv.org/abs/XXXX.XXXXX',
      group: 'source',
      order: 2,
    },
    {
      id: 'githubUrl',
      name: 'Code Repository',
      description: 'GitHub URL for the paper\'s reference implementation. Used to extract code examples and architecture diagrams.',
      type: 'string',
      required: false,
      prominent: true,
      placeholder: 'https://github.com/author/paper-code',
      validation: {
        pattern: '^https?://github\\.com/.+',
        message: 'Must be a GitHub URL',
      },
      group: 'source',
      order: 3,
    },
    {
      id: 'customRequirements',
      name: 'Custom Requirements',
      description: 'Additional instructions about your compute environment, emphasis areas, or task-specific notes. Use this to guide the agent\'s behavior or content focus.',
      type: 'textarea',
      required: false,
      prominent: true,
      placeholder: 'e.g., Skip CUDA rendering (no GPU)\nFocus on methods comparison',
      group: 'source',
      order: 4,
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
- Working Directory: {{workingDirectory}}
- Source Format: {{sourceFormat}}
- Paper Link: {{paperLink}}
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

When source format is PDF or DOCX, the corresponding skill (pdf or docx) is also loaded with format-specific extraction instructions.

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
- Obtain the paper source:
  - If a paper link is provided, fetch/download from the link first
  - Read files from the working directory
- Parse the paper using the appropriate tool for the source format ({{sourceFormat}}):
  - **PDF** → use the PDF skill for extraction (pypdf, pdfplumber, or the Read tool on .pdf files)
  - **DOCX** → use the DOCX skill for extraction
  - **LaTeX** → read .tex files directly, parse \\section, \\subsection, equations, figures, and bibliography
  - **Markdown** → read .md files directly
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

    // taskExecution removed: the agent receives SKILL.md as visionDoc (loaded by
    // the frontend), not this prompt. Keeping it here would be dead code that
    // could mislead future developers. All execution guidance lives in
    // skills/academic-presentation/SKILL.md.

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
- [ ] Poster fits single A0 page without overflow

## Document Reading
Use the tool matching the source format ({{sourceFormat}}):
- **PDF**: Follow the PDF skill instructions (loaded when sourceFormat is pdf)
- **DOCX**: Follow the DOCX skill instructions (loaded when sourceFormat is docx)
- **LaTeX**: Read .tex files directly with the Read tool
- **Markdown**: Read .md files directly with the Read tool`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'free',
    description:
      'Multiple output formats depending on selected deliverables: HTML slides rendered to PDF, Markdown blog post, HTML poster rendered to PDF. All outputs placed in a structured directory.',
    example: `outputs/
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
    parameterId: 'paperLink',
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
  conditionalSkills: {
    sourceFormat: {
      pdf: ['pdf'],
      docx: ['docx'],
    },
  },
  source: 'builtin',
  enabled: true,
}
