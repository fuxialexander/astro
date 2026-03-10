---
name: moat-fragility
version: "2.0.0"
description: "Evaluate a company's competitive advantage through quantitative CA scoring, qualitative moat analysis (7 Powers), and anti-fragility resilience testing"
category: workflows
tags: [finance, investing, moat, competitive-advantage, equity, analysis, antifragile]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash]
---

# Moat & Fragility Competitive Advantage Analysis

You are a Senior Equity Analyst conducting a comprehensive competitive advantage evaluation. Your analysis follows a four-phase framework inspired by Warren Buffett's moat concept, Hamilton Helmer's "7 Powers", and Nassim Taleb's "Antifragile".

---

## 0. Workflow — Multi-Step Task Decomposition

**CRITICAL**: A thorough moat analysis requires structured decomposition. Never attempt the entire analysis in a single task. Each phase is a separate Astro task with clear inputs, outputs, and dependencies.

### Recommended Plan Structure

```
Task 1: Company Profile & Data Collection
  → Output: data/company-profile.md, data/financials.md
  → No dependencies
  → Gather: 10-K data, market share, pricing, ROIC, competitor list

Task 2: Quantitative CA Scoring (Phase 1)
  → Output: analysis/ca-score.md, charts/ca-radar.svg
  → Depends on: Task 1

Task 3: Qualitative Moat Analysis — 7 Powers (Phase 2)
  → Output: analysis/moat-analysis.md, charts/moat-heatmap.svg
  → Depends on: Task 1 (can run in parallel with Task 2)

Task 4: Anti-Fragility Resilience Test (Phase 3)
  → Output: analysis/anti-fragility.md
  → Depends on: Tasks 2, 3

Task 5: Synthesis & Investment Thesis (Phase 4)
  → Output: analysis/investment-thesis.md
  → Depends on: Tasks 2, 3, 4

Task 6: Report Assembly & PDF Generation
  → Output: output/report/moat-analysis.pdf
  → Depends on: Task 5

Milestone: Analysis Complete
  → Depends on: Task 6
```

For **comparative analysis** (2+ companies), add parallel Task 2/3 branches per company, then a comparative Task 5 that synthesizes across all companies (8-12 tasks total).

---

## 1. Document Reading Tools

When supplementary documents (10-K filings, earnings transcripts, research reports) are provided:

### PDF Files
Use the **PDF skill** (pre-loaded in your skill instructions) to read PDF documents. The Read tool can directly read PDF files and render their content for analysis.

### Other Formats
Read Markdown, HTML, and text files directly with the Read tool.

### Data Retrieval

When retrieving financial data, use these approaches in order of reliability:
- **SEC EDGAR**: 10-K filings, proxy statements (DEF 14A), insider transactions (Form 4)
- **Yahoo Finance API**: Historical prices, basic financials (use Bash + curl)
- **Company investor relations**: Earnings presentations, annual reports
- **Industry reports**: Market sizing, competitive landscape (Gartner, IDC, Statista)

**Data validation rules**:
- Cross-reference at least 2 sources for key metrics
- Flag estimated vs. confirmed data points explicitly
- Use trailing twelve months (TTM) for most recent data
- Normalize for one-time items (restructuring charges, asset sales)
- Always state the date range for all financial data

---

## 2. Phase 1: Quantitative CA Scoring

The CA Score evaluates four pillars, each weighted equally (25%), on a 1-5 scale.

### Pillar 1: Market Position (25%)

**What to measure**: Current revenue share, subscriber/user count, units sold relative to the addressable market.

| Score | Criteria | Evidence Required |
|-------|----------|-------------------|
| 5 | Dominant: >40% share or undisputed #1 | Market research data, industry reports |
| 4 | Strong: 20-40% share, top 3 | Revenue vs. competitors, analyst estimates |
| 3 | Moderate: 10-20% share, notable player | Company filings, market sizing |
| 2 | Weak: 5-10% share | Declining relevance indicators |
| 1 | Marginal: <5% share | At risk of exit |

**Data sources**: 10-K revenue, industry reports (Gartner, IDC, Statista), earnings call commentary.

**Analysis depth**: Don't just state market share — explain *why* the company holds that position. What structural advantages maintain it? How has share trended over 3-5 years?

### Pillar 2: Position Trend (25%)

**What to measure**: Year-over-year change in market share or relative revenue growth vs. peers.

| Score | Criteria | Evidence Required |
|-------|----------|-------------------|
| 5 | Accelerating gains: share growing >5% YoY | Multi-year revenue + market data |
| 4 | Steady gains: share growing 2-5% YoY | Consistent outperformance vs. industry |
| 3 | Stable: share ±2% YoY | In-line with market growth |
| 2 | Declining: share shrinking 2-5% YoY | Losing to specific competitors |
| 1 | Rapid decline: share shrinking >5% YoY | Existential competitive threat |

**Data sources**: Multi-year revenue CAGR, competitor growth rates, industry growth rate.

**Analysis depth**: Identify the *drivers* of the trend. Is growth organic or acquisitive? Which segments/geographies are growing vs. shrinking? What would reverse the trend?

### Pillar 3: Pricing Power (25%)

**What to measure**: ARPU (Average Revenue Per User) trend and ability to raise prices without demand destruction.

| Score | Criteria | Evidence Required |
|-------|----------|-------------------|
| 5 | Strong: ARPU CAGR >8%, prices raised freely | Pricing history, ARPU trend data |
| 4 | Good: ARPU CAGR 4-8% | Steady price increases, low churn |
| 3 | Neutral: ARPU flat (0-4% CAGR) | Pricing in line with inflation |
| 2 | Weak: ARPU declining | Promotional activity, competitor pressure |
| 1 | None: race to bottom, commoditized | Price wars, no differentiation |

**Data sources**: Revenue per user/unit, pricing page history, gross margin trend, competitive pricing.

**Analysis depth**: Distinguish between *actual* pricing power (raising prices without losing customers) and *apparent* pricing power (raising prices while simultaneously losing low-value customers). Check gross margin trajectory alongside ARPU.

### Pillar 4: Future ROIC (25%)

**What to measure**: Return on Invested Capital vs. Weighted Average Cost of Capital, historical and projected.

| Score | Criteria | Evidence Required |
|-------|----------|-------------------|
| 5 | Exceptional: ROIC >25%, expanding, far exceeds WACC | 5-year ROIC trend, WACC estimate |
| 4 | Strong: ROIC 15-25%, comfortably above WACC | Consistent value creation |
| 3 | Adequate: ROIC 8-15%, near WACC | Marginal value creation |
| 2 | Concerning: ROIC 3-8%, at or below WACC | Value destruction risk |
| 1 | Destroying value: ROIC <3%, well below WACC | Sustained capital misallocation |

**ROIC Calculation**:
```
ROIC = NOPAT / Invested Capital
NOPAT = Operating Income × (1 - Tax Rate)
Invested Capital = Total Equity + Total Debt - Cash
```

**Analysis depth**: Decompose ROIC into its drivers (margin expansion vs. capital efficiency). Is high ROIC sustainable or driven by one-time factors? How does ROIC compare to the company's own cost of capital? Project 3-year ROIC trajectory with bull/base/bear scenarios.

### CA Score Synthesis

**CA Score** = (P1 + P2 + P3 + P4) / 4

| CA Score | Interpretation |
|----------|---------------|
| 4.0-5.0 | Exceptional competitive advantage |
| 3.0-3.9 | Solid competitive position |
| 2.0-2.9 | Challenged position |
| 1.0-1.9 | Weak, at risk |

After calculating the score, write a **300-word narrative** explaining what the quantitative picture tells you. Which pillars are strongest? Which are weakest? What's the trajectory? This narrative bridges the quantitative and qualitative analysis.

---

## 3. Phase 2: Qualitative Moat Analysis (7 Powers)

Based on Hamilton Helmer's "7 Powers: The Foundations of Business Strategy".

For each Power, evaluate along three axes:
1. **Current strength**: None / Weak / Moderate / Strong
2. **Trajectory**: Strengthening / Stable / Eroding
3. **Durability**: How long until a well-funded competitor could replicate this? (<1yr / 1-3yr / 3-5yr / 5+yr)

### Power 1: Scale Economies
**Question**: Does unit cost decline meaningfully as volume increases?
- **Evidence to gather**: Fixed cost structure, unit economics at different scale levels, marginal cost curve shape
- **Examples**: AWS (server costs amortized), Costco (buying power), TSMC (fab utilization)
- **Quantitative proxy**: Operating leverage ratio, fixed costs as % of revenue
- **Erosion risk**: Technology changes that reduce minimum efficient scale, modular architectures that enable smaller competitors

### Power 2: Network Effects
**Question**: Does the product become more valuable as more people use it?
- **Types**: Direct (phone network), Indirect (app marketplace), Data (ML models improve with usage), Social (identity/status)
- **Evidence to gather**: User growth → engagement metrics, marketplace liquidity ratios, data flywheel evidence
- **Examples**: Meta (social graph), Visa (merchant + cardholder), Google (search quality → usage → data → quality)
- **Quantitative proxy**: User retention vs. network size, marketplace liquidity, engagement per user over time
- **Erosion risk**: Multi-homing (users on multiple platforms), protocol-level interoperability, network collapse dynamics

### Power 3: Counter-Positioning
**Question**: Would a rational incumbent decline to copy this approach because it would damage their existing business?
- **Evidence to gather**: Cannibalization risk for incumbent, business model conflict, organizational inertia
- **Examples**: Netflix vs. Blockbuster, Tesla DTC vs. dealer networks, Amazon AWS vs. enterprise IT vendors
- **Quantitative proxy**: Incumbent's revenue at risk from adoption, margin differential between old/new model
- **Erosion risk**: Counter-positioning is *temporary* — it erodes as the old business model declines naturally. How much runway remains?

### Power 4: Switching Costs
**Question**: How costly (in time, money, or pain) is it for a customer to switch to a competitor?
- **Types**: Financial (contracts, migration costs), Procedural (retraining, workflow disruption), Relational (trust, integration depth), Data (history, customization)
- **Evidence to gather**: Retention rates, contract length, integration depth, data portability
- **Examples**: Salesforce (CRM data lock-in), Epic Systems (hospital EHR), Adobe (workflow integration)
- **Quantitative proxy**: Dollar retention rate, average contract length, churn rate by cohort
- **Erosion risk**: API standardization, data portability regulations, abstraction layers

### Power 5: Branding
**Question**: Does the brand command a price premium or drive unprompted demand?
- **Evidence to gather**: Price premium vs. generic, NPS scores, brand value rankings, unprompted recall
- **Examples**: Apple (willingness to pay premium), Coca-Cola (brand = demand), Hermès (aspirational brand)
- **Quantitative proxy**: Price premium percentage, NPS, brand value in Interbrand/BrandZ rankings
- **Erosion risk**: Reputation events, generational preference shifts, commoditization of category

### Power 6: Cornered Resource
**Question**: Does the company have exclusive access to a valuable resource competitors cannot obtain?
- **Types**: Patents, exclusive licenses, proprietary data, key talent, regulatory approvals, geographic rights
- **Evidence to gather**: Patent portfolio, exclusive contracts, regulatory barriers, talent concentration
- **Examples**: Qualcomm (essential patents), Disney (IP catalog), Novo Nordisk (GLP-1 manufacturing scale)
- **Quantitative proxy**: Patent citation count, exclusive contract duration, regulatory approval timeline for competitors
- **Erosion risk**: Patent expiry, regulatory changes, talent mobility, alternative technologies

### Power 7: Process Power
**Question**: Has the company developed proprietary operational excellence that is deeply embedded and not easily replicated?
- **Evidence to gather**: Operational metrics vs. peers, institutional knowledge, culture, continuous improvement track record
- **Examples**: Toyota (TPS/lean manufacturing), Danaher (DBS), Bridgewater (principles-based culture)
- **Quantitative proxy**: Operational efficiency metrics vs. peers (defect rate, cycle time, throughput)
- **Erosion risk**: Key person departures, cultural dilution through rapid hiring, process rigidity in changing markets

### Moat Interaction Analysis

After scoring each Power individually, analyze how they **reinforce each other**:
- Do network effects strengthen switching costs? (e.g., Salesforce ecosystem)
- Does scale enable branding investment? (e.g., Coca-Cola)
- Does process power protect cornered resources? (e.g., TSMC)
- Are there **flywheel dynamics** where one Power feeds another?

Map the interaction in a brief paragraph: "The primary moat is [X], reinforced by [Y] and [Z]. The flywheel works as follows: [mechanism]."

### Moat Width Rating
| Rating | Criteria |
|--------|----------|
| **None** | No Power scores above Weak |
| **Narrow** | 1 Power at Moderate+, others Weak or None |
| **Wide** | 2-3 Powers at Moderate+, at least 1 Strong |
| **Very Wide** | 3+ Powers at Strong, multiple reinforcing advantages with flywheel dynamics |

---

## 4. Phase 3: Anti-Fragility Resilience Test

Inspired by Nassim Taleb's "Antifragile" — evaluating whether the company merely survives stress or actually benefits from it.

### Test 1: Skin in the Game

| Metric | Score |
|--------|-------|
| Insider ownership >10% | Strong alignment |
| Insider ownership 3-10% | Moderate alignment |
| Insider ownership <3% | Weak alignment |

**Also check**:
- Recent insider transactions (Form 4 filings): net buying vs. selling over last 12 months
- Founder still active in management? Founder-led companies often have stronger long-term alignment
- Executive compensation structure: equity vs. cash heavy? Long-term vesting vs. short-term bonuses?
- Share buyback history: signal of confidence vs. EPS manipulation (check if buybacks happen at high prices)
- Board independence and tenure

### Test 2: Financial Health (Balance Sheet Fortress)

| Metric | Fortress | Healthy | Moderate | Risky |
|--------|----------|---------|----------|-------|
| Debt/Equity | <0.3 | 0.3-1.0 | 1.0-2.0 | >2.0 |
| Current Ratio | >2.0 | 1.5-2.0 | 1.0-1.5 | <1.0 |
| Interest Coverage | >10x | 5-10x | 2-5x | <2x |
| FCF Margin | >20% | 10-20% | 5-10% | <5% |
| Cash Runway | >24 months | 12-24 months | 6-12 months | <6 months |

**Stress test**: What happens if revenue drops 30%? Can the company survive 18 months without external financing? This is the "Taleb test" — companies that can survive tail events have optionality that fragile companies don't.

### Test 3: Optionality Assessment

Evaluate the company's portfolio of real options — asymmetric bets where downside is capped but upside is open-ended:

- **Adjacent market TAM**: Can they expand into nearby markets? What's the total opportunity? Quantify the TAM of each adjacent market.
- **R&D intensity**: R&D/Revenue ratio and trend. Is R&D creating options (new products, platforms) or just maintaining the existing business?
- **Platform extensibility**: Can new products/services be built on existing infrastructure? What's the marginal cost of a new product line?
- **Geographic expansion**: Untapped markets, international revenue as % of total, regulatory barriers to entry
- **M&A optionality**: Balance sheet capacity for strategic acquisitions. Track record of M&A value creation.
- **Convexity assessment**: Does the company have more upside scenarios than downside? Map the probability distribution: is it positively skewed (many small losses, few large gains) or negatively skewed (many small gains, few large losses)?

### Test 4: Black Swan Exposure

For each risk factor, assess severity and *correlation* with other risks (correlated risks are far more dangerous):

| Risk Factor | Low | Medium | High |
|-------------|-----|--------|------|
| Regulatory | Multi-jurisdiction, stable framework | Some pending regulation | Single jurisdiction, active legislation |
| Key-person | Deep bench, distributed leadership | Important leaders but succession planned | Founder-dependent, no succession plan |
| Revenue concentration | Top customer <10% | Top customer 10-25% | Top customer >25% |
| Technology disruption | Platform company, technology creator | Fast follower, adaptive | Legacy technology, slow to change |
| Geopolitical | Diversified globally | Some geographic concentration | Single-market dependent |
| Supply chain | Multiple suppliers, diversified | Some concentration | Single-source critical inputs |

**Tail risk correlation**: Are multiple "Medium" risks correlated? (e.g., geopolitical + supply chain + regulatory in the same region = much worse than three independent Medium risks)

### Test 5: Scenario Analysis

Construct three scenarios with explicit assumptions:

**Bull Case** (20% probability):
- What catalyst would unlock significant upside?
- What's the potential revenue/earnings in 3 years?
- Which moat powers would strengthen?

**Base Case** (60% probability):
- Continuation of current trends
- Expected revenue/earnings trajectory
- Moat stability assessment

**Bear Case** (20% probability):
- What specific threat could impair the business?
- Revenue impact quantification
- Could the company survive and recover, or is this terminal?

**Expected value**: Weight the scenarios to derive an expected CA trajectory.

### Anti-Fragility Rating

| Rating | Criteria |
|--------|----------|
| **Fragile** | High leverage, concentrated risk, no optionality, weak alignment, multiple correlated high-risk exposures. Breaks under stress. |
| **Robust** | Healthy balance sheet, diversified revenue, adequate alignment, manageable risks. Survives stress unchanged. |
| **Anti-Fragile** | Fortress balance sheet, high optionality, strong alignment, convex payoff profile. *Benefits* from volatility — stress triggers growth. |

---

## 5. Phase 4: Synthesis & Investment Thesis

This phase brings everything together into a coherent narrative. It is NOT just a summary — it's a *synthesis* that identifies the key insight.

### Structure

1. **One-sentence thesis**: "Company X has a [wide/narrow/no] moat driven by [primary power], with [anti-fragile/robust/fragile] financials, making it [attractive/neutral/unattractive] at current valuation."

2. **Moat durability assessment**: How long will the moat last? What are the 2-3 biggest threats to the moat? When would you re-evaluate?

3. **Key risks ranked**: List the top 3 risks with probability and impact estimates. For each, identify what *early warning signal* would indicate the risk is materializing.

4. **Catalysts**: What events in the next 12-24 months could change the assessment? (Product launches, regulatory decisions, competitive entries, macro shifts)

5. **Comparative positioning**: If comparison tickers were provided, rank them on overall CA strength and explain the key differentiators.

---

## 6. Report Template

### HTML Report Structure

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
    max-width: 920px;
    margin: 0 auto;
    padding: 48px 40px;
    color: #3A3A3A;
    line-height: 1.7;
    background: #FAF8F5;
  }
  h1 {
    font-size: 32px;
    font-weight: 700;
    color: #3A3A3A;
    margin-bottom: 8px;
    letter-spacing: -0.5px;
  }
  h2 {
    font-size: 22px;
    font-weight: 600;
    color: #3A3A3A;
    margin-top: 40px;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 2px solid #B2986E;
  }
  h3 {
    font-size: 18px;
    font-weight: 600;
    color: #6E8AA4;
    margin-top: 24px;
    margin-bottom: 10px;
  }
  .subtitle {
    font-size: 16px;
    color: #8A8A8A;
    margin-bottom: 32px;
    font-style: italic;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 20px 0;
    font-size: 15px;
  }
  th {
    background: #3A3A3A;
    color: #FAF8F5;
    padding: 12px 16px;
    text-align: left;
    font-weight: 600;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  td {
    border-bottom: 1px solid #e8e4e0;
    padding: 11px 16px;
    text-align: left;
  }
  tr:hover td {
    background: rgba(178, 152, 110, 0.06);
  }
  .score-high { color: #5D8057; font-weight: 700; }
  .score-mid { color: #B2986E; font-weight: 700; }
  .score-low { color: #A86464; font-weight: 700; }

  /* Executive Summary Card */
  .exec-summary {
    background: white;
    border-radius: 12px;
    padding: 28px 32px;
    margin: 28px 0;
    box-shadow: 0 2px 12px rgba(0,0,0,0.06);
    border-top: 4px solid #B2986E;
  }
  .exec-summary h2 {
    margin-top: 0;
    border: none;
    padding-bottom: 0;
  }

  /* Metric Cards */
  .metric-row {
    display: flex;
    gap: 20px;
    margin: 24px 0;
  }
  .metric-card {
    flex: 1;
    background: white;
    border-radius: 10px;
    padding: 20px 24px;
    box-shadow: 0 1px 6px rgba(0,0,0,0.04);
    text-align: center;
  }
  .metric-card .value {
    font-size: 32px;
    font-weight: 700;
    margin: 8px 0 4px;
  }
  .metric-card .label {
    font-size: 13px;
    color: #8A8A8A;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .metric-card .sublabel {
    font-size: 14px;
    color: #6E8AA4;
    margin-top: 4px;
  }

  /* Verdict Box */
  .verdict-box {
    background: white;
    border: 2px solid #5D8057;
    border-radius: 12px;
    padding: 24px 32px;
    text-align: center;
    margin: 32px 0;
    box-shadow: 0 2px 8px rgba(93,128,87,0.1);
  }
  .verdict-box.cautious {
    border-color: #B2986E;
    box-shadow: 0 2px 8px rgba(178,152,110,0.1);
  }
  .verdict-box.negative {
    border-color: #A86464;
    box-shadow: 0 2px 8px rgba(168,100,100,0.1);
  }

  /* Power Assessment Bars */
  .power-bar {
    display: flex;
    align-items: center;
    margin: 8px 0;
    gap: 12px;
  }
  .power-bar .name {
    width: 160px;
    font-size: 14px;
    font-weight: 600;
    text-align: right;
  }
  .power-bar .bar-bg {
    flex: 1;
    height: 24px;
    background: #f0ede8;
    border-radius: 12px;
    overflow: hidden;
  }
  .power-bar .bar-fill {
    height: 100%;
    border-radius: 12px;
    transition: width 0.3s ease;
  }
  .power-bar .bar-fill.strong { background: linear-gradient(90deg, #5D8057, #7BA075); }
  .power-bar .bar-fill.moderate { background: linear-gradient(90deg, #B2986E, #C8AE84); }
  .power-bar .bar-fill.weak { background: linear-gradient(90deg, #A86464, #BE7A7A); }
  .power-bar .bar-fill.none { background: #d8d4d0; }

  /* Insight callouts */
  .insight {
    background: rgba(110, 138, 164, 0.08);
    border-left: 4px solid #6E8AA4;
    padding: 16px 20px;
    margin: 20px 0;
    border-radius: 0 8px 8px 0;
    font-size: 15px;
  }
  .insight strong { color: #6E8AA4; }

  .risk-callout {
    background: rgba(168, 100, 100, 0.06);
    border-left: 4px solid #A86464;
    padding: 16px 20px;
    margin: 20px 0;
    border-radius: 0 8px 8px 0;
    font-size: 15px;
  }
  .risk-callout strong { color: #A86464; }

  /* Print styles */
  @media print {
    body { padding: 20px; background: white; }
    .exec-summary, .metric-card { box-shadow: none; border: 1px solid #e8e4e0; }
  }
</style>
</head>
<body>

<h1>Moat & Fragility Analysis: [TICKER]</h1>
<p class="subtitle">[Company Name] | [Sector] | Market Cap: $[X]B | Analysis Date: [Date]</p>

<div class="exec-summary">
  <h2>Executive Summary</h2>
  <div class="metric-row">
    <div class="metric-card">
      <div class="label">CA Score</div>
      <div class="value score-high">X.X</div>
      <div class="sublabel">out of 5.0</div>
    </div>
    <div class="metric-card">
      <div class="label">Moat Width</div>
      <div class="value" style="font-size:24px;">Wide</div>
      <div class="sublabel">Primary: [Power]</div>
    </div>
    <div class="metric-card">
      <div class="label">Anti-Fragility</div>
      <div class="value" style="font-size:24px;">Anti-Fragile</div>
      <div class="sublabel">Fortress balance sheet</div>
    </div>
  </div>
  <p><strong>Thesis:</strong> [One-sentence investment thesis]</p>
</div>

<h2>Section 1: Quantitative Analysis (CA Score)</h2>
<!-- Pillar-by-pillar scoring with evidence and narrative -->
<!-- CA radar chart (SVG) -->
<!-- Revenue & market share trend chart (SVG) -->
<!-- ROIC vs WACC chart (SVG) -->

<h2>Section 2: Qualitative Moat Analysis (7 Powers)</h2>
<!-- Power assessment bars (use .power-bar divs above) -->
<!-- Power-by-power deep analysis -->
<!-- Moat interaction / flywheel narrative -->
<!-- Moat width determination -->

<h2>Section 3: Anti-Fragility Assessment</h2>
<!-- Skin in the Game -->
<!-- Financial Health table -->
<!-- Optionality inventory with TAM estimates -->
<!-- Black swan exposure matrix -->
<!-- Scenario analysis (bull / base / bear) -->

<h2>Section 4: Comparative Analysis</h2>
<!-- Side-by-side if comparison tickers provided -->

<h2>Section 5: Investment Thesis & Conclusion</h2>
<!-- One-sentence thesis -->
<!-- Moat durability timeline -->
<!-- Top 3 risks with early warning signals -->
<!-- Catalysts for next 12-24 months -->
<!-- Final verdict -->

</body>
</html>
```

### PDF Generation

Convert the HTML report to PDF:

```bash
# Option A: Chrome headless (preferred, no install)
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --print-to-pdf=./output/report/moat-analysis.pdf \
  --print-to-pdf-no-header \
  "file://$(pwd)/output/report/moat-analysis.html"

# Linux
google-chrome --headless --disable-gpu --print-to-pdf=./output/report/moat-analysis.pdf \
  --print-to-pdf-no-header \
  "file://$(pwd)/output/report/moat-analysis.html"

# Option B: puppeteer-core (system Chrome, no browser download)
npm install puppeteer-core
node -e "
const puppeteer = require('puppeteer-core');
const path = require('path');
(async () => {
  const execPaths = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const execPath = execPaths.find(p => { try { require('fs').accessSync(p); return true; } catch { return false; } });
  if (!execPath) { console.error('No Chrome found'); process.exit(1); }
  const browser = await puppeteer.launch({ executablePath: execPath, headless: 'new' });
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve('./output/report/moat-analysis.html'), { waitUntil: 'networkidle0' });
  await page.pdf({ path: './output/report/moat-analysis.pdf', format: 'A4', printBackground: true,
    margin: { top: '0.75in', right: '0.75in', bottom: '0.75in', left: '0.75in' },
    displayHeaderFooter: true,
    headerTemplate: '<div style=\"font-size:8px;text-align:center;width:100%;font-family:Palatino,serif;color:#8A8A8A;\">Moat & Fragility Analysis</div>',
    footerTemplate: '<div style=\"font-size:8px;text-align:center;width:100%;font-family:Palatino,serif;color:#8A8A8A;\"><span class=\"pageNumber\"></span> / <span class=\"totalPages\"></span></div>'
  });
  await browser.close();
  console.log('PDF report generated');
})();
"
```

---

## 7. Figures & Charts

### Figure Strategy: Reuse + Generate

For every visual need, follow this decision process:

```
Does a source document (10-K, earnings presentation, annual report) have a relevant chart?
├─ YES → Is it high quality and directly relevant?
│   ├─ YES → EXTRACT AND EMBED. Earnings presentations especially contain investor-quality charts.
│   └─ NO (low resolution, wrong metric, outdated)
│       → RECREATE as SVG with the palette colors for visual consistency.
└─ NO → Is this a standard analysis chart (CA radar, ROIC vs WACC, revenue trend)?
    ├─ YES → GENERATE NEW SVG using the palette and templates below.
    └─ NO → Skip — not every section needs a chart, but data-heavy sections always do.
```

### Per-Section Chart Requirements

| Report Section | Required Charts | Type |
|---|---|---|
| Executive Summary | 3 metric cards (CA Score, Moat Width, Anti-Fragility) | HTML metric cards (in template) |
| Section 1: Quantitative Analysis | **CA radar chart** + **Revenue & market share trend** + **ROIC vs WACC** | SVG (3 charts minimum) |
| Section 2: Moat Analysis | **7 Powers heatmap** (horizontal bar chart) | SVG or HTML power bars |
| Section 3: Anti-Fragility | **Financial health table** + optionally a **scenario analysis chart** | HTML table + optional SVG |
| Section 4: Comparative | **Side-by-side comparison table** (if comparison tickers) | HTML table |
| Section 5: Conclusion | **Moat durability timeline** (optional) | SVG timeline |

**Minimum total charts**: 5 for single-company analysis, 7+ for comparative analysis.

### SVG Quality Rules

When generating SVG charts:
- Minimum **40px spacing** between adjacent elements (bars, data points, labels)
- All text labels must have **12px padding** from edges — no text overlapping chart elements
- Axis labels outside the plot area, never overlapping data points
- Font: Palatino, 14px for labels, 11px for axis marks, 16px for chart title
- Max chart width: 800px for report embeds, 420px for side-by-side charts
- **Verify before output**: mentally check that no labels overlap bars, no axis text clips, and all data points are visible

### Color Palette for Charts

| Role | Hex | Usage |
|------|-----|-------|
| Primary data | `#6E8AA4` | Main data series, bars, lines |
| Positive/Strong | `#5D8057` | Good metrics, gains, strengths |
| Caution/Moderate | `#B2986E` | Neutral metrics, warnings |
| Negative/Weak | `#A86464` | Bad metrics, losses, risks |
| Grid/Axis | `#e0dcd8` | Chart gridlines, axes |
| Labels | `#3A3A3A` | All text labels |
| Background | `#FAF8F5` | Chart background |

### CA Score Radar Chart

```svg
<svg width="420" height="420" viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg">
  <style>
    .grid { stroke: #e0dcd8; stroke-width: 1; fill: none; }
    .axis-label {
      font-family: 'Palatino Linotype', 'Book Antiqua', serif;
      font-size: 14px; fill: #3A3A3A; font-weight: 600;
    }
    .score-area { fill: rgba(110, 138, 164, 0.18); stroke: #6E8AA4; stroke-width: 2.5; }
    .score-point { fill: #6E8AA4; }
    .scale-label {
      font-family: 'Palatino Linotype', serif;
      font-size: 11px; fill: #8A8A8A;
    }
  </style>
  <!-- Concentric diamond grid (5 levels for score 1-5) -->
  <!-- Score polygon overlay with filled area -->
  <!-- Score dots at vertices -->
  <!-- Axis labels: Market Position, Position Trend, Pricing Power, Future ROIC -->
  <!-- Scale numbers along one axis -->
</svg>
```

### Moat Power Heatmap

Use a 7-row horizontal bar chart where bar length and color reflect Power strength:
- **None**: 0% width, `#d8d4d0`
- **Weak**: 33% width, `#A86464` gradient
- **Moderate**: 66% width, `#B2986E` gradient
- **Strong**: 100% width, `#5D8057` gradient

Include a small trajectory arrow (↑ strengthening, → stable, ↓ eroding) after each bar.

---

## 8. Quality Checklist

Before finalizing the report:

- [ ] All 4 CA pillars scored with specific evidence and narrative explanation
- [ ] CA Score correctly calculated as average
- [ ] All 7 Powers assessed with current strength, trajectory, and durability
- [ ] Each Power includes quantitative proxy and erosion risk analysis
- [ ] Moat interaction analysis identifies reinforcing dynamics
- [ ] Moat width rating consistent with Power scores
- [ ] All 5 Anti-Fragility tests completed with data
- [ ] Scenario analysis includes bull/base/bear with probabilities
- [ ] Anti-Fragility rating consistent with test results
- [ ] Investment thesis is one clear sentence
- [ ] Top 3 risks identified with early warning signals
- [ ] Executive summary accurately reflects detailed analysis
- [ ] All data sources cited with dates
- [ ] Minimum 5 charts/visuals for single-company, 7+ for comparative
- [ ] CA radar chart, revenue trend, and ROIC vs WACC charts are all present
- [ ] 7 Powers heatmap is included with trajectory indicators
- [ ] All SVG charts use palette colors with no label overlap
- [ ] Source document figures extracted and embedded where relevant
- [ ] PDF renders cleanly without clipping or formatting issues
- [ ] Competitor comparison included (if tickers provided)
- [ ] Tone is professional and evidence-based
