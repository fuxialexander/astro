---
name: npm-release
description: >-
  Release a new version of a submodule package to NPM. Handles the full release
  pipeline: merge dev to main, bump version, create GitHub release (which triggers
  the publish Action), monitor CI, and verify the published package. Use this skill
  when the user says "release agent-runner", "publish to npm", "bump version",
  "do a release", "release the CLI", "cut a new version", "ship it", or wants to
  publish any submodule package. Also use when the user asks about the release
  process or wants to check if a release succeeded.
---

# NPM Release Skill

This skill manages the end-to-end release of a submodule package to NPM. The
release flow differs by package — agent-runner uses a `dev` → `main` merge flow,
while CLI and openclaw-plugin release directly from `main`.

## Package Registry

| Package | Repo | Has `dev` branch | NPM dist-tag | Release Action |
|---------|------|-------------------|--------------|----------------|
| `@astroanywhere/agent` | `astro-anywhere/astro-agent` | Yes | `latest` (main), `next` (dev) | `.github/workflows/release.yml` |
| `@astroanywhere/cli` | `astro-anywhere/cli` | No | `latest` | TBD |
| openclaw-plugin | `astro-anywhere/openclaw-plugin` | No | — | Not yet published |

## Release Workflow

### Step 1: Determine version bump type

Ask the user if not specified:
- **patch** (`0.1.43` → `0.1.44`): Bug fixes only
- **minor** (`0.1.43` → `0.2.0`): New features, backward compatible
- **major** (`0.1.43` → `1.0.0`): Breaking changes

### Step 2: Merge dev → main (agent-runner only)

For agent-runner, all development happens on `dev`. Before releasing, merge `dev`
into `main`:

```bash
cd packages/agent-runner

# Check what's new on dev since last release
git fetch origin dev main
git log --oneline origin/main..origin/dev
```

Show the user the list of commits that will be included. Then create a release PR:

```bash
# Create the release PR
gh pr create \
  --repo astro-anywhere/astro-agent \
  --base main \
  --head dev \
  --title "Release: merge dev → main" \
  --body "$(cat <<'EOF'
## Release Merge

Merging accumulated changes from `dev` into `main` for release.

### Commits included
<list of commits from git log>
EOF
)"
```

Wait for the user to confirm, then merge:

```bash
gh pr merge <pr-number> --repo astro-anywhere/astro-agent --merge
```

Pull the updated main:

```bash
git checkout main
git pull origin main
```

For packages without a `dev` branch, skip this step — `main` is already ready.

### Step 3: Bump the version

```bash
cd <submodule-path>
git checkout main
git pull origin main

# Bump version (creates commit + git tag)
npm version <patch|minor|major>

# Push the version commit and tag
git push origin main --follow-tags
```

Record the new version number from the output (e.g., `v0.1.44`).

### Step 4: Create a GitHub Release

The release Action triggers on GitHub release creation (not on tags). Create the
release to kick off the NPM publish:

```bash
VERSION=$(node -p "require('./package.json').version")

gh release create "v${VERSION}" \
  --repo <github-org/repo> \
  --title "v${VERSION}" \
  --notes "$(cat <<'EOF'
## Changes

<summarize key changes from the commits included>

## Install

```bash
npm install @astroanywhere/agent@latest
# or
npx @astroanywhere/agent@latest launch
```
EOF
)" \
  --target main
```

### Step 5: Monitor the GitHub Action

Watch the release Action to ensure it succeeds:

```bash
# Find the workflow run
gh run list --repo <github-org/repo> --workflow release.yml --limit 3

# Watch the latest run
gh run watch <run-id> --repo <github-org/repo>
```

#### If the Action fails

Common failure modes and fixes:

**Tag already exists** (from a previous failed attempt):
```bash
# Delete the existing tag and release
gh release delete "v${VERSION}" --repo <github-org/repo> --yes 2>/dev/null
git push origin --delete "v${VERSION}" 2>/dev/null
git tag -d "v${VERSION}" 2>/dev/null

# Re-tag and re-release
git tag "v${VERSION}"
git push origin "v${VERSION}"
gh release create "v${VERSION}" --repo <github-org/repo> --title "v${VERSION}" \
  --notes "<release notes>" --target main
```

**Build failure**: Check the Action logs, fix the issue in a hotfix branch → main,
then re-run the release from Step 3.

**NPM auth failure**: The `NPM_TOKEN` secret may be expired. Tell the user to update
it in the repo's GitHub Settings → Secrets.

### Step 6: Verify NPM publication

Wait 30-60 seconds for NPM registry propagation, then verify:

```bash
# Check the published version on NPM
npm view <package-name> version

# Verify the dist-tag points to the new version
npm view <package-name> dist-tags

# Test installation
npx <package-name>@latest --version
```

If the version on NPM doesn't match, wait another 30 seconds and retry. NPM
propagation can take up to 2 minutes.

### Step 7: Sync dev with main (agent-runner only)

After releasing, sync the version bump back to `dev` so it stays ahead of `main`:

```bash
cd packages/agent-runner
git checkout dev
git pull origin dev
git merge main
git push origin dev
```

### Step 8: Update submodule pointer in astro

Now that `main` has a new release commit, update the pointer in the main repo.
Either do it inline or tell the user to run `/submodule-sync`:

```bash
cd /path/to/astro
cd packages/agent-runner && git checkout main && git pull origin main && cd ../..
git add packages/agent-runner
git commit -m "chore: update agent-runner to v${VERSION}"
```

## Quick Reference: Full Release Command Sequence (agent-runner)

```bash
cd packages/agent-runner
git fetch origin dev main
gh pr create --repo astro-anywhere/astro-agent --base main --head dev \
  --title "Release: merge dev → main"
# ... merge PR ...
git checkout main && git pull origin main
npm version patch                    # or minor/major
git push origin main --follow-tags
VERSION=$(node -p "require('./package.json').version")
gh release create "v${VERSION}" --repo astro-anywhere/astro-agent \
  --title "v${VERSION}" --notes "Release v${VERSION}" --target main
# ... wait for Action ...
gh run list --repo astro-anywhere/astro-agent --workflow release.yml --limit 1
# ... verify ...
npm view @astroanywhere/agent version
# ... sync dev ...
git checkout dev && git merge main && git push origin dev
```

## Important Rules

- Never skip the GitHub Release step — the release Action triggers on `release:
  published`, not on tag push. Pushing a tag alone won't publish to NPM.
- Always verify the NPM version after the Action completes. Silent publish failures
  happen (e.g., the tag existed but the release was re-created without re-running).
- For agent-runner, always sync `dev` with `main` after releasing, otherwise `dev`
  will be behind on the version bump commit and future PRs will have merge conflicts.
- The `--provenance` flag in the release Action requires OIDC (`id-token: write`
  permission). This is already configured — don't remove it.
