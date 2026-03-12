---
name: daily-paper-analysis
version: "1.0.0"
description: "Analyze HuggingFace Daily Papers: produce an AI digest of all papers and in-depth analysis of top-N papers with figures, background, and LaTeX source extraction"
category: workflows
tags: [academic, papers, huggingface, arxiv, alphaxiv, daily, research, analysis]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash]
---

# HuggingFace Daily Paper Analysis

You are a senior research analyst producing two deliverables from HuggingFace Daily Papers:

1. **Daily Digest** — Summarizing ALL papers for the selected date
2. **In-Depth Analyses** — Individual documents for top-N papers (by upvotes), with thorough technical analysis, architecture figures, and background context

**Dual output format**: Every document is produced as both **styled HTML** (for PDF rendering and web viewing) and **Markdown** (Obsidian-compatible, with YAML frontmatter). PDFs are rendered from the HTML versions via Chrome headless.

All deliverables use the same low-saturation color palette and Palatino typography as the academic-presentation skill.

---

## 0. Workflow — Multi-Step Task Decomposition

**CRITICAL**: Do NOT attempt everything in a single task. Decompose into multiple Astro tasks with clear dependencies.

### Recommended Plan Structure

```
Task 1: Data Retrieval & Validation
  -> Output: data/daily-papers.json, data/paper-metadata.md
  -> No dependencies
  -> Fetch HF Daily Papers API, validate date has papers
  -> If no papers exist: report to user and STOP

Task 2: Daily Digest Generation
  -> Output: daily-digest-YYYY-MM-DD.{html,md,pdf}
  -> Depends on: Task 1
  -> Summarize ALL papers (HTML + Markdown + PDF)

Task 3: In-Depth Analysis — Papers 1-5
  -> Output: papers/01-paper-title-slug.{html,md} through 05-paper-title-slug.{html,md}
  -> Depends on: Task 1
  -> Fetch AlphaXiv overview + LaTeX source for each paper
  -> Generate architecture figures, produce HTML + Markdown per paper

Task 4: In-Depth Analysis — Papers 6-10
  -> Output: papers/06-paper-title-slug.{html,md} through 10-paper-title-slug.{html,md}
  -> Depends on: Task 1 (can run in parallel with Task 3)

Task 5: Additional Papers (if user-specified papers exist)
  -> Output: papers/extra-01-title.{html,md}, ...
  -> Depends on: Task 1
  -> Resolve user-specified links/titles, check if in daily papers
  -> Analyze regardless of origin

Task 6: Compilation & PDF Assembly
  -> Output: daily-papers-YYYY-MM-DD.{html,md,pdf}
  -> Depends on: Tasks 2, 3, 4, 5
  -> Combine all content into compiled HTML, Markdown, and PDF

Milestone: Analysis Complete
  -> Depends on: Task 6
```

**Minimum 4 tasks** (digest + one batch of papers + compilation). Scale to 6-8 tasks for larger batches or user-specified papers.

---

## 1. Data Retrieval

### 1.1 HuggingFace Daily Papers API

```bash
# Fetch daily papers for a specific date
curl -sL "https://huggingface.co/api/daily_papers?date=YYYY-MM-DD"
```

The API returns a JSON array. Each entry contains:
- `paper.id` — arXiv ID (e.g., "2501.12345")
- `paper.title` — Paper title
- `paper.summary` — Abstract
- `paper.authors[].name` — Author names
- `paper.upvotes` — Community upvotes (use for ranking)
- `publishedAt` — Publication timestamp
- `paper.ai_summary` — HuggingFace AI-generated TL;DR (~1-2 sentences, ~200 chars). Too shallow to drive in-depth analysis on its own, but valuable as a TL;DR seed for both the digest one-paragraph summary and the in-depth analysis TL;DR box.
- `paper.ai_keywords` — AI-generated keywords

**Date validation**: If the API returns an empty array `[]`, the date has no papers. This typically happens on weekends, holidays, or future dates. In this case:
1. Report to the user: "No HuggingFace Daily Papers found for YYYY-MM-DD. This date may be a weekend, holiday, or future date."
2. **STOP execution.** Do not proceed with empty data.

**Typical volume**: 24-49 papers per weekday. Rank by `upvotes` descending to select top-N for in-depth analysis.

### 1.2 AlphaXiv — AI-Generated Research Reports (Primary Source for In-Depth Analysis)

AlphaXiv provides two hidden markdown endpoints for arXiv papers. **Always follow redirects** (`-L` flag).

```bash
# AI-generated research overview (~16K chars, multi-section structured analysis)
curl -sL "https://alphaxiv.org/overview/ARXIV_ID.md"

# Full LaTeX source extracted as markdown
curl -sL "https://alphaxiv.org/abs/ARXIV_ID.md"
```

**The AlphaXiv overview is the primary data source for in-depth analysis.** Each overview is a ~16K-char structured report covering authors, context, methodology, results, and impact — far richer than the HF `ai_summary` (which is only ~200 chars / 1-2 sentences).

**Coverage**: ~80% of HuggingFace Daily Papers have AlphaXiv overviews. When an overview is unavailable (returns 404 or empty), fall back to:
1. The paper abstract from the API (`paper.summary`, ~1300 chars) — this is the primary fallback
2. Attempt to fetch the AlphaXiv full text (`/abs/ID.md`) which may still be available even without an overview
3. The HuggingFace `ai_summary` as a last resort for analysis depth (only ~200 chars — still useful as the TL;DR seed)
4. Note in the analysis: "AlphaXiv overview unavailable — analysis based on abstract and available sources"

**Important**: The AlphaXiv overview is a pre-built analysis — use it as high-quality source material, not as your final output. Your job is to synthesize, curate, and add value beyond what AlphaXiv provides (architecture figures, cross-paper connections, missing background context).

### 1.3 arXiv Direct Access

```bash
# Paper abstract page (HTML)
curl -sL "https://arxiv.org/abs/ARXIV_ID"

# PDF direct link (do NOT download unless needed)
# https://arxiv.org/pdf/ARXIV_ID

# LaTeX source (tar.gz) — only if AlphaXiv /abs/ endpoint fails
curl -sL "https://arxiv.org/e-print/ARXIV_ID" -o paper.tar.gz
tar xzf paper.tar.gz
```

### 1.4 Resolving User-Specified Papers

Users may provide additional papers via links or titles. Resolve them in this order:

1. **arXiv link** (e.g., `https://arxiv.org/abs/2501.12345`) — extract the ID directly
2. **GitHub link** (e.g., `https://github.com/author/repo`) — look for arXiv links in the README, or search the HF Daily Papers by repo name
3. **Paper title** — search the HF Daily Papers list for a title match; if not found, search arXiv
4. **HuggingFace paper link** (e.g., `https://huggingface.co/papers/2501.12345`) — extract the ID

After resolving, determine:
- **Is it in today's Daily Papers?** Check against the fetched list by arXiv ID
- **If not**: Mark clearly in the analysis header as "User-requested paper (not in HF Daily Papers for YYYY-MM-DD)" but still perform full analysis

---

## 2. Daily Digest — All Papers Summary

The digest summarizes every paper from the day. It serves as a quick-scan reference. Produce as:
- **HTML**: Styled with color palette and box styles (self-contained CSS)
- **Markdown**: Obsidian-compatible with YAML frontmatter (date, paper count, tags)
- **PDF**: Rendered from the HTML via Chrome headless

### 2.1 Digest Structure

For each paper, include:
1. **Title** (linked to arXiv)
2. **Authors** (first 3, then "et al.")
3. **Upvotes** badge
4. **Keywords** (from `ai_keywords`)
5. **One-paragraph summary** — Synthesize the abstract (and `ai_summary` as a TL;DR seed) into a 3-5 sentence summary. Focus on: what problem, what approach, what result.
6. **Key contribution** — Single bold sentence highlighting the main takeaway
7. **Links**: arXiv, PDF, GitHub (if available), HuggingFace paper page

### 2.2 Digest Grouping

Group papers by research area (inferred from `ai_keywords`):
- **Language Models & NLP**
- **Computer Vision & Multimodal**
- **Reinforcement Learning & Agents**
- **Audio, Speech & Music**
- **Science & Mathematics**
- **Systems & Infrastructure**
- **Other**

Within each group, sort by upvotes descending. Show the group count in the section header.

---

## 3. In-Depth Paper Analysis

Each in-depth analysis is produced as both a standalone **HTML** document and a standalone **Markdown** file. The agent must go significantly beyond a simple summary.

### 3.1 Analysis Pipeline Per Paper

1. **Fetch AlphaXiv overview** (`/overview/ID.md`) — primary source material
2. **Fetch AlphaXiv full text** (`/abs/ID.md`) — LaTeX source as markdown for equations and details
3. **Read carefully** — understand the paper's core contribution, methodology, and results
4. **Generate architecture/workflow figures** — SVG diagrams showing the key method (see Section 5)
5. **Fill missing background** — explain prerequisite concepts that a reader needs to understand the paper
6. **Cross-reference** — note connections to other papers in the daily list

### 3.2 Analysis Document Structure

Each paper analysis HTML document must contain these sections:

```
1. Header
   - Title, authors, affiliations
   - arXiv ID, date, venue (if known)
   - Upvotes badge, daily paper rank
   - Tags: [from daily papers] / [user-requested] / [not in daily papers]

2. TL;DR (box-pink)
   - 2-3 sentence executive summary (use `ai_summary` as a seed, then expand with your own synthesis)
   - Who should read this and why

3. Background & Prerequisites (box-blue)
   - What the reader needs to know before diving in
   - Key prior work this builds on (with citations)
   - 2-3 prerequisite concepts explained in 1-2 paragraphs each

4. Problem & Motivation
   - What gap or limitation does this address?
   - Why is this problem important now?

5. Method / Approach
   - Architecture/workflow figure (SVG — see Section 5)
   - Step-by-step explanation of the core method
   - Key equations (rendered via KaTeX)
   - Design choices and their justifications

6. Results & Key Findings (box-green)
   - Main quantitative results
   - Comparison with baselines/prior work
   - Ablation highlights (if available)

7. Limitations & Open Questions (box-pink)
   - Acknowledged limitations
   - Unaddressed questions
   - Potential failure modes

8. Connections & Context
   - How this relates to other papers in today's digest
   - Broader research trends it fits into
   - Practical implications

9. Resources
   - Links: arXiv, PDF, code, demo, dataset
   - Related papers for further reading
```

### 3.3 Analysis Depth Guidelines

- **Comprehensive** (default for top-5 papers): 2000-4000 words. Full background section, multiple figures, equation walkthrough, detailed results discussion.
- **Standard** (papers 6-10): 1000-2000 words. Abbreviated background, one figure, key results only.
- **Brief** (papers beyond top-10, or quick mode): 500-1000 words. Extended summary with one key figure.

---

## 4. Color Palette & Typography

Use the same low-saturation palette as the academic-presentation skill. All HTML documents must be self-contained with embedded CSS.

### 4.1 Colors

```css
:root {
  /* Base */
  --bg:       #FAF8F5;  /* warm off-white */
  --text:     #3A3A3A;  /* soft black */
  --text-secondary: #6A6A6A;

  /* Accents (low-saturation) */
  --emph:     #C4A882;  /* warm sand — emphasis, key takeaways */
  --blue:     #8FA8B8;  /* dusty blue — technical, references */
  --green:    #A8B8A0;  /* sage — positive results, methods */
  --teal:     #7FA8A0;  /* muted teal — callouts */
  --gold:     #C8B878;  /* antique gold — highlights, badges */
  --lavender: #9B8FBF;  /* soft purple — special notes */
  --red:      #A86464;  /* muted red — limitations, warnings */
}
```

### 4.2 Typography

```css
body {
  font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
  font-size: 17px;
  line-height: 1.7;
  color: var(--text);
  background: var(--bg);
  max-width: 900px;
  margin: 0 auto;
  padding: 40px 32px;
}

h1 { font-size: 32px; font-weight: 700; margin-bottom: 16px; }
h2 { font-size: 24px; font-weight: 600; margin-top: 36px; margin-bottom: 14px; }
h3 { font-size: 20px; font-weight: 600; margin-top: 24px; margin-bottom: 10px; }

code, pre {
  font-family: 'Fira Code', 'Source Code Pro', monospace;
  font-size: 15px;
}
```

### 4.3 Box Styles

Use colored boxes to highlight different types of content:

```css
.box-blue {
  background: rgba(143, 168, 184, 0.12);
  border-left: 4px solid #8FA8B8;
  padding: 16px 20px;
  margin: 20px 0;
  border-radius: 4px;
}
.box-green {
  background: rgba(168, 184, 160, 0.12);
  border-left: 4px solid #A8B8A0;
  padding: 16px 20px;
  margin: 20px 0;
  border-radius: 4px;
}
.box-pink {
  background: rgba(196, 168, 130, 0.12);
  border-left: 4px solid #C4A882;
  padding: 16px 20px;
  margin: 20px 0;
  border-radius: 4px;
}
.box-gold {
  background: rgba(200, 184, 120, 0.12);
  border-left: 4px solid #C8B878;
  padding: 16px 20px;
  margin: 20px 0;
  border-radius: 4px;
}
.box-lavender {
  background: rgba(155, 143, 191, 0.12);
  border-left: 4px solid #9B8FBF;
  padding: 16px 20px;
  margin: 20px 0;
  border-radius: 4px;
}
.box-red {
  background: rgba(168, 100, 100, 0.10);
  border-left: 4px solid #A86464;
  padding: 16px 20px;
  margin: 20px 0;
  border-radius: 4px;
}
```

**Box usage rules:**
- `box-pink` (sand/emphasis): TL;DR, key takeaways, limitations
- `box-blue`: Background/prerequisites, technical details, references
- `box-green`: Results, methods, positive findings
- `box-gold`: Badges, rankings, metadata highlights
- `box-lavender`: Special notes, cross-paper connections
- `box-red`: Warnings, critical limitations, failure modes

### 4.4 Badges & Tags

```css
.badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
}
.badge-upvotes {
  background: rgba(200, 184, 120, 0.2);
  color: #8A7A40;
}
.badge-rank {
  background: rgba(143, 168, 184, 0.2);
  color: #5A7A8A;
}
.badge-daily {
  background: rgba(168, 184, 160, 0.2);
  color: #5A7A5A;
}
.badge-extra {
  background: rgba(155, 143, 191, 0.2);
  color: #6A5A8A;
}
```

### 4.5 Math Rendering (KaTeX)

Include KaTeX in any HTML with equations:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.body, {delimiters: [{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}]});">
</script>
```

---

## 5. SVG Figure Guidelines

Generate SVG architecture/workflow diagrams for each in-depth paper. These figures are a key value-add beyond what AlphaXiv provides.

### 5.1 When to Generate Figures

- **Always**: One main architecture/workflow figure per paper showing the core method
- **If applicable**: Data flow diagram, comparison table as visual, training pipeline
- **Skip if**: The paper is purely theoretical with no describable pipeline/architecture

### 5.2 SVG Style Rules

```svg
<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg">
  <style>
    text {
      font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
      fill: #3A3A3A;
    }
    .label { font-size: 14px; }
    .label-small { font-size: 12px; fill: #6A6A6A; }
    .label-bold { font-size: 14px; font-weight: 600; }

    /* Node styles — match the box colors */
    .node-blue {
      fill: rgba(143, 168, 184, 0.15);
      stroke: #8FA8B8;
      stroke-width: 1.5;
      rx: 8;
    }
    .node-green {
      fill: rgba(168, 184, 160, 0.15);
      stroke: #A8B8A0;
      stroke-width: 1.5;
      rx: 8;
    }
    .node-pink {
      fill: rgba(196, 168, 130, 0.15);
      stroke: #C4A882;
      stroke-width: 1.5;
      rx: 8;
    }
    .node-teal {
      fill: rgba(127, 168, 160, 0.15);
      stroke: #7FA8A0;
      stroke-width: 1.5;
      rx: 8;
    }

    /* Arrows */
    .arrow {
      stroke: #8FA8B8;
      stroke-width: 1.5;
      fill: none;
      marker-end: url(#arrowhead);
    }
  </style>
  <defs>
    <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#8FA8B8"/>
    </marker>
  </defs>
  <!-- Diagram content here -->
</svg>
```

**Rules:**
- Use the same color palette as boxes (blue, green, pink/sand, teal)
- Palatino font for all text
- Rounded rectangles (`rx: 8`) for nodes
- Clean arrows with arrowhead markers
- Maximum 800px wide, 200-500px tall
- No drop shadows, no gradients — flat, clean style
- Label every node and arrow

---

## 6. Compiled Document

After all individual analyses are complete, assemble the compiled document in three formats:
- **HTML**: Styled document with cover, TOC, digest, and all analyses (self-contained CSS)
- **Markdown**: Single .md combining all content (Obsidian-compatible with YAML frontmatter)
- **PDF**: Rendered from the compiled HTML via Chrome headless

### 6.1 Compiled Structure

```
1. Cover Page
   - "HuggingFace Daily Papers — YYYY-MM-DD"
   - Paper count, date, generation timestamp

2. Table of Contents
   - Links to digest and each in-depth analysis
   - Paper titles with rank and upvote count

3. Daily Digest (full content from Task 2)

4. In-Depth Analyses (one per paper, in rank order)
   - Page break between each analysis
   - Top-N by upvotes first, then user-specified extras

5. Appendix: Data Sources
   - API endpoints used
   - AlphaXiv coverage notes
   - Papers where full text was unavailable
```

### 6.2 PDF Rendering

```bash
# Chrome headless (preferred)
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --print-to-pdf=./daily-papers-YYYY-MM-DD.pdf \
  --print-to-pdf-no-header \
  "file://$(pwd)/daily-papers-YYYY-MM-DD.html"

# Linux
google-chrome --headless --disable-gpu --print-to-pdf=./daily-papers-YYYY-MM-DD.pdf \
  --print-to-pdf-no-header \
  "file://$(pwd)/daily-papers-YYYY-MM-DD.html"

# Alternative: puppeteer-core
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
  await page.goto('file://' + path.resolve('./daily-papers-YYYY-MM-DD.html'), { waitUntil: 'networkidle0' });
  await page.pdf({ path: './daily-papers-YYYY-MM-DD.pdf', format: 'A4', printBackground: true,
    margin: { top: '0.75in', right: '0.75in', bottom: '0.75in', left: '0.75in' } });
  await browser.close();
})();
"
```

---

## 7. Markdown Output Guidelines

All Markdown files must be **Obsidian-compatible**:

### 7.1 YAML Frontmatter

Every .md file must start with YAML frontmatter:

\`\`\`yaml
---
title: "Paper Title or Digest Title"
date: YYYY-MM-DD
type: digest | analysis | compiled
tags: [daily-papers, YYYY-MM-DD, research-area]
papers: 42                    # total paper count (digest/compiled only)
rank: 3                       # paper rank by upvotes (analysis only)
arxiv: "2501.12345"           # arXiv ID (analysis only)
---
\`\`\`

### 7.2 Markdown Conventions

- Use standard Markdown headers (\`#\`, \`##\`, \`###\`) matching the HTML section structure
- Inline math: \`$equation$\`, display math: \`$$equation$$\` (Obsidian renders both)
- Reference SVG figures with relative paths: \`![Architecture](../figures/01-architecture.svg)\`
- Use Obsidian wikilinks for cross-references between papers: \`[[01-paper-title-slug|Paper Title]]\`
- Tables use standard Markdown pipe syntax
- Callout boxes use Obsidian callout syntax:
  \`\`\`markdown
  > [!abstract] TL;DR
  > Summary text here

  > [!info] Background & Prerequisites
  > Technical context here

  > [!success] Key Results
  > Results text here

  > [!warning] Limitations
  > Limitations text here
  \`\`\`
- Links: \`[arXiv](https://arxiv.org/abs/ID)\`, \`[PDF](https://arxiv.org/pdf/ID)\`, \`[GitHub](url)\`

### 7.3 File Naming

Markdown files use the same base name as their HTML counterparts:
- \`daily-digest-YYYY-MM-DD.html\` -> \`daily-digest-YYYY-MM-DD.md\`
- \`papers/01-paper-title-slug.html\` -> \`papers/01-paper-title-slug.md\`
- \`daily-papers-YYYY-MM-DD.html\` -> \`daily-papers-YYYY-MM-DD.md\`

---

## 8. Quality Checklist

- [ ] Date validated — API returns non-empty array before proceeding
- [ ] All papers from the API are included in the digest (none missing)
- [ ] Papers ranked correctly by upvotes
- [ ] Top-N papers each have a dedicated in-depth analysis
- [ ] User-specified papers resolved and analyzed (marked if not in daily papers)
- [ ] AlphaXiv overview fetched for each in-depth paper (fallback noted if unavailable)
- [ ] Each in-depth analysis has at least one SVG architecture/workflow figure
- [ ] Background/prerequisites section fills knowledge gaps for each paper
- [ ] All HTML documents are self-contained with embedded CSS
- [ ] Color palette matches specification (low-saturation, Palatino font)
- [ ] KaTeX included in HTML pages with equations
- [ ] Every HTML document has a corresponding .md file with same base name
- [ ] All .md files have valid YAML frontmatter (title, date, type, tags)
- [ ] Markdown uses Obsidian callout syntax for colored boxes
- [ ] Markdown uses Obsidian wikilinks for cross-paper references
- [ ] SVG figure paths in Markdown are correct relative paths
- [ ] Digest PDF renders cleanly (daily-digest-YYYY-MM-DD.pdf)
- [ ] Compiled PDF renders cleanly (daily-papers-YYYY-MM-DD.pdf)
- [ ] Compiled document has working table of contents
- [ ] All arXiv, GitHub, and HuggingFace links are correct in both HTML and MD
