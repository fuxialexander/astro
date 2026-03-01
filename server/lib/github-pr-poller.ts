/**
 * GitHub PR Status Poller
 *
 * Periodically checks the merge status of PRs linked to plan nodes
 * that are in transitional statuses (auto_verified, in_progress, awaiting_judgment).
 *
 * This is a FALLBACK for when GitHub webhooks are not configured.
 * When webhooks ARE configured, those handle merge detection instantly.
 * Duplicate detection is safe — prMergeCompletionHook checks node status
 * before transitioning, so both webhook and poller can fire.
 *
 * Reuses the existing event pipeline:
 *   detected merge → astroEventTransport.emitEvent('merge_queue.succeeded')
 *   → prMergeCompletionHook (auto_verified → completed + downstream dispatch)
 *   → sseNotificationHook (SSE to frontend)
 *   → Frontend realtime-store (updates node)
 *
 * Computation overhead:
 *   - One DB query per cycle (typically 0-20 rows)
 *   - One GitHub API call per pollable node
 *   - GitHub rate limit: 5,000 requests/hour per OAuth token
 *   - When no pollable nodes exist: one lightweight query, then exit
 */

import { db } from './db/index.js'
import { planNodes, projects } from './db/schema.js'
import { eq, and, inArray, isNull, isNotNull } from 'drizzle-orm'
import { astroEventTransport } from './events/astro-event-transport.js'
import { findAccessToken } from './github-token-resolver.js'

/** Statuses that indicate a task is waiting for PR merge confirmation */
const POLLABLE_STATUSES = ['auto_verified', 'in_progress', 'awaiting_judgment'] as const

/** Default polling interval: 60 seconds */
const DEFAULT_INTERVAL_MS = 60_000

const GITHUB_API_BASE = 'https://api.github.com'

interface PollableNode {
  clientId: string
  projectId: string
  prNumber: number
  branchName: string | null
}

interface ProjectInfo {
  id: string
  ownerId: string
  teamId: string | null
  githubOwner: string
  githubRepo: string
}

interface PrPollerConfig {
  enabled: boolean
  intervalMs?: number
}

/** Tracks rate limit state per token to avoid burning through limits */
const tokenRateLimits = new Map<string, { resetAt: number }>()

let pollTimer: ReturnType<typeof setInterval> | null = null
let isRunning = false

/**
 * Check if a specific GitHub PR has been merged.
 *
 * @returns Object with merged status and merge commit SHA, or null on error
 */
async function checkPrMergeStatus(
  accessToken: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ merged: boolean; mergedSha?: string } | null> {
  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    )

    // Handle rate limiting
    const remaining = response.headers.get('X-RateLimit-Remaining')
    const resetHeader = response.headers.get('X-RateLimit-Reset')
    if (remaining === '0' && resetHeader) {
      const resetAt = parseInt(resetHeader, 10) * 1000
      tokenRateLimits.set(accessToken, { resetAt })
      console.warn(
        `[github-pr-poller] Rate limit exhausted, reset at ${new Date(resetAt).toISOString()}`
      )
      return null
    }

    if (response.status === 401) {
      console.warn('[github-pr-poller] Token unauthorized (401) — skipping')
      return null
    }

    if (response.status === 404) {
      console.warn(`[github-pr-poller] PR #${prNumber} not found in ${owner}/${repo}`)
      return null
    }

    if (!response.ok) {
      console.warn(`[github-pr-poller] GitHub API error ${response.status} for PR #${prNumber}`)
      return null
    }

    const data = (await response.json()) as {
      merged?: boolean
      merge_commit_sha?: string
    }

    return {
      merged: data.merged === true,
      mergedSha: data.merge_commit_sha ?? undefined,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[github-pr-poller] Network error checking PR #${prNumber}: ${msg}`)
    return null
  }
}

/**
 * Find all plan nodes that have PRs and are in a pollable status.
 * Groups results by project for efficient token resolution.
 */
async function findPollableNodes(): Promise<Map<string, { project: ProjectInfo; nodes: PollableNode[] }>> {
  const result = new Map<string, { project: ProjectInfo; nodes: PollableNode[] }>()

  try {
    // Query nodes with PRs in pollable statuses, joined with project info
    const rows = await db
      .select({
        clientId: planNodes.clientId,
        projectId: planNodes.projectId,
        prNumber: planNodes.prNumber,
        branchName: planNodes.branchName,
        projectOwnerId: projects.ownerId,
        projectTeamId: projects.teamId,
        githubOwner: projects.githubOwner,
        githubRepo: projects.githubRepo,
      })
      .from(planNodes)
      .innerJoin(projects, eq(planNodes.projectId, projects.id))
      .where(
        and(
          inArray(planNodes.status, [...POLLABLE_STATUSES]),
          isNotNull(planNodes.prNumber),
          isNull(planNodes.deletedAt),
          isNotNull(projects.githubOwner),
          isNotNull(projects.githubRepo),
        )
      )

    for (const row of rows) {
      if (!row.prNumber || !row.githubOwner || !row.githubRepo) continue

      const projectId = row.projectId
      if (!result.has(projectId)) {
        result.set(projectId, {
          project: {
            id: projectId,
            ownerId: row.projectOwnerId,
            teamId: row.projectTeamId,
            githubOwner: row.githubOwner,
            githubRepo: row.githubRepo,
          },
          nodes: [],
        })
      }

      result.get(projectId)!.nodes.push({
        clientId: row.clientId,
        projectId,
        prNumber: row.prNumber,
        branchName: row.branchName,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[github-pr-poller] Failed to query pollable nodes: ${msg}`)
  }

  return result
}

/**
 * Run a single polling cycle:
 * 1. Find all pollable nodes (nodes with PRs in transitional status)
 * 2. For each project, resolve a GitHub token
 * 3. For each node, check if its PR has been merged
 * 4. If merged, emit merge_queue.succeeded event (reuses existing pipeline)
 */
async function pollCycle(): Promise<void> {
  const grouped = await findPollableNodes()

  if (grouped.size === 0) return

  let totalChecked = 0
  let totalMerged = 0

  for (const [, { project, nodes }] of grouped) {
    // Resolve token for this project
    const accessToken = await findAccessToken(project.ownerId, project.teamId)
    if (!accessToken) {
      // No GitHub connection available for this project — skip
      continue
    }

    // Check if this token is rate-limited
    const rateLimit = tokenRateLimits.get(accessToken)
    if (rateLimit && Date.now() < rateLimit.resetAt) {
      continue // Skip until rate limit resets
    }
    // Clear expired rate limit entry
    if (rateLimit) {
      tokenRateLimits.delete(accessToken)
    }

    for (const node of nodes) {
      totalChecked++

      const status = await checkPrMergeStatus(
        accessToken,
        project.githubOwner,
        project.githubRepo,
        node.prNumber,
      )

      if (!status) continue // Error or rate limited

      if (status.merged) {
        totalMerged++
        console.log(
          `[github-pr-poller] PR #${node.prNumber} merged for node ${node.clientId} ` +
          `in ${project.githubOwner}/${project.githubRepo}`
        )

        // Emit the same event that the webhook handler emits.
        // This reuses the entire downstream pipeline:
        // prMergeCompletionHook → sseNotificationHook → frontend update
        await astroEventTransport.emitEvent({
          type: 'merge_queue.succeeded',
          nodeId: node.clientId,
          projectId: node.projectId,
          prNumber: node.prNumber,
          branchName: node.branchName || '',
          mergedSha: status.mergedSha,
          timestamp: new Date(),
        })
      }
    }
  }

  if (totalChecked > 0) {
    console.log(
      `[github-pr-poller] Poll cycle: checked ${totalChecked} PR(s), ${totalMerged} merged`
    )
  }
}

/**
 * Start the PR poller with the given configuration.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startPrPoller(config?: PrPollerConfig): void {
  if (pollTimer || isRunning) {
    console.warn('[github-pr-poller] Already running')
    return
  }

  const enabled = config?.enabled ?? true
  if (!enabled) {
    console.log('[github-pr-poller] Disabled by configuration')
    return
  }

  const intervalMs = config?.intervalMs ?? DEFAULT_INTERVAL_MS
  isRunning = true

  console.log(`[github-pr-poller] Starting with ${intervalMs}ms interval`)

  // Run first cycle immediately (fire-and-forget)
  void pollCycle().catch((err) => {
    console.error('[github-pr-poller] Initial poll cycle failed:', err)
  })

  // Schedule subsequent cycles
  pollTimer = setInterval(() => {
    void pollCycle().catch((err) => {
      console.error('[github-pr-poller] Poll cycle failed:', err)
    })
  }, intervalMs)
}

/**
 * Stop the PR poller.
 */
export function stopPrPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  isRunning = false
  tokenRateLimits.clear()
  console.log('[github-pr-poller] Stopped')
}
