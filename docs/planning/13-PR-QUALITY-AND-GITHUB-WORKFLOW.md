# PR Quality and GitHub Workflow

## Problem

When Astro submits PRs after task execution, the PR title and body often just echo the task description from the plan node rather than describing what was actually done. This makes PRs uninformative and hard to review.

**Root cause:** The PR body relies on a structured JSON summary generated via a follow-up Claude SDK turn. When that summary is missing (timeout, parse error, non-SDK provider), the fallback is the raw task description.

## Current Workflow (v0.1.32)

### How a Task Becomes a PR

```
1. Plan node dispatched (title + description)
         ↓
2. Context Assembler builds execution prompt
   (vision doc + dependency outputs + graph position + instructions)
         ↓
3. Agent executes in git worktree
   Branch: astro/{shortProjectId}-{shortNodeId}
         ↓
4. Agent finishes → Claude SDK adapter resumes session
   for a structured JSON summary (follow-up turn)
         ↓
5. Task executor builds PR title + body from summary
         ↓
6. pushAndCreatePR() → git push → gh pr create
```

### Key Files

| Component | File | Function |
|-----------|------|----------|
| Execution prompt | `packages/core/src/prompt-templates.ts` | `buildTaskExecutionPrompt()` |
| Summary generation | `astro-agent/src/providers/claude-sdk-adapter.ts` | `generateSummary()` (line 491) |
| PR body construction | `astro-agent/src/lib/task-executor.ts` | Lines 788-829 |
| PR creation | `astro-agent/src/lib/git-pr.ts` | `pushAndCreatePR()` |
| Server-side hook | `server/lib/events/hooks/pr-creation-hook.ts` | Records PR data to DB |
| Summary prompt (unused) | `packages/core/src/prompt-templates.ts` | `buildSummaryPrompt()` (line 601) |

### PR Body: Two Code Paths

**Path A — Summary exists (good PR, `task-executor.ts:804-816`):**
```
## Summary
{summary.workCompleted}

## Overview
{summary.executiveSummary}

## Changes
- {summary.keyFindings[0]}
- {summary.keyFindings[1]}

## Files Changed
- `src/middleware/auth.ts`
- `src/routes/auth.ts`

## Astro
[View task in Astro](...)

---
*Created by Astro task automation*
```

**Path B — No summary (bad PR, `task-executor.ts:817-818`):**
```
## Task
{task.description || task.prompt.slice(0, 500)}

---
*Created by Astro task automation*
```

### Six Failure Modes for Summary Generation

| # | Failure | Where | Impact |
|---|---------|-------|--------|
| 1 | **Only Claude SDK generates summaries** | `claude-sdk-adapter.ts:162` — only called for `isExecutionTask && result.success` | Codex, OpenClaw, OpenCode, Claude CLI never produce summaries |
| 2 | **`resume` + `outputFormat` SDK bug** | `claude-sdk-adapter.ts:486-488` | Cannot use structured output; must parse text as JSON |
| 3 | **30-second timeout** | `claude-sdk-adapter.ts:502` | Complex tasks with large context may not summarize in time |
| 4 | **JSON parse failure** | `claude-sdk-adapter.ts:573-581` | Agent wraps JSON in prose, adds trailing commas, or returns partial JSON |
| 5 | **No session to resume** | `claude-sdk-adapter.ts:495-498` | Session wasn't persisted → summary skipped |
| 6 | **`executiveSummary` field missing** | `claude-sdk-adapter.ts:575-576` | JSON parses but key field is empty — only logged, not handled |

### What the Agent Already Writes (Currently Wasted)

The execution prompt (`packages/core/src/prompt-templates.ts:502-515`) instructs every agent:

```
**IMPORTANT: When you have finished the task, you MUST end your response
with an executive summary in exactly this format:**

## Executive Summary
**Status:** success | partial | failure
**What was done:** One sentence describing the overall outcome.
- Key finding or change 1
- Key finding or change 2
```

This text appears in the agent's output but is **never parsed or used for the PR body**.

## Proposed Fixes

### Fix 1: Parse In-Stream Executive Summary (All Providers)

**Priority: P0 | Effort: 0.5 day**

Parse the executive summary the agent already writes in its output text. This works for ALL providers since the execution prompt instructs every agent to write it.

```typescript
// New: src/lib/parse-executive-summary.ts

export function parseExecutiveSummaryFromOutput(output: string): Partial<ExecutionSummary> | undefined {
  // Match the "## Executive Summary" block
  const summaryBlock = output.match(
    /## Executive Summary[\s\S]*?\*\*Status:\*\*\s*(success|partial|failure)[\s\S]*?\*\*What was done:\*\*\s*(.+)/
  );
  if (!summaryBlock) return undefined;

  const status = summaryBlock[1].trim() as 'success' | 'partial' | 'failure';
  const workCompleted = summaryBlock[2].trim();

  // Extract bullet points after "What was done"
  const bulletSection = output.match(/\*\*What was done:\*\*[^\n]*\n((?:[-*]\s+[^\n]+\n?)+)/);
  const keyFindings = bulletSection
    ? bulletSection[1].split('\n')
        .filter(l => /^[-*]\s+/.test(l))
        .map(l => l.replace(/^[-*]\s+/, '').trim())
    : [];

  return { status, workCompleted, executiveSummary: workCompleted, keyFindings, filesChanged: [], followUps: [] };
}
```

**Integration in `task-executor.ts` (after result, before PR creation):**
```typescript
if (!result.summary && result.output) {
  const parsed = parseExecutiveSummaryFromOutput(result.output);
  if (parsed) {
    result.summary = {
      status: parsed.status ?? 'success',
      workCompleted: parsed.workCompleted ?? 'Task completed',
      executiveSummary: parsed.executiveSummary ?? parsed.workCompleted ?? '',
      keyFindings: parsed.keyFindings ?? [],
      filesChanged: parsed.filesChanged ?? [],
      followUps: parsed.followUps ?? [],
    };
    console.log(`[executor] Task ${task.id}: parsed in-stream executive summary`);
  }
}
```

### Fix 2: Git Diff Fallback (All Providers)

**Priority: P0 | Effort: 0.5 day**

When no summary is available at all, generate a useful PR body from git state:

```typescript
// In task-executor.ts, in the PR body construction:
if (!summary) {
  prBodyParts.push(`## Task\n\n**${task.title}**\n\n${task.description || ''}`);

  // Add commit log
  try {
    const { stdout: commitLog } = await execFileAsync(
      'git', ['-C', prepared.workingDirectory, 'log', '--oneline', `origin/${baseBranch}..HEAD`],
      { timeout: 5000 }
    );
    if (commitLog.trim()) {
      prBodyParts.push(`## Commits\n\n${commitLog.trim().split('\n').map(l => `- ${l}`).join('\n')}`);
    }
  } catch {}

  // Add diff stat
  try {
    const { stdout: diffStat } = await execFileAsync(
      'git', ['-C', prepared.workingDirectory, 'diff', '--stat', `origin/${baseBranch}..HEAD`],
      { timeout: 5000 }
    );
    if (diffStat.trim()) {
      prBodyParts.push(`## Diff Summary\n\n\`\`\`\n${diffStat.trim()}\n\`\`\``);
    }
  } catch {}
}
```

### Fix 3: Robust JSON Parsing in Claude SDK Adapter

**Priority: P0 | Effort: 0.5 day**

Make the existing summary generation more resilient:

**a) Better JSON extraction:**
```typescript
function extractJsonFromText(text: string): Record<string, unknown> | null {
  let cleaned = text.trim();

  // Strip markdown fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Try direct parse
  try { return JSON.parse(cleaned); } catch {}

  // Try extracting JSON object from surrounding prose
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}

    // Try fixing trailing commas
    const fixed = jsonMatch[0].replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(fixed); } catch {}
  }

  return null;
}
```

**b) Graceful field defaults:**
```typescript
const raw = extractJsonFromText(textOutput);
if (!raw) return undefined;

return {
  status: (raw.status as string) ?? 'success',
  workCompleted: (raw.workCompleted as string) ?? 'Task completed',
  executiveSummary: (raw.executiveSummary as string) ?? (raw.workCompleted as string) ?? '',
  keyFindings: Array.isArray(raw.keyFindings) ? raw.keyFindings : [],
  filesChanged: Array.isArray(raw.filesChanged) ? raw.filesChanged : [],
  followUps: Array.isArray(raw.followUps) ? raw.followUps : [],
  prUrl: (raw.prUrl as string) ?? undefined,
  prNumber: (raw.prNumber as number) ?? undefined,
  branchName: (raw.branchName as string) ?? undefined,
};
```

**c) Scale timeout with task complexity:**
```typescript
const toolCallCount = sessionContext.toolCallCount ?? 0;
const timeoutMs = toolCallCount > 20 ? 60_000 : 30_000;
const summaryTimeout = setTimeout(() => summaryAbort.abort(), timeoutMs);
```

### Fix 4: Server-Side Summary Generation (All Non-SDK Providers)

**Priority: P1 | Effort: 1 day**

`packages/core/src/prompt-templates.ts` already has `buildSummaryPrompt()` (line 601) — it takes task title, description, output, and file changes and produces a structured summary. This is currently **unused**.

Wire it into the dispatch engine as a fallback for providers that don't generate their own summaries:

```typescript
// In dispatch-engine.ts, after receiving task.result from agent-runner:

if (!result.summary && result.output) {
  // Try to generate summary server-side using buildSummaryPrompt()
  try {
    const summaryPrompt = buildSummaryPrompt({
      taskTitle: node.title,
      taskDescription: node.description,
      executionOutput: result.output,
      fileChanges: result.artifacts?.filter(a => a.type === 'file').map(a => ({
        path: a.path ?? a.name,
        action: 'modified',
      })) ?? [],
      status: result.status === 'completed' ? 'success' : 'failure',
    });

    // Call AI to summarize (single turn, no tools, fast)
    const summaryJson = await this.aiClient.generateText(summaryPrompt, { maxTokens: 1000 });
    result.summary = JSON.parse(summaryJson);
  } catch (err) {
    console.warn(`[dispatch] Server-side summary generation failed: ${err}`);
  }
}
```

This approach works for **Codex, OpenClaw, OpenCode, and Claude CLI** since it runs server-side after receiving the result.

### Fix 5: Enrich Codex Adapter Specifically

**Priority: P2 | Effort: 0.5 day**

In addition to Fix 4 (server-side), the Codex adapter can generate its own summary by running a second short Codex invocation with `--read-only` and a summary prompt. This is optional if Fix 1 + Fix 4 work well.

## Summary Fallback Chain (After All Fixes)

```
1. Structured JSON summary from follow-up turn
   (Claude SDK only, with robust JSON parsing)
      ↓ fails
2. Parse in-stream executive summary from agent output text
   (all providers — agent already writes it per prompt instructions)
      ↓ fails
3. Server-side summary generation via buildSummaryPrompt()
   (all providers — runs on Astro server using existing prompt template)
      ↓ fails
4. Git diff + commit log auto-generated PR body
   (all providers — fallback from actual git state)
      ↓ fails (no git changes)
5. Raw task description
   (last resort — current behavior)
```

Every PR should get at least layer 2 or 4. Layer 5 should be extremely rare.

## Implementation Plan

### Phase 1: Quick Wins (1.5 days)

All in `astro-agent` repo:

1. **New file**: `src/lib/parse-executive-summary.ts` — Parse in-stream executive summary
2. **Edit**: `src/providers/claude-sdk-adapter.ts` — Robust JSON extraction, field defaults, scaled timeout
3. **Edit**: `src/lib/task-executor.ts` — Integrate in-stream parsing + git diff fallback
4. **Tests**: Unit tests for `parseExecutiveSummaryFromOutput()` and `extractJsonFromText()`

### Phase 2: Server-Side Summary (1 day)

In `astro` repo:

1. **Edit**: `server/lib/dispatch/dispatch-engine.ts` — Wire `buildSummaryPrompt()` for non-SDK results
2. **Test**: Integration test verifying summary generation for Codex results

### Phase 3: Verification (0.5 day)

1. End-to-end test: dispatch task via Claude SDK → verify rich PR body
2. End-to-end test: dispatch task via Codex → verify server-side summary → rich PR body
3. Edge case test: summary timeout → in-stream fallback → git diff fallback

## GitHub Issue

Tracked at: https://github.com/astro-anywhere/astro-agent/issues/20

## Related Documents

- `docs/planning/01-GITHUB-WORKFLOWS-AND-CI.md` — GitHub workflow improvements and AI code review
- `docs/planning/12-PROVIDER-ADOPTION-OPENCLAW-OPENCODE.md` — Provider SDK adapters (all benefit from this fix)
