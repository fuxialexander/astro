---
name: render-ui
version: "1.0.0"
description: "Render structured data as rich interactive UI components using json-render specs. Triggers when the user asks to render, display, format, or present data as a table, card, dashboard, summary, or structured view — or when tool results contain arrays/objects that would benefit from component rendering."
category: tools
tags: [rendering, ui, table, card, dashboard, structured-data, json-render]
allowedTools: [Read, Glob, Grep, Bash]
---

# Rich UI Rendering Skill

This skill activates when the user wants structured, component-based rendering of data instead of plain text or markdown. It produces `spec` blocks that the frontend renders as interactive UI components (tables, cards, badges, key-value grids, etc.).

## When This Skill Activates

- User says "render this as a table", "show me a summary card", "format this data"
- User asks for a dashboard, status overview, or structured comparison
- Tool results return arrays of objects or structured metadata that would display poorly as raw JSON
- User says "make this look nicer" or "display this as components"

## How to Use Specs

Output a ```spec code fence containing JSONL patch operations. Each line is an RFC 6902 JSON Patch operation that builds up the UI tree:

```spec
{"op":"add","path":"/root","value":"card-1"}
{"op":"add","path":"/elements/card-1","value":{"type":"Card","props":{"title":"Project Status"},"children":["stack-1"]}}
{"op":"add","path":"/elements/stack-1","value":{"type":"Stack","props":{"direction":"vertical","gap":"md"},"children":["kv-1","progress-1","badges"]}}
{"op":"add","path":"/elements/kv-1","value":{"type":"KeyValue","props":{"pairs":[{"key":"Tasks Complete","value":"12/15"},{"key":"Last Updated","value":"2 hours ago"}]},"children":[]}}
{"op":"add","path":"/elements/progress-1","value":{"type":"Progress","props":{"value":80,"label":"Overall Progress"},"children":[]}}
{"op":"add","path":"/elements/badges","value":{"type":"Stack","props":{"direction":"horizontal","gap":"sm"},"children":["b1","b2"]}}
{"op":"add","path":"/elements/b1","value":{"type":"Badge","props":{"label":"On Track","variant":"success"},"children":[]}}
{"op":"add","path":"/elements/b2","value":{"type":"Badge","props":{"label":"3 Blockers","variant":"warning"},"children":[]}}
```

## Available Components

### Layout
- **Card** — `{ title?, description? }` — Container with optional header
- **Stack** — `{ direction?: "horizontal"|"vertical", gap?: "sm"|"md"|"lg", align?: "start"|"center"|"end"|"stretch" }` — Flex layout
- **Separator** — `{}` — Horizontal divider

### Content
- **Text** — `{ content }` — Markdown-rendered text block
- **Heading** — `{ text, level?: "1"|"2"|"3"|"4" }` — Heading element
- **Badge** — `{ label, variant?: "default"|"secondary"|"destructive"|"outline"|"success"|"warning"|"info"|"in-progress"|"awaiting"|"completed"|"error"|"planned" }` — Status badge
- **Alert** — `{ title?, message, variant?: "default"|"destructive"|"info"|"warning"|"success" }` — Alert box
- **Table** — `{ headers: string[], rows: string[][], caption? }` — Data table
- **List** — `{ items: string[], ordered? }` — Bullet or numbered list
- **KeyValue** — `{ pairs: [{ key, value }] }` — Key-value display grid
- **CodeBlock** — `{ code, language?, title? }` — Syntax-highlighted code

### Feedback
- **Progress** — `{ value: 0-100, label? }` — Progress bar

### Input
- **Button** — `{ label, variant?, size? }` — Clickable button (wire via element `on` field)

## Best Practices

1. **Combine markdown and specs** — Use prose before/after spec blocks to provide context
2. **Keep specs focused** — One spec per logical unit (a summary card, a data table, a status dashboard)
3. **Use appropriate components** — Tables for tabular data, KeyValue for metadata, Badges for status, Cards for grouping
4. **Set children to `[]`** for leaf elements — Every element needs a `children` field
5. **Reference children by key** — Parent elements list child keys in their `children` array
6. **Don't over-spec** — If a simple markdown table or list suffices, use markdown. Specs are for when structure and styling add real value.

## Common Patterns

### Status Summary
Card → Stack (vertical) → KeyValue + Progress + Stack (horizontal) → Badges

### Comparison Table
Table with headers and rows — great for file diffs, dependency comparisons, benchmark results

### Alert with Context
Alert → children: [Text, List] — for warnings or important notices with supporting details

### Multi-Section Dashboard
Card → Stack → [Heading, KeyValue, Separator, Heading, Table] — for comprehensive overviews
