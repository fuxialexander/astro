/**
 * Paper-to-Slides Template
 *
 * Builtin use case template that generates Slidev-based slide decks from
 * academic papers (arXiv, PDF, or LaTeX source). The template decomposes
 * the paper-to-slides workflow into discrete tasks: paper fetching,
 * structural analysis, outline creation, and per-section slide generation.
 *
 * Output follows the academic presentation structure exemplified by the
 * 2025_looped_transformer_modular template pattern:
 *   - Title/cover slide with authors & affiliations
 *   - Motivation & background
 *   - Problem statement
 *   - Method/approach (with equations)
 *   - Key results & figures
 *   - Ablations & analysis
 *   - Conclusion & future work
 *
 * The generated slides use Slidev markdown format (https://sli.dev) with:
 *   - YAML frontmatter for layouts (cover, two-cols, section, image, etc.)
 *   - KaTeX blocks for mathematical equations
 *   - Mermaid diagrams for architecture/flow diagrams
 *   - Speaker notes for presenter talking points
 *   - Click animations for incremental reveals
 */

import type {
  UseCaseTemplate,
  TemplateParameter,
  TemplatePromptConfig,
  TemplateOutputFormat,
  TemplateParallelizationConfig,
  TemplateSkillRequirements,
  TemplateExample,
} from '../types/use-case-template.js'

// ============================================================================
// Parameter Definitions
// ============================================================================

const parameters: TemplateParameter[] = [
  // ── Paper Source ──────────────────────────────────────────────────────
  {
    id: 'arxivUrl',
    name: 'arXiv URL',
    description: 'arXiv paper URL (e.g., https://arxiv.org/abs/2305.12345). The agent will fetch the LaTeX source and/or PDF for analysis.',
    type: 'url',
    required: true,
    placeholder: 'https://arxiv.org/abs/2305.12345',
    group: 'Paper Source',
    validation: {
      pattern: '^https?://(www\\.)?arxiv\\.org/(abs|pdf)/\\d{4}\\.\\d{4,5}(v\\d+)?$',
      message: 'Must be a valid arXiv URL (e.g., https://arxiv.org/abs/2305.12345)',
    },
  },
  {
    id: 'githubUrl',
    name: 'GitHub Repository URL',
    description: 'Optional: GitHub repository with paper code. Used to include code snippets, architecture diagrams, and reproducibility notes in slides.',
    type: 'url',
    required: false,
    placeholder: 'https://github.com/author/paper-code',
    group: 'Paper Source',
  },
  {
    id: 'supplementaryUrl',
    name: 'Supplementary Materials URL',
    description: 'Optional: URL to supplementary materials, appendix, or project page with additional figures and results.',
    type: 'url',
    required: false,
    placeholder: 'https://project-page.github.io/paper/',
    group: 'Paper Source',
  },

  // ── Audience & Style ─────────────────────────────────────────────────
  {
    id: 'targetAudience',
    name: 'Target Audience',
    description: 'Who will view these slides? This controls the level of technical depth, notation density, and assumed background knowledge.',
    type: 'select',
    required: true,
    default: 'research-group',
    options: [
      {
        label: 'Conference Talk',
        value: 'conference',
        description: 'Broad ML/AI audience at a venue like NeurIPS, ICML, ACL. Balance accessibility with technical depth.',
      },
      {
        label: 'Research Group / Lab Meeting',
        value: 'research-group',
        description: 'Domain experts who want full technical detail. Include all key equations and proofs.',
      },
      {
        label: 'Department Seminar',
        value: 'seminar',
        description: 'Mixed audience of faculty and students across sub-fields. More background, moderate notation.',
      },
      {
        label: 'Tutorial / Lecture',
        value: 'tutorial',
        description: 'Educational context. Detailed explanations, step-by-step derivations, more slides.',
      },
    ],
    group: 'Audience & Style',
  },
  {
    id: 'slideCount',
    name: 'Target Slide Count',
    description: 'Approximate number of content slides (excluding title and thank-you slides). The agent aims for this count but may adjust based on paper length.',
    type: 'select',
    required: true,
    default: '20-25',
    options: [
      { label: 'Short (10-15 slides)', value: '10-15', description: '~10 minute talk. Key results and method overview only.' },
      { label: 'Standard (20-25 slides)', value: '20-25', description: '~20 minute talk. Full method + results coverage.' },
      { label: 'Long (30-40 slides)', value: '30-40', description: '~40 minute talk. Deep dive with ablations, derivations, and discussion.' },
      { label: 'Tutorial (50+ slides)', value: '50-plus', description: '~60+ minute lecture. Step-by-step with exercises and extended background.' },
    ],
    group: 'Audience & Style',
  },
  {
    id: 'presentationStyle',
    name: 'Visual Style',
    description: 'Visual theme and layout preferences for the slide deck.',
    type: 'select',
    required: false,
    default: 'academic-clean',
    options: [
      { label: 'Academic Clean', value: 'academic-clean', description: 'Minimal, publication-quality. White background, serif math, clean figures.' },
      { label: 'Modern Dark', value: 'modern-dark', description: 'Dark theme with syntax highlighting. Good for code-heavy papers.' },
      { label: 'Colorful', value: 'colorful', description: 'Vibrant colors and visual emphasis. Good for conference spotlights.' },
      { label: 'Minimalist', value: 'minimalist', description: 'Maximum whitespace, large type, few elements per slide.' },
    ],
    group: 'Audience & Style',
  },

  // ── Content Preferences ──────────────────────────────────────────────
  {
    id: 'emphasisAreas',
    name: 'Emphasis Areas',
    description: 'Select which parts of the paper deserve extra slide coverage. The agent allocates more slides to selected areas.',
    type: 'multi-select',
    required: false,
    default: ['method', 'results'],
    options: [
      { label: 'Background / Related Work', value: 'background', description: 'More context slides on prior work and motivation.' },
      { label: 'Method / Architecture', value: 'method', description: 'Detailed method walkthrough with step-by-step diagrams.' },
      { label: 'Mathematical Formulation', value: 'math', description: 'Full equation derivations and proof sketches.' },
      { label: 'Experimental Results', value: 'results', description: 'Comprehensive results tables, charts, and comparisons.' },
      { label: 'Code & Implementation', value: 'code', description: 'Code snippets, API examples, and implementation details.' },
      { label: 'Ablation Studies', value: 'ablations', description: 'Detailed ablation analysis and hyperparameter sensitivity.' },
    ],
    group: 'Content Preferences',
  },
  {
    id: 'includeCodeSnippets',
    name: 'Include Code Snippets',
    description: 'Whether to include code snippets from the GitHub repository (if provided) in the slides.',
    type: 'boolean',
    required: false,
    default: true,
    group: 'Content Preferences',
    showWhen: {
      parameterId: 'githubUrl',
      value: ['*'],  // Show when githubUrl has any value
    },
  },
  {
    id: 'includeSpeakerNotes',
    name: 'Generate Speaker Notes',
    description: 'Generate detailed speaker notes for each slide with talking points, timing cues, and transition phrases.',
    type: 'boolean',
    required: false,
    default: true,
    group: 'Content Preferences',
  },
  {
    id: 'additionalContext',
    name: 'Additional Instructions',
    description: 'Any additional context or special instructions for the slide generation. For example: "Focus on the connection to transformers", "Skip the related work section", "Include comparison with our lab\'s approach".',
    type: 'text',
    required: false,
    placeholder: 'Focus on the novel contributions, emphasize differences from prior work...',
    group: 'Content Preferences',
  },

  // ── Output Configuration ─────────────────────────────────────────────
  {
    id: 'slidevTheme',
    name: 'Slidev Theme',
    description: 'Slidev theme package to use. Themes control the visual appearance of the slide deck.',
    type: 'select',
    required: false,
    default: 'default',
    options: [
      { label: 'Default', value: 'default', description: 'Clean default theme.' },
      { label: 'Seriph', value: 'seriph', description: 'Serif typography, academic feel.' },
      { label: 'Apple Basic', value: 'apple-basic', description: 'Inspired by Apple Keynote.' },
      { label: 'Dracula', value: 'dracula', description: 'Dark theme with syntax highlighting colors.' },
    ],
    group: 'Output',
  },
  {
    id: 'outputDirectory',
    name: 'Output Directory',
    description: 'Directory where the Slidev project will be created. A new subdirectory named after the paper will be generated.',
    type: 'file-path',
    required: false,
    default: './slides',
    placeholder: './slides',
    group: 'Output',
  },
]

// ============================================================================
// Prompt Configuration
// ============================================================================

const prompts: TemplatePromptConfig = {
  // ── System Prompt ──────────────────────────────────────────────────────
  systemPrompt: `You are an expert academic presentation designer specializing in converting research papers into clear, compelling Slidev slide decks. You have deep expertise in:

1. **Paper Analysis**: Extracting the narrative arc, key contributions, and technical details from academic papers (LaTeX source, PDF, arXiv).
2. **Slide Design**: Creating visually clean, information-dense slides that follow academic presentation best practices.
3. **Slidev Mastery**: Using Slidev's full feature set — layouts (cover, two-cols, section, image-left, image-right, center, fact), KaTeX math blocks, Mermaid diagrams, click animations, and speaker notes.
4. **Audience Calibration**: Adjusting depth, notation density, and pacing based on target audience (conference, lab meeting, seminar, tutorial).

## Slidev Markdown Format Reference

Slidev uses markdown files where slides are separated by \`---\`. Each slide can have YAML frontmatter for layout configuration.

### Global Frontmatter (first slide)
\`\`\`yaml
---
theme: {{slidevTheme}}
title: "Paper Title"
info: |
  Presentation generated from arXiv paper
class: text-center
drawings:
  persist: false
transition: slide-left
mdc: true
---
\`\`\`

### Slide Layouts
- \`cover\` — Title/cover page
- \`default\` — Standard content slide
- \`center\` — Centered content
- \`two-cols\` — Two-column layout (use \`::right::\` separator)
- \`two-cols-header\` — Header + two columns
- \`section\` — Section divider
- \`image\` — Full-page image (\`image: /path\`)
- \`image-left\` / \`image-right\` — Image with content
- \`fact\` — Key statistic/finding
- \`quote\` — Block quote
- \`statement\` — Bold statement
- \`end\` — Thank you / final slide

### Math (KaTeX)
Inline: \`$E = mc^2$\`
Block:
\`\`\`
$$
\\mathcal{L} = \\sum_{i=1}^{N} \\ell(f(x_i), y_i)
$$
\`\`\`

### Code Blocks
\`\`\`python {lines: true, startLine: 1}
def forward(self, x):
    return self.model(x)
\`\`\`

### Speaker Notes
\`\`\`
<!--
Speaker notes go here as HTML comments at the end of each slide.
Supports **markdown** formatting.
-->
\`\`\`

### Click Animations
\`\`\`
<v-click>

- This appears on click

</v-click>
\`\`\`

### Diagrams (Mermaid)
\`\`\`mermaid
graph LR
  A[Input] --> B[Encoder]
  B --> C[Decoder]
  C --> D[Output]
\`\`\`

## Academic Presentation Structure

Follow this canonical structure for paper presentations (adjust emphasis based on user preferences):

1. **Title Slide** (cover layout) — Paper title, authors, affiliations, venue, date
2. **Motivation / Problem** (1-3 slides) — Why this problem matters, real-world context
3. **Background / Related Work** (2-4 slides) — Key prior work, what's missing
4. **Problem Statement** (1-2 slides) — Formal problem definition, key notation
5. **Method / Approach** (4-8 slides) — Architecture, algorithm, key equations
6. **Theoretical Analysis** (1-3 slides, if applicable) — Proofs, complexity, guarantees
7. **Experimental Setup** (1-2 slides) — Datasets, baselines, metrics
8. **Results** (3-6 slides) — Main results tables/figures, comparisons
9. **Ablation Studies** (1-3 slides) — Component analysis, sensitivity
10. **Discussion / Limitations** (1-2 slides) — Strengths, weaknesses, future directions
11. **Conclusion** (1 slide) — Key takeaways
12. **Thank You / Q&A** (end layout) — Contact info, links

## Figure & Equation Handling

When extracting from the paper:
- **Equations**: Convert LaTeX to KaTeX-compatible format. Use block equations for key formulas, inline for references.
- **Figures**: Reference figures by description. If the paper has a GitHub repo, check for figure source files. Use Mermaid to recreate architecture diagrams when possible.
- **Tables**: Convert to markdown tables. For complex tables, use HTML within slides.
- **Algorithms**: Use code blocks with pseudocode or recreate as numbered lists with click animations.

## Visual Style: {{presentationStyle}}

Adapt the visual style based on the user's preference:
- **academic-clean**: White backgrounds, minimal decoration, serif math fonts, publication-quality figure references
- **modern-dark**: Dark backgrounds, code-friendly, syntax-highlighted snippets, vibrant accent colors
- **colorful**: Bold section colors, visual emphasis blocks, gradient backgrounds for section dividers
- **minimalist**: Maximum whitespace, one idea per slide, large typography, minimal bullet points`,

  // ── Plan Generation Prompt ─────────────────────────────────────────────
  planGenerationPrompt: `Create a comprehensive plan to convert the following arXiv paper into a Slidev presentation:

**Paper URL:** {{arxivUrl}}
{{githubUrl ? '**GitHub Repository:** ' + githubUrl : ''}}
{{supplementaryUrl ? '**Supplementary Materials:** ' + supplementaryUrl : ''}}

**Target Audience:** {{targetAudience}}
**Target Slide Count:** {{slideCount}} slides
**Visual Style:** {{presentationStyle}}
**Emphasis Areas:** {{emphasisAreas}}
**Include Code Snippets:** {{includeCodeSnippets}}
**Generate Speaker Notes:** {{includeSpeakerNotes}}
**Slidev Theme:** {{slidevTheme}}
**Output Directory:** {{outputDirectory}}
{{additionalContext ? '**Additional Instructions:** ' + additionalContext : ''}}

## Plan Structure

Decompose the paper-to-slides conversion into these task phases:

### Phase 1: Paper Acquisition & Parsing
- Fetch the arXiv paper source (try LaTeX source first via /e-print endpoint, fall back to PDF)
- Parse the paper structure: extract title, authors, abstract, section headers, equations, figure references, table data, bibliography
- If a GitHub URL is provided, clone the repository and identify key code files, architecture diagrams, and figure source files

### Phase 2: Content Analysis & Outline
- Analyze the paper's narrative arc: identify the core contribution, key innovation, and main results
- Map paper sections to slide sections following the academic presentation structure
- Create a detailed slide outline specifying: slide number, layout type, content summary, and which paper elements (equations, figures, tables) to include
- Allocate slide count across sections based on emphasis areas and target count

### Phase 3: Slidev Project Setup
- Initialize a Slidev project in the output directory with the selected theme
- Set up the global frontmatter configuration (theme, title, transitions, etc.)
- Create asset directories for figures and diagrams

### Phase 4: Slide Generation (per-section)
Generate the actual Slidev markdown for each presentation section:
- **Title & Introduction slides**: Cover slide, motivation, problem statement
- **Background slides**: Related work, key concepts, notation
- **Method slides**: Architecture diagrams (Mermaid), key equations (KaTeX), algorithm walkthrough
- **Results slides**: Main results tables, comparison figures, key metrics (fact layout)
- **Analysis slides**: Ablation studies, sensitivity analysis, visualizations
- **Conclusion slides**: Summary, limitations, future work, thank you

Each slide should include:
- Appropriate Slidev layout in frontmatter
- KaTeX equations for all mathematical content
- Mermaid diagrams to recreate architecture/flow diagrams
- Click animations for incremental content reveal
- Speaker notes with talking points (if enabled)

### Phase 5: Review & Polish
- Verify all KaTeX equations render correctly
- Check slide flow and transitions
- Ensure consistent styling across all slides
- Add navigation structure (section dividers)
- Create a README with build/preview instructions

## Task Constraints
- Each task should be independently executable by an agent with access to file tools and web fetch
- Tasks should produce concrete file outputs (markdown files, config files)
- The final output should be a complete, buildable Slidev project
- Total task count: 8-12 tasks covering all phases`,

  // ── Task Execution Prompt ──────────────────────────────────────────────
  taskExecutionPrompt: `You are generating slides for an academic paper presentation using the Slidev framework.

## Key Requirements
- All mathematical notation MUST use KaTeX-compatible LaTeX syntax
- Use Slidev layouts appropriately (cover, two-cols, section, image-left, center, fact, end)
- Each slide should convey ONE main idea
- Use click animations (\`<v-click>\`) for incremental reveals on dense slides
- Architecture/flow diagrams should be recreated as Mermaid diagrams when possible
- Tables should be in markdown format (or HTML for complex tables)
- Speaker notes should include talking points, timing cues, and transition phrases

## Slidev File Structure
The output Slidev project should follow this structure:
\`\`\`
{{outputDirectory}}/
  slides.md          # Main presentation file
  package.json       # Slidev project config
  components/        # Custom Vue components (if needed)
  public/            # Static assets (images, figures)
    figures/          # Paper figures
  README.md          # Build instructions
\`\`\`

## Slide Quality Checklist
- [ ] Title slide has paper title, ALL authors, affiliations, venue
- [ ] Each section has a clear divider slide (section layout)
- [ ] Key equations are numbered and referenced consistently
- [ ] Results slides have clear captions and axis labels described
- [ ] No more than 6 bullet points per slide
- [ ] Speaker notes explain the "why" not just the "what"
- [ ] Final slide has contact info and paper/code links`,

  // ── Vision Document Template ───────────────────────────────────────────
  visionDocTemplate: `# Paper-to-Slides: {{arxivUrl}}

## Goal
Convert the academic paper at {{arxivUrl}} into a professional Slidev presentation targeting a {{targetAudience}} audience. The presentation should have approximately {{slideCount}} content slides in the {{presentationStyle}} visual style.

## Target Output
A complete, buildable Slidev project that:
- Faithfully represents the paper's contributions, methods, and results
- Uses appropriate Slidev layouts for each content type
- Includes KaTeX equations for all mathematical notation
- Contains Mermaid diagrams recreating key architecture/flow figures
- Provides speaker notes with talking points for each slide
- Is ready to present with \`npx slidev\`

## Emphasis Areas
The presentation should give extra coverage to: {{emphasisAreas}}

## Output Location
The Slidev project will be created at: {{outputDirectory}}
${`{{githubUrl ? '\\n## Code Repository\\nCode snippets and implementation details from: ' + '{{githubUrl}}' : ''}}`}
${`{{additionalContext ? '\\n## Additional Notes\\n' + '{{additionalContext}}' : ''}}`}`,
}

// ============================================================================
// Output Format Specification
// ============================================================================

const outputFormat: TemplateOutputFormat = {
  nodeCountRange: {
    min: 8,
    max: 12,
  },

  preferredNodeTypes: ['task', 'milestone'],

  defaultVerification: 'human',  // Slide quality requires human judgment

  defaultEstimate: 'M',

  labels: [
    { id: 'l1', name: 'Paper Analysis', color: '#6366f1' },   // Indigo
    { id: 'l2', name: 'Slide Design', color: '#8b5cf6' },     // Violet
    { id: 'l3', name: 'Content Writing', color: '#06b6d4' },  // Cyan
    { id: 'l4', name: 'Diagrams & Math', color: '#f59e0b' },  // Amber
    { id: 'l5', name: 'Setup & Polish', color: '#10b981' },   // Emerald
  ],

  acceptanceCriteriaTemplates: [
    {
      id: 'ac-slidev-build',
      description: 'Slidev project builds without errors',
      type: 'command',
      command: 'cd {{outputDirectory}} && npx slidev build --base /',
      autoVerifiable: true,
    },
    {
      id: 'ac-katex-valid',
      description: 'All KaTeX equations render without errors',
      type: 'command',
      command: 'cd {{outputDirectory}} && npx slidev build --base / 2>&1 | grep -c "KaTeX" | test $(cat) -eq 0',
      autoVerifiable: true,
    },
    {
      id: 'ac-slide-count',
      description: 'Slide count is within the target range',
      type: 'command',
      command: 'grep -c "^---$" {{outputDirectory}}/slides.md',
      autoVerifiable: true,
    },
    {
      id: 'ac-speaker-notes',
      description: 'All content slides have speaker notes',
      type: 'manual',
      autoVerifiable: false,
    },
    {
      id: 'ac-content-accuracy',
      description: 'Slide content accurately represents the paper',
      type: 'manual',
      autoVerifiable: false,
    },
    {
      id: 'ac-visual-quality',
      description: 'Slides are visually clean and well-formatted',
      type: 'manual',
      autoVerifiable: false,
    },
  ],
}

// ============================================================================
// Parallelization Configuration
// ============================================================================

const parallelization: TemplateParallelizationConfig = {
  maxConcurrentTasks: 2,
  autoDispatch: true,
  preferredBackend: 'local',
  defaultModel: 'claude-sonnet-4-20250514',
  defaultMaxTurns: 30,
  defaultDeliveryMode: 'direct',
  useWorktrees: false,  // Slides project is standalone, no git worktree needed
  maxRetries: 1,
}

// ============================================================================
// Skill Requirements
// ============================================================================

const skills: TemplateSkillRequirements = {
  required: [],
  recommended: [
    'celltype-literature',  // For arXiv/preprint search capabilities
  ],
  inlineInstructions: `## Paper Fetching Instructions

When fetching papers from arXiv:

1. **LaTeX Source (preferred)**: Try fetching from \`https://arxiv.org/e-print/{ARXIV_ID}\` — this returns a tar.gz with the LaTeX source files. Extract and parse the .tex files.
2. **PDF Fallback**: If LaTeX source is unavailable, fetch the PDF from \`https://arxiv.org/pdf/{ARXIV_ID}.pdf\` and extract text content.
3. **Abstract & Metadata**: Fetch from \`https://arxiv.org/abs/{ARXIV_ID}\` to get title, authors, abstract, and submission date.
4. **arXiv API**: Use \`http://export.arxiv.org/api/query?id_list={ARXIV_ID}\` for structured metadata (Atom XML).

## Figure Extraction

When recreating paper figures:
- Architecture diagrams → Mermaid graph/flowchart
- Pipeline diagrams → Mermaid sequence or graph diagrams
- Mathematical plots → Describe in text, reference original figure numbers
- Tables → Markdown tables or HTML tables for complex layouts
- Attention visualizations → Describe qualitatively, reference figure numbers

## GitHub Repository Integration

When a GitHub URL is provided:
- Clone or fetch the repository to examine code structure
- Identify key model files (model.py, architecture files)
- Extract brief, illustrative code snippets (~10-20 lines each)
- Look for figure generation scripts in \`figures/\`, \`plots/\`, \`vis/\` directories
- Check README for model architecture descriptions`,
}

// ============================================================================
// Example Configurations
// ============================================================================

const examples: TemplateExample[] = [
  {
    name: 'Looped Transformers (ICML 2025)',
    description: 'Convert "On Expressive Power of Looped Transformers" into a 20-slide conference talk with emphasis on method and theoretical results.',
    parameterValues: {
      arxivUrl: 'https://arxiv.org/abs/2410.03569',
      githubUrl: 'https://github.com/kevin671/tmlt',
      targetAudience: 'conference',
      slideCount: '20-25',
      presentationStyle: 'academic-clean',
      emphasisAreas: ['method', 'math', 'results'],
      includeCodeSnippets: false,
      includeSpeakerNotes: true,
      slidevTheme: 'seriph',
      outputDirectory: './slides/2025_looped_transformer_modular',
    },
  },
  {
    name: 'Attention Is All You Need (Tutorial)',
    description: 'Create a detailed tutorial presentation of the original Transformer paper with step-by-step architecture walkthrough.',
    parameterValues: {
      arxivUrl: 'https://arxiv.org/abs/1706.03762',
      githubUrl: 'https://github.com/tensorflow/tensor2tensor',
      targetAudience: 'tutorial',
      slideCount: '50-plus',
      presentationStyle: 'academic-clean',
      emphasisAreas: ['method', 'math', 'background', 'code'],
      includeCodeSnippets: true,
      includeSpeakerNotes: true,
      slidevTheme: 'default',
      outputDirectory: './slides/attention_tutorial',
    },
  },
  {
    name: 'AlphaFold2 (Lab Meeting)',
    description: 'Present the AlphaFold2 paper in a research group meeting with focus on architecture and results.',
    parameterValues: {
      arxivUrl: 'https://arxiv.org/abs/2107.03451',
      targetAudience: 'research-group',
      slideCount: '20-25',
      presentationStyle: 'modern-dark',
      emphasisAreas: ['method', 'results', 'ablations'],
      includeCodeSnippets: false,
      includeSpeakerNotes: true,
      slidevTheme: 'dracula',
      outputDirectory: './slides/alphafold2_presentation',
    },
  },
]

// ============================================================================
// Complete Template Definition
// ============================================================================

/**
 * Paper-to-Slides builtin template.
 *
 * Converts academic papers (arXiv) into professional Slidev presentations.
 * Supports multiple audience levels, visual styles, and emphasis configurations.
 *
 * Example output structure (matching 2025_looped_transformer_modular pattern):
 * ```
 * slides/2025_looped_transformer_modular/
 *   slides.md            # 20-25 slide Slidev markdown
 *   package.json          # {"scripts": {"dev": "slidev", "build": "slidev build"}}
 *   public/figures/       # Extracted/recreated figures
 *   README.md             # Build & present instructions
 * ```
 *
 * The generated slides.md follows this structure:
 * ```markdown
 * ---
 * theme: seriph
 * title: "On Expressive Power of Looped Transformers"
 * ---
 *
 * # On Expressive Power of Looped Transformers
 * ### Theoretical Analysis and Enhancement via Timestep Encoding
 * **Author 1** · Author 2 · Author 3
 * *ICML 2025*
 *
 * ---
 * layout: section
 * ---
 * # Motivation & Background
 *
 * ---
 *
 * ## Why Looped Transformers?
 * - Standard transformers: fixed depth = fixed computation
 * - Looped transformers: **iterate** the same block → adaptive compute
 *
 * $$
 * h^{(t+1)} = \text{TransformerBlock}(h^{(t)})
 * $$
 *
 * <v-click>
 *
 * **Key question**: What can looped transformers compute that standard ones cannot?
 *
 * </v-click>
 *
 * <!-- Speaker: Start by motivating why we need adaptive computation... -->
 *
 * ---
 * layout: two-cols
 * ---
 * ## Architecture
 * - Shared parameters across loops
 * - Timestep encoding: $e_t = \text{PE}(t)$
 * - Input: $x$, Output: $h^{(T)}$
 *
 * ::right::
 *
 * ```mermaid
 * graph TD
 *   A[Input x] --> B[Block]
 *   B --> C{t < T?}
 *   C -->|Yes| B
 *   C -->|No| D[Output]
 * ```
 * ```
 */
export const paperToSlidesTemplate: UseCaseTemplate = {
  id: 'builtin-paper-to-slides',
  name: 'Paper to Slides',
  slug: 'paper-to-slides',
  description: 'Convert an arXiv paper into a professional Slidev presentation. Fetches the paper source, analyzes its structure, extracts key equations and figures, and generates a complete slide deck with KaTeX math, Mermaid diagrams, and speaker notes.',
  category: 'research',
  icon: '📊',
  tags: [
    'academic',
    'paper',
    'presentation',
    'slides',
    'slidev',
    'arxiv',
    'conference-talk',
    'research',
    'latex',
    'katex',
  ],

  parameters,
  prompts,
  outputFormat,
  parallelization,
  skills,
  examples,

  source: 'builtin',
  enabled: true,
  metadata: {
    version: '1.0.0',
    author: 'Astro Team',
    homepage: 'https://sli.dev',
    license: 'MIT',
    lastUpdated: '2026-03-01',
    minAstroVersion: '0.1.0',
    extra: {
      slidevMinVersion: '0.50.0',
      outputFormat: 'slidev-markdown',
      supportedPaperSources: ['arxiv', 'pdf-url'],
    },
  },
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
}
