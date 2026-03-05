# Academic Paper/Book Review

> Workflow guide for the Academic Paper/Book Review example.

## What It Does

Generates a detailed structured review of academic papers, books, or theses. The review covers:
1. **Comprehension** -- Parse and understand the full document
2. **Logical flow** -- Map argument structure with optional diagrams
3. **Novelty analysis** -- Compare against existing literature
4. **Technical rigor** -- Assess methodology, proofs, experiments
5. **Merits & shortcomings** -- Enumerated strengths and weaknesses
6. **Structured report** -- PDF output via LaTeX or Markdown

## Quick Start

1. Go to **Examples** > **Academic Paper/Book Review**
2. Enter the path to a directory containing your document(s)
3. Select document type (Paper, Book, Thesis) and source format (PDF, LaTeX, Markdown, DOCX)
4. Click **Start Planning** -- Astro generates a review task graph
5. Review the plan, then execute

## Parameters

### Required

| Parameter | What to Enter | Examples |
|-----------|---------------|---------|
| **Source Directory** | Path to directory containing the document(s) | `/home/user/papers/` |
| **Document Type** | Paper, Book, or Thesis/Dissertation | Paper |
| **Source Format** | PDF, LaTeX, Markdown, or Word | PDF |

### Optional (Advanced Options)

**Review settings:**
| Parameter | Purpose | Default |
|-----------|---------|---------|
| Review Depth | Comprehensive (15-25pg), Standard (8-12pg), Quick (3-5pg) | Comprehensive |
| Reviewer Expertise | Domain Expert, General Researcher, Grad Student | Expert |
| Focus Areas | Multi-select: Novelty, Math Rigor, Experiments, Writing | (none) |
| Target Venue | Calibrate standards to a specific venue (e.g., NeurIPS) | (empty) |

**Output settings:**
| Parameter | Purpose | Default |
|-----------|---------|---------|
| Report Format | LaTeX-to-PDF or Markdown-to-PDF | LaTeX-to-PDF |
| Include Diagrams | Generate SVG argument flow / methodology diagrams | Yes |
| Literature Search | Mini literature review for novelty context | Enabled |

## Data Flow

```
User enters source directory + format
         |
         v
   ┌─────────────────┐
   │ Document Parsing │ -- PDF? Use PDF skill to extract content
   │                  │ -- LaTeX? Read .tex files directly
   │                  │ -- DOCX? Use DOCX skill for extraction
   │                  │ -- Markdown? Read directly
   └────────┬────────┘
            |
            v
   ┌──────────────────┐
   │ Structure Mapping │ -- Extract sections, arguments, claims
   │                   │ -- Build argument flow diagram (if enabled)
   └────────┬─────────┘
            |
       ┌────┴────┬───────────┐
       v         v           v
  ┌────────┐ ┌────────┐ ┌──────────┐
  │Novelty │ │Rigor   │ │Writing   │   (parallel assessment)
  │Analysis│ │Check   │ │Quality   │
  └───┬────┘ └───┬────┘ └────┬─────┘
      |          |           |
      v          v           v
   ┌──────────────────────────┐
   │ Report Assembly          │ -- Compile findings into structured report
   │                          │ -- Generate LaTeX/Markdown
   │                          │ -- Render to PDF
   └──────────────────────────┘
```

## Output Structure

```
output/
  review-report.tex         # LaTeX source (or .md)
  review-report.pdf         # Compiled PDF report
  diagrams/
    argument-flow.svg       # Logical structure diagram
    methodology-map.svg     # Methodology overview
  notes/
    comprehension.md        # Raw comprehension notes
    novelty-analysis.md     # Literature comparison
    technical-rigor.md      # Rigor assessment
```

## Review Report Sections

1. **Executive Summary** -- Key verdict in 2-3 sentences
2. **Comprehension** -- What the paper claims and how
3. **Logical Flow** -- Argument structure diagram and analysis
4. **Novelty Assessment** -- What's genuinely new vs. incremental
5. **Technical Rigor** -- Methodology, proofs, experiments
6. **Merits** -- Enumerated strengths with evidence
7. **Shortcomings** -- Enumerated weaknesses with suggestions
8. **Minor Issues** -- Typos, formatting, presentation
9. **Overall Recommendation** -- Accept/Revise/Reject with confidence

## SKILL.md

The `academic-review` skill (`skills/academic-review/SKILL.md`) contains:
- Review rubric and scoring dimensions
- How to use PDF and DOCX extraction skills
- Structured output format for each review section
- Literature comparison methodology

When you launch this example, the SKILL.md is loaded as the project's **skill.md**. You can revise it to customize the review rubric or add venue-specific criteria.

## Execution Config

| Setting | Value |
|---------|-------|
| Model | Claude Sonnet 4 |
| Max turns per task | 50 |
| Max cost per task | $5.00 |
| Delivery mode | Branch |
| Verification | Mixed |

## Tips

- **PDF format works best** for published papers -- the PDF skill handles extraction well
- **Set a Target Venue** to get venue-calibrated feedback (e.g., NeurIPS has different standards than a workshop)
- **Focus Areas** let you deep-dive into specific aspects without sacrificing breadth
- For books, the **Quick Assessment** depth is often sufficient for chapter-by-chapter reviews
