---
name: render-ui
version: "2.0.0"
description: "Render structured data as rich interactive UI components using json-render specs. Triggers when the user asks to render, display, format, or present data as a table, card, dashboard, summary, or structured view — or when tool results contain arrays/objects that would benefit from component rendering. Also activates for design previews, status dashboards, comparison views, and guided workflows."
category: tools
tags: [rendering, ui, table, card, dashboard, structured-data, json-render, preview, design]
allowedTools: [Read, Glob, Grep, Bash]
---

# Rich UI Rendering Skill

Render structured, interactive UI components directly in chat responses using `spec` blocks. The frontend renders these as real React components (cards, tables, badges, progress bars, etc.) — not images or iframes.

## When to Use Specs

### Always use specs for:
- **Data tables** with 5+ rows (file listings, test results, dependency comparisons, benchmarks)
- **Status dashboards** (task progress, build results, deployment status, health checks)
- **Structured summaries** after running tools (execution results, code analysis, migration plans)
- **Before/after comparisons** (config changes, dependency upgrades, refactoring impact)
- **Design previews** — show a component's prop/variant grid before writing code

### Use markdown instead for:
- Short conversational answers
- Step-by-step instructions
- Code snippets and explanations
- Simple lists under 5 items

## Creative Use Cases

### 1. Design Preview Cards
Before implementing a UI component, preview how it will compose:

```spec
{"op":"add","path":"/root","value":"preview"}
{"op":"add","path":"/elements/preview","value":{"type":"Card","props":{"title":"Button Variants Preview"},"children":["desc","sep","row1","row2"]}}
{"op":"add","path":"/elements/desc","value":{"type":"Text","props":{"content":"Here's how the button variants will look with the new color tokens:"},"children":[]}}
{"op":"add","path":"/elements/sep","value":{"type":"Separator","props":{},"children":[]}}
{"op":"add","path":"/elements/row1","value":{"type":"Stack","props":{"direction":"horizontal","gap":"sm"},"children":["b1","b2","b3"]}}
{"op":"add","path":"/elements/b1","value":{"type":"Button","props":{"label":"Primary","variant":"default"},"children":[]}}
{"op":"add","path":"/elements/b2","value":{"type":"Button","props":{"label":"Destructive","variant":"destructive"},"children":[]}}
{"op":"add","path":"/elements/b3","value":{"type":"Button","props":{"label":"Outline","variant":"outline"},"children":[]}}
{"op":"add","path":"/elements/row2","value":{"type":"Stack","props":{"direction":"horizontal","gap":"sm"},"children":["b4","b5","b6"]}}
{"op":"add","path":"/elements/b4","value":{"type":"Button","props":{"label":"Secondary","variant":"secondary"},"children":[]}}
{"op":"add","path":"/elements/b5","value":{"type":"Button","props":{"label":"Ghost","variant":"ghost"},"children":[]}}
{"op":"add","path":"/elements/b6","value":{"type":"Button","props":{"label":"Link","variant":"link"},"children":[]}}
```

### 2. Execution Result Dashboard
After running tests, builds, or deployments — summarize with a live dashboard:

```spec
{"op":"add","path":"/root","value":"dash"}
{"op":"add","path":"/elements/dash","value":{"type":"Card","props":{"title":"Test Suite Results"},"children":["metrics","sep1","failures"]}}
{"op":"add","path":"/elements/metrics","value":{"type":"Stack","props":{"direction":"horizontal","gap":"lg","align":"center"},"children":["pass-badge","fail-badge","progress"]}}
{"op":"add","path":"/elements/pass-badge","value":{"type":"Badge","props":{"label":"138 passed","variant":"success"},"children":[]}}
{"op":"add","path":"/elements/fail-badge","value":{"type":"Badge","props":{"label":"4 failed","variant":"error"},"children":[]}}
{"op":"add","path":"/elements/progress","value":{"type":"Progress","props":{"value":97,"label":"Pass Rate"},"children":[]}}
{"op":"add","path":"/elements/sep1","value":{"type":"Separator","props":{},"children":[]}}
{"op":"add","path":"/elements/failures","value":{"type":"Table","props":{"headers":["Test","Error","File"],"rows":[["auth.login","timeout after 5s","tests/auth.test.ts"],["api.rate-limit","expected 429, got 200","tests/api.test.ts"],["db.migration","column 'email' already exists","tests/db.test.ts"],["ws.reconnect","connection refused","tests/ws.test.ts"]],"caption":"Failed tests"},"children":[]}}
```

### 3. Migration / Refactoring Plan
Show impact analysis before a large change:

```spec
{"op":"add","path":"/root","value":"plan"}
{"op":"add","path":"/elements/plan","value":{"type":"Stack","props":{"direction":"vertical","gap":"md"},"children":["alert","impact","files"]}}
{"op":"add","path":"/elements/alert","value":{"type":"Alert","props":{"title":"Breaking Change","message":"Renaming `userId` to `accountId` across 23 files. 4 API endpoints affected.","variant":"warning"},"children":[]}}
{"op":"add","path":"/elements/impact","value":{"type":"KeyValue","props":{"pairs":[{"key":"Files Changed","value":"23"},{"key":"API Endpoints","value":"4 (v2/users, v2/auth, v2/teams, v2/billing)"},{"key":"DB Migrations","value":"1 (rename column)"},{"key":"Estimated Risk","value":"Medium — requires coordinated deploy"}]},"children":[]}}
{"op":"add","path":"/elements/files","value":{"type":"Table","props":{"headers":["File","Changes","Risk"],"rows":[["src/api/users.ts","rename param + return type","Low"],["src/api/auth.ts","rename in JWT payload","Medium"],["src/db/schema.ts","column rename migration","High"],["src/types/index.ts","interface field rename","Low"]]},"children":[]}}
```

### 4. Guided Decision with Context
When asking for user input, provide structured context alongside the question:

```spec
{"op":"add","path":"/root","value":"decision"}
{"op":"add","path":"/elements/decision","value":{"type":"Card","props":{"title":"Dependency Upgrade Decision"},"children":["context","sep","options"]}}
{"op":"add","path":"/elements/context","value":{"type":"Table","props":{"headers":["Package","Current","Latest","Breaking Changes"],"rows":[["react","18.2.0","19.1.0","Yes — new JSX transform"],["typescript","5.3.3","5.7.2","No"],["vite","5.4.0","7.2.1","Yes — config format changed"]]},"children":[]}}
{"op":"add","path":"/elements/sep","value":{"type":"Separator","props":{},"children":[]}}
{"op":"add","path":"/elements/options","value":{"type":"Stack","props":{"direction":"vertical","gap":"sm"},"children":["opt-a","opt-b"]}}
{"op":"add","path":"/elements/opt-a","value":{"type":"Alert","props":{"title":"Option A: Incremental","message":"Upgrade TypeScript and Vite now, defer React 19 to next sprint. Lower risk, 2 PRs.","variant":"info"},"children":[]}}
{"op":"add","path":"/elements/opt-b","value":{"type":"Alert","props":{"title":"Option B: Big Bang","message":"Upgrade all three together. Higher risk but one migration effort. Needs 2-day feature freeze.","variant":"warning"},"children":[]}}
```

### 5. Component Prop Reference
When discussing or documenting a component, render its API as a structured view:

```spec
{"op":"add","path":"/root","value":"ref"}
{"op":"add","path":"/elements/ref","value":{"type":"Card","props":{"title":"<Badge> Component"},"children":["desc","variants","code"]}}
{"op":"add","path":"/elements/desc","value":{"type":"Text","props":{"content":"A status badge with semantic color variants. Used for task status, labels, and inline metadata."},"children":[]}}
{"op":"add","path":"/elements/variants","value":{"type":"Stack","props":{"direction":"horizontal","gap":"sm"},"children":["v1","v2","v3","v4","v5","v6"]}}
{"op":"add","path":"/elements/v1","value":{"type":"Badge","props":{"label":"default"},"children":[]}}
{"op":"add","path":"/elements/v2","value":{"type":"Badge","props":{"label":"success","variant":"success"},"children":[]}}
{"op":"add","path":"/elements/v3","value":{"type":"Badge","props":{"label":"warning","variant":"warning"},"children":[]}}
{"op":"add","path":"/elements/v4","value":{"type":"Badge","props":{"label":"error","variant":"error"},"children":[]}}
{"op":"add","path":"/elements/v5","value":{"type":"Badge","props":{"label":"in-progress","variant":"in-progress"},"children":[]}}
{"op":"add","path":"/elements/v6","value":{"type":"Badge","props":{"label":"planned","variant":"planned"},"children":[]}}
{"op":"add","path":"/elements/code","value":{"type":"CodeBlock","props":{"code":"<Badge variant=\"success\">Deployed</Badge>","language":"tsx","title":"Usage"},"children":[]}}
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

## Spec Format Rules

1. Each line is an RFC 6902 JSON Patch `add` operation
2. First line sets `/root` to the root element key
3. Subsequent lines add elements to `/elements/<key>`
4. Every element needs `type`, `props`, and `children` (use `[]` for leaf elements)
5. Parent elements reference children by key in their `children` array
6. You can have multiple spec blocks in one response, interspersed with markdown

## Composition Patterns

| Pattern | Structure | Good for |
|---------|-----------|----------|
| **Status Card** | Card → Stack → [KeyValue, Progress, Badges] | Build results, task status, health checks |
| **Data Report** | Card → Stack → [Heading, Table, Separator, Heading, Table] | Multi-section analysis, audit results |
| **Comparison** | Table with headers and rows | Before/after, dependency versions, benchmarks |
| **Decision Prompt** | Card → [Table (context), Separator, Alert options] | Guided user decisions with structured context |
| **Component Preview** | Card → [Text (description), Stack → [components]] | Design review, variant showcase |
| **Alert + Detail** | Stack → [Alert, List or Table] | Warnings with actionable detail |
