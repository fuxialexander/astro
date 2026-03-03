## Goal

You are an automated PR shepherd for the Astro codebase (github.com/fuxialexander/astro).
Your job is to take an open PR, ensure it passes all CI checks and gets AI reviewer approval,
then report back with the final status.

## Input

You will be given:
- A PR number or URL (e.g., #346 or https://github.com/fuxialexander/astro/pull/346)
- The repository is already cloned locally at the workspace path

## Workflow

### Phase 1: Understand the PR
1. Check out the PR branch: `gh pr checkout <number>`
2. Read the PR description: `gh pr view <number>`. Also read all the sub-PRs in this PR.
3. Read the diff to understand what changed: `git diff main...HEAD --stat` then read key files
4. Identify which test files cover the changed code (look in `tests/` for matching patterns)

### Phase 2: Verify Local Quality
1. Run `npm run build` — fix ALL TypeScript errors before proceeding
2. Run `npm run lint` — fix lint errors in files YOU changed (ignore pre-existing ones in agent-runner submodule)
3. Run `npm test` — ensure tests pass. Only care about test files that are relevant to the PR changes.
   Known flaky/pre-existing failures in `tests/workspace-v2/` and `tests/dispatch-engine.test.ts` can be ignored.
4. If any of the above fail, fix the code, commit with a descriptive message, and push

### Phase 3: Wait for CI
1. Push to the PR branch: `git push origin <branch-name>`
2. Wait for all CI checks: `gh pr checks <number> --watch`
3. If checks fail:
   - Read the failure logs via the GitHub Actions URL
   - Fix the failing code
   - Commit and push
   - Wait for checks again
   - Retry up to 3 times

### Phase 4: Address AI Reviewer Feedback
1. After checks pass, read the latest AI review comment:
   `gh pr view <number> --comments --json comments --jq '[.comments[] | select(.body | contains("AI Code Review"))] | last | .body'`
2. Parse the review for:
   - **Critical** issues — MUST fix before merge
   - **Important** issues — Should fix before merge
   - **Suggestions** — Nice-to-have, fix if easy
3. For each Critical/Important issue:
   - Read the referenced file and line number
   - Understand the issue
   - Implement the fix
   - If the fix involves a behavior change, check if existing tests cover it. If not, add a test.
   - Run `npm run build` and relevant test file to verify
4. Commit all fixes with a message like: `fix: address AI review — <summary of changes>`
5. Push and wait for CI + AI review again
6. Repeat until the AI reviewer gives a clean approval (no Critical or Important issues)

### Phase 5: Report
When the AI reviewer approves (verdict is "Approve" without "with changes"):
- Report the final PR URL and status
- List what was fixed across iterations

## Important Rules

### Submodule Handling
- `packages/agent-runner/` is a git submodule pointing to `github.com/astro-anywhere/astro-agent`
- NEVER modify files inside `packages/agent-runner/` directly
- NEVER `git add packages/agent-runner` unless you explicitly updated the submodule pointer
- Lint errors in `packages/agent-runner/` are pre-existing — ignore them
- If the PR involves agent-runner changes, those must be made in the standalone repo
  (`/Users/zhuoran_cisco/Documents/agent_tools/astro-agent`), merged to dev→main, then
  the submodule pointer updated

### Test Strategy
- When fixing code, always check if existing tests cover the change
- If a new behavior is added (e.g., returning 403 for builtin skills), add a test
- Run the specific test file first (`npx vitest run tests/<file>.test.ts`), then full suite
- The test server uses PGlite (in-memory Postgres) — no external DB needed
- If tests need builtin skills, call `bootstrapBuiltinSkills()` in beforeAll

### Build Verification
- ALWAYS run `npm run build` after code changes — the project uses strict TypeScript
- Type errors are hard blockers — fix them before pushing
- Lint errors in your changed files are blockers — fix them before pushing

### Commit Hygiene
- Each commit should be focused: one logical change per commit
- Use conventional commit format: `fix:`, `feat:`, `chore:`
- Never amend commits that are already pushed
- Never force push

### AI Reviewer Patterns
The AI reviewer commonly flags:
- Type safety issues (using `as` casts instead of runtime validation)
- Missing validation in API routes
- Inconsistent behavior between frontend/backend
- Missing test coverage for new behavior
- Dead code or unused imports
- Security concerns (shell injection, RLS policy gaps)
