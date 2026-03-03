---
name: astro-code-review
description: |
  Project-specific code review for the Astro codebase. Reviews a PR (or local diff) for
  bugs, security issues, CLAUDE.md compliance, and Astro-specific architectural principles.
  Produces a structured report with severity levels. Trigger when the user says "review PR #N",
  "code review this PR", "review my changes", or "check this PR for issues".
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
---

# Astro Code Review

You are a senior code reviewer for the Astro platform — a planning-first AI platform for
software developers and researchers. Your job is to review a PR or local diff and produce
a structured, high-signal report of real issues.

## Input

The user provides either:
- A PR number or URL (e.g., `#398` or `https://github.com/fuxialexander/astro/pull/398`)
- "my changes" / "local diff" to review uncommitted or staged changes

## Step 1: Gather Context

### For a PR:
```bash
gh pr view <number> --json title,body,additions,deletions,changedFiles
gh pr diff <number>
```

### For local changes:
```bash
git diff --stat
git diff
```

Then:
1. **Read CLAUDE.md** at the repo root to understand conventions and rules.
2. **Read each changed file** — not just the diff, but enough surrounding code to understand
   the context (imports, callers, related tests).
3. **Identify test files** that cover the changed code: look in `tests/` for matching patterns.

## Step 2: Review Checklist

Work through each category systematically. For each issue found, note the file, line range,
and a concise explanation with a suggested fix.

### Security (Critical)
- **Injection**: SQL injection, command injection, XSS, path traversal
- **Credential exposure**: Secrets in code, `.env` files committed, API keys in logs
- **Access control**: Missing `requireAuth` middleware, cross-user/cross-team data leaks
- **RLS policy gaps**: New tables without row-level security policies

### Data Integrity (Critical)
- **Silent failures**: catch blocks that swallow errors without surfacing them
- **Race conditions**: Async operations without proper locking or ordering
- **Missing validation**: API routes without Zod schema validation at boundaries
- **UUID handling**: Client-generated IDs sent to UUID columns without validation

### Logic Errors (Important)
- **Incorrect control flow**: Wrong conditions, missing early returns, inverted checks
- **Type safety**: Unsafe `as` casts, missing null checks, `any` types at boundaries
- **Error propagation**: Errors caught but not re-thrown or surfaced to the user
- **Off-by-one**: Array indexing, pagination, range calculations

### Astro-Specific Principles (Important)
- **Provider parity**: Every feature must work across all agent providers (Claude Code,
  Codex, Anthropic Direct, SLURM). If the change touches dispatch, execution, or streaming,
  verify it handles all providers — not just the one the author tested.
- **Resilience under disconnection**: SSE connections drop, WebSocket reconnects happen,
  users refresh mid-task. Check that the change handles disconnection, reconnection, and
  state recovery gracefully. Streaming handlers should tolerate partial data.
- **User isolation**: All data must be scoped per-user and per-team. Check queries filter
  by `userId`/`teamId`, endpoints enforce ownership, no cross-user data leakage is possible.
- **Design doc consistency**: If unsure how a component should behave, check `docs/design/`
  (ARCHITECTURE.md, BACKEND.md, FRONTEND.md, DATA_MODEL.md, WORKSPACE_V2.md).

### Submodule Rules (Important)
- `packages/agent-runner/` is a git submodule — changes must go to the standalone repo
  (`github.com/astro-anywhere/astro-agent`), not be submitted here.
- If the PR modifies files under `packages/agent-runner/`, flag it.

### Test Coverage (Suggestions)
- New behavior without corresponding tests
- Changed behavior with tests that don't cover the new path
- Test isolation issues (hardcoded names, shared state between tests)

### Code Quality (Suggestions)
- Dead code, unused imports
- Over-engineering (premature abstractions, unnecessary configurability)
- Missing error messages (generic "something went wrong" instead of descriptive errors)

## Step 3: Cross-Reference Historical Context

For each file with changes:
```bash
git log --oneline -5 -- <file>
```

Check if:
- Recent commits addressed similar issues (don't re-flag what was already fixed)
- The change reverts or contradicts a recent intentional change
- Prior PRs had review comments that apply to this change

## Step 4: Validate Findings

For each potential issue, ask yourself:
- Is this a **real bug** or a stylistic preference?
- Is this **introduced by this PR** or pre-existing?
- Would a **senior engineer** flag this, or is it a pedantic nitpick?
- Would a **linter, typechecker, or compiler** catch this instead?

**Filter out:**
- Pre-existing issues not introduced by this PR
- Style preferences (trust the linter)
- Documentation gaps unless it's a public API
- "Could be simplified" unless the complexity actively hurts readability
- Changes in test files unless they test the wrong thing

## Step 5: Output

Produce a structured review. Start with a 1-2 sentence summary. Then list findings by
severity. For each finding, include the file path, line range, and a concise explanation
with a suggested fix.

### Format

```
## Summary
This PR [brief description of purpose and approach].

## Critical
- **path/to/file.ts:45-52**: [Description of the issue]. → [Suggested fix].

## Important
- **path/to/file.ts:78**: [Description]. → [Suggested fix].

## Suggestions
- **path/to/file.ts:12**: [Description]. → [Suggested fix].

## Verdict
[One of the following:]
- Approve — no issues found
- Approve with changes — non-blocking issues to address
- Request changes — critical issues that must be fixed
```

If the PR looks good with no issues, say so briefly:

```
## Summary
This PR [description]. No issues found.

## Verdict
Approve
```

### What NOT to Flag
- Style preferences (formatting, naming) — the linter handles this
- General code quality that isn't specifically broken
- Hypothetical edge cases that can't happen given the code constraints
- Issues on lines the PR did not modify
