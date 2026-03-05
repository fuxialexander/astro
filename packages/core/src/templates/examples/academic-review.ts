/**
 * Example: Academic Paper/Book Review Template
 *
 * Generates a superhuman-level detailed review of academic papers or books.
 * Supports PDF, LaTeX, Markdown, and Word (.docx) source formats.
 *
 * Review Pipeline:
 * 1. Parse & comprehend the full document
 * 2. Map the logical structure and argument flow (diagram)
 * 3. Novelty analysis with literature comparison
 * 4. Technical/methodological rigor assessment
 * 5. Merits & shortcomings enumeration
 * 6. Generate structured PDF report (via LaTeX or Markdown→PDF)
 *
 * Uses the PDF skill (anthropics/skills/pdf) for PDF inputs and
 * the DOCX skill (anthropics/skills/docx) for Word documents.
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const academicReviewTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro/academic-review',
  name: 'Academic Paper/Book Review',
  description:
    'Generate a superhuman-level detailed review of academic papers or books. Produces a structured PDF report covering comprehension, logical flow diagrams, novelty analysis with literature comparison, technical rigor assessment, and comprehensive merits/shortcomings evaluation. Supports PDF, LaTeX, Markdown, and Word inputs.',
  category: 'research',
  version: '1.0.0',
  icon: '📖',
  tags: ['review', 'academic', 'paper', 'book', 'critique', 'analysis', 'pdf', 'latex', 'docx'],
  maturity: 'stable',

  // ── Parameters ────────────────────────────────────────────────────────

  requiredParameters: [
    {
      id: 'sourceDirectory',
      name: 'Source Directory',
      description:
        'Path to the directory containing the document(s) to review. The directory should contain files in the selected source format.',
      type: 'string',
      required: true,
      placeholder: '/path/to/papers/',
      validation: {
        min: 1,
        message: 'Provide a path to the directory containing the document(s)',
      },
      group: 'source',
      order: 0,
    },
    {
      id: 'documentType',
      name: 'Document Type',
      description: 'What type of document are you reviewing?',
      type: 'select',
      required: true,
      default: 'paper',
      options: [
        { label: 'Academic Paper', value: 'paper', description: 'Journal article, conference paper, preprint, or technical report' },
        { label: 'Book', value: 'book', description: 'Textbook, monograph, or edited volume' },
        { label: 'Thesis/Dissertation', value: 'thesis', description: 'PhD dissertation, Master\'s thesis, or honors thesis' },
      ],
      group: 'source',
      order: 1,
    },
    {
      id: 'sourceFormat',
      name: 'Source Format',
      description:
        'File format of the source document. This determines which extraction tool is used. PDF files use the PDF skill; DOCX files use the DOCX skill; LaTeX and Markdown are read directly.',
      type: 'select',
      required: true,
      default: 'pdf',
      options: [
        { label: 'PDF', value: 'pdf', description: 'Uses the PDF skill (anthropics/skills/pdf) for extraction' },
        { label: 'LaTeX (.tex)', value: 'latex', description: 'LaTeX source files — read and parsed directly' },
        { label: 'Markdown (.md)', value: 'markdown', description: 'Markdown files — read directly' },
        { label: 'Word (.docx)', value: 'docx', description: 'Uses the DOCX skill (anthropics/skills/docx) for extraction' },
      ],
      group: 'source',
      order: 2,
    },
  ],

  optionalParameters: [
    // ── Review focus ──
    {
      id: 'reviewDepth',
      name: 'Review Depth',
      description: 'How thorough should the review be?',
      type: 'select',
      required: false,
      default: 'comprehensive',
      options: [
        { label: 'Comprehensive', value: 'comprehensive', description: 'Full review with literature comparison, technical assessment, and detailed scoring (~15-25 pages)' },
        { label: 'Standard', value: 'standard', description: 'Balanced review covering all dimensions (~8-12 pages)' },
        { label: 'Quick Assessment', value: 'quick', description: 'High-level assessment of novelty and quality (~3-5 pages)' },
      ],
      group: 'review',
      order: 0,
    },
    {
      id: 'reviewerExpertise',
      name: 'Reviewer Expertise Level',
      description: 'Assume reviewer expertise at this level for calibrating critique depth.',
      type: 'select',
      required: false,
      default: 'expert',
      options: [
        { label: 'Domain Expert', value: 'expert', description: 'Deep domain knowledge — focus on technical novelty and methodological rigor' },
        { label: 'General Researcher', value: 'researcher', description: 'Broad research background — balance accessibility with technical depth' },
        { label: 'Graduate Student', value: 'student', description: 'Learning context — include more explanations and educational commentary' },
      ],
      group: 'review',
      order: 1,
    },
    {
      id: 'focusAreas',
      name: 'Focus Areas',
      description: 'Select specific areas to emphasize in the review. All areas are covered regardless, but selected areas receive deeper treatment.',
      type: 'multi-select',
      required: false,
      default: [],
      options: [
        { label: 'Novelty & Originality', value: 'novelty', description: 'Deep dive into what is truly new vs. incremental' },
        { label: 'Mathematical Rigor', value: 'math', description: 'Proof correctness, derivation validity, statistical soundness' },
        { label: 'Experimental Design', value: 'experiments', description: 'Methodology, baselines, ablations, statistical significance' },
        { label: 'Writing & Presentation', value: 'writing', description: 'Clarity, structure, figure quality, completeness' },
      ],
      group: 'review',
      order: 2,
    },
    {
      id: 'targetVenue',
      name: 'Target Venue',
      description: 'If known, calibrate review standards to a specific venue or publication tier.',
      type: 'string',
      required: false,
      placeholder: 'e.g., NeurIPS, Nature, ICML, ACL, Physical Review Letters',
      group: 'review',
      order: 3,
    },

    // ── Output ──
    {
      id: 'reportFormat',
      name: 'Report Format',
      description: 'Output format for the review report.',
      type: 'select',
      required: false,
      default: 'latex-pdf',
      options: [
        { label: 'LaTeX → PDF', value: 'latex-pdf', description: 'Professional LaTeX report compiled to PDF' },
        { label: 'Markdown → PDF', value: 'markdown-pdf', description: 'Markdown report converted to PDF via Playwright' },
      ],
      group: 'output',
      order: 0,
    },
    {
      id: 'includeDiagrams',
      name: 'Include Logic Diagrams',
      description: 'Generate SVG diagrams of the paper\'s argument flow and methodology.',
      type: 'select',
      required: false,
      default: 'yes',
      options: [
        { label: 'Yes', value: 'yes', description: 'Generate argument flow diagrams and methodology maps' },
        { label: 'No', value: 'no', description: 'Text-only report without diagrams' },
      ],
      group: 'output',
      order: 1,
    },
    {
      id: 'literatureSearch',
      name: 'Literature Search',
      description: 'Whether to conduct a mini literature review to contextualize novelty claims.',
      type: 'select',
      required: false,
      default: 'enabled',
      options: [
        { label: 'Enabled', value: 'enabled', description: 'Search for and cite related work to assess novelty (recommended)' },
        { label: 'Disabled', value: 'disabled', description: 'Review based only on the document itself' },
      ],
      group: 'review',
      order: 4,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────

  prompts: {
    planGeneration: `You are a world-class academic reviewer generating a superhuman-level review pipeline for a document.

## Document Specification
- Source Directory: {{sourceDirectory}}
- Document Type: {{documentType}}
- Source Format: {{sourceFormat}}
- Review Depth: {{reviewDepth}}
- Reviewer Expertise: {{reviewerExpertise}}
- Focus Areas: {{focusAreas}}
- Target Venue: {{targetVenue}}
- Report Format: {{reportFormat}}
- Include Diagrams: {{includeDiagrams}}
- Literature Search: {{literatureSearch}}

## Skill Reference
This project uses the \`academic-review\` skill. The skill's SKILL.md contains:
- The complete Review Scoring Rubric (1-10 scale across 8 dimensions)
- Document parsing instructions per format (PDF skill, DOCX skill, LaTeX/MD direct)
- The 6-phase review pipeline specification
- Logic flow diagram generation guidelines
- Report LaTeX/Markdown template and styling
- Literature comparison methodology

**The SKILL.md is the single source of truth for review criteria and report format.**

## Planning Guidelines

Decompose this review into a DAG of tasks following the 6-phase pipeline:

### Phase 1: Document Parsing & Comprehension
- Parse the source document using the appropriate tool:
  - PDF → use the PDF skill (Read tool with PDF files)
  - DOCX → use the DOCX skill (Bash: docx extraction)
  - LaTeX → read .tex files directly, parse structure
  - Markdown → read .md files directly
- Extract: title, authors, abstract, sections, equations, figures, references
- Generate a structured summary: what is this document about?
- Identify the core claims and contributions (3-5 key points)

### Phase 2: Logical Structure & Argument Flow
- Map the argument structure: premises → reasoning → conclusions
- Identify logical dependencies between claims
- Generate an argument flow diagram (SVG if diagrams enabled)
- Flag any logical gaps, circular reasoning, or unsupported leaps
- For books: map chapter dependencies and narrative arc

### Phase 3: Novelty Analysis & Literature Context
- Identify the claimed contributions
- If literature search enabled: search for related work and prior art
- Assess each contribution: truly novel / incremental / already known
- Compare methodology to existing approaches
- Rate novelty on the rubric scale (1-10)

### Phase 4: Technical & Methodological Rigor
- Verify mathematical derivations and proofs (if applicable)
- Assess experimental methodology: baselines, controls, ablations
- Check statistical significance of reported results
- Evaluate reproducibility: are methods described in sufficient detail?
- Rate technical quality on the rubric scale (1-10)

### Phase 5: Merits & Shortcomings Enumeration
- List all significant merits (minimum 5)
- List all significant shortcomings (minimum 5)
- Categorize: major vs minor for each
- Provide specific evidence/page references for each point
- Generate actionable recommendations for improvement

### Phase 6: Report Generation
- Compile all analysis into the chosen report format
- Apply the scoring rubric across all 8 dimensions
- Generate the final PDF (LaTeX compilation or Markdown→PDF)
- Include argument flow diagrams if enabled
- Proofread and verify all citations/references

### Parallelism
- Phase 1 must complete first (all other phases depend on it)
- Phases 2, 3, and 4 can run in parallel
- Phase 5 depends on phases 2, 3, and 4
- Phase 6 depends on phase 5

### Labels
- l5=Research (analysis, literature review)
- l1=Frontend (report generation, diagrams)

### Verification
- "auto" for parsing and extraction tasks
- "human" for final review quality assessment`,

    taskExecution: `You are conducting a superhuman-level academic review.

## Context
- Source Directory: {{sourceDirectory}}
- Document Type: {{documentType}}
- Source Format: {{sourceFormat}}
- Review Depth: {{reviewDepth}}
- Focus Areas: {{focusAreas}}
- Target Venue: {{targetVenue}}

## CRITICAL: Document Reading Tools

**For PDF files**: You MUST use the PDF skill to read PDF documents. Use the Read tool on PDF files — it will render the PDF content for analysis. Reference: https://github.com/anthropics/skills/tree/main/skills/pdf

**For DOCX files**: You MUST use the DOCX skill to read Word documents. Use Bash to run extraction commands or the appropriate DOCX parsing approach. Reference: https://github.com/anthropics/skills/tree/main/skills/docx

**For LaTeX files**: Read .tex files directly with the Read tool. Parse \\section, \\subsection, equations (\\begin{equation}), figures (\\includegraphics), and bibliography.

**For Markdown files**: Read .md files directly with the Read tool.

## Skill Reference
Consult the \`academic-review\` skill's SKILL.md for:
- The complete 8-dimension scoring rubric (1-10 scale)
- Review logic and methodology
- Report template and styling
- Diagram generation guidelines

## Review Principles
- Be rigorous but fair — acknowledge genuine contributions
- Provide specific evidence for every claim (page numbers, equations, figures)
- Distinguish between fundamental flaws and presentation issues
- Calibrate standards to the target venue if specified
- Always suggest constructive improvements, not just criticisms`,

    sharedContext: `Academic Paper/Book Review shared context:

## Review Scoring Rubric (1-10 Scale)

### 8 Dimensions
1. **Novelty & Originality** (weight: 20%)
   - 9-10: Paradigm-shifting idea, opens new research direction
   - 7-8: Significant novel contribution with clear differentiation from prior work
   - 5-6: Incremental improvement with some novel elements
   - 3-4: Limited novelty, mostly recombination of known ideas
   - 1-2: No discernible novelty

2. **Technical Quality** (weight: 20%)
   - 9-10: Flawless methodology, rigorous proofs, comprehensive experiments
   - 7-8: Sound methodology with minor gaps
   - 5-6: Generally correct but with notable weaknesses
   - 3-4: Significant methodological concerns
   - 1-2: Fundamentally flawed

3. **Significance & Impact** (weight: 15%)
   - 9-10: Will reshape the field
   - 7-8: Important contribution, likely to be highly cited
   - 5-6: Useful contribution, moderate impact expected
   - 3-4: Limited impact, niche audience
   - 1-2: Negligible impact

4. **Clarity & Presentation** (weight: 10%)
   - 9-10: Exceptionally clear, well-organized, beautiful figures
   - 7-8: Clear writing, good structure
   - 5-6: Adequate but could be improved
   - 3-4: Difficult to follow, poor organization
   - 1-2: Incomprehensible

5. **Experimental Rigor** (weight: 15%)
   - 9-10: Comprehensive experiments, strong baselines, ablations, statistical tests
   - 7-8: Good experiments with adequate baselines
   - 5-6: Basic experiments, missing some important comparisons
   - 3-4: Weak experiments, inadequate baselines
   - 1-2: No experiments or completely unconvincing

6. **Reproducibility** (weight: 5%)
   - 9-10: Code + data released, all details provided
   - 7-8: Sufficient detail to reproduce, code promised
   - 5-6: Most details present, some ambiguity
   - 3-4: Missing critical implementation details
   - 1-2: Cannot be reproduced from description

7. **Literature Coverage** (weight: 10%)
   - 9-10: Comprehensive, fair comparison to all relevant work
   - 7-8: Good coverage with minor omissions
   - 5-6: Adequate but missing some important references
   - 3-4: Significant gaps in related work
   - 1-2: Ignores most prior work

8. **Ethical Considerations** (weight: 5%)
   - 9-10: Thorough ethics discussion, limitations acknowledged
   - 7-8: Ethics addressed adequately
   - 5-6: Brief mention of limitations
   - 3-4: Ethics largely ignored
   - 1-2: Potential ethical concerns unaddressed

### Overall Score Calculation
Weighted average of all 8 dimensions. Final verdict:
- 8.0-10.0: **Strong Accept** — exceptional work
- 6.5-7.9: **Accept** — solid contribution
- 5.0-6.4: **Weak Accept / Borderline** — has merit but needs revision
- 3.5-4.9: **Weak Reject** — significant issues
- 1.0-3.4: **Reject** — fundamental problems

## Document Reading Tools
- **PDF**: Use the PDF skill (Read tool on .pdf files)
- **DOCX**: Use the DOCX skill (Bash extraction for .docx files)
- **LaTeX**: Read .tex files directly
- **Markdown**: Read .md files directly

## Report Structure
The final review report follows this structure:
1. Executive Summary (overall score + 3-sentence verdict)
2. Document Overview (what is it, who wrote it, what does it claim)
3. Argument Flow Diagram (SVG)
4. Dimension-by-Dimension Scoring (8 dimensions with justification)
5. Major Merits (with evidence)
6. Major Shortcomings (with evidence)
7. Minor Issues
8. Recommendations for Improvement
9. Literature Context
10. Final Verdict and Confidence Level`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'free',
    description:
      'Structured review report in PDF format (via LaTeX or Markdown). Includes scoring rubric, argument flow diagrams, and detailed per-dimension analysis.',
    example: `output/
  review-report.tex         # LaTeX source (if latex-pdf format)
  review-report.pdf         # Compiled PDF report
  diagrams/
    argument-flow.svg       # Argument structure diagram
    methodology-map.svg     # Methodology overview
  notes/
    literature-context.md   # Related work analysis
    raw-notes.md            # Detailed review notes`,
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
    maxTurns: 50,
    maxBudgetPerTask: 5.0,
    skills: ['academic-review'],
    deliveryMode: 'branch',
    skipSafetyCheck: false,
    defaultVerification: 'mixed',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 6, max: 15 },
    defaultEstimate: 'M',
    suggestedMilestones: [
      {
        title: 'Document Parsed',
        description: 'Source document fully parsed, structure extracted, core claims identified',
      },
      {
        title: 'Structure Mapped',
        description: 'Argument flow diagram generated, logical dependencies identified',
      },
      {
        title: 'Novelty Assessed',
        description: 'Literature comparison complete, novelty scores assigned',
      },
      {
        title: 'Technical Review Complete',
        description: 'Methodology, proofs, and experiments assessed with detailed scores',
      },
      {
        title: 'Report Generated',
        description: 'Final PDF report with all scores, merits, shortcomings, and recommendations',
      },
    ],
    commonLabels: ['l1', 'l5'],
    preferParallelTasks: true,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['scientific-computing'],
  recommendedSkills: ['academic-review'],
  source: 'builtin',
  enabled: true,
}
