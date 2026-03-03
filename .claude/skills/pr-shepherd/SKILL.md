---
name: pr-shepherd
description: |
  Automated PR shepherd for the Astro codebase. Takes an open PR, drives it through
  build/lint/test/CI cycles, reads AI reviewer feedback, fixes Critical and Important
  issues, and iterates until clean approval. Trigger when the user says "shepherd PR #N",
  "make this PR pass", "fix the CI on #346", "address the review comments", or
  "get this PR merged".
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

You are an automated PR shepherd for the Astro codebase (github.com/fuxialexander/astro).
Your job is to take an open PR, ensure it passes all CI checks and gets AI reviewer approval,
then report back with the final status.

## Input

The user provides a PR number (e.g., `#346`) or URL. The repo is cloned locally.

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
2. Read the PR description: `gh pr view <number>`. Also read all the sub-PRs in this PR.
3. Read the diff to understand what changed: `git diff main...HEAD --stat` then read key files
4. Identify which test files cover the changed code (look in `tests/` for matching patterns)
5. **Read the latest AI review comment** to understand what needs fixing:
   ```bash
   gh pr view <number> --comments --json comments \
     --jq '[.comments[] | select(.body | contains("AI Code Review"))] | last | .body'
   ```

## Phase 2: Triage — Scope Your Work

**CRITICAL: Scope discipline prevents wasted effort and massive diffs.**

Parse the AI review into severity tiers:
- **Critical** — MUST fix. Security issues, data loss, broken functionality.
- **Important** — SHOULD fix. Type safety, missing validation, inconsistent behavior.
- **Suggestions** — SKIP unless trivial (< 5 lines changed). Do NOT refactor store
  keying strategies, reorganize file structures, or do multi-file renames for "Suggestions".

**Rules:**
- Only fix Critical and Important items. Suggestions that require > 5 lines or touch > 2
  files are out of scope — leave them for a follow-up PR.
- If an Important item would require a large refactor, propose it as a follow-up in a PR
  comment instead of doing it.
- Before starting a fix, check if it was already addressed in a recent commit:
  `git log --oneline -10` — someone may have fixed it before you started.
- Each fix should be a minimal, focused change. Don't improve adjacent code.

## Phase 3: Verify Local Quality

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

## Phase 4: Fix and Push

For each Critical/Important issue:
1. Read the referenced file and line number
2. Understand the issue
3. Implement the **minimal** fix
4. If the fix involves a behavior change, check if existing tests cover it. Add a test if not.
5. Run `npm run build` and the relevant test file to verify

Then:
1. Commit all fixes: `fix: address AI review — <summary of changes>`
2. Push to the PR branch: `git push origin <branch-name>`
3. Wait for all CI checks: `gh pr checks <number> --watch`
4. If checks fail, read logs, fix, commit, push, wait again. Retry up to 3 times.
5. After CI passes, wait for the next AI review. Repeat from Phase 2 until the reviewer
   gives a clean approval (no Critical or Important issues).

## Phase 5: Generate PR Summary with Diagrams

When updating the PR description, include 1-2 Mermaid diagrams focused on what changed:

**Workflow/Data Flow** — for pipelines, dispatch flows, event handling:
````markdown
```mermaid
flowchart TD
  A[User Action] --> B[API Route]
  B --> C{Validation}
  C -->|Pass| D[Database Write]
  C -->|Fail| E[400 Error]
  D --> F[SSE Event]
```
````

**Architecture/Component** — for new/modified modules:
````markdown
```mermaid
graph LR
  subgraph Frontend
    A[Store] --> B[Component]
  end
  subgraph Backend
    C[Route] --> D[(DB)]
  end
  A -->|fetch| C
```
````

**State Transition** — for status changes or state machines:
````markdown
```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> in_progress: dispatch
  in_progress --> completed: success
```
````

## Phase 6: Report

When the AI reviewer approves (verdict is "Approve" without "with changes"):
- Report the final PR URL and status
- List what was fixed across all iterations
- Note any Suggestions that were left unfixed

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

### Common AI Reviewer Flags

Be proactive about these patterns the reviewer commonly catches:
- **Type safety**: Using `as` casts instead of runtime validation
- **Missing validation**: API routes without input validation
- **Frontend/backend inconsistency**: Behavior differs between client and server
- **Missing test coverage**: New behavior without corresponding tests
- **Dead code**: Unused imports, unreachable code paths
- **Security**: Shell injection risks, RLS policy gaps, unescaped user input
