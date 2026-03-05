# Moat & Fragility Analysis

> Workflow guide for the Moat & Fragility Competitive Advantage Analysis example.

## What It Does

Evaluates a company's competitive advantage through three phases:
1. **Quantitative CA Scoring** -- Market position, trend momentum, pricing power, ROIC (1-5 scale)
2. **Qualitative Moat Analysis** -- Hamilton Helmer's 7 Powers framework (scale economies, network effects, counter-positioning, switching costs, branding, cornered resource, process power)
3. **Anti-Fragility Resilience Test** -- Taleb-inspired stress testing across market, technology, regulatory, and macro shocks

Produces a structured PDF report with charts, scoring tables, and actionable insights.

## Quick Start

1. Go to **Examples** > **Moat & Fragility Analysis**
2. Enter a ticker symbol (e.g., AAPL)
3. Optionally add competitor tickers and supplementary documents
4. Click **Start Planning** -- Astro generates an analysis task graph
5. Review the plan, then execute

## Parameters

### Required

| Parameter | What to Enter | Examples |
|-----------|---------------|---------|
| **Ticker Symbol** | Uppercase stock ticker | `AAPL`, `MSFT`, `BRK.B`, `GOOG` |

### Optional (Advanced Options)

**Source:**
| Parameter | Purpose | Examples |
|-----------|---------|---------|
| Supplementary Documents | Path to 10-K filings, earnings transcripts, research reports (PDF/MD/HTML) | `/home/user/filings/` |
| Comparison Tickers | Comma-separated competitor tickers for relative analysis | `MSFT, GOOG, META` |

**Analysis:**
| Parameter | Purpose | Default |
|-----------|---------|---------|
| Analysis Depth | Full (all 3 phases), Standard (quantitative + qualitative), Quick (quantitative only) | Full |
| Time Horizon | Investment horizon: Short (1yr), Medium (3-5yr), Long (10yr+) | Medium |

**Output:**
| Parameter | Purpose | Default |
|-----------|---------|---------|
| Report Format | Markdown-to-PDF or LaTeX-to-PDF | Markdown-to-PDF |
| Include Charts | Generate SVG charts for financial metrics and scoring | Yes |

## Data Flow

```
User enters ticker symbol (+ optional competitors)
         |
         v
   ┌──────────────────┐
   │ Data Collection   │ -- Fetch financials (revenue, margins, ROIC)
   │                   │ -- Read supplementary docs (if provided)
   │                   │ -- Gather competitor data (if tickers given)
   └────────┬─────────┘
            |
       ┌────┴────┬───────────────┐
       v         v               v
  ┌────────┐ ┌──────────┐ ┌──────────────┐
  │Quant   │ │Qualitative│ │Anti-Fragility│  (parallel phases)
  │CA Score│ │Moat (7    │ │Resilience    │
  │(4 dims)│ │Powers)    │ │Test          │
  └───┬────┘ └────┬──────┘ └──────┬───────┘
      |           |               |
      v           v               v
   ┌──────────────────────────────────┐
   │ Report Assembly                  │ -- Compile all findings
   │                                  │ -- Generate charts (SVG)
   │                                  │ -- Render Markdown/LaTeX to PDF
   └──────────────────────────────────┘
```

## Three-Phase Framework

### Phase 1: Quantitative CA Scoring

| Dimension | What It Measures | Scale |
|-----------|-----------------|-------|
| Market Position | Market share, dominance, entry barriers | 1-5 |
| Trend Momentum | Revenue growth, margin trajectory, market expansion | 1-5 |
| Pricing Power | Gross margins, ability to raise prices without losing share | 1-5 |
| ROIC | Return on invested capital vs. cost of capital | 1-5 |

### Phase 2: Qualitative Moat Analysis (7 Powers)

Each of Hamilton Helmer's 7 Powers is assessed for presence, strength, and durability:
- Scale Economies, Network Effects, Counter-Positioning, Switching Costs, Branding, Cornered Resource, Process Power

### Phase 3: Anti-Fragility Resilience Test

Stress tests the company against hypothetical shocks:
- **Market shock** -- 50% revenue drop, major competitor entry
- **Technology shock** -- Disruptive new technology, platform shift
- **Regulatory shock** -- Antitrust, new compliance requirements
- **Macro shock** -- Recession, interest rate spike, currency crisis

## Output Structure

```
output/
  report.md                 # Full Markdown report
  report.pdf                # Rendered PDF
  charts/
    ca-scoring-radar.svg    # Quantitative scoring radar chart
    moat-heatmap.svg        # 7 Powers strength heatmap
    competitor-compare.svg  # Relative positioning chart
  data/
    financials.md           # Raw financial data notes
    moat-assessment.md      # Qualitative analysis notes
    resilience-test.md      # Stress test results
```

## SKILL.md

The `moat-fragility` skill (`skills/moat-fragility/SKILL.md`) contains:
- Scoring rubric for each quantitative dimension
- 7 Powers framework assessment methodology
- Anti-fragility stress test scenarios
- Report structure and formatting guidelines
- Chart generation instructions

When you launch this example, the SKILL.md is loaded as the project's **skill.md**. You can revise scoring criteria or add industry-specific stress scenarios.

## Execution Config

| Setting | Value |
|---------|-------|
| Model | Claude Sonnet 4 |
| Max turns per task | 50 |
| Max cost per task | $5.00 |
| Delivery mode | Branch |
| Verification | Mixed |

## Tips

- **Start with just a ticker** -- the system fetches public financial data automatically
- **Add supplementary docs** (10-K filings, earnings calls) for much richer qualitative analysis
- **Comparison tickers** make the report significantly more useful -- always add 2-3 competitors
- **Adjust time horizon** to match your investment thesis (short-term trading vs. long-term hold)
- The anti-fragility test is most interesting for seemingly "safe" companies -- it reveals hidden vulnerabilities
