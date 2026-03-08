---
name: submodule-pr
description: >-
  Create a PR in a submodule's own repository when changes involve submodule code.
  Use this skill whenever the user has made or wants to make changes to code inside
  packages/agent-runner/, packages/cli/, or packages/openclaw-plugin/ — these are
  git submodules with their own repos. Changes must be committed and PR'd in the
  submodule repo first, not in the main astro repo. Trigger when the user says
  "push submodule changes", "PR for agent-runner", "submit changes to the agent",
  "create a PR for the CLI", or when you detect staged/unstaged changes inside a
  submodule path after completing work.
---

# Submodule PR Skill

When code changes land inside a git submodule directory, those changes belong to a
separate repository. This skill handles creating a proper PR in the submodule's own
repo, following each submodule's branching conventions.

## Submodule Registry

| Local Path | GitHub Repo | NPM Package | Default PR Target | Notes |
|------------|-------------|-------------|-------------------|-------|
| `packages/agent-runner` | `astro-anywhere/astro-agent` | `@astroanywhere/agent` | `dev` | Releases to NPM; all PRs target `dev` first |
| `packages/cli` | `astro-anywhere/cli` | `@astroanywhere/cli` | `main` | |
| `packages/openclaw-plugin` | `astro-anywhere/openclaw-plugin` | — | `main` | Currently empty scaffold |

## Workflow

### 1. Identify which submodule has changes

```bash
# From the astro root, check for submodule changes
cd <submodule-path>
git status
git diff
```

If there are no changes in any submodule, tell the user and stop.

### 2. Determine the correct target branch

- **agent-runner**: Always target `dev`. This is the active development branch. PRs to
  `main` only happen during a release merge (handled by the `npm-release` skill).
- **cli** and **openclaw-plugin**: Target `main` (default branch).

### 3. Create a feature branch inside the submodule

```bash
cd <submodule-path>
git checkout <target-branch>
git pull origin <target-branch>
git checkout -b <branch-type>/<description>
```

Branch naming: `feat/`, `fix/`, or `chore/` prefix followed by a kebab-case description.

### 4. Commit and push

Stage only the relevant files (never use `git add -A` blindly). Write a conventional
commit message (`feat:`, `fix:`, `chore:`, etc.). Push with `-u`:

```bash
git add <specific-files>
git commit -m "<type>: <description>"
git push -u origin <branch-name>
```

### 5. Create the PR using the pr-submission skill

Use the `/pr-submission` skill to generate a high-quality PR description with
architecture diagrams and structured documentation. The pr-submission skill
produces styled mermaid diagrams, before/after comparisons, and clear test plans
that make submodule PRs easier to review.

**How to invoke it**: After pushing the branch, run the pr-submission skill from
within the submodule directory. The skill will:
- Analyze the diff against the target branch
- Generate mermaid diagrams showing the architecture or data flow of the changes
- Create a structured PR body with Summary, Architecture/Root Cause, and Test Plan
- Create the PR via `gh pr create`

The key differences when creating a submodule PR vs a main-repo PR:
- Use `--repo <github-org/repo>` to target the submodule's GitHub repository
- Use `--base <target-branch>` (e.g., `dev` for agent-runner, `main` for others)
- The diff base is `<target-branch>` not `main` — so run
  `git diff <target-branch>...HEAD` when analyzing changes

```bash
# From inside the submodule directory:
# 1. Analyze the changes
git log --oneline <target-branch>...HEAD
git diff <target-branch>...HEAD --stat

# 2. Create PR with pr-submission-quality description
gh pr create \
  --repo <github-org/repo> \
  --base <target-branch> \
  --title "<type>: <concise title under 70 chars>" \
  --body "$(cat <<'EOF'
## Summary

[1-3 sentences: what changed and why. Lead with impact.]

### What changed

- **item 1** — description
- **item 2** — description

---

## Architecture

[Mermaid diagram with theme init + classDef palette showing the design.
Use flowchart for data/control flow, sequence diagram for component
interactions, or state diagram for lifecycle changes.]

---

## Test Plan

- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] [Scenario-specific test items]
EOF
)"
```

For agent-runner, the PR targets `dev`. Include the PR URL in your response.

### 6. Do NOT update the submodule pointer in the main repo yet

After creating the submodule PR, do **not** stage or commit the submodule pointer
change in the main astro repo. The pointer should only be updated after the submodule
PR is merged (handled by the `submodule-sync` skill).

Tell the user: "PR created in `<repo>`. Once merged, use `/submodule-sync` to update
the pointer in the main repo."

## Important Rules

- Never commit submodule code changes directly in the main astro repo — they will be
  lost on the next submodule update.
- Never push directly to `main` on agent-runner. Always go through `dev` first.
- If the submodule's working directory has a dirty `package-lock.json`, include it in
  the commit (the submodule's CI and Fly.io deploy use `--frozen-lockfile`).
- Run `npm run build` inside the submodule before pushing to catch TypeScript errors
  early. The submodule repos have their own CI that will also check this.
- If changes span multiple submodules, create separate PRs for each one.
