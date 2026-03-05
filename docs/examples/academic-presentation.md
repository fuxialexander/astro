# Academic Paper Presentation

> Workflow guide for the Academic Paper Presentation example.

## What It Does

Converts academic papers into three deliverable formats:
1. **Slides** -- HTML slides rendered to PDF via Playwright
2. **Blog Post** -- Markdown with citations and figures
3. **Conference Poster** -- Single-page HTML rendered to A0 PDF

All outputs use a consistent low-saturation color palette and typography.

## Quick Start

1. Go to **Examples** > **Academic Paper Presentation**
2. Enter a paper source (arXiv link or PDF path)
3. Select which deliverables you want
4. Click **Start Planning** -- Astro generates a task graph
5. Review the plan, then execute

## Parameters

### Required

| Parameter | What to Enter | Examples |
|-----------|---------------|---------|
| **Paper Source(s)** | arXiv links (one per line) or a path to a directory of PDFs | `https://arxiv.org/abs/2301.07041` or `/home/user/papers/` |
| **Output Deliverables** | Check one or more: Slides, Blog Post, Poster | Default: Slides only |

### Optional (Advanced Options)

These appear based on which deliverables you selected:

**Always visible:**
| Parameter | Purpose | Default |
|-----------|---------|---------|
| Code Repository | GitHub URL for the paper's code -- extracts code examples for slides | (empty) |
| Custom Requirements | Focus areas, narrative direction, multi-paper story arc | (empty) |

**Visible when Slides selected:**
| Parameter | Purpose | Default |
|-----------|---------|---------|
| Slide Count | Brief (8-12), Standard (15-25), Detailed (30-45) | Standard |
| Target Audience | ML Researchers, Grad Students, Engineers, General | Researchers |
| Slide Theme | Light, Dark, or Both | Light |

**Visible when Blog Post selected:**
| Parameter | Purpose | Default |
|-----------|---------|---------|
| Blog Style | Detailed (2000-4000 words) or Succinct (800-1500 words) | Detailed |

**Visible when Poster selected:**
| Parameter | Purpose | Default |
|-----------|---------|---------|
| Poster Orientation | Portrait (3-col) or Landscape (4-col) | Portrait |

## Data Flow

```
User enters paper source
         |
         v
   ┌─────────────┐
   │ Paper Source │ -- arXiv link? Fetch LaTeX/HTML automatically
   │             │ -- PDF path?   Use PDF skill to read content
   │             │ -- Directory?  Process each PDF as separate branch
   └──────┬──────┘
          |
          v
   ┌──────────────┐
   │ Paper Analysis│ -- Extract: sections, equations, figures, bibliography
   │  (Phase 1)   │ -- Identify 3-5 key contributions
   │              │ -- Clone GitHub repo (if provided)
   └──────┬───────┘
          |
     ┌────┴────┬──────────┐
     v         v          v
  ┌──────┐ ┌──────┐ ┌────────┐
  │Slides│ │ Blog │ │ Poster │   (parallel branches)
  │      │ │ Post │ │        │
  └──┬───┘ └──┬───┘ └───┬────┘
     |        |         |
     v        v         v
  ┌───────────────────────────┐
  │ Quality Check & Assembly  │ -- Verify renders, cross-check content
  └───────────────────────────┘
```

## Multiple Papers

If you enter multiple arXiv links (one per line), Astro creates **parallel branches** -- one per paper. Each branch runs the full pipeline independently. Up to 5 papers per run.

## Output Structure

```
output/
  slides/
    slide-01-title.html
    slide-02-motivation.html
    ...
    slides.pdf              # Combined PDF via Playwright
  blog/
    blog-post.md            # Markdown with citations
    figures/                # Referenced figures
  poster/
    poster.html             # Single-page HTML
    poster.pdf              # A0 PDF via Playwright
```

## SKILL.md

The `academic-presentation` skill (`skills/academic-presentation/SKILL.md`) contains:
- 5 HTML slide layout types (title, section-divider, full-bullet, left-right-split, three-zone)
- Color palette definitions for light and dark themes
- Typography rules, box styles, SVG figure guidelines
- HTML-to-PDF rendering instructions via Playwright
- Blog Markdown structure and poster CSS grid layout

When you launch this example, the SKILL.md is loaded as the project's **skill.md** (editable in project overview). You can revise it before or during execution to customize rendering rules.

## Execution Config

| Setting | Value |
|---------|-------|
| Model | Claude Sonnet 4 |
| Max turns per task | 50 |
| Max cost per task | $5.00 |
| Delivery mode | Branch (git branch per task) |
| Verification | Mixed (auto for file creation, human for quality) |

## Tips

- **Start with one paper and Slides only** to see how it works before adding more deliverables
- **arXiv links** work better than PDFs because LaTeX source preserves equation structure
- **Custom Requirements** is powerful -- use it to focus on specific aspects like "emphasize the ablation study" or "compare with Transformer baselines"
- The **Code Repository** option adds code examples to slides, making them much richer for engineering audiences
