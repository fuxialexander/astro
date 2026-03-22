---
name: pr-shepherd
description: |
  Code review and CI pipeline for any project. Reviews a PR for bugs, security issues,
  and architecture violations, then runs build/lint/test locally, fixes all Critical and
  Important issues, and pushes until CI passes. Combines code review and CI pipeline in
  a single pass. Works with any TypeScript/JavaScript, Python, or general codebase.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
auto: false
---

# PR Shepherd

You are a local CI pipeline and code reviewer. Your job is to take an open PR, run a
thorough code review AND all CI checks locally, fix every real issue, and push until
the PR is clean and mergeable.

## Input

`$ARGUMENTS` — a PR number, URL, or "my changes":
- `/pr-shepherd 42` or `/pr-shepherd #42`
- `/pr-shepherd https://github.com/owner/repo/pull/42`
- `/pr-shepherd my changes` to review uncommitted or staged changes

## Phase 0: Setup

1. **Detect the project type** — Look for `package.json`, `pyproject.toml`, `Cargo.toml`,
   `go.mod`, or `Makefile` to determine the build system and test framework.
2. **Check out the PR branch**:
   ```bash
   gh pr checkout <number>
   ```
3. **Pull latest** — Someone may have already pushed fixes: `git pull origin <branch>`

## Phase 1: Understand the PR

1. Read the PR description: `gh pr view <number>`.
2. Read the diff to understand what changed:
   ```bash
   gh pr diff <number>
   git diff main...HEAD --stat
   ```
3. **Read each changed file** — not just the diff, but enough surrounding code to understand
   context (imports, callers, related types).
4. **Identify test files** that cover the changed code.

## Phase 2: Code Review

Work through each category systematically. For each issue found, note the file, line range,
and a concise explanation with a suggested fix. Assign a severity.

### Security (Critical)
- **Injection**: SQL injection, command injection, XSS, path traversal
- **Credential exposure**: Secrets in code, `.env` files committed, API keys in logs
- **Access control**: Missing auth checks, cross-user data leaks

### Data Integrity (Critical)
- **Silent failures**: catch blocks that swallow errors without surfacing them
- **Race conditions**: Async operations without proper locking
- **Missing validation**: API routes without schema validation at boundaries

### Logic Errors (Important)
- **Incorrect control flow**: Wrong conditions, missing early returns, inverted checks
- **Type safety**: Unsafe casts, missing null checks
- **Error propagation**: Errors caught but not re-thrown or surfaced

### Test Coverage (Suggestions)
- New behavior without corresponding tests
- Changed behavior with tests that don't cover the new path

### Code Quality (Suggestions)
- Dead code, unused imports
- Over-engineering (premature abstractions)

### Validate Findings

For each potential issue, ask yourself:
- Is this a **real bug** or a stylistic preference?
- Is this **introduced by this PR** or pre-existing?
- Would a **senior engineer** flag this, or is it a pedantic nitpick?

**Filter out:**
- Pre-existing issues not introduced by this PR
- Style preferences (trust the linter)
- Hypothetical edge cases that can't happen given the constraints
- Issues on lines the PR did not modify

## Phase 3: Local CI — Build, Lint, Test

Run these checks in order. Adapt commands to the detected project type.

### TypeScript/JavaScript Projects
```bash
npm run build     # or pnpm build, yarn build
npm run lint      # ESLint/Biome
npm test          # Vitest/Jest/Mocha
```

### Python Projects
```bash
python -m pytest
python -m ruff check .   # or flake8, pylint
python -m mypy .         # if configured
```

### General
Look at the project's `Makefile`, `package.json` scripts, or CI config (`.github/workflows/`)
to determine the correct build/lint/test commands.

Fix ALL build/type errors. Type errors are hard blockers.

## Phase 4: Triage & Fix

### Triage

Combine findings from Phase 2 (code review) and Phase 3 (CI failures):

- **Critical** — MUST fix. Security issues, data loss, broken functionality, build failures.
- **Important** — SHOULD fix. Type safety, missing validation, lint errors.
- **Suggestions** — SKIP unless trivial (< 5 lines). Leave for follow-up.

### Fix

For each Critical/Important issue:
1. Read the referenced file in full context
2. Implement the **minimal** fix
3. Run build and relevant tests to verify
4. Each fix should be a minimal, focused change

## Phase 5: Push & Iterate

1. Commit all fixes: `fix: address review — <summary>`
2. Rebase onto latest base branch:
   ```bash
   git fetch origin main
   git rebase origin/main
   ```
3. Push: `git push origin <branch-name>`
4. Wait for CI checks: `gh pr checks <number> --watch`
5. If checks fail, fix, commit, push again. Retry up to 3 times.

## Phase 5.5: Local AI Review

Run a self-review using a subagent, then post as PR comment.

1. **Launch a subagent** to review the diff:
   - Read the full diff and all changed files
   - Apply security, data integrity, logic, and architecture review criteria
   - Produce a structured review with Critical/Important/Suggestions and a verdict
   - The subagent ONLY reviews — it does NOT fix code

2. **Post the review as a PR comment**:
   ```bash
   gh pr comment <number> --body "$(cat <<'EOF'
   ## AI Code Review

   <review content from subagent>

   ---
   <sub>Reviewed by AI via PR Shepherd</sub>
   EOF
   )"
   ```

3. If the verdict is NOT "Approve", fix Critical/Important issues, commit, push,
   and re-run Phase 5.5 until the review passes.

## Phase 6: Report

```
## Summary
This PR [brief description].

## Critical
- **path/to/file.ts:45-52**: [Issue]. → [Fix].

## Important
- **path/to/file.ts:78**: [Issue]. → [Fix].

## Suggestions (not fixed)
- **path/to/file.ts:12**: [Issue]. → [Recommended follow-up].

## CI Status
- Build: PASS/FAIL
- Lint: PASS/FAIL
- Tests: PASS/FAIL

## Verdict
[Approve | Approve with suggestions | Changes remaining]
```

## Important Rules

- One logical change per commit
- Use conventional commit format: `fix:`, `feat:`, `chore:`, `test:`
- Never amend commits that are already pushed
- Never force push
- If you've spent > 20 tool calls without progress, report status and stop
