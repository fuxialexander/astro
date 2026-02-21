# Merge Queue Setup Guide

This guide covers how to configure GitHub Merge Queue integration with Astro so that completed task PRs are automatically enqueued, tested, and merged.

## Prerequisites

- A GitHub repository with branch protection rules
- A GitHub token with `repo` and `write:discussion` scopes (set as `GITHUB_TOKEN` env var)
- The GitHub channel plugin configured (webhook secret + auth token)

## 1. Enable Merge Queue on GitHub

In your GitHub repository:

1. Go to **Settings > Rules > Rulesets** (or **Settings > Branches** for classic branch protection)
2. Create or edit a ruleset for the `main` branch
3. Enable **Require merge queue**
4. Configure merge queue settings:
   - **Merge method**: Squash (recommended), Merge, or Rebase
   - **Build concurrency**: 5 (default)
   - **Minimum/maximum group size**: 1/5 (defaults)

## 2. Configure Required Status Checks

The CI workflow (`.github/workflows/ci.yml`) runs the following jobs that can be set as required status checks:

| Job Name | Check Name | Description |
|----------|-----------|-------------|
| `lint` | Lint | ESLint check |
| `typecheck` | Type Check | TypeScript compilation |
| `build` | Build | Production build |
| `test` | Test | Unit/integration tests |

In your branch protection settings, add these as **Required status checks** under the merge queue configuration.

## 3. Configure Webhooks

Ensure your GitHub webhook is configured to send `merge_group` events:

1. Go to **Settings > Webhooks**
2. Edit your Astro webhook
3. Under **Events**, ensure these are checked:
   - Pull requests
   - Merge groups
   - Check runs (optional, for detailed CI status)

## 4. Enable Merge Queue in Astro

Per-project toggle:

1. Open your project in Astro
2. Go to the **Overview** tab
3. In the Properties panel, find **Merge Queue** and toggle it on
4. Select your preferred **Merge Method** (Squash, Merge, or Rebase)

## 5. How It Works

When a task completes successfully:

1. **Labeling**: The PR is labeled with `astro-managed`, `astro-project:<id>`, and `astro-node:<id>`
2. **Auto-merge**: GitHub's auto-merge is enabled on the PR, which enqueues it in the merge queue
3. **CI Testing**: GitHub runs CI against the merge group (your branch + all queued changes ahead of it)
4. **Merge**: If CI passes, the PR is merged automatically
5. **Status Updates**: Astro receives webhook events and updates the plan node status:
   - `queued` → PR is in the merge queue
   - `testing` → CI is running against the merge group
   - `merged` → PR was successfully merged
   - `failed` → Merge queue rejected the PR (conflicts, CI failure, etc.)

## 6. Failure Handling

When a PR fails in the merge queue:

- The plan node status changes to `awaiting_judgment`
- The merge queue status shows `failed` with a reason (conflicts, CI failure, removed)
- A red badge appears on the node in the plan graph
- The user must investigate and take action (fix conflicts, fix CI, re-enqueue)

## 7. Token Permissions

The `GITHUB_TOKEN` needs these permissions:

| Scope | Reason |
|-------|--------|
| `repo` | Read/write PR, labels, merge queue |
| `write:discussion` | Enable auto-merge (GraphQL API) |

For fine-grained tokens:
- **Pull requests**: Read and write
- **Issues**: Read and write (for labels)
- **Contents**: Read (for merge queue status)
- **Merge queue**: Read and write

## Troubleshooting

### Auto-merge fails with "not allowed"
- Ensure branch protection has "Allow auto-merge" enabled
- Ensure the token has sufficient permissions
- Verify the merge queue is enabled on the repository

### PR not entering merge queue
- Check that required status checks are configured and passing
- Verify the PR targets a branch with merge queue enabled
- Check the GitHub Actions tab for CI failures

### Webhook events not received
- Verify the webhook URL is correct and accessible
- Check that `merge_group` event type is selected in webhook settings
- Review webhook delivery logs in GitHub Settings > Webhooks > Recent Deliveries

### Node status not updating
- Check the server logs for `[merge-queue-hook]` entries
- Verify SSE connection is active (check browser DevTools Network tab)
- Ensure the branch name follows the `astro/<nodeId>` convention
