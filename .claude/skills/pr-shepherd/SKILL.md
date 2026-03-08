---
name: pr-shepherd
description: |
  Local GitHub Action for the Astro codebase. Reviews a PR for bugs, security issues,
  and Astro-specific architecture violations, then runs build/lint/test locally, fixes
  all Critical and Important issues, and pushes until CI passes. Combines code review
  and CI pipeline in a single pass. Trigger when the user says "review PR #N",
  "shepherd PR #N", "check this PR", "make this PR pass", "fix the CI on #346",
  "address the review comments", or "get this PR merged".
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# PR Shepherd

You are a local GitHub Action for the Astro codebase (github.com/fuxialexander/astro).
Your job is to take an open PR, run a thorough code review AND all CI checks locally,
fix every real issue, and push until the PR is clean and mergeable.

You replace the GitHub Actions CI pipeline — build, lint, test, and AI code review —
with a single local pass that's faster and can auto-fix what it finds.

## Input

`$ARGUMENTS` — a PR number, URL, or "my changes":
- `/pr-shepherd 398` or `/pr-shepherd #398`
- `/pr-shepherd https://github.com/fuxialexander/astro/pull/398`
- `/pr-shepherd my changes` to review uncommitted or staged changes

## Phase 0: Setup — Workspace Isolation

**CRITICAL: Get your workspace right FIRST. Worktree problems are the #1 cause of agent failure.**

1. **Work directly on the PR branch** — do NOT create nested worktrees.
   ```bash
   gh pr checkout <number>
   ```
2. **If you are already inside a worktree** (check `git worktree list`), work from that
   worktree directly. Do NOT create a worktree inside a worktree — this creates
   nested paths like `.astro/worktrees/X/.claude/worktrees/Y/` that will break.
3. **If your CWD becomes invalid** (e.g., a worktree was deleted underneath you), do NOT
   spend tool calls trying to recover. Instead:
   - `cd` to the main repo root
   - `git worktree prune` to clean up stale references
   - Re-checkout the PR branch and start fresh
4. **Before pushing, rebase onto latest main** to avoid merge conflicts:
   ```bash
   git fetch origin main
   git rebase origin/main
   ```
   If rebase conflicts arise, resolve them, then `git rebase --continue`.

## Phase 1: Understand the PR

1. **Pull latest** — Someone may have already pushed fixes: `git pull origin <branch>`
2. Read the PR description: `gh pr view <number>`.
3. Read the diff to understand what changed:
   ```bash
   gh pr diff <number>
   git diff main...HEAD --stat
   ```
4. **Read each changed file** — not just the diff, but enough surrounding code to understand
   context (imports, callers, related types).
5. **Identify test files** that cover the changed code: look in `tests/` for matching patterns.
6. **Read the latest AI review comment** (if any) to understand prior feedback:
   ```bash
   gh pr view <number> --comments --json comments \
     --jq '[.comments[] | select(.body | contains("AI Code Review"))] | last | .body'
   ```

## Phase 2: Code Review

Work through each category systematically. For each issue found, note the file, line range,
and a concise explanation with a suggested fix. Assign a severity.

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

### Cross-Reference Historical Context

For each file with changes:
```bash
git log --oneline -5 -- <file>
```

Check if:
- Recent commits addressed similar issues (don't re-flag what was already fixed)
- The change reverts or contradicts a recent intentional change

### Validate Findings

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
- Issues on lines the PR did not modify

## Phase 3: Local CI — Build, Lint, Test

Run these checks in order. If any fail, fix the code before moving on.

### Build
```bash
npm run build
```
Fix ALL TypeScript errors. Type errors are hard blockers.

### Lint
```bash
npm run lint
```
Fix lint errors in files changed by the PR. Ignore pre-existing lint errors in
`packages/agent-runner/` — that's a git submodule with its own repo.

### Tests
```bash
npm test
```
Focus on test files relevant to the PR changes. Run specific tests first:
```bash
npx vitest run tests/<relevant-file>.test.ts
```

Known flaky/pre-existing failures you can ignore:
- `tests/workspace-v2/` — known flaky
- `tests/dispatch-engine.test.ts` — known pre-existing issues

If any check fails, fix the code, commit, and re-run.

## Phase 4: Triage & Fix

### Triage

Combine findings from Phase 2 (code review) and Phase 3 (CI failures) into severity tiers:

- **Critical** — MUST fix. Security issues, data loss, broken functionality, build failures.
- **Important** — SHOULD fix. Type safety, missing validation, inconsistent behavior, lint errors.
- **Suggestions** — SKIP unless trivial (< 5 lines changed). Do NOT refactor store keying
  strategies, reorganize file structures, or do multi-file renames for "Suggestions".

**Rules:**
- Only fix Critical and Important items. Suggestions that require > 5 lines or touch > 2
  files are out of scope — leave them for a follow-up PR.
- If an Important item would require a large refactor, propose it as a follow-up in a PR
  comment instead of doing it.
- Before starting a fix, check if it was already addressed in a recent commit:
  `git log --oneline -10` — someone may have fixed it before you started.
- Each fix should be a minimal, focused change. Don't improve adjacent code.

### Fix

For each Critical/Important issue:
1. Read the referenced file and line number
2. Understand the issue in full context
3. Implement the **minimal** fix
4. If the fix involves a behavior change, check if existing tests cover it. Add a test if not.
5. Run `npm run build` and the relevant test file to verify

## Phase 5: Push & Iterate

1. Commit all fixes: `fix: address review — <summary of changes>`
2. Push to the PR branch: `git push origin <branch-name>`
3. Wait for all CI checks: `gh pr checks <number> --watch`
4. If checks fail, read logs, fix, commit, push, wait again. Retry up to 3 times.
5. After CI passes, check for new AI review comments. Repeat from Phase 2 if the reviewer
   flags new Critical or Important issues.

## Phase 5.5: Local AI Review (replaces GitHub Actions AI review)

GitHub Actions CI may be unavailable (exhausted minutes, disabled workflows). Run the AI
code review locally using a subagent, then post it as a PR comment.

1. **Launch a subagent** to perform the AI review. The subagent should:
   - Read the full diff (`gh pr diff <number>`)
   - Read all changed files in full context
   - Apply the review criteria from `.github/workflows/ai-review.yml` (security, data
     integrity, logic errors, Astro-specific principles, provider parity, user isolation)
   - Produce a structured review with Critical/Important/Suggestions and a verdict

2. **Post the review as a PR comment**:
   ```bash
   gh pr comment <number> --body "$(cat <<'EOF'
   ## 🤖 AI Code Review

   <review content from subagent>

   ---
   <sub>Reviewed by Claude Code (local) via Astro CI</sub>
   EOF
   )"
   ```

3. **If the review finds Critical or Important issues** that weren't caught in Phase 2-4,
   go back and fix them before proceeding to Phase 6.

## Phase 6: Report

Produce a structured report summarizing what was found and fixed.

### Format

```
## Summary
This PR [brief description of purpose and approach].

## Critical
- **path/to/file.ts:45-52**: [Description of the issue]. → [Fix applied].

## Important
- **path/to/file.ts:78**: [Description]. → [Fix applied].

## Suggestions (not fixed)
- **path/to/file.ts:12**: [Description]. → [Recommended follow-up].

## CI Status
- Build: PASS/FAIL
- Lint: PASS/FAIL
- Tests: PASS/FAIL (N/N passing)

## Verdict
[One of the following:]
- Approve — no issues found, CI passes
- Approve with suggestions — non-blocking suggestions noted above
- Changes remaining — critical issues that could not be auto-fixed
```

If the PR looks good with no issues, say so briefly:

```
## Summary
This PR [description]. No issues found. CI passes.

## Verdict
Approve
```

## Important Rules

### Worktree Hygiene
- NEVER create a worktree inside another worktree. Check `git worktree list` first.
- If you find nested worktree paths, run `git worktree prune` and start over from repo root.
- Before starting work, clean up stale worktrees:
  ```bash
  git worktree prune
  git worktree list
  ```

### Submodule: `packages/agent-runner/`
- NEVER modify files inside `packages/agent-runner/` directly
- NEVER run `git add packages/agent-runner` unless you explicitly updated the submodule pointer
- Lint errors inside it are pre-existing — ignore them

### Commit Hygiene
- One logical change per commit
- Use conventional commit format: `fix:`, `feat:`, `chore:`, `test:`
- Never amend commits that are already pushed
- Never force push

### Test Strategy
- Check if existing tests cover a change before writing new ones
- If a new behavior is added, add a test for it
- Run specific test files first, then the full suite
- The test server uses PGlite (in-memory Postgres) — no external DB needed

### Recovery Protocol

If things go wrong (worktree deleted, CWD invalid, build broken after many attempts):
1. **Stop.** Do not keep retrying the same approach.
2. `cd` to the repo root. Run `git worktree prune`.
3. Check what's actually on the branch: `git log --oneline -5`
4. If your changes are committed, push what you have and let CI evaluate.
5. If your changes are lost, start fresh — redo only Critical/Important fixes.
6. **If you've spent > 20 tool calls without progress**, report current status and stop.

### What NOT to Flag
- Style preferences (formatting, naming) — the linter handles this
- General code quality that isn't specifically broken
- Hypothetical edge cases that can't happen given the code constraints
- Issues on lines the PR did not modify
