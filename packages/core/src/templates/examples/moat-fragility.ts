/**
 * Example: Moat & Fragility Competitive Advantage Analysis
 *
 * Evaluates a company's competitive advantage through:
 * 1. Quantitative CA Scoring (4 pillars, 1-5 scale)
 * 2. Qualitative Moat Analysis (7 Powers framework)
 * 3. Anti-Fragility Resilience Test (Taleb-inspired)
 *
 * Produces a structured PDF report (Markdown/HTML → PDF).
 * User provides a ticker symbol; the system retrieves financials,
 * analyzes competitive position, and generates the report.
 */

import type { UseCaseTemplate } from '../../types/use-case-template.js'

export const moatFragilityTemplate: UseCaseTemplate = {
  // ── Identity ──────────────────────────────────────────────────────────
  id: 'astro--moat-fragility',
  name: 'Moat & Fragility Analysis',
  description:
    'Assess any public company\'s competitive moat and resilience. Provide a ticker symbol (e.g., AAPL) and optionally add competitor tickers or supplementary filings. Get a PDF report with quantitative scoring (market position, pricing power, ROIC), qualitative moat analysis (7 Powers framework), and an anti-fragility stress test — with charts, comparisons, and actionable insights.',
  category: 'finance',
  version: '1.0.0',
  icon: '📑',
  tags: ['finance', 'investing', 'moat', 'competitive-advantage', 'equity', 'analysis', 'antifragile'],
  maturity: 'stable',

  // ── Parameters ────────────────────────────────────────────────────────

  requiredParameters: [
    {
      id: 'tickerSymbol',
      name: 'Ticker Symbol',
      description:
        'The stock ticker symbol of the company to analyze (e.g., AAPL, MSFT, GOOG). Used to retrieve financial data.',
      type: 'string',
      required: true,
      placeholder: 'AAPL',
      validation: {
        min: 1,
        max: 10,
        pattern: '^[A-Z0-9.\\-]+$',
        message: 'Enter a valid uppercase ticker symbol (e.g., AAPL, BRK.B)',
      },
      group: 'source',
      order: 0,
    },
  ],

  optionalParameters: [
    // ── Source group ──
    {
      id: 'supplementaryDocs',
      name: 'Supplementary Documents',
      description:
        'Optional path to a directory containing supplementary documents (10-K filings, earnings transcripts, research reports) in PDF, Markdown, or HTML format. These are used to enrich the qualitative analysis.',
      type: 'string',
      required: false,
      placeholder: '/path/to/filings/',
      group: 'source',
      order: 1,
    },
    {
      id: 'comparisonTickers',
      name: 'Comparison Tickers',
      description: 'Comma-separated competitor ticker symbols for relative analysis.',
      type: 'string',
      required: false,
      placeholder: 'MSFT, GOOG, META',
      group: 'source',
      order: 2,
    },

    // ── Analysis group ──
    {
      id: 'analysisDepth',
      name: 'Analysis Depth',
      description: 'How thorough should the analysis be?',
      type: 'select',
      required: false,
      default: 'comprehensive',
      options: [
        { label: 'Comprehensive', value: 'comprehensive', description: 'Full three-phase analysis with competitor comparison (~20-30 pages)' },
        { label: 'Standard', value: 'standard', description: 'Complete analysis without competitor deep-dive (~12-18 pages)' },
        { label: 'Quick Screen', value: 'quick', description: 'High-level scoring and key moat identification (~5-8 pages)' },
      ],
      group: 'analysis',
      order: 0,
    },
    {
      id: 'timeHorizon',
      name: 'Analysis Time Horizon',
      description: 'Historical data lookback and forward projection period.',
      type: 'string',
      required: false,
      default: '5 years',
      placeholder: 'e.g. 5 years, 1 year, 2 quarters',
      group: 'analysis',
      order: 1,
    },
    {
      id: 'sectorFocus',
      name: 'Sector Context',
      description: 'Sector-specific analysis lens to apply.',
      type: 'select',
      required: false,
      default: 'auto',
      options: [
        { label: 'Auto-detect', value: 'auto', description: 'Automatically determine sector from ticker' },
        { label: 'Technology', value: 'tech', description: 'SaaS metrics, R&D intensity, platform dynamics' },
        { label: 'Consumer', value: 'consumer', description: 'Brand strength, retail metrics, market share' },
        { label: 'Healthcare', value: 'healthcare', description: 'Pipeline analysis, regulatory moat, patent protection' },
        { label: 'Financial Services', value: 'financial', description: 'NIM, AUM, regulatory capital, network effects' },
      ],
      group: 'analysis',
      order: 2,
    },

    // ── Output group ──
    {
      id: 'reportStyle',
      name: 'Report Style',
      description: 'Visual style of the output report.',
      type: 'select',
      required: false,
      default: 'professional',
      options: [
        { label: 'Professional', value: 'professional', description: 'Clean, institutional equity research style' },
        { label: 'Executive Brief', value: 'executive', description: 'Concise, decision-focused format' },
      ],
      group: 'output',
      order: 0,
    },
  ],

  // ── Prompts ───────────────────────────────────────────────────────────

  prompts: {
    planGeneration: `You are a Senior Equity Analyst designing a comprehensive competitive advantage analysis pipeline.

## Company Specification
- Ticker Symbol: {{tickerSymbol}}
- Comparison Tickers: {{comparisonTickers}}
- Supplementary Documents: {{supplementaryDocs}}
- Analysis Depth: {{analysisDepth}}
- Time Horizon: {{timeHorizon}}
- Sector Context: {{sectorFocus}}
- Report Style: {{reportStyle}}

## Skill Reference
This project uses the \`moat-fragility\` skill. The skill's SKILL.md contains:
- The complete CA Scoring methodology (4 pillars, 1-5 scale, 25% each)
- The 7 Powers qualitative moat framework
- The Anti-Fragility resilience test (Taleb-inspired)
- Financial data retrieval guidelines
- Report template with chart specifications
- Scoring tables and interpretation guides

**The SKILL.md is the single source of truth for scoring logic and report structure.**

## Planning Guidelines

Decompose this analysis into a DAG of tasks following the 3-phase framework:

### Phase 1: Data Retrieval & Quantitative Scoring (CA Score)
- Retrieve financial data for {{tickerSymbol}} (and comparison tickers if provided) from:
  - **SEC EDGAR**: 10-K filings for revenue, margins, ROIC, balance sheet data
  - **Earnings reports/transcripts**: Recent quarterly earnings for forward guidance and segment detail
  - **Yahoo Finance API**: Historical prices, key statistics (\`curl\` commands)
  - **Company investor relations**: Annual reports, earnings presentations
  - **Industry reports**: Market sizing data from Gartner, IDC, Statista
- Data to collect:
  - Revenue (last N years based on time horizon)
  - Market share / addressable market estimates
  - ARPU and pricing trends (CAGR)
  - ROIC vs. WACC (historical and projected)
  - Balance sheet: debt/equity, cash, FCF
  - Insider ownership from DEF 14A proxy
- If supplementary documents provided, parse them using appropriate tools:
  - PDF files → use the PDF skill (Read tool on .pdf files)
  - Other formats → read directly
- Score each of the 4 CA pillars (1-5):
  1. Market Position
  2. Position Trend
  3. Pricing Power (ARPU/CAGR)
  4. Future ROIC
- Calculate weighted CA Score (average of 4 pillars)

### Phase 2: Qualitative Moat Analysis (7 Powers)
- Analyze each of the 7 Powers:
  1. Scale Economies — does unit cost decline with volume?
  2. Network Effects — does value increase with users?
  3. Counter-Positioning — is the incumbent unable to copy?
  4. Switching Costs — how costly is it to switch?
  5. Branding — does the brand command premium pricing?
  6. Cornered Resource — any exclusive access to key assets?
  7. Process Power — any proprietary operational excellence?
- For each Power: provide 2-3 specific examples from 10-K, earnings calls, or public data
- Rate moat strength: None / Narrow / Wide / Very Wide
- Identify the primary moat source (top 1-2 powers)

### Phase 3: Anti-Fragility Resilience Test
- Skin in the Game: founder/insider ownership %, recent transactions
- Financial Health: debt-to-equity, current ratio, cash reserves, free cash flow
- Optionality: pivot potential, adjacent market opportunities, R&D optionality
- Black Swan exposure: regulatory risk, key-person risk, concentration risk
- Rate anti-fragility: Fragile / Robust / Anti-Fragile

### Phase 4: Report Generation
- Compile all analysis into structured report
- Generate charts:
  - Revenue & market share trend (line chart)
  - ROIC vs. WACC (bar chart)
  - CA Score radar chart (4 pillars)
  - Moat strength heatmap
- Write Executive Summary with overall assessment
- Generate final PDF (Markdown/HTML → PDF via Playwright)

### Parallelism
- Phase 1 data retrieval must complete first
- Phase 1 scoring, Phase 2, and Phase 3 can partially overlap
- Phase 4 depends on all prior phases

### Labels
- l5=Research (financial analysis, moat assessment)
- l1=Frontend (report generation, charts)

### Verification
- "auto" for data retrieval and report generation
- "human" for final analysis quality review`,

    taskExecution: `You are conducting a Moat & Fragility competitive advantage analysis.

## CRITICAL: Output Directory
Save ALL output files (reports, data files, charts, PDFs) under the \`outputs/\` directory in the working directory. Never write results to the repository root or git worktree root. Intermediate data, charts, and final reports must all go under \`outputs/\`.

## Context
- Ticker Symbol: {{tickerSymbol}}
- Comparison Tickers: {{comparisonTickers}}
- Analysis Depth: {{analysisDepth}}
- Time Horizon: {{timeHorizon}}
- Sector Context: {{sectorFocus}}

## CRITICAL: Document Reading Tools

### PDF Files (.pdf)
PDFs require special handling — do NOT try to \`cat\` or \`Read\` a PDF as plain text.

**Method 1 (preferred)**: Use \`pdftotext\` (poppler-utils):
\`\`\`bash
pdftotext "path/to/file.pdf" - | head -500  # Extract text to stdout
pdftotext -layout "path/to/file.pdf" -       # Preserve table layout
\`\`\`

**Method 2**: Use Python with \`pdfplumber\` (better for tables):
\`\`\`bash
pip install pdfplumber -q && python3 -c "
import pdfplumber
with pdfplumber.open('path/to/file.pdf') as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        if text: print(text)
        for table in page.extract_tables():
            for row in table: print('\\t'.join(str(c or '') for c in row))
"
\`\`\`

**Method 3**: Use the Read tool directly on .pdf files (works for simple PDFs).

### Word Documents (.docx)
\`\`\`bash
pip install python-docx -q && python3 -c "
from docx import Document
doc = Document('path/to/file.docx')
for p in doc.paragraphs: print(p.text)
for table in doc.tables:
    for row in table.rows: print('\\t'.join(c.text for c in row.cells))
"
\`\`\`

### Excel Files (.xlsx)
\`\`\`bash
pip install openpyxl -q && python3 -c "
import openpyxl
wb = openpyxl.load_workbook('path/to/file.xlsx')
for sheet in wb.sheetnames:
    ws = wb[sheet]
    print(f'--- Sheet: {sheet} ---')
    for row in ws.iter_rows(values_only=True): print('\\t'.join(str(c or '') for c in row))
"
\`\`\`

### Other formats (HTML, Markdown, text)
Read directly with the Read tool.

### Supplementary Documents
If a supplementary documents directory is provided at \`{{supplementaryDocs}}\`:
1. First list contents: \`ls -la "{{supplementaryDocs}}"\`
2. Then process each file using the appropriate method above
3. Extract key financial data points and save to \`data/\` as structured Markdown

## Skill Reference
Consult the \`moat-fragility\` skill's SKILL.md for:
- CA Scoring rubric (4 pillars × 1-5 scale)
- 7 Powers framework definitions and examples
- Anti-Fragility assessment criteria
- Financial ratio benchmarks
- Report template and chart specifications

## Data Retrieval Guidelines

### Primary Sources (use in this order)
1. **SEC EDGAR** — 10-K annual filings, 10-Q quarterly filings, DEF 14A proxy statements, Form 4 insider transactions
   - Use \`curl\` to fetch filings: \`curl "https://efts.sec.gov/LATEST/search-index?q=%22{{tickerSymbol}}%22&dateRange=custom&startdt=2023-01-01&enddt=2025-12-31&forms=10-K"\`
   - Or navigate the full-text search: \`https://efts.sec.gov/LATEST/search-index?q=<company>&forms=10-K\`
2. **Earnings Reports & Transcripts** — Quarterly earnings calls contain forward guidance, segment breakdowns, and management commentary. Extract revenue, margins, and guidance from the most recent 4 quarters.
3. **Yahoo Finance** — Historical prices, key statistics, financial statements
   - \`curl -s "https://query1.finance.yahoo.com/v8/finance/chart/{{tickerSymbol}}?range=5y&interval=1mo"\` for price history
   - Key stats page for PE, market cap, revenue, margins
4. **Company Investor Relations pages** — Annual reports, earnings presentations, supplemental data packs
5. **Industry Reports** — Gartner, IDC, Statista for market sizing and competitive landscape

### What to Extract
- **Revenue**: Last 5 years annual + last 4 quarters
- **Market share**: From earnings calls, industry reports, or calculated from revenue vs TAM
- **ARPU / Pricing**: Revenue per user/unit, pricing page history, gross margin trend
- **ROIC**: Calculate from NOPAT / Invested Capital using 10-K data
- **Balance sheet**: Debt/equity, current ratio, cash position, FCF
- **Insider ownership**: From DEF 14A proxy filings
- **Competitor data**: Same metrics for comparison tickers

### Important
- For financial ratios, use the most recent annual report data
- When exact data is unavailable, use reasonable estimates and clearly label them as estimates
- Always cite data sources with dates (e.g., "MSFT 10-K FY2025, p.42")
- Cross-reference at least 2 sources for key metrics

## Analysis Principles
- Be evidence-based: every score must be justified with specific data points
- Distinguish between current state and trajectory
- Consider both bull and bear cases
- Flag high-uncertainty assumptions explicitly
- Compare to sector medians when possible`,

    sharedContext: `Moat & Fragility Analysis shared context:

## CA Scoring Framework (Phase 1)

### 4 Pillars (25% weight each)

**1. Market Position** (Current standing)
| Score | Criteria |
|-------|----------|
| 5 | Dominant: >40% market share or clear #1 in category |
| 4 | Strong: 20-40% share, top 3 position |
| 3 | Moderate: 10-20% share, notable player |
| 2 | Weak: 5-10% share, struggling for relevance |
| 1 | Marginal: <5% share, at risk of irrelevance |

**2. Position Trend** (Direction of momentum)
| Score | Criteria |
|-------|----------|
| 5 | Accelerating gains: share growing >5% YoY |
| 4 | Steady gains: share growing 2-5% YoY |
| 3 | Stable: share ±2% YoY |
| 2 | Declining: share shrinking 2-5% YoY |
| 1 | Rapid decline: share shrinking >5% YoY |

**3. Pricing Power** (ARPU trend / ability to raise prices)
| Score | Criteria |
|-------|----------|
| 5 | Strong pricing power: ARPU CAGR >8%, can raise prices freely |
| 4 | Good pricing power: ARPU CAGR 4-8% |
| 3 | Neutral: ARPU roughly flat (0-4% CAGR) |
| 2 | Weak: ARPU declining, competing on price |
| 1 | No pricing power: race to bottom, commoditized |

**4. Future ROIC** (Return on Invested Capital outlook)
| Score | Criteria |
|-------|----------|
| 5 | Exceptional: ROIC >25% and expanding, far exceeds WACC |
| 4 | Strong: ROIC 15-25%, comfortably above WACC |
| 3 | Adequate: ROIC 8-15%, near or slightly above WACC |
| 2 | Concerning: ROIC 3-8%, at or below WACC |
| 1 | Destroying value: ROIC <3%, well below WACC |

**CA Score** = Average of 4 pillar scores (1.0 – 5.0)
- 4.0-5.0: Exceptional competitive advantage
- 3.0-3.9: Solid competitive position
- 2.0-2.9: Challenged position, needs improvement
- 1.0-1.9: Weak position, at risk

## 7 Powers Moat Framework (Phase 2)

Based on Hamilton Helmer's "7 Powers":

1. **Scale Economies**: Unit costs decline as volume increases. Barrier: smaller competitors can't match cost structure.
2. **Network Effects**: Product value increases with number of users. Barrier: late entrants face empty-network problem.
3. **Counter-Positioning**: Incumbent cannot respond without damaging existing business. Barrier: cannibalization dilemma.
4. **Switching Costs**: Customer faces material costs to change providers. Barrier: lock-in through integration, data, or workflow.
5. **Branding**: Business enjoys higher willingness-to-pay due to reputation. Barrier: decades of trust, emotional connection.
6. **Cornered Resource**: Exclusive access to a valuable resource (talent, patent, license, data). Barrier: not available to competitors.
7. **Process Power**: Proprietary operational excellence built over time. Barrier: not easily replicated or understood.

### Moat Width Rating
- **None**: No identifiable sustainable advantage
- **Narrow**: 1 Power present, moderate strength
- **Wide**: 2-3 Powers present, strong evidence
- **Very Wide**: 3+ Powers present, dominant position with multiple reinforcing advantages

## Anti-Fragility Test (Phase 3)

Based on Nassim Taleb's "Antifragile" framework:

**1. Skin in the Game**
- Insider ownership >10%: Strong alignment
- Insider ownership 3-10%: Moderate alignment
- Insider ownership <3%: Weak alignment
- Recent insider buying: Positive signal
- Recent insider selling (non-scheduled): Negative signal

**2. Financial Health**
- Debt/Equity < 0.3: Fortress balance sheet
- Debt/Equity 0.3-1.0: Healthy
- Debt/Equity 1.0-2.0: Moderate leverage
- Debt/Equity > 2.0: High leverage risk
- Cash reserves: months of operating expenses covered
- Free Cash Flow margin and consistency

**3. Optionality**
- Adjacent market opportunities (TAM expansion)
- R&D as % of revenue (investment in future options)
- Platform extensibility (can new products be built on existing infrastructure?)
- Geographic expansion potential

**4. Black Swan Exposure**
- Regulatory risk (single jurisdiction, pending legislation)
- Key-person dependency (founder-driven?)
- Revenue concentration (top customer % of revenue)
- Technology disruption risk
- Geopolitical exposure

### Anti-Fragility Rating
- **Fragile**: High leverage, concentrated risk, no optionality, weak insider alignment
- **Robust**: Healthy balance sheet, diversified, adequate alignment
- **Anti-Fragile**: Low leverage, high optionality, strong insider alignment, benefits from volatility

## Report Structure

### Section 1: Executive Summary
- Company name, ticker, sector, market cap
- CA Score (X.X / 5.0) with traffic-light indicator
- Moat Width (None / Narrow / Wide / Very Wide)
- Anti-Fragility Rating (Fragile / Robust / Anti-Fragile)
- 3-sentence verdict

### Section 2: Quantitative Analysis (CA Score)
- Company Overview table (Revenue, Market Share, ARPU, ROIC — N years)
- Pillar-by-pillar scoring with justification
- Revenue & market share trend chart
- ROIC vs. WACC chart

### Section 3: Qualitative Moat Analysis
- Power-by-power assessment with examples
- Moat strength heatmap
- Primary moat source identification
- Competitive positioning map

### Section 4: Anti-Fragility Assessment
- Skin in the Game analysis
- Balance sheet health metrics
- Optionality inventory
- Risk factor catalog
- Overall resilience rating

### Section 5: Comparative Analysis (if comparison tickers provided)
- Side-by-side CA Score comparison
- Relative moat strength
- Relative valuation context

### Section 6: Conclusion & Recommendation
- Overall assessment
- Key risks to monitor
- Catalysts to watch
- Suggested follow-up research`,
  },

  // ── Output ────────────────────────────────────────────────────────────
  outputFormat: {
    type: 'free',
    description:
      'Structured competitive advantage report in PDF format. Includes quantitative scoring tables, moat analysis, anti-fragility assessment, and charts.',
    example: `outputs/
  report/
    moat-analysis-AAPL.md     # Markdown report source
    moat-analysis-AAPL.html   # HTML with embedded charts
    moat-analysis-AAPL.pdf    # Final PDF via Playwright
  data/
    financials.md             # Retrieved financial data
    comparison.md             # Competitor comparison data
  charts/
    revenue-trend.svg         # Revenue & market share chart
    roic-wacc.svg             # ROIC vs WACC chart
    ca-radar.svg              # CA Score radar chart
    moat-heatmap.svg          # 7 Powers heatmap`,
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
    skills: ['moat-fragility'],
    deliveryMode: 'branch',
    skipSafetyCheck: false,
    defaultVerification: 'mixed',
  },

  // ── Plan Hints ────────────────────────────────────────────────────────
  planHints: {
    targetNodeCount: { min: 6, max: 18 },
    defaultEstimate: 'M',
    suggestedMilestones: [
      {
        title: 'Financial Data Retrieved',
        description: 'Revenue, market share, ARPU, and ROIC data collected for all tickers',
      },
      {
        title: 'CA Score Calculated',
        description: 'All 4 pillars scored (1-5), weighted CA Score computed',
      },
      {
        title: 'Moat Analyzed',
        description: '7 Powers assessment complete, moat width rated',
      },
      {
        title: 'Anti-Fragility Assessed',
        description: 'Skin in the Game, financial health, optionality, and risk factors evaluated',
      },
      {
        title: 'Report Generated',
        description: 'Final PDF report with charts, scoring tables, and recommendations',
      },
    ],
    commonLabels: ['l5'],
    preferParallelTasks: true,
  },

  // ── Relationships ─────────────────────────────────────────────────────
  domains: ['data-engineering'],
  recommendedSkills: ['moat-fragility'],
  source: 'builtin',
  enabled: true,
}
