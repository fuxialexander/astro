---
name: academic-presentation
version: "1.0.0"
description: "Convert academic papers into slides (PDF), blog posts (Markdown), and conference posters (PDF) using HTML-based rendering with Morandi palette"
category: workflows
tags: [academic, presentation, slides, blog, poster, pdf, html, morandi]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash]
---

# Academic Paper Presentation

You are an expert academic presentation designer. You convert research papers into three deliverable formats:

1. **Slides** — HTML slides rendered to PDF via Playwright
2. **Blog Post** — Markdown with citations and figures
3. **Conference Poster** — Single-page HTML rendered to A0 PDF via Playwright

All deliverables use a Morandi-style low-saturation color palette with consistent typography and figure styling.

---

## 0. Document Reading — PDF Skill

**CRITICAL**: When the paper source is PDF files, you MUST use the **PDF skill** to read them. The Read tool can directly read PDF files and render their content for analysis.

Reference: https://github.com/anthropics/skills/tree/main/skills/pdf

```
# Simply use the Read tool on the PDF file:
Read: /path/to/paper.pdf
```

The PDF skill handles text extraction with layout preservation, table extraction, figure identification, equation rendering, and multi-column layout parsing.

For **arXiv links**, fetch the LaTeX source or HTML directly. For **DOCX files** (if provided), use the DOCX skill: https://github.com/anthropics/skills/tree/main/skills/docx

---

## 1. Slide Layout System

Every slide is a self-contained HTML file with embedded CSS. The page size is **1280×720px** (16:9 aspect ratio). Use the following 5 layout types for all slides.

### Layout 1: Title Slide

Centered title, authors, and affiliation. Used for the opening slide.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1280px; height: 720px;
    font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
    background: #FAF8F5;
    color: #3A3A3A;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 60px 100px;
  }
  h1 {
    font-size: 42px;
    font-weight: 700;
    line-height: 1.3;
    margin-bottom: 24px;
    color: #3A3A3A;
  }
  .authors {
    font-size: 22px;
    color: #8FA8B8;
    margin-bottom: 12px;
  }
  .affiliation {
    font-size: 18px;
    color: #A8B8A0;
  }
  .accent-line {
    width: 80px;
    height: 3px;
    background: #C4A882;
    margin: 20px auto;
  }
</style>
</head>
<body>
  <h1>Paper Title Goes Here</h1>
  <div class="accent-line"></div>
  <p class="authors">Author A, Author B, Author C</p>
  <p class="affiliation">University / Lab Name</p>
</body>
</html>
```

### Layout 2: Section Divider

Full-page centered large text. Used to introduce major sections.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1280px; height: 720px;
    font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
    background: #FAF8F5;
    color: #3A3A3A;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 60px 100px;
  }
  h1 {
    font-size: 52px;
    font-weight: 700;
    color: #3A3A3A;
    margin-bottom: 16px;
  }
  .subtitle {
    font-size: 24px;
    color: #8FA8B8;
    font-style: italic;
  }
  .section-number {
    font-size: 120px;
    font-weight: 700;
    color: #C4A882;
    opacity: 0.15;
    position: absolute;
    top: 40px;
    right: 80px;
  }
</style>
</head>
<body>
  <span class="section-number">02</span>
  <h1>Section Title</h1>
  <p class="subtitle">Brief description of what this section covers</p>
</body>
</html>
```

### Layout 3: Full Bullet

Centered bullets with color-box highlighting. The workhorse layout for content slides.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1280px; height: 720px;
    font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
    background: #FAF8F5;
    color: #3A3A3A;
    padding: 50px 80px;
  }
  h2 {
    font-size: 34px;
    font-weight: 600;
    margin-bottom: 32px;
    color: #3A3A3A;
  }
  ul {
    list-style: none;
    padding: 0;
  }
  ul li {
    font-size: 22px;
    line-height: 1.6;
    margin-bottom: 14px;
    padding-left: 24px;
    position: relative;
  }
  ul li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #8FA8B8;
  }
  .box-blue {
    background: rgba(143, 168, 184, 0.15);
    border-left: 3px solid #8FA8B8;
    padding: 12px 16px;
    margin: 16px 0;
    border-radius: 4px;
    font-size: 20px;
  }
  .box-green {
    background: rgba(168, 184, 160, 0.15);
    border-left: 3px solid #A8B8A0;
    padding: 12px 16px;
    margin: 16px 0;
    border-radius: 4px;
    font-size: 20px;
  }
  .box-pink {
    background: rgba(196, 168, 130, 0.15);
    border-left: 3px solid #C4A882;
    padding: 12px 16px;
    margin: 16px 0;
    border-radius: 4px;
    font-size: 20px;
  }
  .highlight { color: #C4A882; font-weight: 600; }
</style>
</head>
<body>
  <h2>Slide Title</h2>
  <ul>
    <li>First key point with <span class="highlight">emphasis</span></li>
    <li>Second key point explaining the concept</li>
    <li>Third point with supporting detail</li>
  </ul>
  <div class="box-blue">
    <strong>Key Takeaway:</strong> Important conclusion or insight.
  </div>
</body>
</html>
```

### Layout 4: Left-Right Split

Text 60% left, figure/image 40% right. Figure is top-aligned. Use for slides with diagrams.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1280px; height: 720px;
    font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
    background: #FAF8F5;
    color: #3A3A3A;
    padding: 50px 60px;
  }
  h2 {
    font-size: 34px;
    font-weight: 600;
    margin-bottom: 28px;
    color: #3A3A3A;
  }
  .content {
    display: flex;
    gap: 40px;
    height: calc(100% - 80px);
  }
  .left {
    flex: 0 0 58%;
    font-size: 22px;
    line-height: 1.6;
  }
  .right {
    flex: 0 0 38%;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .right img, .right svg {
    max-width: 100%;
    max-height: 480px;
    border-radius: 6px;
  }
  .caption {
    font-size: 14px;
    color: #A8B8A0;
    margin-top: 8px;
    text-align: center;
  }
  ul { list-style: none; padding: 0; }
  ul li {
    margin-bottom: 12px;
    padding-left: 20px;
    position: relative;
  }
  ul li::before {
    content: '→';
    position: absolute;
    left: 0;
    color: #8FA8B8;
  }
</style>
</head>
<body>
  <h2>Slide Title</h2>
  <div class="content">
    <div class="left">
      <ul>
        <li>Key point about the figure</li>
        <li>Another observation or result</li>
        <li>Technical detail with context</li>
      </ul>
    </div>
    <div class="right">
      <!-- SVG figure or <img> goes here -->
      <svg width="400" height="300" viewBox="0 0 400 300">
        <!-- Figure content -->
      </svg>
      <span class="caption">Figure 1: Description</span>
    </div>
  </div>
</body>
</html>
```

### Layout 5: Three-Zone

Top 70% is a left-right split, bottom 30% is a supplementary bar. Use for results + analysis slides.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1280px; height: 720px;
    font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
    background: #FAF8F5;
    color: #3A3A3A;
    padding: 50px 60px;
    display: flex;
    flex-direction: column;
  }
  h2 {
    font-size: 34px;
    font-weight: 600;
    margin-bottom: 20px;
    color: #3A3A3A;
  }
  .top-zone {
    display: flex;
    gap: 30px;
    flex: 0 0 65%;
  }
  .top-left {
    flex: 0 0 55%;
    font-size: 20px;
    line-height: 1.5;
  }
  .top-right {
    flex: 0 0 42%;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }
  .top-right img, .top-right svg {
    max-width: 100%;
    max-height: 320px;
  }
  .bottom-zone {
    flex: 1;
    margin-top: 16px;
    padding: 14px 20px;
    background: rgba(143, 168, 184, 0.08);
    border-radius: 6px;
    border-top: 2px solid #8FA8B8;
    font-size: 18px;
    line-height: 1.5;
    display: flex;
    align-items: center;
  }
  .bottom-zone .label {
    font-weight: 600;
    color: #8FA8B8;
    margin-right: 12px;
    white-space: nowrap;
  }
</style>
</head>
<body>
  <h2>Slide Title</h2>
  <div class="top-zone">
    <div class="top-left">
      <p>Main content and analysis goes here. Describe the results, methodology, or key insight that this slide presents.</p>
    </div>
    <div class="top-right">
      <!-- Figure, table, or chart -->
      <svg width="380" height="280" viewBox="0 0 380 280">
        <!-- Chart/figure content -->
      </svg>
    </div>
  </div>
  <div class="bottom-zone">
    <span class="label">Supplementary:</span>
    <span>Additional context, ablation results, or comparison notes.</span>
  </div>
</body>
</html>
```

---

## 2. Color Palette — Morandi

The Morandi palette uses low-saturation, muted tones inspired by the Italian painter Giorgio Morandi. The palette conveys sophistication and academic rigor without visual distraction.

### Light Mode (`morandi-light`)

| Role | Name | Hex | Usage |
|------|------|-----|-------|
| Background | Warm Off-White | `#FAF8F5` | Slide/poster background |
| Text | Soft Black | `#3A3A3A` | Body text, headings |
| Emphasis | Warm Sand | `#C4A882` | Key terms, takeaways, accent lines |
| Blue | Dusty Blue | `#8FA8B8` | Technical elements, equations, references |
| Muted | Sage | `#A8B8A0` | Supporting info, captions, secondary text |
| Teal | Muted Teal | `#7FA8A0` | Callouts, special notes (use sparingly) |
| Gold | Antique Gold | `#C8B878` | Highlights, awards, important numbers |

### Dark Mode (`morandi-dark`)

| Role | Name | Hex | Usage |
|------|------|-----|-------|
| Background | Charcoal | `#2A2A2E` | Slide/poster background |
| Text | Warm White | `#E8E4E0` | Body text, headings |
| Emphasis | Warm Sand | `#D4B892` | Key terms, takeaways |
| Blue | Dusty Blue | `#9FB8C8` | Technical elements |
| Muted | Sage | `#B8C8B0` | Supporting info |
| Teal | Muted Teal | `#8FB8B0` | Callouts |
| Gold | Antique Gold | `#D8C888` | Highlights |

### Rules
- **Max 2-3 accent colors per slide** — choose based on content type
- Use **emphasis** for the single most important thing on the slide
- Use **blue** for technical/code elements and box borders
- Use **muted/sage** for captions, footnotes, and secondary labels
- Never use fully saturated colors (#FF0000, #0000FF, etc.)

---

## 3. Typography

### Font Stacks

Choose based on the `fontFamily` parameter:

| Parameter Value | CSS Font Stack |
|----------------|---------------|
| `palatino` | `'Palatino Linotype', 'Book Antiqua', Palatino, serif` |
| `inter` | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| `source-serif` | `'Source Serif 4', 'Source Serif Pro', Georgia, serif` |

### Scale (Slides)

| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| H1 (title slide) | 42px | 700 | 1.3 |
| H2 (slide title) | 34px | 600 | 1.3 |
| Body | 22px | 400 | 1.6 |
| Caption | 16px | 400 | 1.4 |
| Code | 18px | 400 (mono) | 1.5 |
| Footnote | 14px | 400 | 1.4 |

### Scale (Poster)

| Element | Size | Weight |
|---------|------|--------|
| Title | 72px | 700 |
| Section heading | 36px | 600 |
| Body | 24px | 400 |
| Caption | 18px | 400 |

### Code Font
Always use: `'Fira Code', 'Source Code Pro', 'Courier New', monospace`

---

## 4. Box Styles

Use these colored box styles for callouts, key insights, and grouped information:

```css
.box-blue {
  background: rgba(143, 168, 184, 0.15);
  border-left: 3px solid #8FA8B8;
  padding: 12px 16px;
  margin: 16px 0;
  border-radius: 4px;
}

.box-green {
  background: rgba(168, 184, 160, 0.15);
  border-left: 3px solid #A8B8A0;
  padding: 12px 16px;
  margin: 16px 0;
  border-radius: 4px;
}

.box-pink {
  background: rgba(196, 168, 130, 0.15);
  border-left: 3px solid #C4A882;
  padding: 12px 16px;
  margin: 16px 0;
  border-radius: 4px;
}

.box-beige {
  background: rgba(200, 184, 120, 0.15);
  border-left: 3px solid #C8B878;
  padding: 12px 16px;
  margin: 16px 0;
  border-radius: 4px;
}

.box-lavender {
  background: rgba(155, 143, 191, 0.15);
  border-left: 3px solid #9B8FBF;
  padding: 12px 16px;
  margin: 16px 0;
  border-radius: 4px;
}
```

### When to Use Each
- **box-blue** — Technical details, equations, code context
- **box-green** — Results, positive outcomes, confirmations
- **box-pink** — Key takeaways, important conclusions
- **box-beige** — Highlights, awards, notable numbers
- **box-lavender** — Theoretical notes, proofs, formal statements

---

## 5. SVG Figure Generation

When generating figures (architecture diagrams, pipeline flows, comparison charts), use inline SVG that matches the Morandi palette.

### SVG Guidelines

1. **Colors**: Only use colors from the Morandi palette. Map diagram elements:
   - Input/data nodes → dusty blue (`#8FA8B8`)
   - Processing/model nodes → warm sand (`#C4A882`)
   - Output/result nodes → sage (`#A8B8A0`)
   - Connections/arrows → soft black (`#3A3A3A` at 60% opacity)
   - Labels → soft black (`#3A3A3A`)
   - Background fills → palette color at 15% opacity

2. **Sizing**: SVGs should be sized to fit within the slide layout:
   - Left-Right Split right panel: max 460×480px
   - Three-Zone right panel: max 380×320px
   - Full-width figure: max 1100×500px

3. **Style**:
   - Rounded rectangles (`rx="6"`) for nodes
   - 2px stroke width for borders
   - Arrow markers for directed connections
   - Font: use the selected font family at 16px for labels

4. **Example: Architecture Diagram**
```svg
<svg width="440" height="300" viewBox="0 0 440 300" xmlns="http://www.w3.org/2000/svg">
  <!-- Input -->
  <rect x="10" y="120" width="100" height="50" rx="6"
        fill="rgba(143,168,184,0.15)" stroke="#8FA8B8" stroke-width="2"/>
  <text x="60" y="150" text-anchor="middle" fill="#3A3A3A"
        font-family="Palatino Linotype, serif" font-size="16">Input</text>

  <!-- Arrow -->
  <line x1="110" y1="145" x2="160" y2="145"
        stroke="#3A3A3A" stroke-opacity="0.6" stroke-width="2"
        marker-end="url(#arrow)"/>

  <!-- Encoder -->
  <rect x="160" y="120" width="120" height="50" rx="6"
        fill="rgba(196,168,130,0.15)" stroke="#C4A882" stroke-width="2"/>
  <text x="220" y="150" text-anchor="middle" fill="#3A3A3A"
        font-family="Palatino Linotype, serif" font-size="16">Encoder</text>

  <!-- Arrow -->
  <line x1="280" y1="145" x2="330" y2="145"
        stroke="#3A3A3A" stroke-opacity="0.6" stroke-width="2"
        marker-end="url(#arrow)"/>

  <!-- Output -->
  <rect x="330" y="120" width="100" height="50" rx="6"
        fill="rgba(168,184,160,0.15)" stroke="#A8B8A0" stroke-width="2"/>
  <text x="380" y="150" text-anchor="middle" fill="#3A3A3A"
        font-family="Palatino Linotype, serif" font-size="16">Output</text>

  <!-- Arrow marker definition -->
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#3A3A3A" fill-opacity="0.6"/>
    </marker>
  </defs>
</svg>
```

---

## 6. HTML-to-PDF Rendering

Use Playwright headless Chromium for all HTML-to-PDF conversions.

### Slides → PDF

Each HTML slide is a separate file. Combine into a single PDF:

```bash
# Install Playwright if needed
npx playwright install chromium

# Render individual slides to PDF pages
node -e "
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const slideDir = './output/slides';
  const files = fs.readdirSync(slideDir)
    .filter(f => f.endsWith('.html'))
    .sort();

  for (const file of files) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('file://' + path.resolve(slideDir, file));
    await page.pdf({
      path: path.join(slideDir, file.replace('.html', '.pdf')),
      width: '1280px',
      height: '720px',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    await page.close();
  }

  await browser.close();
})();
"
```

After generating individual PDFs, merge them:

```bash
# Merge PDFs using Playwright (generate all pages in one pass)
node -e "
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const slideDir = './output/slides';
  const files = fs.readdirSync(slideDir)
    .filter(f => f.endsWith('.html'))
    .sort();

  // Create a combined HTML that includes all slides as pages
  let combinedHtml = '<!DOCTYPE html><html><head><style>';
  combinedHtml += '@page { size: 1280px 720px; margin: 0; }';
  combinedHtml += '.slide { width: 1280px; height: 720px; page-break-after: always; overflow: hidden; position: relative; }';
  combinedHtml += '</style></head><body>';

  for (const file of files) {
    const content = fs.readFileSync(path.join(slideDir, file), 'utf-8');
    // Extract body content and styles from each slide
    const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const styleMatch = content.match(/<style>([\s\S]*?)<\/style>/i);
    if (bodyMatch) {
      combinedHtml += '<div class=\"slide\">';
      if (styleMatch) combinedHtml += '<style>' + styleMatch[1] + '</style>';
      combinedHtml += bodyMatch[1];
      combinedHtml += '</div>';
    }
  }
  combinedHtml += '</body></html>';

  const page = await browser.newPage();
  await page.setContent(combinedHtml, { waitUntil: 'networkidle' });
  await page.pdf({
    path: path.join(slideDir, 'slides.pdf'),
    width: '1280px',
    height: '720px',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  await page.close();
  await browser.close();
  console.log('Combined PDF saved to slides.pdf');
})();
"
```

### Poster → PDF

```bash
node -e "
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // A0 dimensions: 841mm × 1189mm (portrait) or 1189mm × 841mm (landscape)
  const orientation = 'portrait'; // or 'landscape'
  const width = orientation === 'portrait' ? '841mm' : '1189mm';
  const height = orientation === 'portrait' ? '1189mm' : '841mm';

  await page.goto('file://' + path.resolve('./output/poster/poster.html'));
  await page.pdf({
    path: './output/poster/poster.pdf',
    width,
    height,
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  await page.close();
  await browser.close();
  console.log('Poster PDF saved');
})();
"
```

---

## 7. Blog Post Format

### Markdown Structure

```markdown
# [Paper Title]: [Catchy Subtitle]

*A [detailed/succinct] summary of [Paper Title] by [Authors]*

---

## TL;DR

[2-3 sentence summary of the paper's key contribution]

## Motivation

[Why this work matters. What problem exists in the field.]

## Approach

[Description of the methodology. Include key equations:]

$$
\mathcal{L}(\theta) = \sum_{i=1}^{N} \log p(x_i | \theta)
$$

[Explain the equation in plain English.]

## Key Results

[Main experimental findings with specific numbers:]

| Method | Accuracy | F1 Score |
|--------|----------|----------|
| Baseline | 78.3% | 0.76 |
| **Proposed** | **84.7%** | **0.83** |

## Discussion

[Implications, limitations, and future directions.]

## References

1. Author et al., "Title," Conference, Year. [arXiv:XXXX.XXXXX](https://arxiv.org/abs/XXXX.XXXXX)
```

### Detailed vs. Succinct

- **Detailed** (~2000-4000 words): Full methodology walkthrough with equations, multiple figures, ablation analysis, and comprehensive references. Include code snippets if GitHub repo is available.
- **Succinct** (~800-1500 words): Focus on motivation, key contribution, and main results. One equation max. Skip ablations.

---

## 8. Poster Format

### HTML CSS Grid Layout

#### Portrait (3 columns, A0: 841mm × 1189mm)

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 841mm;
    height: 1189mm;
    font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
    background: #FAF8F5;
    color: #3A3A3A;
    padding: 30mm;
  }

  .poster-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: auto 1fr;
    gap: 20mm;
    height: 100%;
  }

  .header {
    grid-column: 1 / -1;
    text-align: center;
    padding-bottom: 20mm;
    border-bottom: 3px solid #C4A882;
  }

  .header h1 {
    font-size: 72px;
    font-weight: 700;
    margin-bottom: 12px;
  }

  .header .authors {
    font-size: 32px;
    color: #8FA8B8;
  }

  .section {
    background: white;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }

  .section h2 {
    font-size: 36px;
    font-weight: 600;
    margin-bottom: 16px;
    color: #3A3A3A;
    border-bottom: 2px solid #8FA8B8;
    padding-bottom: 8px;
  }

  .section p, .section li {
    font-size: 24px;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <div class="poster-grid">
    <div class="header">
      <h1>Paper Title</h1>
      <p class="authors">Author A, Author B — University Name</p>
    </div>
    <!-- Content sections fill the 3-column grid -->
    <div class="section">
      <h2>Motivation</h2>
      <p>Content...</p>
    </div>
    <div class="section">
      <h2>Method</h2>
      <p>Content...</p>
    </div>
    <div class="section">
      <h2>Results</h2>
      <p>Content...</p>
    </div>
    <!-- More sections as needed -->
  </div>
</body>
</html>
```

#### Landscape (4 columns, A0: 1189mm × 841mm)

Same structure but with `grid-template-columns: 1fr 1fr 1fr 1fr` and swapped width/height dimensions.

---

## 9. Content Narrative Arc

All deliverables follow this structure, adapted for format:

1. **Motivation** (Hook) — Why should the audience care? What gap exists?
   - Slides: 1-2 slides
   - Blog: 1-2 paragraphs
   - Poster: 1 section

2. **Methodology** — What is the proposed approach?
   - Slides: 4-8 slides (most detail), use Left-Right Split and Three-Zone layouts
   - Blog: Detailed section with equations and figures
   - Poster: 1-2 sections with key diagram

3. **Results** — Does it work? Quantitative evidence.
   - Slides: 3-5 slides with tables/charts in Three-Zone layout
   - Blog: Tables and charts with analysis
   - Poster: 1-2 sections with key result table

4. **Discussion** — Implications, limitations, future work.
   - Slides: 1-2 slides
   - Blog: 1-2 paragraphs
   - Poster: 1 section

---

## 10. Multi-Paper Handling

When multiple papers are provided:

1. **Shared Analysis Phase**: Each paper is analyzed independently in parallel branches
2. **Emphasis Weighting**: If `customRequirements` specifies relative emphasis, allocate proportional space
3. **Overarching Story**: When generating deliverables for multiple related papers:
   - Identify the common thread or progression
   - Use consistent terminology across all deliverables
   - Cross-reference between papers where relevant
   - In slides, add a "Landscape" slide showing how papers relate

---

## 11. Quality Checklist

Before marking any deliverable as complete, verify:

### Slides
- [ ] One idea per slide — no information overload
- [ ] Max 6-8 bullet points per Full Bullet slide
- [ ] Every equation has a plain-English annotation
- [ ] Figures use SVG with Morandi palette colors
- [ ] Max 2-3 accent colors per slide
- [ ] Title slide has paper title, authors, and affiliation
- [ ] Section dividers introduce each major topic
- [ ] HTML is self-contained (no external CSS/JS dependencies)
- [ ] Playwright renders clean PDF without clipping or overflow

### Blog Post
- [ ] TL;DR at the top (2-3 sentences)
- [ ] All claims backed by specific numbers from the paper
- [ ] Proper citation format with arXiv/DOI links
- [ ] Equations have accompanying plain-English explanation
- [ ] Tables are properly formatted Markdown
- [ ] Word count matches style parameter (detailed: 2000-4000, succinct: 800-1500)

### Poster
- [ ] Fits single A0 page without overflow
- [ ] Header spans full width with title and authors
- [ ] CSS grid layout matches orientation (3-col portrait, 4-col landscape)
- [ ] Text is readable at poster viewing distance (24px+ body, 36px+ headings)
- [ ] Key figure/diagram is prominent and legible
- [ ] QR code or URL to paper/code included
