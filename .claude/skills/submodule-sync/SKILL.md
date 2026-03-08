---
name: submodule-sync
description: |
  Release and sync git submodules. Pushes changes to the submodule's own repo,
  merges dev → main, bumps the version, creates a GitHub release, then updates
  the submodule pointer in the parent repo. Enforces the branching model where
  `dev` is the golden truth and `main` is release-only. Works for any submodule
  in the project. Trigger when the user says "sync submodule", "release agent-runner",
  "release cli", "update submodule", "bump submodule version", or "merge dev to main".
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

# Submodule Sync & Release

You manage the release lifecycle for git submodules. Each submodule lives in its own
GitHub repo with a `dev` → `main` branching model. You handle the full pipeline:
push changes, merge to main, bump version, release, and update the parent repo's
submodule pointer.

## Input

A submodule name, path, or "all":
- `/submodule-sync agent-runner` — sync a specific submodule
- `/submodule-sync packages/cli` — sync by path
- `/submodule-sync all` — sync all submodules that have unpushed changes on dev

---

## Branching Model

Every submodule follows the same branching discipline:

```
dev  ← golden truth. All feature branches target dev. CI runs here.
main ← release-only. Only receives merges from dev. Never commit directly.
```

- **Feature work**: branch from `dev`, PR back to `dev`
- **Releasing**: merge `dev` → `main` via PR, tag, bump version on `dev`
- **Parent repo**: submodule pointer always tracks `main` (stable releases only)

---

## Phase 0: Identify Submodules

1. Read `.gitmodules` in the parent repo to discover all submodules:
   ```bash
   cat .gitmodules
   git submodule status
   ```

2. If the user specified a name (e.g., "agent-runner", "cli"), match it against:
   - The submodule path (e.g., `packages/agent-runner`)
   - The repo name from the URL (e.g., `astro-agent`)
   - A friendly alias (e.g., "agent-runner" matches `packages/agent-runner`)

3. If "all" was specified, iterate over every submodule that has commits on `dev`
   ahead of `main`.

4. For each submodule, resolve:
   - `SUBMODULE_PATH` — path in the parent repo (e.g., `packages/agent-runner`)
   - `SUBMODULE_REPO` — the standalone clone path. Check common locations:
     - Sibling directory to the parent repo
     - Inside the parent repo at the submodule path
     - Ask the user if not found
   - `SUBMODULE_URL` — GitHub URL from `.gitmodules`

---

## Phase 1: Verify Submodule State

For each submodule, working from the **standalone repo** (not the nested path in the parent):

```bash
cd $SUBMODULE_REPO
git fetch origin
```

1. **Check for uncommitted changes:**
   ```bash
   git status --short
   ```
   If dirty, stop and ask the user whether to stash, commit, or abort.

2. **Check dev is ahead of main:**
   ```bash
   git log --oneline origin/main...origin/dev
   ```
   If dev has no commits ahead of main, skip this submodule (already released).

3. **Check for open PRs targeting dev:**
   ```bash
   gh pr list --base dev --state open --json number,title --jq '.[] | "#\(.number) \(.title)"'
   ```
   Warn the user if there are open PRs — they won't be included in this release.

4. **Read the current version:**
   ```bash
   grep '"version"' package.json
   ```

---

## Phase 2: Ensure Feature PRs Are Merged

If the user's current work is on a feature branch (not `dev`):

1. Check if a PR exists for the feature branch → `dev`:
   ```bash
   gh pr list --head $(git branch --show-current) --base dev --json number,state
   ```

2. If no PR exists, ask the user if they want to create one.

3. If a PR exists but isn't merged, warn and ask whether to proceed anyway
   (the feature won't be in the release).

---

## Phase 3: Bump Version

1. Switch to `dev` and pull latest:
   ```bash
   git checkout dev && git pull origin dev
   ```

2. Read current version from `package.json`.

3. Determine the bump type from the commits since last release:
   - If any commit starts with `feat:` → **minor** bump (0.1.x → 0.2.0)
   - If only `fix:`, `chore:`, `test:`, `docs:` → **patch** bump (0.1.43 → 0.1.44)
   - Ask the user to confirm or override.

4. Update `package.json` version.

5. Run build to verify:
   ```bash
   npm run build
   ```

6. Commit and push:
   ```bash
   git add package.json
   git commit -m "chore: bump version to $NEW_VERSION"
   git push origin dev
   ```

---

## Phase 4: Merge dev → main

1. Create a PR from `dev` → `main`:
   ```bash
   gh pr create --base main --head dev \
     --title "chore: release $NEW_VERSION" \
     --body "Merge dev → main for release $NEW_VERSION."
   ```

2. Wait for CI checks (if any):
   ```bash
   gh pr checks $PR_NUMBER --watch
   ```
   If checks fail, report to the user and stop.

3. Merge the PR (use `--merge` to preserve history, `--admin` if branch protection blocks):
   ```bash
   gh pr merge $PR_NUMBER --merge --delete-branch=false
   ```

   **IMPORTANT:** Never delete the `dev` branch. Always use `--delete-branch=false`.

4. Pull main locally:
   ```bash
   git checkout main && git pull origin main
   ```

---

## Phase 5: Tag & Release

1. Create a GitHub release with auto-generated notes:
   ```bash
   gh release create v$NEW_VERSION --target main \
     --title "v$NEW_VERSION" \
     --generate-notes
   ```

   If the auto-generated notes are insufficient, write a summary from the commit log:
   ```bash
   git log --oneline origin/main@{1}...origin/main
   ```

2. Verify the release:
   ```bash
   gh release view v$NEW_VERSION
   ```

---

## Phase 6: Update Parent Repo Submodule Pointer

1. Switch to the parent repo and the appropriate branch:
   ```bash
   cd $PARENT_REPO
   ```

2. Update the submodule to the latest `main`:
   ```bash
   cd $SUBMODULE_PATH
   git checkout main && git pull origin main
   cd $PARENT_REPO_ROOT
   ```

3. Verify the pointer moved:
   ```bash
   git diff --submodule $SUBMODULE_PATH
   ```

4. Stage and commit:
   ```bash
   git add $SUBMODULE_PATH
   git commit -m "chore: update $SUBMODULE_NAME submodule to v$NEW_VERSION"
   ```

5. If there's a current feature branch with an open PR, push to that branch.
   Otherwise, ask the user which branch to commit to.

---

## Phase 7: Report

Produce a summary for each submodule synced:

```
## Submodule Sync Report

| Submodule | Version | Release | Parent Commit |
|-----------|---------|---------|---------------|
| agent-runner | 0.1.44 | [v0.1.44](url) | abc1234 |
| cli | 0.2.1 | [v0.2.1](url) | def5678 |

### Actions taken
- packages/agent-runner: dev → main, v0.1.44, release created, submodule pointer updated
- packages/cli: already up to date (skipped)
```

---

## Important Rules

### Branch Safety
- **NEVER** commit directly to `main` in a submodule repo. All changes go through `dev`.
- **NEVER** delete the `dev` branch when merging to `main`.
- **NEVER** force-push to `main` or `dev`.
- When merging dev → main, use `--merge` (not `--squash`) to preserve the full history
  and keep dev and main in sync.

### Submodule Pointer Safety
- **NEVER** run `git add $SUBMODULE_PATH` unless you explicitly updated the submodule
  pointer. Accidental submodule pointer changes are a common source of CI failures.
- Always verify `git diff --submodule` shows the expected change before committing.
- If the submodule shows as dirty but you didn't intend to update it, restore it:
  ```bash
  git restore --staged $SUBMODULE_PATH
  ```

### Version Consistency
- The version bump commit goes on `dev` BEFORE merging to `main`. This ensures
  `dev` and `main` agree on the version after the merge.
- After the merge, `dev` and `main` should point to the same commit (or `dev` may
  have the merge commit ahead — that's fine).

### Multiple Submodules
- When syncing "all", process each submodule independently. A failure in one should
  not block the others.
- Report results for each submodule separately.

### Recovery
- If a merge to `main` fails (conflicts, CI), do NOT force it. Report the issue
  and let the user decide.
- If a release was created but the submodule pointer wasn't updated, the release
  still exists — just update the pointer in a follow-up commit.

### What NOT to Do
- Don't bump the version on `main` — always on `dev` before the merge.
- Don't create feature branches from `main` — always from `dev`.
- Don't merge `main` back into `dev` — the flow is one-way: `dev` → `main`.
- Don't skip the build check before version bump — catch errors early.
