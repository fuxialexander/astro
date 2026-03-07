---
name: pr-review
description: |
  Review a pull request for correctness, security, and design quality. Produces a structured
  review with severity-tagged findings, checks issue alignment, and evaluates whether the
  solution addresses the root cause. Pure analysis — does not auto-fix or push code.
  Trigger when the user says "review this PR", "check PR #N", "look at this pull request",
  "evaluate this PR", or "is this PR correct".
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# PR Review

You review pull requests for correctness, security, and design quality. You produce structured
reviews but do NOT auto-fix or push code. For automated fixing, use `/pr-shepherd` instead.

## Input

`$ARGUMENTS` — a PR number, URL, or branch name:
- `/pr-review 734` or `/pr-review #734`
- `/pr-review https://github.com/fuxialexander/astro/pull/734`

---

## Phase 1: Gather Context

1. **Read the PR metadata**:
   ```bash
   gh pr view <number> --json title,body,labels,baseRefName,headRefName
   ```

2. **Read the linked issue** — check the PR body for `Closes #N`, `Fixes #N`, or
   `Resolves #N`. If a linked issue exists, read it thoroughly. The PR MUST address
   the issue's stated requirements:
   ```bash
   gh issue view <number> --json title,body
   ```

3. **Read the diff**:
   ```bash
   gh pr diff <number>
   git diff main...HEAD --stat
   ```

4. **Read each changed file** — not just the diff, but enough surrounding code to understand
   design context (imports, callers, types, related tests). Use `Read` with offset/limit
   for large files.

5. **Check recent history** on touched files to understand prior changes:
   ```bash
   git log --oneline -5 -- <file>
   ```

6. **Read related design docs** in `docs/design/` if the change touches architecture.

---

## Phase 2: Issue Alignment

If the PR targets a specific issue, this section is mandatory.

1. **Extract requirements** from the issue body — symptoms, root cause description,
   proposed fixes, acceptance criteria, severity ratings.

2. **Map each requirement to the diff** — does the PR address it? Partially? Not at all?

3. **Flag gaps**:
   - Requirements the PR claims to fix but doesn't
   - Requirements partially addressed (e.g., fixes the symptom but not the root cause)
   - Acceptance criteria not met

4. **Note scope additions** — changes not requested by the issue. These may be valid
   (necessary refactoring, related fixes) but should be called out so reviewers know
   what was intentional vs incidental.

If no linked issue exists, note: "No linked issue. Consider adding `Closes #N` for traceability."

---

## Phase 3: Code Review

Work through each category systematically. For each finding, note the file, line range,
severity, and a concise explanation.

### Severity Levels

| Level | Meaning | Action required |
|-------|---------|-----------------|
| **Critical** | Security, data loss, broken functionality | Must fix before merge |
| **Important** | Logic errors, type safety, missing validation | Should fix |
| **Suggestion** | Style, test coverage, minor improvements | Optional |
| **Observation** | Design decisions, tradeoffs, context | No action needed |

### Security (Critical)
- **Injection**: SQL injection, command injection, XSS, path traversal
- **Credential exposure**: Secrets in code, `.env` committed, API keys in logs
- **Access control**: Missing `requireAuth` middleware, cross-user/team data leaks
- **RLS gaps**: New tables without row-level security policies

### Data Integrity (Critical)
- **Silent failures**: catch blocks that swallow errors without surfacing them
- **Race conditions**: Async operations without proper locking or ordering
- **Missing validation**: API routes without Zod schema validation at boundaries

### Logic & Correctness (Important)
- Wrong conditions, missing early returns, inverted boolean checks
- Unsafe `as` casts, missing null checks, `any` types at API boundaries
- Off-by-one errors in array indexing, pagination, range calculations
- Errors caught but not re-thrown or surfaced to the user (console.warn is not enough)

### Root Cause Analysis (Important — for bug fixes)

For every bug-fix PR, evaluate whether the fix addresses the **root cause**:

- Does the fix eliminate the actual mechanism that produces the bug?
- Or does it mask the symptom while the underlying issue remains?
- Could the same class of bug recur in a different code path?
- Are the assumptions the fix relies on (timestamps, IDs, ordering) actually reliable?

This is the most important part of reviewing a bug fix. A fix that addresses symptoms
instead of root causes creates recurring issues.

### Astro-Specific Principles (Important)
- **Provider parity**: Does the change work across all agent providers (Claude Code, Codex,
  Anthropic Direct, SLURM)? If it touches dispatch, execution, or streaming, check all providers.
- **Disconnection resilience**: Does it handle SSE drops, page refresh, WebSocket reconnection?
  Streaming handlers should tolerate partial data and late-arriving events.
- **User isolation**: Are DB queries scoped by `userId`/`teamId`? No cross-user data leakage?
- **Design doc consistency**: Does it match specifications in `docs/design/`?

### Test Coverage (Suggestion)
- New behavior without corresponding tests
- Changed behavior with tests that don't cover the new path

### Filter Out — Do NOT Flag

- Pre-existing issues not introduced by this PR
- Style preferences (formatting, naming — trust the linter)
- Hypothetical edge cases that can't happen given code constraints
- Issues on lines the PR did not modify
- Documentation gaps unless it's a public API change
- "Could be simplified" unless the complexity actively hurts readability

---

## Phase 4: Produce the Review

### Standard Format

```markdown
## PR #<number>: <title>

### Summary
[1-3 sentences: what the PR does and whether it achieves its stated goal.]

### Issue Alignment
[If linked to an issue:]
- **Issue #N**: <issue title>
- **Requirements addressed**:
  - [Requirement 1] — how the PR addresses it
  - [Requirement 2] — how the PR addresses it
- **Gaps**: [requirements not fully met, or "None"]
- **Out of scope**: [changes beyond the issue's requirements, or "None"]

[If no linked issue:]
- No linked issue. Consider adding `Closes #N` to the PR body.

### Findings

#### Critical
- **path/to/file.ts:45-52**: [Description of the issue and why it's critical].
  Suggested fix: [concrete approach].

#### Important
- **path/to/file.ts:78**: [Description]. Suggested fix: [approach].

#### Suggestions
- **path/to/file.ts:12**: [Description].

#### Observations
- [Design tradeoff or context note — no action required.]

### Verdict
[One of:]
- **Approve** — no issues found, the approach is sound
- **Approve with suggestions** — non-blocking suggestions noted above
- **Request changes** — Critical or Important issues that must be addressed before merge
```

### Clean PR Format

If the PR is clean with no issues:

```markdown
## PR #<number>: <title>

### Summary
[Description]. No issues found. The approach is sound.

### Issue Alignment
[Issue #N requirements are fully addressed. / No linked issue.]

### Verdict
**Approve**
```

---

## Important Rules

- **Read before judging** — never flag an issue based on the diff alone. Read surrounding code.
- **Root cause focus** — for bug fixes, this is the most important evaluation criterion.
- **Issue alignment is mandatory** — if a PR says "Fixes #N", verify it actually does.
- **No auto-fix** — this skill produces analysis only. Use `/pr-shepherd` to auto-fix.
- **Validate severity** — ask: would a senior engineer flag this? Is it a real bug or a nitpick?
- **Concrete suggestions** — every Critical/Important finding must include a suggested fix approach.
- **Credit good work** — if the PR has a particularly clean design or clever solution, say so.
