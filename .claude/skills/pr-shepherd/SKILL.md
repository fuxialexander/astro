---
name: pr-shepherd
description: |
  Automated PR shepherd for the Astro codebase (github.com/fuxialexander/astro).
  Takes an open PR number or URL, checks out the branch, ensures it passes build/lint/tests,
  waits for CI, reads AI reviewer feedback, fixes Critical and Important issues, generates
  PR summaries with Mermaid architecture diagrams, and iterates until the PR gets a clean
  approval. Use this skill whenever the user mentions shepherding a PR, fixing CI failures
  on a PR, addressing AI review comments, getting a PR to pass checks, or wants automated
  PR quality assurance. Also trigger when the user says things like "make this PR pass",
  "fix the CI on #346", "shepherd PR 350", "get this PR merged", "address the review
  comments on my PR", or "update the PR description".
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

You are an automated PR shepherd for the Astro codebase. Your job is to take an open PR,
drive it through build, lint, test, CI, and AI review cycles until it's ready to merge.

## Input

The user provides a PR number (e.g., `#346`) or URL. The repo is cloned locally.

## Phase 1: Understand the PR

1. Check out the PR branch:
   ```bash
   gh pr checkout <number>
   ```

2. Read the PR description and any linked/sub-PRs:
   ```bash
   gh pr view <number>
   ```
   Also read all the sub-PRs referenced in this PR.

3. Read the diff to understand scope:
   ```bash
   git diff main...HEAD --stat
   ```
   Then read key changed files to understand the actual code changes.

4. Identify relevant test files — look in `tests/` for files that match the changed modules.

## Phase 2: Verify Local Quality

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
Fix lint errors in files changed by the PR. Ignore pre-existing lint errors in `packages/agent-runner/` — that's a git submodule with its own repo.

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

If any check fails, fix the code, commit with a descriptive message (`fix: <what you fixed>`), and re-run.

## Phase 3: Wait for CI

1. Push to the PR branch:
   ```bash
   git push origin <branch-name>
   ```

2. Wait for CI checks:
   ```bash
   gh pr checks <number> --watch
   ```

3. If checks fail:
   - Read the failure logs from the GitHub Actions URL
   - Fix the failing code
   - Commit and push
   - Wait for checks again
   - Retry up to 3 times before asking the user for help

## Phase 4: Address AI Reviewer Feedback

After CI passes, read the latest AI review comment:
```bash
gh pr view <number> --comments --json comments --jq '[.comments[] | select(.body | contains("AI Code Review"))] | last | .body'
```

Parse the review into severity levels:
- **Critical** — Must fix before merge
- **Important** — Should fix before merge
- **Suggestions** — Nice-to-have, fix if easy and low-risk

For each Critical and Important issue:

1. Read the referenced file and line number
2. Understand what the reviewer is flagging
3. Implement the fix
4. Check if existing tests cover the changed behavior. If a new behavior was added (e.g., returning 403 for a new condition), add a test.
5. Run `npm run build` and the relevant test file to verify

Commit all fixes together:
```bash
git commit -m "fix: address AI review — <summary of changes>"
```

Push and wait for CI + a new AI review. Repeat this cycle until the AI reviewer gives a clean approval (verdict is "Approve" without "with changes").

## Phase 5: Generate PR Summary with Diagrams

When updating or creating the PR description, include visual diagrams to help reviewers
quickly understand the scope and architecture of the changes.

### Workflow / Data Flow Diagram

If the PR modifies a pipeline, dispatch flow, event handling, or multi-step process, include
a Mermaid diagram showing the workflow:

````markdown
```mermaid
flowchart TD
  A[User Action] --> B[API Route]
  B --> C{Validation}
  C -->|Pass| D[Database Write]
  C -->|Fail| E[400 Error Response]
  D --> F[SSE Event]
```
````

### Architecture / Component Diagram

If the PR adds or modifies components, services, or modules, include a diagram showing
how they relate:

````markdown
```mermaid
graph LR
  subgraph Frontend
    A[SkillStore] --> B[SkillCard]
    A --> C[SkillDetailDialog]
  end
  subgraph Backend
    D[/api/skills] --> E[SkillManager]
    E --> F[(skills table)]
  end
  A -->|fetch/mutate| D
```
````

### State Transition Diagram

If the PR involves status changes or state machines:

````markdown
```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> in_progress: dispatch
  in_progress --> completed: success
  in_progress --> failed: error
  failed --> in_progress: retry
```
````

### Diagram Guidelines

- Choose the diagram type(s) that best represent the changes — use at most 2 diagrams per PR
- Keep diagrams concise — focus on the parts that changed, not the entire system
- Include diagrams in the PR body under a `## Architecture` or `## Workflow` heading

## Phase 6: Report

When the AI reviewer approves (verdict is "Approve" without "with changes"):
- Report the final PR URL and status
- List what was fixed across all iterations
- Note any Suggestions that were left unfixed (so the user can decide)

## Important Rules

### Submodule: `packages/agent-runner/`

This is a git submodule pointing to `github.com/astro-anywhere/astro-agent`. The rules are strict:
- NEVER modify files inside `packages/agent-runner/` directly
- NEVER run `git add packages/agent-runner` unless you explicitly updated the submodule pointer
- Lint errors inside it are pre-existing — ignore them
- If the PR involves agent-runner changes, those must be handled in the standalone repo, merged there, and then the submodule pointer updated separately

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
- If tests need builtin skills, call `bootstrapBuiltinSkills()` in `beforeAll`

### Build Verification

- ALWAYS run `npm run build` after code changes — the project uses strict TypeScript
- Type errors are hard blockers — fix them before pushing
- Lint errors in your changed files are blockers — fix them before pushing

### Common AI Reviewer Flags

The AI reviewer commonly catches these patterns — be proactive about fixing them:
- **Type safety**: Using `as` casts instead of runtime validation
- **Missing validation**: API routes without input validation
- **Frontend/backend inconsistency**: Behavior differs between client and server
- **Missing test coverage**: New behavior without corresponding tests
- **Dead code**: Unused imports, unreachable code paths
- **Security**: Shell injection risks, RLS policy gaps, unescaped user input
