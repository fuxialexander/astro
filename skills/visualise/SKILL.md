---
name: visualise
version: "1.0.0"
description: "Use this skill to render interactive visual content — SVG diagrams, HTML widgets, data charts — directly in conversations. Triggers when the user asks to visualize, diagram, chart, illustrate, or create interactive graphics."
category: tools
tags: [visualization, diagram, svg, chart, interactive, html]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash]
---

# Inline Visualizer Reference

This document describes a system for rendering interactive visuals (SVG diagrams, HTML widgets, charts) directly in chat conversations.

## Core Workflow

**Default to the simplest visualization that works.** Start with plain SVG — it streams beautifully, needs no libraries, and renders progressively as tokens arrive. Only reach for HTML+JS (Chart.js, D3, Canvas) when the visualization genuinely needs interactivity (sliders, hover states, animation) or complex data rendering that SVG alone can't handle.

If the user asks for something simple ("show me how X works", "diagram of Y"), use a clean SVG. If they ask for something interactive or data-heavy ("interactive explorer", "dashboard", "let me adjust parameters"), use HTML+JS.

## CRITICAL: Output Method

**ALWAYS output HTML/SVG inside a ` ```visualizer ` code fence.** The content is rendered as a live sandboxed iframe in the user's UI.

**NEVER do any of these:**
- NEVER create or write HTML/SVG files to disk (no Write tool for .html/.svg)
- NEVER open a browser (`open`, `xdg-open`, `python -m http.server`, etc.)
- NEVER look at existing HTML files in the repo before generating your visualization
- Only save to a file if the user explicitly says "save to file" or "create a file"

## Theming: Light & Dark Mode

**Background MUST be transparent.** The host app provides the surface color. NEVER set `background`, `background-color`, or `bgcolor` on `html`, `body`, or any root container. No `#fff`, no `white`, no `#000`, no `black` backgrounds.

**All colors must work in both light and dark mode:**

- **Text**: use `var(--color-text-primary)`, `var(--color-text-secondary)`, `var(--color-text-tertiary)` — NEVER `#333`, `black`, `white`, `#000`, `rgb(51,51,51)`, etc.
- **Surfaces/cards**: use `var(--color-background-secondary)` or `var(--color-background-tertiary)` — NEVER `#fff`, `#f5f5f5`, `white`, etc.
- **Borders**: use `var(--color-border-primary)` or `var(--color-border-tertiary)` — NEVER `#ddd`, `#ccc`, `lightgray`, etc.
- **SVG fills/strokes**: use the color ramp hex values from the table below (chosen to work in both modes). For text in SVG, use CSS variables via inline `style` attributes.
- **SVG backgrounds/regions**: use the lighter ramp stops (50, 100) which have sufficient contrast in both modes.

**Test yourself**: if you wrote any literal color value (`#...`, `rgb(...)`, named color), replace it with a CSS variable or a ramp hex.

## Progressive Rendering & Streaming

Content streams token-by-token. The browser parses and paints the DOM incrementally as tokens arrive — SVG elements appear the moment their closing tag streams in, HTML elements render in document order. No special library is needed; this is native browser behavior made visible by the slow token stream.

**Structure for smooth streaming:**

1. **`<style>` block first** (short, ≤15 lines) — color/font rules arrive before the content they style
2. **Visible HTML/SVG content next** — renders progressively as it arrives, top-to-bottom
3. **`<script>` blocks last** — interactive logic runs only after layout is painted

**Rules that make streaming feel smooth:**

- **No `display:none`** — hidden content streams invisibly, wasting time. Everything should be in normal flow so it renders as it arrives.
- **Inline styles on interactive elements** — form controls look correct mid-stream because styles are on the element, not waiting for a stylesheet.
- **For SVG**: each `<rect/>`, `<circle/>`, `<path/>`, `<text>` appears the instant its tag closes. Shapes paint top-to-bottom naturally.
- **For HTML+Canvas/Chart.js**: the HTML structure (containers, labels, controls) paints first. The `<script>` at the bottom executes after streaming completes and fills in dynamic parts (canvas draws, animations).

**Entrance animations** — add a subtle appear + fly-in effect so elements don't just pop in:

```css
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
body > * {
  animation: fadeSlideIn 0.3s ease-out both;
}
/* Stagger children for sequential reveal */
body > *:nth-child(1) { animation-delay: 0s; }
body > *:nth-child(2) { animation-delay: 0.05s; }
body > *:nth-child(3) { animation-delay: 0.1s; }
body > *:nth-child(4) { animation-delay: 0.15s; }
body > *:nth-child(5) { animation-delay: 0.2s; }
body > *:nth-child(6) { animation-delay: 0.25s; }
```

For SVG, apply to top-level groups (`<g>`) instead:

```css
svg > g {
  animation: fadeSlideIn 0.3s ease-out both;
}
svg > g:nth-child(2) { animation-delay: 0.05s; }
svg > g:nth-child(3) { animation-delay: 0.1s; }
/* etc. */
```

Keep the fly-in distance short (4–8px) and duration fast (0.2–0.4s). The effect should be barely noticeable — a polish detail, not a distraction.

## Sandbox Constraints

The iframe is heavily restricted:

- No `localStorage` or `sessionStorage`
- No `position: fixed` (collapses the auto-sizing container)
- No external API fetches due to Content Security Policy
- Only these CDN sources allowed: `cdnjs.cloudflare.com`, `esm.sh`, `cdn.jsdelivr.net`, `unpkg.com`
- No DOCTYPE or full HTML structure — fragments only
- Transparent background (NEVER set a background color on html/body)

A `sendPrompt(text)` function lets visuals trigger follow-up chat messages.

## Visual Selection Guide

Route on the user's verb. **Default to SVG** — only use HTML+JS when interactivity is required:

| User says | Type | Format | Why |
|-----------|------|--------|-----|
| "How does X work?" | Illustrative diagram | **SVG** | Static mechanism drawing |
| "What are the components?" | Structural diagram | **SVG** | Labelled boxes, no interaction needed |
| "Walk me through steps" | Flowchart | **SVG** | Steps in sequence |
| "Compare X vs Y" | Comparison layout | **SVG** or HTML | SVG if static, HTML if interactive |
| "Show me the data" | Chart | **SVG** (simple) or HTML+Chart.js (complex) | Bar/line with <10 points → inline SVG; larger datasets → Chart.js |
| "Interactive explorer" | Interactive widget | **HTML+JS** | Needs sliders, controls, hover |
| "Let me adjust parameters" | Interactive widget | **HTML+JS** | Needs real-time updates |

## Quick Specs

- SVG viewBox: 680px width
- Font: 14px labels, 12px subtitles
- Stroke: 0.5px
- Max 2-3 color ramps
- Corner radius: `rx="4"` default

Wrap output in ` ```visualizer ` fence for client detection.

---

# Design System Reference

## Core Philosophy

Three principles: **seamless** integration with host apps, **flat** aesthetics (no gradients or decorative effects), and **compact** presentation where "text goes in your response, visuals go in the output."

## CSS Variables

All variables auto-adapt for light/dark mode:

### Backgrounds
- `--color-background-primary`
- `--color-background-secondary`
- `--color-background-tertiary`
- `--color-background-info`
- `--color-background-danger`
- `--color-background-success`
- `--color-background-warning`

### Text
- `--color-text-primary`
- `--color-text-secondary`
- `--color-text-tertiary`
- `--color-text-info`
- `--color-text-danger`
- `--color-text-success`
- `--color-text-warning`

### Borders
- `--color-border-primary`
- `--color-border-secondary`
- `--color-border-tertiary`

### Typography
- `--font-sans`
- `--font-serif`
- `--font-mono`

### Spacing / Radius
- `--border-radius-md` (8px)
- `--border-radius-lg` (12px)
- `--border-radius-xl` (16px)

## Color Ramps

Nine named color ramps with 7 stops each. **Color encodes meaning, not sequence.** Use 2-3 colors per diagram. Reserve semantic colors (blue, green, amber, red) for their intended purposes. Apply the darkest stops (800/900) for text on colored backgrounds.

| Ramp | 50 | 100 | 200 | 400 | 600 | 800 | 900 |
|------|-----|-----|-----|-----|-----|-----|-----|
| Purple | #EEEDFE | #CECBF6 | #AFA9EC | #7F77DD | #534AB7 | #3C3489 | #26215C |
| Teal | #E1F5EE | #9FE1CB | #5DCAA5 | #1D9E75 | #0F6E56 | #085041 | #04342C |
| Coral | #FAECE7 | #F5C4B3 | #F0997B | #D85A30 | #993C1D | #712B13 | #4A1B0C |
| Pink | #FBEAF0 | #F4C0D1 | #ED93B1 | #D4537E | #993556 | #72243E | #4B1528 |
| Gray | #F1EFE8 | #D3D1C7 | #B4B2A9 | #888780 | #5F5E5A | #444441 | #2C2C2A |
| Blue | #E6F1FB | #B5D4F4 | #85B7EB | #378ADD | #185FA5 | #0C447C | #042C53 |
| Green | #EAF3DE | #C0DD97 | #97C459 | #639922 | #3B6D11 | #27500A | #173404 |
| Amber | #FAEEDA | #FAC775 | #EF9F27 | #BA7517 | #854F0B | #633806 | #412402 |
| Red | #FCEBEB | #F7C1C1 | #F09595 | #E24B4A | #A32D2D | #791F1F | #501313 |

**Color guidance:**
- Gray for neutral/structural elements
- Warm tones (coral, amber, red) for active/hot in illustrative diagrams
- Cool tones (teal, blue, green) for calm/passive in illustrative diagrams
- Nested regions need distinct ramps so hierarchy is visible

## SVG Standards

All visuals use a 680px viewBox width with safe area from x=40 to x=640. Transparent backgrounds.

### SVG Template

```svg
<svg width="100%" viewBox="0 0 680 H">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5"
      markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>
</svg>
```

### Pre-built CSS Classes

Text classes:
- `.th` — heading text (14px, font-weight 500)
- `.ts` — subtitle text (12px)
- `.tb` — body text (14px)

Shape/connector classes:
- `.box` — basic rectangle
- `.node` — interactive node (pointer cursor)
- `.arr` — arrow/connector path
- `.leader` — leader line for labels

Color classes (apply to `<g>` or shape elements, NOT to `<path>`):
- `.c-purple`, `.c-teal`, `.c-coral`, `.c-pink`, `.c-gray`
- `.c-blue`, `.c-green`, `.c-amber`, `.c-red`

### Font Width Calibration

- 14px font: each character ~ 8px wide
- 12px font: each character ~ 7px wide
- Always use `dominant-baseline="central"` for text positioning
- Check `(text_width + 2 * padding)` fits the rect before placing

---

# UI Components Reference

Patterns for interactive explainers, comparisons, data records, metric cards, and steppers. All use HTML mode.

## Core Aesthetic

Flat, clean, white surfaces. Minimal 0.5px borders. Generous whitespace. No gradients, no shadows except focus rings.

## Tokens

- Borders: `0.5px solid var(--color-border-tertiary)` (or `-secondary` for emphasis)
- Corner radius: `var(--border-radius-md)` for most, `var(--border-radius-lg)` for cards
- Cards: white bg, 0.5px border, radius-lg, padding `1rem 1.25rem`
- Spacing: rem for vertical rhythm, px for internal gaps (8px, 12px, 16px)

## Pre-styled Form Elements

Inputs, selects, buttons, and range sliders are pre-styled. Write bare tags. Override only specific properties.

Buttons that trigger `sendPrompt` should append a right-arrow indicator.

## Metric Cards

For summary numbers:

```html
<div style="background: var(--color-background-secondary); border-radius: var(--border-radius-md); padding: 1rem;">
  <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0 0 2px;">Label</p>
  <p style="font-size: 24px; font-weight: 500; margin: 0;">$3,870</p>
</div>
```

Use in grids of 2-4: `display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px;`

No border on metric cards — secondary bg differentiates them.

## Interactive Explainer

Sliders, buttons, live state displays. No card wrapper — whitespace is the container.

```html
<div style="display: flex; align-items: center; gap: 12px; margin: 0 0 1.5rem;">
  <label style="font-size: 14px; color: var(--color-text-secondary);">Years</label>
  <input type="range" min="1" max="40" value="20" style="flex: 1;" oninput="update(this.value)"/>
  <span style="font-size: 14px; font-weight: 500; min-width: 24px;" id="out">20</span>
</div>
<div style="display: flex; align-items: baseline; gap: 8px;">
  <span style="font-size: 14px; color: var(--color-text-secondary);">Value:</span>
  <span style="font-size: 24px; font-weight: 500;" id="result">$3,870</span>
</div>
```

## Comparison Layout

Side-by-side cards:

```html
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;">
  <div style="background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-lg); padding: 1rem 1.25rem;">
    <p style="font-weight: 500; font-size: 15px; margin: 0 0 12px; color: var(--color-text-info);">Option A</p>
  </div>
  <div style="background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-lg); padding: 1rem 1.25rem;">
    <p style="font-weight: 500; font-size: 15px; margin: 0 0 12px; color: var(--color-text-warning);">Option B</p>
  </div>
</div>
```

Recommended option: accent with `border: 2px solid var(--color-border-info)` (only exception to 0.5px rule). Add badge: `background: var(--color-background-info); color: var(--color-text-info); font-size: 12px; padding: 4px 12px;`

## Data Record / Card

Wrap in a single raised card:

```html
<div style="background: var(--color-background-primary); border-radius: var(--border-radius-lg); border: 0.5px solid var(--color-border-tertiary); padding: 1rem 1.25rem;">
  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
    <div style="width: 44px; height: 44px; border-radius: 50%; background: var(--color-background-info); display: flex; align-items: center; justify-content: center; font-weight: 500; font-size: 14px; color: var(--color-text-info);">MR</div>
    <div>
      <p style="font-weight: 500; font-size: 15px; margin: 0;">Name</p>
      <p style="font-size: 13px; color: var(--color-text-secondary); margin: 0;">Role</p>
    </div>
  </div>
</div>
```

## Stepper (for Cyclic Processes)

For event loops, Krebs cycle, GC — anything where last stage feeds back to first. Don't draw as ring diagrams.

```html
<div id="step-content" style="min-height: 200px; padding: 1rem 0;"></div>
<div style="display: flex; align-items: center; justify-content: space-between; padding-top: 12px; border-top: 0.5px solid var(--color-border-tertiary);">
  <button onclick="prev()">Previous</button>
  <div style="display: flex; gap: 6px;" id="dots"></div>
  <button onclick="next()">Next</button>
</div>
<script>
const steps = [{ title: 'Step 1', content: '...' }, /* ... */];
let current = 0;
function render() {
  document.getElementById('step-content').innerHTML =
    `<h3 style="font-size:16px;font-weight:500;margin:0 0 8px">${steps[current].title}</h3>
     <p style="font-size:14px;color:var(--color-text-secondary);margin:0">${steps[current].content}</p>`;
  document.getElementById('dots').innerHTML = steps.map((_, i) =>
    `<div style="width:8px;height:8px;border-radius:50%;background:${i===current?'var(--color-text-info)':'var(--color-border-tertiary)'}"></div>`
  ).join('');
}
function next() { current = (current + 1) % steps.length; render(); }
function prev() { current = (current - 1 + steps.length) % steps.length; render(); }
render();
</script>
```

## Mockup Presentation

Contained mockups (mobile, chat threads, modals) — wrap in background surface:

```html
<div style="background: var(--color-background-secondary); border-radius: var(--border-radius-lg); padding: 2rem; display: flex; justify-content: center;">
  <!-- mockup -->
</div>
```

For modals, use faux viewport (NOT `position: fixed`):

```html
<div style="min-height: 400px; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; border-radius: var(--border-radius-lg);">
  <div style="background: var(--color-background-primary); border-radius: var(--border-radius-lg); padding: 2rem; max-width: 400px; width: 100%;">
    <!-- content -->
  </div>
</div>
```

## Grid Overflow Fix

Use `minmax(0, 1fr)` instead of plain `1fr` to prevent children from pushing past container.

---

# Diagram Reference

Three diagram families. Pick based on intent, not subject matter.

## Diagram Types

**Flowchart** — steps in sequence, decisions branching.
- Trigger: "walk me through the process", "what are the steps"
- Good for: workflows, pipelines, request lifecycles

**Structural** — things inside other things.
- Trigger: "what's the architecture", "where does X live"
- Good for: VPC/subnet/instance, file systems, containment

**Illustrative** — draw the mechanism. Build intuition.
- Physical things get cross-sections (engines, lungs, water heaters)
- Abstract things get spatial metaphors (LLM = stacked layers, hash table = row of buckets)
- Trigger: "how does X actually work", "explain X", "I don't get X"
- Default to illustrative for "how does X work" — don't retreat to a flowchart

## Route on the Verb

| User says | Type | What to draw |
|-----------|------|-------------|
| "how do LLMs work" | Illustrative | Token row, stacked layers, attention threads |
| "transformer architecture" | Structural | Labelled boxes: embedding, attention, FFN |
| "how does attention work" | Illustrative | One query token, fan of weighted lines |
| "training steps" | Flowchart | Forward, loss, backward, update |

## Flowchart Rules

**Sizing:** At 14px, each character is approximately 8px wide. A 13-char label needs a rect at least 140px wide.

**Spacing:** 60px between boxes, 24px padding inside, 10px arrowhead gap. Two-line boxes: 56px height minimum.

**Layout:** Single-direction flows. Max 4-5 nodes per diagram. 6+ components: decompose into overview + sub-flows.

**Arrows:** Must not cross any box. If direct path crosses something, use L-bend:

```svg
<path d="M x1 y1 L x1 ymid L x2 ymid L x2 y2" fill="none" class="arr" marker-end="url(#arrow)"/>
```

**Tier packing:** Compute total width BEFORE placing. 4 boxes at 130px + 3 gaps at 20px = 580px (fits in 640 safe area).

**Cycles:** Don't draw as rings. Use a stepper (HTML mode) or linear layout with return arrow.

**Single-line node (44px):**

```svg
<g class="node c-blue" onclick="sendPrompt('Tell me about this')">
  <rect x="100" y="20" width="180" height="44" rx="8" stroke-width="0.5"/>
  <text class="th" x="190" y="42" text-anchor="middle" dominant-baseline="central">Label</text>
</g>
```

**Two-line node (56px):**

```svg
<g class="node c-blue">
  <rect x="100" y="20" width="200" height="56" rx="8" stroke-width="0.5"/>
  <text class="th" x="200" y="38" text-anchor="middle" dominant-baseline="central">Title</text>
  <text class="ts" x="200" y="56" text-anchor="middle" dominant-baseline="central">Subtitle</text>
</g>
```

## Structural Diagram Rules

Large rounded rects = containers. Smaller rects inside = regions.

- Outermost: rx=20-24, lightest fill (50 stop), 0.5px stroke
- Inner regions: rx=8-12, next shade (100-200 stop), different ramp if semantically different
- 20px minimum padding inside every container
- Max 2-3 nesting levels
- External inputs/outputs sit outside with arrows pointing in/out

**Color:** Nested regions need distinct ramps. Same class on parent and child flattens the hierarchy.

**ERDs:** Use mermaid.js, not SVG. Import from `esm.sh/mermaid@11`.

## Illustrative Diagram Rules

The most ambitious type. Draw the mechanism, not a diagram about it.

**What changes from flowcharts:**
- Shapes are freeform — paths, ellipses, circles, polygons, curves
- Layout follows the subject's geometry, not a grid
- Color encodes intensity — warm = active/hot, cool = calm, gray = inert
- Layering and overlap encouraged for shapes (but never let strokes cross text)
- Small shape indicators allowed — triangles for flames, circles for bubbles, wavy lines for steam
- One gradient permitted — only for continuous physical properties. Two stops, same ramp.
- Animation permitted in HTML mode — CSS `@keyframes`, `transform` and `opacity` only

**Fidelity ceiling:** Schematics, not illustrations. A tank is a rounded rect. A flame is three triangles. Recognisable silhouette beats accurate contour.

**Labels:** Place outside the object with leader lines. Pick one side. Reserve 140px margin. Default to right-side labels.

**Composition:** 1. Main silhouette. 2. Internal structure. 3. External connections. 4. State indicators.

**Prefer interactive over static.** If the system has a control, give the diagram that control. Water heater: thermostat slider. LLM: click tokens to see attention. Cache: drag hit rate.

## Common Failures

1. Arrow through a box — trace coordinates against every box before writing
2. Text overflow — check `(text_width + 2 * padding)` fits the rect
3. viewBox too small — content clipped
4. Floating labels — every text should be in a box, legend, or connected by leader
5. Connector without `fill="none"` — renders as black shape
6. Missing `dominant-baseline="central"` — text sits 4px too high
7. Missing arrow marker in defs — always include it

---

# Charts Reference

Data visualization using Chart.js or inline SVG. Use HTML mode.

## Chart.js Setup

```html
<div style="position: relative; height: 300px;">
  <canvas id="chart"></canvas>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script>
const ctx = document.getElementById('chart').getContext('2d');
const style = getComputedStyle(document.documentElement);
const textSecondary = style.getPropertyValue('--color-text-secondary').trim();
const borderDefault = style.getPropertyValue('--color-border-tertiary').trim();

new Chart(ctx, {
  type: 'bar',
  data: {
    labels: ['Q1', 'Q2', 'Q3', 'Q4'],
    datasets: [{
      label: 'Revenue',
      data: [12, 19, 8, 15],
      backgroundColor: '#5DCAA5',
      borderRadius: 4,
      borderSkipped: false,
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: textSecondary, font: { size: 12 } } }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: textSecondary, font: { size: 12 } }, border: { color: borderDefault } },
      y: { grid: { color: borderDefault }, ticks: { color: textSecondary, font: { size: 12 } }, border: { display: false } }
    }
  }
});
</script>
```

## Critical Rules

- Wrap canvas in container with explicit height and `position: relative`
- Set `responsive: true` and `maintainAspectRatio: false`
- Read CSS variables for text/border colors — never hardcode grays
- Use ramp colors for data series
- `borderRadius: 4` on bars
- Hide x-axis grid, show y-axis grid in border color
- Font size 12px for all chart text

## Dataset Colors

Use 400 or 600 stops from the ramps:

| Series | Color | Hex |
|--------|-------|-----|
| 1 | teal-400 | #1D9E75 |
| 2 | purple-400 | #7F77DD |
| 3 | coral-400 | #D85A30 |
| 4 | blue-400 | #378ADD |
| 5 | amber-400 | #BA7517 |

For area/line fills, use same color at 20% opacity.

## Chart Type Selection

| Data shape | Type | Notes |
|-----------|------|-------|
| Categories + values | Bar | Horizontal if labels are long |
| Time series | Line | `tension: 0.3` for smooth curves |
| Parts of whole | Doughnut | `cutout: '60%'` — not pie |
| Two variables | Scatter | Add trend line if correlation is the point |

## Combining with Metrics

Metric cards above, chart below:

```html
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px;">
  <!-- metric cards -->
</div>
<div style="position: relative; height: 280px;">
  <canvas id="chart"></canvas>
</div>
```

## Inline SVG Charts (No Library)

For simple visualizations that stream better:

**Horizontal bar:**

```svg
<svg width="100%" viewBox="0 0 680 80">
  <text class="ts" x="40" y="30">Category A</text>
  <rect x="160" y="16" width="360" height="20" rx="4" fill="#1D9E75" opacity="0.8"/>
  <text class="ts" x="530" y="30">72%</text>
</svg>
```

**Sparkline:**

```svg
<svg width="120" height="32" viewBox="0 0 120 32">
  <polyline points="0,28 20,20 40,24 60,12 80,16 100,4 120,8"
    fill="none" stroke="#1D9E75" stroke-width="1.5" stroke-linecap="round"/>
</svg>
```

## D3.js

For complex custom visualizations (force graphs, maps, treemaps):

```html
<div id="viz"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script>
const svg = d3.select('#viz').append('svg')
  .attr('width', '100%').attr('viewBox', '0 0 680 400');
</script>
```

Use D3 only when Chart.js can't handle the layout. For standard charts, Chart.js is simpler.

## Number Formatting

Round everything displayed:
- Counts: `value.toLocaleString()`
- Currency: `Intl.NumberFormat` with currency option
- Percentages: `Math.round(value) + '%'`
- Set `step` on range sliders for clean values
