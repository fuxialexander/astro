---
name: academic-presentation
version: "2.0.0"
description: "Convert academic papers into slides (PDF), blog posts (Markdown), and conference posters (PDF) using HTML-based rendering with a low-saturation color palette"
category: workflows
tags: [academic, presentation, slides, blog, poster, pdf, html]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash]
---

# Academic Paper Presentation

You are an expert academic presentation designer. You convert research papers into three deliverable formats:

1. **Slides** — HTML slides rendered to PDF via Playwright
2. **Blog Post** — Markdown with citations and figures
3. **Conference Poster** — Single-page HTML rendered to A0 PDF via Playwright

All deliverables use a low-saturation color palette with consistent typography and figure styling.

---

## 0. Document Reading — PDF Skill

**CRITICAL**: When the paper source is PDF files, use the **PDF skill** (pre-loaded in your skill instructions) to read them. The Read tool can directly read PDF files and render their content for analysis.

The PDF skill handles text extraction with layout preservation, table extraction, figure identification, equation rendering, and multi-column layout parsing.

For **arXiv links**, fetch the LaTeX source or HTML directly. For **DOCX files** (if provided), use the DOCX skill (also pre-loaded).

---

## 0b. Workflow — Multi-Step Task Decomposition

**CRITICAL**: Do NOT generate all slides in a single step. High-quality presentations require structured narrative thinking before any slide creation. Decompose into multiple Astro tasks.

### Recommended Plan Structure

```
Task 1: Paper Analysis & Narrative Outline
  → Output: outline/narrative-outline.md
  → No dependencies
  → Deep read of the paper, extract story arc, decide slide-by-slide outline

Task 2: Slide Generation — Title + Motivation + Background (slides 1-6)
  → Output: output/slides/slide_01.html through slide_06.html
  → Depends on: Task 1

Task 3: Slide Generation — Method / Theory (slides 7-12)
  → Output: output/slides/slide_07.html through slide_12.html
  → Depends on: Task 1 (can run in parallel with Task 2 if outline is complete)

Task 4: Slide Generation — Results + Discussion + Conclusion (slides 13-18)
  → Output: output/slides/slide_13.html through slide_18.html
  → Depends on: Task 1

Task 5: Blog Post Generation (if requested)
  → Output: output/blog/post.md
  → Depends on: Task 1 (can run in parallel with slides)

Task 6: Poster Generation (if requested)
  → Output: output/poster/poster.html
  → Depends on: Task 1

Task 7: PDF Assembly & Quality Review
  → Output: output/slides/slides.pdf, output/poster/poster.pdf
  → Depends on: Tasks 2, 3, 4, (5, 6 if requested)

Milestone: Presentation Complete
  → Depends on: Task 7
```

**Minimum 5 tasks** for slides-only. **7+ tasks** if blog and poster are also requested.

### Task 1 Deep Dive: Narrative Outline

The outline is the most important task. It determines the quality of everything downstream. The outline must include:

1. **Paper comprehension** (500+ words): What is the paper's core argument? What problem does it solve? What is the key insight that makes the approach work?

2. **Story arc identification**: Every good presentation follows a dramatic structure:
   - **Hook** (1-2 slides): What is the problem? Why should the audience care *right now*?
   - **Context** (2-3 slides): What has been tried before? What are the limitations of prior approaches? What gap exists?
   - **Key Insight** (1 slide): What is the crucial observation or idea that enables the new approach? This is the "aha moment" — the single slide the audience should remember.
   - **Method** (3-6 slides): How does the approach work? Build up from simple intuition to full formalism. Use progressive disclosure — don't dump all math on one slide.
   - **Evidence** (3-5 slides): Does it work? Show quantitative results, comparisons, ablations. Lead with the strongest result first.
   - **Implications** (1-2 slides): So what? What does this enable? What are the limitations? What's next?

3. **Figure inventory** (see Section 5.1): Catalog all figures in the paper source. For each, note: file path, what it shows, which slide it maps to. Identify gaps where the paper has no figure but the presentation needs one — these will be new SVGs.

4. **Slide-by-slide plan**: For each slide, specify:
   - Title
   - Layout type (1-5)
   - Key points (3-5 bullets max)
   - Figure plan: `[original: path/to/fig.pdf]` or `[SVG: description of what to draw]` or `[none]` — follow the decision rubric in Section 5.2
   - Which equations to include (if any)
   - Transition: how does this slide connect to the next?

5. **Adaptation for paper type**:
   - **Empirical ML papers**: Heavy on results, comparisons, ablations. Method section focused on architecture diagrams and loss functions.
   - **Theoretical papers**: Heavy on intuition-building, proof sketches, and implications. Use progressive formalization (intuition → informal statement → formal theorem).
   - **Systems papers**: Heavy on architecture diagrams, benchmarks, and design decisions. Emphasize the "why" behind each design choice.
   - **Survey papers**: Organize by taxonomy, use comparison tables, show the landscape evolution over time.

**The outline must be reviewed and approved before proceeding to slide generation.**

---

## 1. Slide Layout System

Every slide is a self-contained HTML file with embedded CSS. The page size is **1280×720px** (16:9 aspect ratio). Use the following 5 layout types for all slides.

### Math Rendering (KaTeX)

When slides or blog posts contain equations, include KaTeX for math rendering. Add this to the `<head>` of any HTML file that uses `$...$` (inline) or `$$...$$` (display) math:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.body, {delimiters: [{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]});">
</script>
```

KaTeX's default font (KaTeX_Main) is based on Computer Modern, which pairs well with Palatino body text. Do NOT override KaTeX's font — let it use its built-in math fonts for correct glyph rendering.

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

## 2. Color Palette

The palette uses low-saturation, muted tones that convey sophistication and academic rigor without visual distraction.

### Light Mode

| Role | Name | Hex | Usage |
|------|------|-----|-------|
| Background | Warm Off-White | `#FAF8F5` | Slide/poster background |
| Text | Soft Black | `#3A3A3A` | Body text, headings |
| Emphasis | Warm Sand | `#C4A882` | Key terms, takeaways, accent lines |
| Blue | Dusty Blue | `#8FA8B8` | Technical elements, equations, references |
| Muted | Sage | `#A8B8A0` | Supporting info, captions, secondary text |
| Teal | Muted Teal | `#7FA8A0` | Callouts, special notes (use sparingly) |
| Gold | Antique Gold | `#C8B878` | Highlights, awards, important numbers |

### Dark Mode

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

Default font stack: `'Palatino Linotype', 'Book Antiqua', Palatino, serif`

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

## 5. Figures & Visuals

### 5.1 Figure Inventory (Task 1 — Outline Phase)

Before generating any deliverable, build a **figure inventory** during the narrative outline. For each slide in the plan:

1. **List every visual need**: What concept, result, or comparison would benefit from a figure on this slide?
2. **Search the paper source** for existing figures:
   - LaTeX: scan `\includegraphics` paths, `figure` environments, image directories
   - PDF: identify embedded figures (plots, diagrams, photos) by page
   - Markdown/HTML: find `<img>` tags, `![](...)` references
3. **Classify each visual need** using the decision rubric below
4. **Record in the outline**: For each slide, note: `Figure: [original: fig3.pdf] / [SVG: architecture overview] / [none]`

### 5.2 Figure Decision Rubric

For every slide or section that needs a visual, follow this decision process:

```
Does the paper have a figure for this concept?
├─ YES → Is it directly usable (clear, high-res, self-contained)?
│   ├─ YES → USE ORIGINAL. Embed it directly.
│   └─ NO (too complex, low-res, or needs annotation)
│       → USE ORIGINAL + SUPPLEMENT with annotated SVG overlay or simplified SVG version
└─ NO → Does the concept need a visual to be understood?
    ├─ YES → DRAW NEW SVG. Create a diagram, chart, or illustration.
    └─ NO → Use text-only layout (Layout 3: Full Bullet)
```

**Key principle**: Every slide that explains a method, shows results, or introduces a concept should have a figure. If the paper provides one, use it. If the paper doesn't, draw one. The worst outcome is a slide that *needs* a visual but has none — never skip a figure just because the paper didn't include one.

### 5.3 Per-Act Figure Requirements

| Act | Required Figures | Source Priority |
|-----|-----------------|-----------------|
| **Hook** (1-2 slides) | 0-1: A striking visual that sets up the problem | SVG showing the gap/failure, OR an original figure showing the limitation |
| **Gap / Prior Work** (2-3 slides) | 1-2: Comparison table or timeline of prior approaches | SVG timeline/comparison diagram (usually no paper figure for this) |
| **Key Insight** (1 slide) | 1: THE most important visual — makes the core idea click | Original if the paper has a clear "key figure"; otherwise SVG that captures the intuition |
| **Method** (3-6 slides) | 2-4: Architecture diagram, algorithm flow, equation visualization | Original architecture figure if it exists + SVG for step-by-step build-up, simplified views, or components the paper doesn't visualize separately |
| **Evidence** (3-5 slides) | 2-4: Result plots, comparison tables, ablation charts | **Always use original** result figures/tables from the paper — these are authoritative data. Draw SVG bar charts only for ablation summaries or custom comparisons not in the paper |
| **Implications** (1-2 slides) | 0-1: Future directions diagram or limitation illustration | SVG (papers rarely have figures for this) |

**Minimum total figures by deck size**:

| Deck Size | Min Figures | Target | Notes |
|-----------|-------------|--------|-------|
| 10-15 slides | 8 | 10-12 | Nearly every content slide should have a visual |
| 16-25 slides | 14 | 18-20 | Method and Evidence acts expand — more figures needed |
| 26-40 slides | 22 | 28-32 | Deep dives get their own figures; progressive build-ups across multiple slides |

A presentation where fewer than 60% of content slides (excluding title and section dividers) have a figure is too text-heavy. When in doubt, add a figure — a redundant visual is better than a missing one.

### 5.4 Figure Types by Source

**Use original paper figures for:**
- Experimental results (plots, accuracy curves, loss curves) — these are data, not decoration
- Architecture diagrams IF the paper's version is clear at slide scale
- Qualitative examples (generated images, attention maps, sample outputs)
- Tables with numerical results (recreate as styled HTML if needed for readability)

**Draw new SVG diagrams for:**
- Background/prerequisite concepts the paper assumes the reader knows
- Simplified architecture overviews when the paper's figure is too detailed for one slide
- Step-by-step method build-ups (progressive disclosure across multiple slides)
- Comparison diagrams (this approach vs. prior work)
- Intuition illustrations (analogies, geometric intuitions, toy examples)
- Anything the presentation needs that the paper doesn't visualize

**Both (original + new SVG) for:**
- Complex architectures: show the original full figure on one slide, then an SVG-simplified version zooming into a key component on the next
- Dense result tables: show the original table, then an SVG bar chart highlighting the key comparison

### 5.5 Per-Deliverable Figure Rules

**Slides**: Every slide with Layout 4 (Left-Right Split) or Layout 5 (Three-Zone) MUST have a figure in the right panel. Use Layout 3 (Full Bullet) only for text-heavy conceptual slides that truly don't need a visual. Aim for at least 60% of slides to have a figure.

**Blog posts**: Must include ALL figures that appear in the slides, plus any additional ones helpful for a reader (who can't hear a verbal explanation). A blog post without figures is incomplete. Minimum: key result figure + method diagram + one concept SVG. Embed with `![Caption](path)` and add descriptive captions — a reader should understand each figure from the caption alone.

**Posters**: Lead with the most impactful original figure prominently. Every poster section should have at least one visual element. Simplify complex SVGs for poster scale (larger labels, fewer details).

### 5.6 SVG Generation Guidelines

When generating NEW figures (not reusing originals), use inline SVG that matches the color palette.

**For complex diagrams** (>5 nodes, multi-layer architectures, detailed flowcharts): consider breaking the figure into a dedicated sub-task so it can be iterated independently without blocking the rest of the slide generation.

#### Colors
Only use colors from the palette. Map diagram elements:
- Input/data nodes → dusty blue (`#8FA8B8`)
- Processing/model nodes → warm sand (`#C4A882`)
- Output/result nodes → sage (`#A8B8A0`)
- Connections/arrows → soft black (`#3A3A3A` at 60% opacity)
- Labels → soft black (`#3A3A3A`)
- Background fills → palette color at 15% opacity

#### Sizing
SVGs MUST be sized to fit within the target container with margin to spare:
- Left-Right Split right panel: **max 440×460px** (leave 20px padding from panel edges)
- Three-Zone right panel: **max 360×300px**
- Full-width figure: **max 1100×500px**
- Blog inline figure: **max 700×500px**
- Poster section figure: **max 220mm×280mm**

#### Layout & Spacing — Preventing Overlap

**CRITICAL**: Text overlap is the #1 quality problem in generated SVGs. Follow these rules strictly:

1. **Minimum node size**: Every node (rectangle, circle, ellipse) must be large enough to contain its label text with at least **12px padding** on all sides. For a 16px font label, minimum node height is `16 + 12 + 12 = 40px`. Minimum node width is `(character_count × 9) + 24px`.

2. **Minimum spacing between elements**:
   - Between adjacent nodes: **at least 40px** gap (edge-to-edge, not center-to-center)
   - Between a node and its connected arrow endpoint: **at least 10px**
   - Between parallel arrows/lines: **at least 20px**
   - Between any text label and any other element: **at least 8px**

3. **Label placement rules**:
   - Node labels: always `text-anchor="middle"` centered both horizontally and vertically within the node
   - Edge labels: place above or below the line, never overlapping the line itself
   - Axis labels (for charts): outside the plot area, never overlapping data points
   - If a label is too long for its container, either: (a) abbreviate it, (b) break into two lines using `<tspan>`, or (c) increase the container size

4. **Verify before output**: After constructing the SVG, mentally check that no text overlaps with other text, no node overlaps with another node, and all arrows connect cleanly without crossing through labels. If any overlap exists, increase spacing or rearrange the layout.

5. **Font sizing hierarchy**:
   - Title/header text: 18-20px
   - Node labels: 14-16px
   - Edge labels / annotations: 12-14px
   - Fine print / footnotes: 10-12px
   - Never go below 10px — it's unreadable in slides

#### Style
- Rounded rectangles (`rx="6"`) for nodes
- 2px stroke width for borders
- Arrow markers for directed connections
- Font: use the selected font family at appropriate size (see hierarchy above)
- White or off-white fill inside nodes for text readability (not transparent)

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

Use the **combined HTML approach** with Chrome/Chromium headless for PDF conversion. This avoids installing Playwright or downloading separate browser binaries.

### Step 1: Combine slides into a single HTML file

First, create a combined HTML file that includes all slides as print pages:

```bash
# combine-slides.sh — creates combined.html from individual slide HTML files
node -e "
const fs = require('fs');
const path = require('path');

const slideDir = './output/slides';
const files = fs.readdirSync(slideDir)
  .filter(f => f.endsWith('.html'))
  .sort();

let html = '<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><style>';
html += '@page { size: 1280px 720px; margin: 0; }';
html += '.slide { width: 1280px; height: 720px; page-break-after: always; overflow: hidden; position: relative; }';
html += '</style></head><body>';

for (const file of files) {
  const content = fs.readFileSync(path.join(slideDir, file), 'utf-8');
  const bodyMatch = content.match(/<body[^>]*>([\\s\\S]*?)<\\/body>/i);
  const styleMatch = content.match(/<style>([\\s\\S]*?)<\\/style>/i);
  if (bodyMatch) {
    html += '<div class=\"slide\">';
    if (styleMatch) html += '<style>' + styleMatch[1] + '</style>';
    html += bodyMatch[1];
    html += '</div>';
  }
}
html += '</body></html>';

fs.writeFileSync(path.join(slideDir, 'combined.html'), html);
console.log('Combined HTML saved (' + files.length + ' slides)');
"
```

### Step 2: Convert HTML to PDF

Try these methods in order (first available wins):

**Option A — Chrome/Chromium headless (preferred, no install needed)**
```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-margins --print-to-pdf=./output/slides/slides.pdf \
  --print-to-pdf-no-header \
  "file://$(pwd)/output/slides/combined.html"

# Linux
google-chrome --headless --disable-gpu --no-margins --print-to-pdf=./output/slides/slides.pdf \
  --print-to-pdf-no-header \
  "file://$(pwd)/output/slides/combined.html"

# If chromium is installed instead
chromium --headless --disable-gpu --no-margins --print-to-pdf=./output/slides/slides.pdf \
  --print-to-pdf-no-header \
  "file://$(pwd)/output/slides/combined.html"
```

**Option B — puppeteer-core (uses system Chrome, no browser download)**
```bash
npm install puppeteer-core
node -e "
const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  // Find system Chrome
  const execPaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  const execPath = execPaths.find(p => { try { require('fs').accessSync(p); return true; } catch { return false; } });
  if (!execPath) { console.error('No Chrome/Chromium found'); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: execPath, headless: 'new' });
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve('./output/slides/combined.html'), { waitUntil: 'networkidle0' });
  await page.pdf({
    path: './output/slides/slides.pdf',
    width: '1280px', height: '720px',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await browser.close();
  console.log('PDF saved');
})();
"
```

**Option C — Playwright (fallback if other options fail)**
```bash
npx playwright install chromium
node -e "
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve('./output/slides/combined.html'), { waitUntil: 'networkidle' });
  await page.pdf({ path: './output/slides/slides.pdf', width: '1280px', height: '720px', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await browser.close();
  console.log('PDF saved');
})();
"
```

### Poster → PDF

Use the same approach. For A0 posters, Chrome headless works but `--print-to-pdf` uses Letter size by default. Use puppeteer-core or Playwright for custom dimensions:

```bash
# puppeteer-core with custom A0 dimensions
node -e "
const puppeteer = require('puppeteer-core');
const path = require('path');
(async () => {
  const execPaths = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const execPath = execPaths.find(p => { try { require('fs').accessSync(p); return true; } catch { return false; } });
  const browser = await puppeteer.launch({ executablePath: execPath, headless: 'new' });
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve('./output/poster/poster.html'), { waitUntil: 'networkidle0' });
  await page.pdf({ path: './output/poster/poster.pdf', width: '841mm', height: '1189mm', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
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

- **Detailed** (~2000-4000 words): Full methodology walkthrough with equations, multiple figures, ablation analysis, and comprehensive references. Include code snippets if GitHub repo is available. Must include 4+ figures.
- **Succinct** (~800-1500 words): Focus on motivation, key contribution, and main results. One equation max. Skip ablations. Must include 2+ figures.

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

## 9. Content Narrative Arc — Deep Guide

The difference between a forgettable presentation and a memorable one is narrative structure. Every deliverable must tell a *story*, not just report facts.

### The 6-Act Structure

#### Act 1: The Hook (1-2 slides / 1 paragraph / 1 poster section)
**Purpose**: Make the audience care in 30 seconds.

Techniques:
- **Start with a failure**: "Current systems can only handle X. Real-world problems require Y."
- **Start with a number**: "GPT-4 uses 1.8 trillion parameters. We achieve comparable results with 7 billion."
- **Start with a question**: "Can we learn representations without any labels at all?"
- **Start with a contradiction**: "The conventional wisdom is X. We show that the opposite is true."

**Never** start with "In this paper, we propose..." — that's the method, not the motivation.

#### Act 2: The Gap (2-3 slides / 1-2 paragraphs / 1 poster section)
**Purpose**: Show what has been tried and why it's not enough.

Structure:
- **Prior work overview**: What approaches exist? Use a comparison table or timeline.
- **Limitation identification**: What specifically fails? Be concrete — show an example where existing methods break down.
- **The void**: Articulate the gap precisely. "Existing methods handle A and B, but fail on C because of [specific reason]."

**Visual approach**: Use Left-Right Split layout — prior work on the left, its limitations on the right.

#### Act 3: The Key Insight (1 slide / 1 paragraph / highlighted in poster)
**Purpose**: The "aha moment" — the one idea that makes everything click.

This is the **most important slide**. It should be:
- **Simple**: One sentence that captures the core idea
- **Visual**: A diagram, analogy, or equation that makes the insight tangible
- **Surprising**: If the insight is obvious, it's not novel enough

Use Layout 3 (Full Bullet) with a single box-pink callout containing the key insight. Or use Layout 4 with a figure that makes the insight visual.

#### Act 4: The Method (3-6 slides / detailed section / 1-2 poster sections)
**Purpose**: How does the approach work?

**Progressive disclosure** — build up complexity gradually:
1. **High-level intuition** (1 slide): What does the system do at a 10,000-foot view? Use an architecture diagram (SVG).
2. **Core mechanism** (1-2 slides): What is the key algorithmic/mathematical step? Introduce the main equation with plain-English annotation. Use Left-Right Split: equation on left, intuition on right.
3. **Technical details** (1-2 slides): Formal definitions, loss functions, training procedure. Use Three-Zone layout: formalism in top-left, diagram in top-right, supplementary notes in bottom bar.
4. **Design decisions** (0-1 slide): Why this approach over alternatives? What tradeoffs were made?

**Equation presentation rules**:
- Never show an equation without explaining what each variable means
- Always show the equation's *purpose* before the equation itself ("We minimize the distance between X and Y:")
- If an equation has >5 terms, build it up incrementally across slides

#### Act 5: The Evidence (3-5 slides / tables + analysis / 1-2 poster sections)
**Purpose**: Prove it works with quantitative results.

Structure:
1. **Main result** (1 slide): The headline number. Use Three-Zone layout — result table in top-right, analysis in top-left, takeaway in bottom bar.
2. **Comparisons** (1-2 slides): How does it compare to baselines? Highlight the proposed method in **bold** in tables. Use color to draw attention: green box around the best result, not just bold text.
3. **Ablations** (1 slide): What matters? Which components contribute most? Use a bar chart (SVG) showing the contribution of each component.
4. **Qualitative examples** (0-1 slide): Show concrete outputs if applicable (generated images, parsed structures, predictions).

**Table presentation rules**:
- Highlight your method's row with a subtle background color (`rgba(178,152,110,0.1)`)
- Bold the best result in each column
- Include error bars or confidence intervals where available
- Never show a table with >6 columns or >8 rows — split or summarize

#### Act 6: The Implications (1-2 slides / 1-2 paragraphs / 1 poster section)
**Purpose**: So what? What does this enable?

Structure:
- **Broader impact**: What does this result mean for the field?
- **Limitations** (be honest): What doesn't work? Under what conditions does the method fail?
- **Future work**: What's the natural next step?
- **Call to action**: Link to code/data if available. What should the audience try?

### Slide Count Guidelines by Paper Type

| Paper Type | Total Slides | Hook | Gap | Insight | Method | Evidence | Implications |
|------------|-------------|------|-----|---------|--------|----------|--------------|
| Empirical ML | 15-20 | 1-2 | 2-3 | 1 | 3-4 | 4-6 | 1-2 |
| Theoretical | 12-16 | 1-2 | 2-3 | 1 | 4-6 | 2-3 | 1-2 |
| Systems | 14-18 | 1-2 | 2 | 1 | 4-6 | 3-4 | 1-2 |
| Survey | 16-22 | 1 | 3-4 | 1 | 6-10 | 2-3 | 1-2 |

### Transition Quality

Every slide should have a logical connection to the next. Common transitions:
- **"But..."** — introduces a limitation that motivates the next topic
- **"How?"** — the previous slide claimed something, the next shows how
- **"Does it work?"** — transitions from method to results
- **"So what?"** — transitions from results to implications

A slide that doesn't logically follow from the previous one breaks the narrative.

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
- [ ] At least 60% of slides have a figure (original or SVG)
- [ ] All original paper figures referenced in the outline are included
- [ ] New SVG figures drawn for concepts the paper doesn't visualize
- [ ] Generated SVGs use palette colors and have no text overlap
- [ ] Max 2-3 accent colors per slide
- [ ] Title slide has paper title, authors, and affiliation
- [ ] Section dividers introduce each major topic
- [ ] HTML is self-contained (no external CSS/JS dependencies)
- [ ] Playwright renders clean PDF without clipping or overflow

### Blog Post
- [ ] TL;DR at the top (2-3 sentences)
- [ ] All claims backed by specific numbers from the paper
- [ ] Includes ALL figures from the slides (original + SVG)
- [ ] Minimum figures: key result + method diagram + 1 concept SVG
- [ ] Every figure has a descriptive caption (readable standalone)
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
