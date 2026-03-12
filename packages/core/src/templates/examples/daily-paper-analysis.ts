/**
 * Example: HuggingFace Daily Paper Analysis Template
 *
 * Produces two deliverables from HuggingFace Daily Papers:
 * 1. AI digest summarizing ALL papers for a selected date
 * 2. In-depth analysis of top-N papers (by upvotes) with
 *    architecture figures, background context, and LaTeX source
 *
 * Data sources: HuggingFace API, AlphaXiv overview/abs endpoints, arXiv.
 * User selects a date; the system validates, ranks, and analyzes.
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const dailyPaperAnalysisTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro--daily-paper-analysis',
  name: 'Daily Paper Analysis',
  description:
    'Analyze HuggingFace Daily Papers for any date. Get a digest of ALL papers plus in-depth analysis of the top-rated ones — with architecture figures, background context, and key equations. Optionally add specific papers (by arXiv link, title, or GitHub URL) for guaranteed inclusion in the detailed analysis.',
  category: 'research',
  version: '1.0.0',
  icon: '📰',
  tags: ['arxiv', 'huggingface', 'daily-papers', 'research', 'analysis', 'alphaxiv', 'digest', 'survey'],
  maturity: 'stable',

  // ── Parameters ────────────────────────────────────────────────────────

  requiredParameters: [
    {
      id: 'workingDirectory',
      name: 'Working Directory',
      description:
        'Directory where all output files (digest, individual analyses, compiled document, PDF) will be saved.',
      type: 'file-path',
      required: true,
      placeholder: '/path/to/output',
      group: 'source',
      order: 0,
    },
    {
      id: 'date',
      name: 'Date',
      description:
        'Date to fetch HuggingFace Daily Papers for (format: YYYY-MM-DD). Weekdays typically have 24-49 papers. Weekends/holidays may have none — the agent will stop and ask you to pick a different date if no papers are found.',
      type: 'string',
      required: true,
      placeholder: '2025-01-15',
      validation: {
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        message: 'Enter a date in YYYY-MM-DD format',
      },
      group: 'source',
      order: 1,
    },
  ],

  optionalParameters: [
    // ── Source group ──
    {
      id: 'topN',
      name: 'Number of In-Depth Papers',
      description: 'How many top-ranked papers (by upvotes) to analyze in depth. The digest always covers ALL papers regardless of this setting.',
      type: 'select',
      required: false,
      default: '10',
      options: [
        { label: '5 papers', value: '5', description: 'Quick — top 5 most upvoted' },
        { label: '10 papers', value: '10', description: 'Standard — top 10 most upvoted' },
        { label: '15 papers', value: '15', description: 'Extended — top 15 most upvoted' },
        { label: '20 papers', value: '20', description: 'Comprehensive — top 20 most upvoted' },
        { label: '30 papers', value: '30', description: 'Full — top 30 (may take longer)' },
      ],
      group: 'source',
      order: 2,
    },
    {
      id: 'additionalPapers',
      name: 'Additional Papers',
      description:
        'Papers to always include in the in-depth analysis, regardless of ranking. One per line. Accepts arXiv links (https://arxiv.org/abs/...), HuggingFace paper links, GitHub repo links, or paper titles. These are analyzed even if they are not in the daily paper list — the agent will note their origin.',
      type: 'textarea',
      required: false,
      prominent: true,
      placeholder: 'https://arxiv.org/abs/2501.12345\nAttention Is All You Need\nhttps://github.com/author/cool-model',
      group: 'source',
      order: 3,
    },
    {
      id: 'customRequirements',
      name: 'Custom Requirements',
      description: 'Additional instructions: focus areas, filtering preferences, environment notes, or emphasis on specific research topics.',
      type: 'textarea',
      required: false,
      prominent: true,
      placeholder: 'e.g., Focus on LLM agent papers\nSkip vision-only papers\nOffline — use cached data only',
      group: 'source',
      order: 4,
    },

    // ── Analysis group ──
    {
      id: 'analysisDepth',
      name: 'Analysis Depth',
      description: 'How thorough should each in-depth paper analysis be?',
      type: 'select',
      required: false,
      default: 'comprehensive',
      options: [
        { label: 'Comprehensive', value: 'comprehensive', description: 'Full analysis with background, figures, equations, cross-references (~2000-4000 words per paper)' },
        { label: 'Standard', value: 'standard', description: 'Core analysis with one figure, key results (~1000-2000 words per paper)' },
        { label: 'Brief', value: 'brief', description: 'Extended summary with one figure (~500-1000 words per paper)' },
      ],
      group: 'analysis',
      order: 0,
    },
    {
      id: 'filterKeywords',
      name: 'Keyword Filter',
      description: 'Only include papers matching these keywords in the in-depth analysis. The digest still covers ALL papers. Comma-separated.',
      type: 'string',
      required: false,
      placeholder: 'e.g., LLM, agent, reasoning, multimodal',
      group: 'analysis',
      order: 1,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────

  prompts: {
    planGeneration: `You are a senior research analyst designing a HuggingFace Daily Papers analysis pipeline.

## Specification
- Working Directory: {{workingDirectory}}
- Date: {{date}}
- Top-N Papers for In-Depth Analysis: {{topN}}
- Additional Papers: {{additionalPapers}}
- Custom Requirements: {{customRequirements}}
- Analysis Depth: {{analysisDepth}}
- Keyword Filter: {{filterKeywords}}

## Skill Reference
This project uses the \`daily-paper-analysis\` skill. The skill's SKILL.md contains:
- HuggingFace Daily Papers API usage and date validation
- AlphaXiv endpoint specifications (overview + full text)
- Paper resolution logic for user-specified papers
- Digest structure and grouping rules
- In-depth analysis document structure (9 sections)
- Color palette, typography, box styles, SVG figure guidelines
- Markdown output guidelines (Obsidian-compatible format, YAML frontmatter, callouts)
- Compiled document assembly and PDF rendering

**The SKILL.md is the single source of truth for all rendering and analysis details.**

## Planning Guidelines

Decompose into a DAG of tasks:

### Phase 1: Data Retrieval & Validation
- Fetch HuggingFace Daily Papers API: \`curl -sL "https://huggingface.co/api/daily_papers?date={{date}}"\`
- **CRITICAL — Date Validation**: Check the API response carefully:
  - If the response is an empty array \`[]\`, the date has no papers (weekend, holiday, or future date). Report: "No HuggingFace Daily Papers found for {{date}}. Please choose a different date (weekdays typically have papers)." Then **STOP** — do not create further tasks.
  - If the response is not valid JSON or the request fails, report the error and STOP.
  - If the response has papers, proceed.
- Parse the JSON response, extract paper metadata
- Rank papers by \`paper.upvotes\` descending, select top-{{topN}} for in-depth analysis
- **Resolving additional papers** ({{additionalPapers}}):
  - arXiv links (arxiv.org/abs/ID) → extract the arXiv ID directly
  - HuggingFace links (huggingface.co/papers/ID) → extract the arXiv ID
  - GitHub links → fetch the repo README and search for arXiv links; if none found, search HF daily papers by repo name
  - Paper titles → fuzzy-match against the daily papers list by title; if no match, search arXiv
  - **If a paper cannot be resolved** (dead link, no match found): log a warning in the output noting "Could not resolve: [user input]" and skip it — do not fail the entire pipeline
  - For each resolved paper, check: is its arXiv ID in today's daily papers list?
    - Yes → include it in the in-depth set (it may already be there via top-N ranking — deduplicate)
    - No → still include it, but tag as "User-requested (not in HF Daily Papers for {{date}})"
- If keyword filter is set ({{filterKeywords}}), filter the in-depth selection to only papers whose title, abstract, or ai_keywords match at least one keyword. User-specified additional papers bypass this filter.

### Phase 2: Daily Digest (depends on Phase 1)
- Generate the digest as both HTML (styled) and Markdown (Obsidian-compatible with YAML frontmatter)
- Render the digest HTML to PDF via Chrome headless
- Group by research area (inferred from ai_keywords)
- Include: title, authors, upvotes, keywords, one-paragraph summary, key contribution, links
- Use the color palette and box styles from the skill (HTML) and Obsidian callouts (Markdown)
- All output goes under \`{{workingDirectory}}/\`

### Phase 3: In-Depth Analyses (depends on Phase 1, parallel with Phase 2)
- For each paper in the in-depth set (top-N + additional papers, deduplicated):
  - Fetch AlphaXiv overview: \`curl -sL "https://alphaxiv.org/overview/PAPER_ID.md"\`
  - Fetch AlphaXiv full text: \`curl -sL "https://alphaxiv.org/abs/PAPER_ID.md"\`
  - **AlphaXiv is the primary source** for in-depth analysis (~16K chars per overview vs ~200 chars for HF ai_summary). ~20% of papers lack overviews. If overview returns 404 or empty:
    1. Use the paper abstract from the API (\`paper.summary\`, ~1300 chars) — primary fallback
    2. Still attempt \`/abs/ID.md\` for full text (may be available even without overview)
    3. Use HF \`ai_summary\` as last resort for analysis depth (~200 chars — still useful as TL;DR seed)
    4. Note in the analysis: "AlphaXiv overview unavailable — analysis based on abstract and available sources"
  - Generate in-depth analysis as both HTML and Markdown for each paper
  - Create SVG architecture/workflow figure(s)
  - Fill background context, explain prerequisites
- Split into batches of ~5 papers per task for parallelism
- Analysis depth per skill specification: {{analysisDepth}}

### Phase 4: Compilation & PDF (depends on Phases 2 and 3)
- Assemble compiled HTML: cover page + TOC + digest + all in-depth analyses
- Assemble compiled Markdown: single .md with all content (Obsidian-compatible)
- Render compiled HTML and digest HTML to PDF via Chrome headless or puppeteer-core
- **Dual output**: Every document has both .html and .md versions. PDFs rendered from HTML.
- Verify all links, figures, and formatting in both HTML and Markdown
- **Output directory**: All files must be written under \`{{workingDirectory}}/\` with the folder structure specified in the skill
- **If running in a git worktree**: After all tasks complete, copy the entire output directory to \`{{workingDirectory}}/\` in the main repo. The user's working directory is the final destination.

### Parallelism
- Phase 1 must complete first (and must validate data exists)
- Phase 2 (digest) and Phase 3 (in-depth) can run in parallel
- Phase 3 batches can run in parallel with each other
- Phase 4 depends on all prior phases

### Labels
- l5=Research (paper analysis, content synthesis)
- l1=Frontend (HTML rendering, SVG figures, PDF generation)

### Verification
- "auto" for data retrieval, HTML generation, PDF rendering
- "human" for final quality review of compiled document`,

    sharedContext: `Daily Paper Analysis shared context:

## Data Sources

### HuggingFace Daily Papers API
\`\`\`
GET https://huggingface.co/api/daily_papers?date=YYYY-MM-DD
\`\`\`
Returns JSON array with fields: paper.id, paper.title, paper.summary (~1300 chars abstract), paper.authors[].name, paper.upvotes, paper.ai_summary (~200 chars TL;DR), paper.ai_keywords, publishedAt.
Typical volume: 24-49 papers/weekday. Empty array on weekends/holidays.
Note: paper.ai_summary is ~200 chars (1-2 sentences) — too shallow to drive in-depth analysis alone, but valuable as a TL;DR seed for both the digest summary and the in-depth analysis TL;DR box.

### AlphaXiv Endpoints (follow redirects with -L) — PRIMARY source for in-depth analysis
- Overview (AI report, ~16K chars): \`https://alphaxiv.org/overview/ARXIV_ID.md\`
- Full text (LaTeX→MD): \`https://alphaxiv.org/abs/ARXIV_ID.md\`
Coverage: ~80% of HF daily papers have overviews. Fallback chain: abstract → /abs/ full text → ai_summary (last resort).

## Color Palette
- Background: #FAF8F5 (warm off-white)
- Text: #3A3A3A (soft black)
- Emphasis/Sand: #C4A882 (warm sand — TL;DR, key takeaways)
- Blue: #8FA8B8 (dusty blue — background, technical)
- Green: #A8B8A0 (sage — results, methods)
- Teal: #7FA8A0 (muted teal — callouts)
- Gold: #C8B878 (antique gold — badges, rankings)
- Lavender: #9B8FBF (soft purple — cross-references)
- Red: #A86464 (muted red — limitations)

## Typography
- Font: 'Palatino Linotype', 'Book Antiqua', Palatino, serif
- Code: 'Fira Code', 'Source Code Pro', monospace
- Body: 17px, line-height 1.7
- H1: 32px bold, H2: 24px semibold, H3: 20px semibold

## Box Styles (border-left colored boxes)
- box-pink (#C4A882): TL;DR, key takeaways, limitations
- box-blue (#8FA8B8): Background, prerequisites, technical details
- box-green (#A8B8A0): Results, methods, positive findings
- box-gold (#C8B878): Badges, rankings, metadata
- box-lavender (#9B8FBF): Cross-paper connections, special notes
- box-red (#A86464): Critical limitations, warnings

## Deliverables
Every document is produced as **both HTML and Markdown**. PDFs are rendered from the HTML versions.
1. **Daily Digest**: HTML + MD + PDF — ALL papers grouped by area, ranked by upvotes
2. **In-Depth Analyses**: HTML + MD per paper — 9-section structure with SVG figures
3. **Compiled Document**: HTML + MD + PDF — cover, TOC, digest, all analyses

## Output Folder Structure
All output goes under \`{{workingDirectory}}/\`:
\`\`\`
{{workingDirectory}}/
  daily-digest-YYYY-MM-DD.html          # All-papers digest (styled)
  daily-digest-YYYY-MM-DD.md            # Digest in Markdown (Obsidian-ready)
  daily-digest-YYYY-MM-DD.pdf           # Digest PDF
  papers/                                # Individual in-depth analyses
    01-paper-title-slug.html
    01-paper-title-slug.md              # Markdown version (Obsidian)
    ...
    extra-01-title.html                  # User-specified extras
    extra-01-title.md
  figures/                               # SVG architecture diagrams
    01-architecture.svg
    ...
  daily-papers-YYYY-MM-DD.html           # Compiled (cover+TOC+digest+analyses)
  daily-papers-YYYY-MM-DD.md             # Compiled Markdown (Obsidian)
  daily-papers-YYYY-MM-DD.pdf            # Final compiled PDF
  data/
    daily-papers.json                    # Raw API response
    paper-metadata.md                    # Rankings & resolution notes
\`\`\`
If running in a git worktree, copy the full output to the user's working directory when done.

## User-Specified Papers
Additional papers may or may not be in the daily papers list.
- If in daily papers: analyze normally, note rank, deduplicate with top-N
- If NOT in daily papers: mark with badge "User-requested (not in HF Daily Papers for {{date}})"
- If cannot be resolved (bad link, no match): log warning, skip — don't fail the pipeline
- Always analyze resolved papers regardless of origin

## Corner Cases
1. **No papers for date**: API returns \`[]\` → report to user, STOP immediately
2. **API error / network failure**: Report error, STOP
3. **AlphaXiv unavailable for a paper**: Fall back to abstract (primary) → /abs/ full text → ai_summary (last resort), note in output
4. **User paper not resolvable**: Log "Could not resolve: [input]", skip, continue with others
5. **User paper already in top-N**: Deduplicate — don't analyze twice
6. **Fewer papers than topN**: If daily list has fewer papers than requested top-N, analyze all available
7. **All user papers unresolvable**: Still produce the digest and top-N analyses normally`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'free',
    description:
      'Dual HTML+Markdown output with PDFs. Markdown files are Obsidian-compatible with YAML frontmatter. PDFs rendered from styled HTML.',
    example: `{{workingDirectory}}/
  daily-digest-YYYY-MM-DD.html                # Digest (styled HTML)
  daily-digest-YYYY-MM-DD.md                  # Digest (Obsidian-ready Markdown)
  daily-digest-YYYY-MM-DD.pdf                 # Digest PDF
  papers/
    01-paper-title-slug.html                  # In-depth analysis (styled HTML)
    01-paper-title-slug.md                    # In-depth analysis (Markdown)
    02-paper-title-slug.html
    02-paper-title-slug.md
    ...
    extra-01-user-requested-title.html        # User-specified paper
    extra-01-user-requested-title.md
  figures/
    01-architecture.svg                       # SVG figures for each in-depth paper
    02-workflow.svg
    ...
  daily-papers-YYYY-MM-DD.html                # Compiled document (HTML)
  daily-papers-YYYY-MM-DD.md                  # Compiled document (Markdown)
  daily-papers-YYYY-MM-DD.pdf                 # Final compiled PDF
  data/
    daily-papers.json                         # Raw HF API response
    paper-metadata.md                         # Parsed metadata, rankings, resolution notes`,
  },

  // ── Parallelization ───────────────────────────────────────────────────
  parallelization: {
    maxConcurrentTasks: 6,
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
    skills: ['daily-paper-analysis'],
    skipSafetyCheck: false,
    defaultVerification: 'mixed',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 4, max: 14 },
    defaultEstimate: 'M',
    suggestedMilestones: [
      {
        title: 'Data Retrieved & Validated',
        description: 'HF Daily Papers API fetched, date validated (non-empty), papers ranked by upvotes, additional papers resolved',
      },
      {
        title: 'Daily Digest Complete',
        description: 'Single HTML document summarizing all papers, grouped by research area',
      },
      {
        title: 'In-Depth Analyses Complete',
        description: 'Individual HTML analyses for top-N papers with SVG figures, background, and equations',
      },
      {
        title: 'Document Compiled & PDF Rendered',
        description: 'All analyses assembled into compiled HTML with TOC, rendered to PDF',
      },
    ],
    commonLabels: ['l5', 'l1'],
    preferParallelTasks: true,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['scientific-computing'],
  recommendedSkills: ['daily-paper-analysis'],
  source: 'builtin',
  enabled: true,
}
