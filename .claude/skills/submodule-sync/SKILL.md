---
name: submodule-sync
description: >-
  Synchronize submodule pointers in the main astro repo to the latest commits on
  each submodule's main branch. Use this skill after a submodule PR has been merged,
  or when the user says "sync submodules", "update submodule pointer", "bump
  agent-runner", "pull latest submodule", or "update packages/agent-runner". Also
  use this proactively after completing a submodule PR — check if the pointer needs
  bumping and offer to update it. Triggers for any mention of syncing, updating, or
  bumping submodule references.
---

# Submodule Pointer Sync Skill

The main astro repo pins each submodule to a specific commit via its git pointer.
When new commits land on a submodule's `main` branch (e.g., after a PR merge or
release), the pointer in the main repo becomes stale. This skill updates it.

## Submodule Registry

| Local Path | GitHub Repo | Track Branch | NPM Package |
|------------|-------------|--------------|-------------|
| `packages/agent-runner` | `astro-anywhere/astro-agent` | `main` | `@astroanywhere/agent` |
| `packages/cli` | `astro-anywhere/cli` | `main` | `@astroanywhere/cli` |
| `packages/openclaw-plugin` | `astro-anywhere/openclaw-plugin` | `main` | `@astroanywhere/astro` |

The main repo always points submodules at `main` (the stable branch). During
development, agent-runner PRs go to `dev` first, but the pointer only advances
when `dev` is merged into `main` via a release.

## Workflow

### 1. Check which submodules are behind

```bash
# From the astro repo root
git submodule update --init

# For each submodule, fetch and compare
for sub in packages/agent-runner packages/cli packages/openclaw-plugin; do
  if [ -d "$sub/.git" ] || [ -f "$sub/.git" ]; then
    echo "=== $sub ==="
    cd "$sub"
    git fetch origin main 2>/dev/null
    CURRENT=$(git rev-parse HEAD)
    LATEST=$(git rev-parse origin/main 2>/dev/null || echo "$CURRENT")
    if [ "$CURRENT" != "$LATEST" ]; then
      BEHIND=$(git rev-list --count HEAD..origin/main)
      echo "  BEHIND by $BEHIND commits"
      git log --oneline HEAD..origin/main | head -5
    else
      echo "  UP TO DATE"
    fi
    cd - > /dev/null
  fi
done
```

If all submodules are up to date, tell the user and stop.

### 2. Update the submodule pointer(s)

For each submodule that is behind:

```bash
cd <submodule-path>
git checkout main
git pull origin main
cd -  # back to astro root
```

### 3. Commit the pointer update in the main repo

Stage only the submodule paths that changed — never use `git add -A`:

```bash
git add packages/agent-runner   # only if it changed
git add packages/cli            # only if it changed
git add packages/openclaw-plugin # only if it changed
```

Create a commit with a descriptive message:

```bash
git commit -m "chore: update <submodule-name> to latest main (<short-sha> — <summary>)"
```

If multiple submodules updated, combine into one commit:

```bash
git commit -m "chore: update submodules to latest main"
```

### 4. Create a PR (never push directly to main)

```bash
BRANCH="chore/sync-submodules-$(date +%Y%m%d-%H%M)"
git checkout -b "$BRANCH"
# The commit was already made above, just push and PR
git push -u origin "$BRANCH"

gh pr create \
  --title "chore: sync submodule pointers" \
  --body "$(cat <<'EOF'
## Summary
Updates submodule pointer(s) to latest `main`:

<list which submodules updated and key commits>

## Test plan
- [ ] Build passes (`npm run build`)
- [ ] No submodule-related CI failures
EOF
)"
```

### 5. Post-PR checklist

After creating the pointer-sync PR, verify:

- The PR diff only shows submodule pointer changes (the `Subproject commit` lines),
  not code changes in the main repo.
- If there are code changes in the main repo that depend on the submodule update,
  those should be in the same PR with an explanation in the PR body.

## When to Run Proactively

After any of these events, check if a pointer sync is needed:

- A submodule PR was just merged (the user told you, or you created it via `/submodule-pr`)
- The user ran `/npm-release` (which merges `dev` → `main` in agent-runner)
- The user mentions the submodule is outdated or asks about version mismatches
- Before creating a main-repo PR that depends on submodule changes

## Important Rules

- The main repo pointer always tracks `main`, never `dev`. Even though agent-runner
  development happens on `dev`, the astro repo only bumps its pointer when `dev` is
  merged to `main` (during a release).
- Never include unrelated changes in a pointer-sync commit. If you have both code
  changes and pointer updates, the pointer update should be its own commit.
- If `packages/agent-runner` shows as modified in `git status` but you didn't
  intentionally update it, unstage it (`git restore --staged packages/agent-runner`)
  to avoid accidental pointer changes.
