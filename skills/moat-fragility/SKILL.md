---
name: moat-fragility
version: "1.0.0"
description: "Evaluate a company's competitive advantage through quantitative CA scoring, qualitative moat analysis (7 Powers), and anti-fragility resilience testing"
category: workflows
tags: [finance, investing, moat, competitive-advantage, equity, analysis, antifragile]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash]
---

# Moat & Fragility Competitive Advantage Analysis

You are a Senior Equity Analyst conducting a comprehensive competitive advantage evaluation. Your analysis follows a three-phase framework inspired by Warren Buffett's moat concept, Hamilton Helmer's "7 Powers", and Nassim Taleb's "Antifragile".

---

## 1. Document Reading Tools

When supplementary documents (10-K filings, earnings transcripts, research reports) are provided:

### PDF Files
Use the **PDF skill** to read PDF documents. The Read tool can directly read PDF files and render their content for analysis.

Reference: https://github.com/anthropics/skills/tree/main/skills/pdf

```
# Simply use the Read tool on the PDF file:
Read: /path/to/10-K-filing.pdf
```

### Other Formats
Read Markdown, HTML, and text files directly with the Read tool.

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

**CA Score** = (P1 + P2 + P3 + P4) / 4

| CA Score | Interpretation |
|----------|---------------|
| 4.0-5.0 | Exceptional competitive advantage |
| 3.0-3.9 | Solid competitive position |
| 2.0-2.9 | Challenged position |
| 1.0-1.9 | Weak, at risk |

---

## 3. Phase 2: Qualitative Moat Analysis (7 Powers)

Based on Hamilton Helmer's "7 Powers: The Foundations of Business Strategy".

### Power 1: Scale Economies
**Question**: Does unit cost decline meaningfully as volume increases?
- **Evidence**: Fixed cost structure, unit economics at different scale levels
- **Examples**: AWS (server costs amortized), Costco (buying power), TSMC (fab utilization)
- **Score**: None / Weak / Moderate / Strong

### Power 2: Network Effects
**Question**: Does the product become more valuable as more people use it?
- **Types**: Direct (phone network), Indirect (app marketplace), Data (ML models improve with usage)
- **Evidence**: User growth → engagement metrics, marketplace liquidity
- **Examples**: Meta (social graph), Visa (merchant + cardholder), Google (search quality → usage → data → quality)
- **Score**: None / Weak / Moderate / Strong

### Power 3: Counter-Positioning
**Question**: Would a rational incumbent decline to copy this approach because it would damage their existing business?
- **Evidence**: Cannibalization risk for incumbent, business model conflict
- **Examples**: Netflix vs. Blockbuster, Tesla DTC vs. dealer networks
- **Score**: None / Weak / Moderate / Strong

### Power 4: Switching Costs
**Question**: How costly (in time, money, or pain) is it for a customer to switch to a competitor?
- **Types**: Financial (contracts), Procedural (retraining), Relational (trust, integration)
- **Evidence**: Retention rates, contract length, integration depth
- **Examples**: Salesforce (CRM data lock-in), Epic Systems (hospital EHR), Adobe (workflow integration)
- **Score**: None / Weak / Moderate / Strong

### Power 5: Branding
**Question**: Does the brand command a price premium or drive unprompted demand?
- **Evidence**: Price premium vs. generic, NPS scores, brand value rankings
- **Examples**: Apple (willingness to pay premium), Coca-Cola (brand = demand), Hermès (aspirational brand)
- **Score**: None / Weak / Moderate / Strong

### Power 6: Cornered Resource
**Question**: Does the company have exclusive access to a valuable resource competitors cannot obtain?
- **Types**: Patents, exclusive licenses, proprietary data, key talent, regulatory approvals
- **Evidence**: Patent portfolio, exclusive contracts, regulatory barriers
- **Examples**: Qualcomm (essential patents), Disney (IP catalog), Novo Nordisk (GLP-1 manufacturing)
- **Score**: None / Weak / Moderate / Strong

### Power 7: Process Power
**Question**: Has the company developed proprietary operational excellence that is deeply embedded and not easily replicated?
- **Evidence**: Operational metrics vs. peers, institutional knowledge, culture
- **Examples**: Toyota (TPS/lean manufacturing), Danaher (DBS), Bridgewater (principles-based culture)
- **Score**: None / Weak / Moderate / Strong

### Moat Width Rating
| Rating | Criteria |
|--------|----------|
| **None** | No Power scores above Weak |
| **Narrow** | 1 Power at Moderate+, others Weak or None |
| **Wide** | 2-3 Powers at Moderate+, at least 1 Strong |
| **Very Wide** | 3+ Powers at Strong, multiple reinforcing advantages |

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
- Recent insider transactions (Form 4 filings)
- Founder still active in management?
- Executive compensation structure (equity vs. cash heavy?)
- Share buyback history (signal of confidence vs. EPS manipulation)

### Test 2: Financial Health

| Metric | Fortress | Healthy | Moderate | Risky |
|--------|----------|---------|----------|-------|
| Debt/Equity | <0.3 | 0.3-1.0 | 1.0-2.0 | >2.0 |
| Current Ratio | >2.0 | 1.5-2.0 | 1.0-1.5 | <1.0 |
| Interest Coverage | >10x | 5-10x | 2-5x | <2x |
| FCF Margin | >20% | 10-20% | 5-10% | <5% |
| Cash Runway | >24 months | 12-24 months | 6-12 months | <6 months |

### Test 3: Optionality

Evaluate the company's portfolio of real options:
- **Adjacent market TAM**: Can they expand into nearby markets? What's the total opportunity?
- **R&D intensity**: R&D/Revenue ratio and trend (investing in future options?)
- **Platform extensibility**: Can new products/services be built on existing infrastructure?
- **Geographic expansion**: Untapped markets, international revenue as % of total
- **M&A optionality**: Balance sheet capacity for strategic acquisitions

### Test 4: Black Swan Exposure

| Risk Factor | Low | Medium | High |
|-------------|-----|--------|------|
| Regulatory | Multi-jurisdiction, stable framework | Some pending regulation | Single jurisdiction, active legislation |
| Key-person | Deep bench, distributed leadership | Important leaders but succession planned | Founder-dependent, no succession plan |
| Revenue concentration | Top customer <10% | Top customer 10-25% | Top customer >25% |
| Technology disruption | Platform company, technology creator | Fast follower, adaptive | Legacy technology, slow to change |
| Geopolitical | Diversified globally | Some geographic concentration | Single-market dependent |

### Anti-Fragility Rating

| Rating | Criteria |
|--------|----------|
| **Fragile** | High leverage, concentrated risk, no optionality, weak alignment, multiple high-risk exposures |
| **Robust** | Healthy balance sheet, diversified revenue, adequate alignment, manageable risks |
| **Anti-Fragile** | Fortress balance sheet, high optionality, strong alignment, positioned to benefit from volatility |

---

## 5. Report Template

### HTML/Markdown Report Structure

```html
<!DOCTYPE html>
<html>
<head>
<style>
  body {
    font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
    max-width: 900px;
    margin: 0 auto;
    padding: 40px;
    color: #333;
    line-height: 1.6;
  }
  h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 8px; }
  h2 { color: #34495e; margin-top: 32px; }
  h3 { color: #4a6fa5; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #ddd; padding: 10px 14px; text-align: left; }
  th { background: #f5f7fa; font-weight: 600; }
  tr:nth-child(even) { background: #fafbfc; }
  .score-high { color: #27ae60; font-weight: 700; }
  .score-mid { color: #f39c12; font-weight: 700; }
  .score-low { color: #e74c3c; font-weight: 700; }
  .executive-summary {
    background: #f8f9fa;
    border-left: 4px solid #3498db;
    padding: 20px;
    margin: 20px 0;
    border-radius: 4px;
  }
  .verdict-box {
    background: #f0f7ff;
    border: 2px solid #3498db;
    padding: 20px;
    border-radius: 8px;
    text-align: center;
    margin: 24px 0;
  }
  .chart-placeholder {
    background: #f5f5f5;
    border: 1px dashed #ccc;
    padding: 20px;
    text-align: center;
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
</head>
<body>

<h1>Moat & Fragility Analysis: [TICKER]</h1>
<p><em>[Company Name] | [Sector] | Market Cap: $[X]B | Analysis Date: [Date]</em></p>

<div class="executive-summary">
  <h2>Executive Summary</h2>
  <table>
    <tr><th>Metric</th><th>Result</th></tr>
    <tr><td>CA Score</td><td><span class="score-high">X.X / 5.0</span></td></tr>
    <tr><td>Moat Width</td><td>Wide</td></tr>
    <tr><td>Anti-Fragility</td><td>Anti-Fragile</td></tr>
  </table>
  <p><strong>Verdict:</strong> [3-sentence summary of the overall assessment]</p>
</div>

<h2>Section 1: Quantitative Analysis (CA Score)</h2>
<!-- Company Overview Table -->
<!-- Pillar scoring with justification -->
<!-- Revenue & market share chart (SVG) -->
<!-- ROIC vs WACC chart (SVG) -->

<h2>Section 2: Qualitative Moat Analysis (7 Powers)</h2>
<!-- Power-by-power assessment -->
<!-- Moat heatmap (SVG) -->
<!-- Primary moat identification -->

<h2>Section 3: Anti-Fragility Assessment</h2>
<!-- Skin in the Game -->
<!-- Financial Health table -->
<!-- Optionality inventory -->
<!-- Risk catalog -->

<h2>Section 4: Comparative Analysis</h2>
<!-- Side-by-side if comparison tickers provided -->

<h2>Section 5: Conclusion & Recommendation</h2>
<!-- Overall assessment, risks, catalysts -->

</body>
</html>
```

### PDF Generation

Convert the HTML report to PDF using Playwright:

```bash
node -e "
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const html = fs.readFileSync('./output/report/moat-analysis.html', 'utf-8');
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.pdf({
    path: './output/report/moat-analysis.pdf',
    format: 'A4',
    printBackground: true,
    margin: { top: '0.75in', right: '0.75in', bottom: '0.75in', left: '0.75in' },
    displayHeaderFooter: true,
    headerTemplate: '<div style=\"font-size:8px;text-align:center;width:100%\">Moat & Fragility Analysis — [TICKER]</div>',
    footerTemplate: '<div style=\"font-size:8px;text-align:center;width:100%\"><span class=\"pageNumber\"></span> / <span class=\"totalPages\"></span></div>',
  });
  await browser.close();
  console.log('PDF report generated');
})();
"
```

---

## 6. SVG Chart Guidelines

### CA Score Radar Chart

```svg
<svg width="400" height="400" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
  <style>
    .axis { stroke: #ddd; stroke-width: 1; }
    .label { font-family: 'Palatino Linotype', serif; font-size: 14px; fill: #333; text-anchor: middle; }
    .score-area { fill: rgba(52, 152, 219, 0.2); stroke: #3498db; stroke-width: 2; }
    .score-point { fill: #3498db; r: 5; }
  </style>
  <!-- Pentagon grid (5 levels for score 1-5) -->
  <!-- Score polygon overlay -->
  <!-- Axis labels: Market Position, Trend, Pricing Power, Future ROIC -->
</svg>
```

### Moat Heatmap

Use a 7-row × 1-column heatmap where each cell's color intensity reflects the Power strength:
- None: #f5f5f5 (light gray)
- Weak: #fce4ec (light red)
- Moderate: #fff9c4 (light yellow)
- Strong: #c8e6c9 (light green)

---

## 7. Data Retrieval Guidelines

### Public Data Sources
When retrieving financial data, use these approaches:
- **SEC EDGAR**: 10-K filings, proxy statements (DEF 14A), insider transactions (Form 4)
- **Yahoo Finance API**: Historical prices, basic financials (use Bash + curl)
- **Company investor relations**: Earnings presentations, annual reports
- **Industry reports**: Market sizing, competitive landscape (Gartner, IDC, Statista)

### Data Validation
- Cross-reference at least 2 sources for key metrics
- Flag estimated vs. confirmed data points
- Use trailing twelve months (TTM) for most recent data
- Normalize for one-time items (restructuring charges, asset sales)

---

## 8. Quality Checklist

Before finalizing the report:

- [ ] All 4 CA pillars scored with specific evidence
- [ ] CA Score correctly calculated as average
- [ ] All 7 Powers assessed with 2-3 specific examples each
- [ ] Moat width rating consistent with Power scores
- [ ] All 4 Anti-Fragility tests completed with data
- [ ] Anti-Fragility rating consistent with test results
- [ ] Executive summary accurately reflects detailed analysis
- [ ] All data sources cited
- [ ] Charts/tables are accurate and properly labeled
- [ ] PDF renders cleanly without clipping or formatting issues
- [ ] Competitor comparison included (if tickers provided)
- [ ] Risks and catalysts identified
- [ ] Tone is professional and evidence-based
