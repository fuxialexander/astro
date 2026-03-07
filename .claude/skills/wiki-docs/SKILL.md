---
name: wiki-docs
description: |
  Write high-quality technical documentation and wiki pages for the Astro project.
  Produces developer-facing documentation with rich visual elements: mermaid diagrams
  (flowcharts, sequence diagrams, state diagrams), comparative ASCII timelines,
  detailed tables, and clear hierarchical structure. Output is GitHub Wiki + Obsidian
  compatible markdown. Trigger when the user asks to "write a wiki page", "document X",
  "update the wiki", "write docs for", "add documentation", or "explain X in the wiki".
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Agent
---

# Wiki Documentation Skill

Write comprehensive technical documentation for the Astro developer wiki. Every page you produce must meet the quality bar described below.

## Output Location

- **Wiki pages**: `/Users/zhuoran_cisco/Documents/agent_tools/astro-wiki/{Page-Name}.md`
- **Design docs**: `/Users/zhuoran_cisco/Documents/agent_tools/astro/docs/design/{NAME}.md`

After writing wiki pages, commit and push:
```bash
cd /Users/zhuoran_cisco/Documents/agent_tools/astro-wiki
git add *.md && git commit -m "docs: <description>" && git push origin master
```

## Quality Standards

### 1. Read Code Before Writing

NEVER guess implementation details. Always read the actual source code before describing behavior. Use `Read`, `Grep`, and `Glob` to understand the real implementation. Verify:
- Function names and signatures
- Exact constants and thresholds
- Actual control flow and error handling
- Database column names and types

### 2. Mermaid Diagrams (Required)

Every page MUST include at least 2 mermaid diagrams. Use the right diagram type for the content:

**Flowcharts** — for decision trees, branching logic, if/else flows:
````markdown
```mermaid
flowchart TD
    A["Task dispatched"] --> B{"Safety check?"}
    B -->|SAFE| C["Execute immediately"]
    B -->|RISKY| D["Show dialog to user"]
    D --> E{"User decision"}
    E -->|proceed| C
    E -->|cancel| F["Abort task"]
```
````

**Sequence diagrams** — for multi-component interactions, request/response flows, event pipelines:
````markdown
```mermaid
sequenceDiagram
    participant B as Browser
    participant S as Server
    participant R as Relay
    participant A as Agent Runner

    B->>S: POST /api/dispatch/task
    S->>R: dispatchTask(machineId, payload)
    R->>A: WebSocket: task_dispatch
    A->>A: createWorktree()
    A->>A: Agent executes (minutes)
    A-->>R: task_text, task_tool_trace
    R-->>S: relay events
    S-->>B: SSE stream
    A->>R: task_result
    R->>S: task:result event
    S->>B: SSE: result + done
```
````

**State diagrams** — for lifecycle states and transitions:
````markdown
```mermaid
stateDiagram-v2
    [*] --> planned
    planned --> dispatched: POST /dispatch/task
    dispatched --> in_progress: session_init event
    in_progress --> auto_verified: success + auto verification
    in_progress --> awaiting_judgment: needs human review
    in_progress --> awaiting_approval: agent asks question
    awaiting_approval --> in_progress: user responds
    awaiting_judgment --> completed: human approves
    auto_verified --> [*]
    completed --> [*]
    planned --> pruned: branch killed
    pruned --> [*]
```
````

**Gantt/timeline** — for comparing before/after architectures:
````markdown
```mermaid
gantt
    title Parallel Execution Timeline
    dateFormat X
    axisFormat %s

    section Task A
    Execute      :a1, 0, 60
    Merge        :a2, after a1, 2

    section Task B
    Execute      :b1, 5, 55
    Wait for lock :b2, after a2, 1
    Merge        :b3, after b2, 2
```
````

### 3. ASCII Diagrams in Collapsible Blocks

ASCII diagrams are **always wrapped in `<details>` blocks** so mermaid diagrams take visual priority. ASCII serves as a fallback for non-mermaid renderers.

**Required pattern** — every ASCII diagram code block must be wrapped like this:

```markdown
<details>
<summary>Text diagram</summary>

\```
+---------------------------+
|  ASCII diagram goes here  |
+---------------------------+
\```

</details>
```

For before/after comparisons, use side-by-side or stacked ASCII art with box-drawing characters, wrapped in `<details>`:

```markdown
<details>
<summary>Text diagram</summary>

\```
Previous (serialized):
Task A: [===== lock held: worktree + execute + merge =====]
Task B:                                                     [===== lock held =====]

New (parallel with merge-only lock):
Task A: [── worktree ── execute ──────────────────][merge]
Task B:   [── worktree ── execute ────────────][wait][merge]
\```

</details>
```

**NEVER leave an ASCII diagram code block unwrapped.** Mermaid diagrams are always shown directly (no `<details>`). Only ASCII/text diagrams go inside collapsible blocks.

### 4. Rich Tables

Use tables for:
- **Configuration/constants**: name, value, purpose
- **API endpoints**: method, path, description
- **Status/type enums**: value, who sets it, when, what happens next
- **Comparison matrices**: feature × mode grid
- **File references**: file path, role/purpose

Always align columns and use consistent formatting.

### 5. Page Structure

Every wiki page follows this template:

```markdown
# Page Title

> One-sentence description of what this page covers.

---

## Overview

Brief context paragraph. What is this component/concept? Why does it exist?

## Section 1: Core Concept

Explanation with mermaid diagram.

### Subsection

Details, tables, code examples.

---

## Section 2: Detailed Flow

Sequence diagram or flowchart showing the step-by-step process.

---

## Section N: Edge Cases / Known Gaps

Table of corner cases and how they're handled.

---

## Key Files

| File | Role |
|------|------|
| `path/to/file.ts` | Brief description |

---

*See also: [[Related Page 1]] | [[Related Page 2]]*
```

### 6. Cross-References

Use Obsidian-compatible wiki links: `[[Page Name]]` or `[[Page Name#Section]]`.

Every page must link to:
- At least 2 related pages
- The parent overview page (if it's a sub-page)
- Key files table with actual file paths

### 7. Code Examples

Include TypeScript code snippets for key interfaces, types, and function signatures:

```typescript
// From packages/core/src/db/schema.ts
interface UsageMetrics {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  model: string;
  numTurns: number;
}
```

### 8. Section Separators

Use `---` between major sections for visual clarity.

### 9. No Emoji

Do not use emoji in documentation. Use text labels, badges in tables, and formatting for emphasis instead.

## Diagram Selection Guide

| Content Type | Best Diagram | Example |
|-------------|-------------|---------|
| Request/response between components | `sequenceDiagram` | Browser → Server → Relay → Agent |
| Decision tree / branching logic | `flowchart TD` | Safety tier classification |
| State machine / lifecycle | `stateDiagram-v2` | Task status transitions |
| Before/after comparison | ASCII timeline | Lock scope reduction |
| Data flow pipeline | `flowchart LR` | Event persistence pipeline |
| Component architecture | ASCII box diagram | Four-process system |
| Timeline/scheduling | `gantt` | Parallel task execution |

## Wiki Structure Reference

The Astro wiki has these sections (see `_Sidebar.md`):

- **Architecture**: Overview, Backend, Frontend, Agent Runner, Data Model
- **AI Pathways**: AI Pathways, Plan Generation, Project Chat, Task Execution, Summarization
- **Execution Lifecycle**: Execution Lifecycle, Relay Protocol, Streaming Events, Execution Guardrails
- **AI Safeguards**: AI Safeguards, Safety Tiers, Approval System, YOLO Mode
- **GitHub Workflow**: GitHub Workflow, Git Worktrees, Branch Model, Delivery Modes
- **Observability**: Observability, Event Persistence, Refresh Recovery, Cost Tracking
- **Skills & Compute**: Skills System, Compute Backends
- **Infrastructure**: Infrastructure, Database Schema, Deployment, Environment Variables
- **Reference**: Glossary, API Reference, MCP Tools

## Source Code Locations

Key directories to read from when writing documentation:

| Domain | Code Location |
|--------|--------------|
| Database schema | `packages/core/src/db/schema.ts` |
| Prompt templates | `packages/core/src/prompt-templates.ts` |
| Dispatch logic | `server/routes/dispatch.ts`, `server/lib/dispatch/` |
| Agent routes | `server/routes/agent.ts` |
| Relay server | `server/lib/relay-server.ts` |
| Streaming events | `server/lib/streaming-event-log.ts` |
| Frontend stores | `src/stores/` |
| SSE parsing | `src/lib/sse-parser.ts` |
| Event hydration | `src/lib/streaming-event-hydrator.ts` |
| Agent runner | `packages/agent-runner/src/` |
| Provider adapters | `packages/agent-runner/src/providers/` |
| Worktree management | `packages/agent-runner/src/lib/worktree.ts` |
| Safety checks | `packages/agent-runner/src/lib/workdir-safety.ts` |
| Skills | `skills/`, `server/lib/skill-manager.ts` |
