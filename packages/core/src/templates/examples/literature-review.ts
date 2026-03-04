/**
 * Example: Literature Review Builder Template
 *
 * Generates comprehensive literature reviews from research topics and keywords.
 * Demonstrates search, analysis, and synthesis workflows with parallel processing
 * of multiple search queries and paper analysis.
 *
 * The pipeline:
 * 1. Parse research topic and generate search queries
 * 2. Search academic databases in parallel (arXiv, Semantic Scholar, PubMed)
 * 3. Filter and deduplicate results, rank by relevance
 * 4. Analyze papers in parallel (key findings, methodology, contributions)
 * 5. Synthesize into structured review document
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const literatureReviewTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro/literature-review',
  name: 'Literature Review Builder',
  description:
    'Build comprehensive literature reviews from research topics or keywords. Searches academic databases (arXiv, Semantic Scholar, PubMed), analyzes papers in parallel, identifies themes and gaps, and synthesizes findings into a structured review document. Outputs markdown with citations, comparison tables, and research gap analysis.',
  category: 'research-analysis',
  version: '1.0.0',
  icon: '📖',
  tags: ['literature-review', 'research', 'academic', 'arxiv', 'semantic-scholar', 'synthesis'],
  maturity: 'beta',

  // ── Parameters ────────────────────────────────────────────────────────

  requiredParameters: [
    {
      id: 'researchTopics',
      name: 'Research Topic(s)',
      description:
        'Research topic, question, or keywords to review. For multiple topics (e.g., comparing fields), enter one per line - each will be searched independently and then synthesized. Be specific: "transformer architectures for protein structure prediction" is better than "machine learning biology".',
      type: 'string',
      required: true,
      placeholder: 'Transformer architectures for time series forecasting\nState-space models for sequence modeling',
      validation: {
        min: 10,
        max: 500,
        message: 'Topic should be 10-500 characters for optimal search results',
      },
      group: 'topic',
      order: 0,
    },
    {
      id: 'reviewType',
      name: 'Review Type',
      description: 'Type of literature review to generate. Affects structure, depth, and synthesis approach.',
      type: 'select',
      required: true,
      default: 'systematic',
      options: [
        {
          label: 'Systematic Review',
          value: 'systematic',
          description: 'Comprehensive, methodical review following PRISMA-like guidelines',
        },
        {
          label: 'Narrative Review',
          value: 'narrative',
          description: 'Thematic synthesis without strict methodology constraints',
        },
        {
          label: 'Scoping Review',
          value: 'scoping',
          description: 'Broad overview to map key concepts and research gaps',
        },
        {
          label: 'Meta-Analysis Prep',
          value: 'meta-analysis',
          description: 'Structured extraction for subsequent quantitative synthesis',
        },
        {
          label: 'Rapid Review',
          value: 'rapid',
          description: 'Quick synthesis of recent literature (last 2-3 years)',
        },
      ],
      group: 'topic',
      order: 1,
    },
  ],

  optionalParameters: [
    {
      id: 'databases',
      name: 'Academic Databases',
      description: 'Which databases to search. Different databases have different coverage.',
      type: 'multi-select',
      required: false,
      default: ['arxiv', 'semantic-scholar'],
      options: [
        { label: 'arXiv', value: 'arxiv', description: 'Preprints in physics, CS, math, biology, etc.' },
        { label: 'Semantic Scholar', value: 'semantic-scholar', description: 'Broad coverage with citation analysis' },
        { label: 'PubMed', value: 'pubmed', description: 'Biomedical and life sciences literature' },
        { label: 'OpenAlex', value: 'openalex', description: 'Open catalog of scholarly papers, authors, institutions' },
        { label: 'Google Scholar', value: 'google-scholar', description: 'Broadest coverage including books/theses' },
      ],
      group: 'search',
      order: 0,
    },
    {
      id: 'yearRange',
      name: 'Year Range',
      description: 'Publication year range to consider.',
      type: 'select',
      required: false,
      default: 'last-5',
      options: [
        { label: 'Last 2 Years', value: 'last-2', description: 'Most recent literature (2024-2026)' },
        { label: 'Last 5 Years', value: 'last-5', description: 'Recent literature (2021-2026)' },
        { label: 'Last 10 Years', value: 'last-10', description: 'Decade of research (2016-2026)' },
        { label: 'All Time', value: 'all', description: 'No year restriction' },
        { label: 'Custom', value: 'custom', description: 'Specify custom year range' },
      ],
      group: 'search',
      order: 1,
    },
    {
      id: 'customYears',
      name: 'Custom Year Range',
      description: 'Custom year range (e.g., "2018-2023").',
      type: 'string',
      required: false,
      placeholder: '2018-2023',
      visibleWhen: {
        parameterId: 'yearRange',
        operator: 'equals',
        value: 'custom',
      },
      validation: {
        pattern: '^\\d{4}-\\d{4}$',
        message: 'Format: YYYY-YYYY (e.g., 2018-2023)',
      },
      group: 'search',
      order: 2,
    },
    {
      id: 'maxPapers',
      name: 'Maximum Papers',
      description: 'Maximum number of papers to include in the review.',
      type: 'select',
      required: false,
      default: '30',
      options: [
        { label: '15 Papers', value: '15', description: 'Focused review of key papers' },
        { label: '30 Papers', value: '30', description: 'Standard comprehensive review' },
        { label: '50 Papers', value: '50', description: 'Extensive review for broad topics' },
        { label: '100 Papers', value: '100', description: 'Large-scale systematic review' },
      ],
      group: 'search',
      order: 3,
    },
    {
      id: 'analysisDepth',
      name: 'Analysis Depth',
      description: 'How deeply to analyze each paper.',
      type: 'select',
      required: false,
      default: 'standard',
      options: [
        { label: 'Summary Only', value: 'summary', description: 'Brief abstract-level summary' },
        { label: 'Standard', value: 'standard', description: 'Key findings, methods, and contributions' },
        { label: 'Deep', value: 'deep', description: 'Detailed methodology and results analysis' },
        { label: 'Critical', value: 'critical', description: 'Include limitations and critical assessment' },
      ],
      group: 'analysis',
      order: 0,
    },
    {
      id: 'synthesisFormat',
      name: 'Synthesis Format',
      description: 'How to structure the final review.',
      type: 'select',
      required: false,
      default: 'thematic',
      options: [
        { label: 'Thematic', value: 'thematic', description: 'Organized by themes/concepts' },
        { label: 'Chronological', value: 'chronological', description: 'Historical progression of ideas' },
        { label: 'Methodological', value: 'methodological', description: 'Grouped by research methods' },
        { label: 'Conceptual', value: 'conceptual', description: 'Conceptual framework mapping' },
      ],
      group: 'synthesis',
      order: 0,
    },
    {
      id: 'includeTables',
      name: 'Include Comparison Tables',
      description: 'Generate structured comparison tables for methods, datasets, and results.',
      type: 'boolean',
      required: false,
      default: true,
      group: 'synthesis',
      order: 1,
    },
    {
      id: 'includeGapAnalysis',
      name: 'Include Gap Analysis',
      description: 'Analyze and summarize research gaps and future directions.',
      type: 'boolean',
      required: false,
      default: true,
      group: 'synthesis',
      order: 2,
    },
    {
      id: 'citationFormat',
      name: 'Citation Format',
      description: 'Citation style for references.',
      type: 'select',
      required: false,
      default: 'apa',
      options: [
        { label: 'APA 7th', value: 'apa', description: 'American Psychological Association' },
        { label: 'IEEE', value: 'ieee', description: 'Institute of Electrical and Electronics Engineers' },
        { label: 'ACM', value: 'acm', description: 'Association for Computing Machinery' },
        { label: 'Nature', value: 'nature', description: 'Nature journal style' },
        { label: 'BibTeX', value: 'bibtex', description: 'BibTeX entries for LaTeX' },
      ],
      group: 'output',
      order: 0,
    },
    {
      id: 'outputFormat',
      name: 'Output Format',
      description: 'Final document format.',
      type: 'select',
      required: false,
      default: 'markdown',
      options: [
        { label: 'Markdown', value: 'markdown', description: 'GitHub-flavored markdown' },
        { label: 'LaTeX', value: 'latex', description: 'LaTeX document ready for compilation' },
        { label: 'Word-Compatible', value: 'word', description: 'Markdown optimized for Pandoc/Word conversion' },
      ],
      group: 'output',
      order: 1,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────

  prompts: {
    planGeneration: `You are an expert research assistant building comprehensive literature reviews.

## Research Specification
- Topic(s): {{researchTopics}}
- Review Type: {{reviewType}}
- Databases: {{databases}}
- Year Range: {{yearRange}} {{customYears}}
- Max Papers: {{maxPapers}}
- Analysis Depth: {{analysisDepth}}
- Synthesis Format: {{synthesisFormat}}
- Include Tables: {{includeTables}}
- Include Gap Analysis: {{includeGapAnalysis}}
- Citation Format: {{citationFormat}}
- Output Format: {{outputFormat}}

## Planning Guidelines

Decompose this literature review into a DAG of tasks and milestones.

### Target Output Structure

\`\`\`
review/
  review.md                   # Main review document
  sections/
    01-introduction.md        # Research question and scope
    02-methodology.md         # Search strategy and selection criteria
    03-results.md             # Search results and PRISMA diagram
    04-synthesis.md           # Thematic synthesis
    05-discussion.md          # Critical discussion
    06-gaps.md                # Research gaps and future directions
    07-conclusion.md          # Summary and implications
  tables/
    comparison-table.md       # Method/results comparison
    summary-table.md          # Paper summary table
  appendices/
    search-queries.md         # Search query documentation
    excluded-papers.md        # Exclusion reasons
  references.bib              # Bibliography file
  README.md                   # Review metadata and reproduction
\`\`\`

### Milestone Structure

1. **Search Strategy Development**
   - Parse research topic into key concepts and synonyms
   - Generate search queries for each database
   - Define inclusion/exclusion criteria
   - Document search protocol

2. **Literature Search** (parallelizable by database)
   - Execute searches on each database in {{databases}}
   - Collect paper metadata (title, abstract, authors, year, citations)
   - Apply year filter ({{yearRange}})
   - Track search results per database

3. **Screening & Selection**
   - Deduplicate papers across databases
   - Screen by title/abstract relevance
   - Apply inclusion/exclusion criteria
   - Rank papers by relevance/citation count
   - Select top {{maxPapers}} papers for analysis

4. **Paper Analysis** (main parallel phase)
   - Analyze each paper at {{analysisDepth}} depth
   - Extract: key findings, methodology, datasets, results
   - Identify themes, concepts, and relationships
   - Note limitations and quality concerns
   - Batch papers into groups for parallel processing

5. **Synthesis & Writing** (parallelizable by section)
   - Generate introduction with research question
   - Write methodology section (PRISMA flow)
   - Create results summary with tables
   - Synthesize themes ({{synthesisFormat}} format)
   - Write critical discussion
   - Identify research gaps (if {{includeGapAnalysis}})
   - Generate conclusion

6. **Assembly & Formatting**
   - Compile all sections into final document
   - Generate comparison tables (if {{includeTables}})
   - Format citations ({{citationFormat}})
   - Create bibliography
   - Validate internal references

### Task Granularity

- Search query development: 1 task
- Each database search: 1 task (parallel)
- Screening and selection: 1 task
- Paper analysis: batch into groups of 5-10 papers per task (parallel)
- Each synthesis section: 1 task (parallel)
- Assembly and formatting: 1 task

### Parallelism

**Database Searches:**
- All database searches run in parallel
- Each database produces independent results
- Deduplication merges all results

**Paper Analysis:**
- Batch papers into groups (e.g., 5 papers per task)
- All analysis tasks run in parallel
- Results feed into synthesis

**Synthesis Sections:**
- Introduction and methodology can start after screening
- Results and synthesis need paper analysis complete
- Discussion and gaps need synthesis themes
- Sections can run in parallel where dependencies allow

**Multiple Topics (Input Parallelization):**
If multiple research topics are provided:
- Each topic gets its own search and analysis branch
- Branches merge at synthesis to create comparative review
- Final output addresses all topics with cross-comparisons

### Review Type Considerations

For {{reviewType}}:
- systematic: Follow PRISMA guidelines, document everything, explicit criteria
- narrative: Flexible structure, emphasize interpretation and synthesis
- scoping: Broad coverage, map concepts, identify key areas
- meta-analysis: Structured data extraction, effect sizes, heterogeneity
- rapid: Recent literature focus, streamlined screening, quick turnaround

### Labels
- l5=Research (search, analysis, synthesis)
- l3=Testing (validation, quality checks)

### Verification
- "auto" for search execution and formatting
- "human" for synthesis quality and gap identification`,

    taskExecution: `You are conducting a literature review analysis.

## Context
- Research Topic: {{researchTopics}}
- Review Type: {{reviewType}}
- Year Range: {{yearRange}}
- Analysis Depth: {{analysisDepth}}
- Synthesis Format: {{synthesisFormat}}

## Analysis Standards

### Paper Analysis Format
For each paper, extract:

\`\`\`markdown
### [Author et al., Year] "Paper Title"

**Citation:** Full citation in {{citationFormat}} format

**Key Findings:**
- Main contribution 1
- Main contribution 2
- Main contribution 3

**Methodology:**
- Approach/algorithm
- Dataset(s) used
- Evaluation metrics

**Results:**
- Key quantitative results
- Comparison to baselines

**Limitations:**
- Noted limitations
- Methodological concerns

**Relevance to Review:**
- How this paper relates to the research question
- Themes it contributes to
\`\`\`

### Synthesis Guidelines

**Thematic Synthesis:**
1. Identify recurring themes across papers
2. Group papers by theme
3. Analyze convergence and divergence
4. Note evolution of ideas over time

**Comparison Tables:**
| Paper | Method | Dataset | Key Metric | Result |
|-------|--------|---------|------------|--------|
| [A]   | ...    | ...     | ...        | ...    |

**Gap Analysis:**
1. What questions remain unanswered?
2. What methodological limitations persist?
3. What datasets/benchmarks are missing?
4. What application domains are underexplored?

### Citation Handling
- Use consistent citation keys: [AuthorYear] or [1]
- Include DOI when available
- Link to arXiv/paper URL
- Note if preprint vs peer-reviewed

### Quality Indicators
- Citation count as relevance signal
- Venue quality (top conference/journal)
- Reproducibility (code/data available)
- Methodological rigor`,

    planRefinement: `You are refining a literature review plan. The user may want to:

- Narrow or broaden the research scope
- Add or remove databases
- Adjust the number of papers
- Change the synthesis structure
- Focus on specific themes or time periods
- Add specific papers to include/exclude

When the user suggests changes:
1. Identify which search/analysis tasks are affected
2. Estimate impact on review completeness
3. Propose specific modifications
4. Note any methodology implications`,

    sharedContext: `Literature review methodology context:

## PRISMA Guidelines (Systematic Reviews)
1. Identification: Records from databases + other sources
2. Screening: Remove duplicates, screen title/abstract
3. Eligibility: Full-text assessment against criteria
4. Included: Final papers for synthesis

## Search Query Construction
- Use Boolean operators: AND, OR, NOT
- Use quotation marks for exact phrases
- Use wildcards (* for truncation)
- Combine: (term1 OR synonym1) AND (term2 OR synonym2)

## Inclusion/Exclusion Criteria
Common inclusion:
- Peer-reviewed or reputable preprint
- Within year range
- Relevant to research question
- Available in English (or specified language)

Common exclusion:
- Duplicate publication
- Review articles (for primary research reviews)
- Off-topic based on abstract
- Insufficient methodological detail

## Database-Specific Tips
- arXiv: Use cs.*, stat.*, etc. for categories
- Semantic Scholar: Use "year:" and "venue:" filters
- PubMed: Use MeSH terms for precision
- OpenAlex: Rich metadata, good for citation analysis

## Synthesis Strategies
- Thematic: Group by conceptual themes
- Chronological: Track evolution of ideas
- Methodological: Compare research approaches
- Vote counting: Tally findings (use cautiously)

## Critical Assessment
- Study design appropriateness
- Sample size and power
- Validity of conclusions
- Generalizability
- Conflicts of interest`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'markdown',
    description:
      'Structured literature review document with sections for introduction, methodology, results, synthesis, discussion, and conclusions. Includes comparison tables, PRISMA flow diagram (if systematic), and formatted bibliography.',
    example: `# Literature Review: Transformer Architectures for Time Series Forecasting

## Abstract

This systematic review examines recent advances in transformer-based approaches for time series forecasting, covering 30 papers published between 2021-2026...

## 1. Introduction

### 1.1 Background
Time series forecasting is fundamental to...

### 1.2 Research Questions
1. How do transformer architectures compare to traditional methods?
2. What modifications make transformers effective for time series?

## 2. Methodology

### 2.1 Search Strategy
| Database | Query | Results |
|----------|-------|---------|
| arXiv    | ...   | 156     |
| Semantic Scholar | ... | 203 |

### 2.2 Selection Criteria
**Inclusion:** ...
**Exclusion:** ...

### 2.3 PRISMA Flow
\`\`\`mermaid
flowchart TD
    A[Records identified n=359] --> B[Duplicates removed n=89]
    B --> C[Screened n=270]
    C --> D[Excluded n=180]
    C --> E[Full-text assessed n=90]
    E --> F[Excluded n=60]
    E --> G[Included n=30]
\`\`\`

## 3. Results

### 3.1 Summary of Included Studies
| Paper | Year | Method | Dataset | Key Result |
|-------|------|--------|---------|------------|
| [Zhou et al., 2021] | 2021 | Informer | ETT | MSE: 0.193 |

## 4. Thematic Synthesis

### 4.1 Attention Mechanisms
The literature identifies several attention variants...

### 4.2 Computational Efficiency
A key challenge addressed by...

## 5. Discussion

### 5.1 Key Findings
...

### 5.2 Limitations
...

## 6. Research Gaps

1. **Limited real-world evaluation**: Most papers...
2. **Scalability concerns**: Few studies address...

## 7. Conclusion

This review synthesizes current knowledge on...

## References

[Zhou et al., 2021] Zhou, H., Zhang, S., Peng, J., et al. (2021). Informer: Beyond efficient transformer for long sequence time-series forecasting. AAAI.`,
  },

  // ── Parallelization ───────────────────────────────────────────────────
  parallelization: {
    maxConcurrentTasks: 8,
    autoDispatch: true,
    defaultPriority: 'normal',
    retry: {
      maxRetries: 3,
      retryDelayMs: 10000,
      exponentialBackoff: true,
    },
    machineSelectionPolicy: 'priority',
  },

  // ── Input Parallelization ──────────────────────────────────────────────
  inputParallelization: {
    parameterId: 'researchTopics',
    splitStrategy: 'newline',
    mergeStrategy: 'concatenate',
    branchLabelFormat: 'Topic {{index}}: {{shortValue}}',
    maxBranches: 4,
    minInputsForParallel: 2,
    addMergeTask: true,
    mergeTaskDescription: 'Synthesize findings across all research topics into a unified comparative review',
  },

  // ── Execution ─────────────────────────────────────────────────────────
  execution: {
    preferredModel: 'claude-sonnet-4-20250514',
    maxTurns: 50,
    maxBudgetPerTask: 8.0,
    deliveryMode: 'branch',
    skipSafetyCheck: true, // Read-only research task
    defaultVerification: 'mixed',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 10, max: 20 },
    defaultEstimate: 'M',
    suggestedMilestones: [
      {
        title: 'Search Strategy Ready',
        description: 'Queries developed, databases selected, criteria defined',
      },
      {
        title: 'Literature Collected',
        description: 'All database searches complete, results deduplicated and screened',
      },
      {
        title: 'Papers Analyzed',
        description: 'All selected papers analyzed, key findings extracted, themes identified',
      },
      {
        title: 'Synthesis Complete',
        description: 'All sections written, tables generated, gaps identified',
      },
      {
        title: 'Review Finalized',
        description: 'Document assembled, citations formatted, ready for use',
      },
    ],
    commonLabels: ['l5'],
    preferParallelTasks: true,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['scientific-computing', 'ml-ai', 'data-engineering'],
  recommendedSkills: [],
  source: 'builtin',
  enabled: true,
}
