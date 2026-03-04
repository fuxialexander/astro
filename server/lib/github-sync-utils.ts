/**
 * GitHub Sync Utilities
 *
 * Shared mapping logic for bi-directional sync between Astro tasks and GitHub issues.
 * Defines status mappings, priority→label mappings, and assignee resolution.
 */

import { db } from './db/index.js'
import { githubConnections } from './db/schema.js'
import { eq } from 'drizzle-orm'

// ── Status Mapping ──────────────────────────────────────────────────────────

/**
 * Astro task statuses that map to GitHub issue states.
 */
export type AstroStatus =
  | 'planned'
  | 'dispatched'
  | 'in_progress'
  | 'auto_verified'
  | 'awaiting_approval'
  | 'awaiting_judgment'
  | 'completed'
  | 'pruned'

/**
 * Map Astro task status → GitHub issue state + state_reason.
 *
 * Ownership: Astro owns status, pushes to GitHub.
 * - completed/pruned → closed (with appropriate reason)
 * - everything else → open
 */
export function astroStatusToGitHub(status: string): {
  state: 'open' | 'closed'
  state_reason?: 'completed' | 'not_planned'
} {
  switch (status) {
    case 'completed':
    case 'auto_verified':
      return { state: 'closed', state_reason: 'completed' }
    case 'pruned':
      return { state: 'closed', state_reason: 'not_planned' }
    default:
      return { state: 'open' }
  }
}

/**
 * Map GitHub issue state → Astro task status.
 *
 * Used when GitHub webhooks report state changes.
 * - closed → completed
 * - open/reopened → planned
 */
export function githubStateToAstro(
  state: string,
  stateReason?: string
): AstroStatus {
  if (state === 'closed') {
    return stateReason === 'not_planned' ? 'pruned' : 'completed'
  }
  return 'planned'
}

// ── Priority → Label Mapping ──────────────────────────────────────────────

/**
 * Astro priority levels mapped to GitHub label names and colors.
 */
const PRIORITY_LABELS: Record<string, { name: string; color: string }> = {
  urgent: { name: 'priority: urgent', color: 'b60205' },
  high: { name: 'priority: high', color: 'd93f0b' },
  medium: { name: 'priority: medium', color: 'fbca04' },
  low: { name: 'priority: low', color: '0e8a16' },
  none: { name: 'priority: none', color: 'c5def5' },
}

/**
 * Get all priority label names for cleanup purposes.
 */
export function getAllPriorityLabelNames(): string[] {
  return Object.values(PRIORITY_LABELS).map((l) => l.name)
}

/**
 * Get the GitHub label for an Astro priority level.
 * If a custom labelMapping is provided, it overrides the default label names.
 */
export function priorityToGitHubLabel(
  priority: string | undefined,
  labelMapping?: Record<string, string>
): { name: string; color: string } | null {
  if (!priority) return null
  const key = priority.toLowerCase()
  const base = PRIORITY_LABELS[key]
  if (!base) return null

  // If there's a custom mapping for this priority, use it (keep default color)
  if (labelMapping?.[key]) {
    return { name: labelMapping[key], color: base.color }
  }

  return base
}

/**
 * Extract Astro priority from GitHub labels.
 * Returns the first matching priority label found.
 * Checks custom labelMapping first (if provided), then falls back to defaults.
 */
export function githubLabelsToPriority(
  labels: Array<{ name: string }>,
  labelMapping?: Record<string, string>
): string | null {
  // Build a reverse mapping: label name → priority key
  // Custom mappings take precedence
  const reverseLookup = new Map<string, string>()

  // Add default mappings
  for (const [priority, config] of Object.entries(PRIORITY_LABELS)) {
    reverseLookup.set(config.name, priority)
  }

  // Override with custom mappings
  if (labelMapping) {
    for (const [priority, labelName] of Object.entries(labelMapping)) {
      if (labelName) {
        reverseLookup.set(labelName, priority)
      }
    }
  }

  for (const label of labels) {
    const match = reverseLookup.get(label.name)
    if (match) return match
  }
  return null
}

// ── Estimate → Label Mapping ──────────────────────────────────────────────

const ESTIMATE_LABELS: Record<string, { name: string; color: string }> = {
  XS: { name: 'estimate: XS', color: 'c5def5' },
  S: { name: 'estimate: S', color: '85d4f0' },
  M: { name: 'estimate: M', color: 'fbca04' },
  L: { name: 'estimate: L', color: 'f9a825' },
  XL: { name: 'estimate: XL', color: 'd93f0b' },
}

/**
 * Get all estimate label names for cleanup purposes.
 */
export function getAllEstimateLabelNames(): string[] {
  return Object.values(ESTIMATE_LABELS).map((l) => l.name)
}

/**
 * Get the GitHub label for an Astro estimate value.
 */
export function estimateToGitHubLabel(
  estimate: string | undefined
): { name: string; color: string } | null {
  if (!estimate) return null
  return ESTIMATE_LABELS[estimate.toUpperCase()] ?? null
}

// ── Assignee Mapping ──────────────────────────────────────────────────────

/**
 * Resolve an Astro user ID to a GitHub login using the githubConnections table.
 * Returns null if no mapping exists.
 */
export async function resolveAstroUserToGitHubLogin(
  userId: string
): Promise<string | null> {
  try {
    const [conn] = await db
      .select({ ghLogin: githubConnections.ghLogin })
      .from(githubConnections)
      .where(eq(githubConnections.userId, userId))
      .limit(1)

    return conn?.ghLogin ?? null
  } catch {
    return null
  }
}

/**
 * Resolve a GitHub login to an Astro user ID using the githubConnections table.
 * Returns null if no mapping exists.
 */
export async function resolveGitHubLoginToAstroUser(
  ghLogin: string
): Promise<string | null> {
  try {
    const [conn] = await db
      .select({ userId: githubConnections.userId })
      .from(githubConnections)
      .where(eq(githubConnections.ghLogin, ghLogin))
      .limit(1)

    return conn?.userId ?? null
  } catch {
    return null
  }
}

// ── Label Management Helpers ──────────────────────────────────────────────

const GITHUB_API_BASE = 'https://api.github.com'

/**
 * Ensure a label exists in the GitHub repository. Creates it if missing.
 */
export async function ensureGitHubLabel(
  accessToken: string,
  owner: string,
  repo: string,
  label: { name: string; color: string }
): Promise<void> {
  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/labels/${encodeURIComponent(label.name)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    )

    if (response.status === 404) {
      // Label doesn't exist — create it
      const createResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/labels`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: label.name,
            color: label.color,
            description: `Managed by Astro sync`,
          }),
        }
      )

      if (!createResponse.ok && createResponse.status !== 422) {
        // 422 means label already exists (race condition) — that's fine
        console.warn(
          `[github-sync] Failed to create label '${label.name}' in ${owner}/${repo}: ${createResponse.status}`
        )
      }
    }
  } catch (err) {
    console.warn(
      `[github-sync] Error checking/creating label '${label.name}':`,
      err instanceof Error ? err.message : String(err)
    )
  }
}

/**
 * Update labels on a GitHub issue. Adds new labels and removes old managed labels.
 *
 * @param managedPrefixes - Label prefixes that are managed by sync (e.g., 'priority:', 'estimate:')
 * @param desiredLabels - Labels that should be present
 */
export async function syncGitHubIssueLabels(
  accessToken: string,
  owner: string,
  repo: string,
  issueNumber: number,
  currentLabels: Array<{ name: string }>,
  desiredLabels: Array<{ name: string; color: string }>,
  managedPrefixes: string[]
): Promise<void> {
  // Compute which labels to add and remove
  const currentNames = new Set(currentLabels.map((l) => l.name))
  const desiredNames = new Set(desiredLabels.map((l) => l.name))

  // Labels to add = desired but not current
  const toAdd = desiredLabels.filter((l) => !currentNames.has(l.name))

  // Labels to remove = current managed labels that are not in desired
  const toRemove = currentLabels.filter(
    (l) =>
      managedPrefixes.some((prefix) => l.name.startsWith(prefix)) &&
      !desiredNames.has(l.name)
  )

  // Ensure all desired labels exist in the repo
  await Promise.all(
    toAdd.map((l) => ensureGitHubLabel(accessToken, owner, repo, l))
  )

  // Add labels
  if (toAdd.length > 0) {
    try {
      await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ labels: toAdd.map((l) => l.name) }),
        }
      )
    } catch (err) {
      console.warn(
        `[github-sync] Failed to add labels to issue #${issueNumber}:`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  // Remove labels
  for (const label of toRemove) {
    try {
      await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label.name)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      )
    } catch (err) {
      console.warn(
        `[github-sync] Failed to remove label '${label.name}' from issue #${issueNumber}:`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }
}

// ── Issue Update Helper ──────────────────────────────────────────────────

/**
 * Update a GitHub issue's title, state, and/or assignees.
 */
export async function updateGitHubIssue(
  accessToken: string,
  owner: string,
  repo: string,
  issueNumber: number,
  updates: {
    title?: string
    state?: 'open' | 'closed'
    state_reason?: 'completed' | 'not_planned' | 'reopened'
    assignees?: string[]
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const body: Record<string, unknown> = {}
    if (updates.title !== undefined) body.title = updates.title
    if (updates.state !== undefined) body.state = updates.state
    if (updates.state_reason !== undefined) body.state_reason = updates.state_reason
    if (updates.assignees !== undefined) body.assignees = updates.assignees

    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      const errorBody = await response.text()
      return {
        success: false,
        error: `GitHub API error ${response.status}: ${errorBody}`,
      }
    }

    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}

/**
 * Fetch the current state of a GitHub issue (for conflict detection).
 */
export async function getGitHubIssue(
  accessToken: string,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<{
  title: string
  state: string
  state_reason: string | null
  labels: Array<{ name: string; color: string }>
  assignees: Array<{ login: string }>
  updated_at: string
} | null> {
  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    )

    if (!response.ok) return null

    const data = await response.json()
    return {
      title: data.title,
      state: data.state,
      state_reason: data.state_reason ?? null,
      labels: (data.labels || []).map((l: Record<string, unknown>) => ({
        name: l.name as string,
        color: l.color as string,
      })),
      assignees: (data.assignees || []).map((a: Record<string, unknown>) => ({
        login: a.login as string,
      })),
      updated_at: data.updated_at,
    }
  } catch {
    return null
  }
}

// ── Sync Source Management ──────────────────────────────────────────────

/**
 * Duration (ms) to keep syncSource='sync' before resetting to 'user'.
 * This prevents webhook echo from re-processing our own changes.
 */
export const SYNC_SOURCE_RESET_DELAY_MS = 5000

/**
 * Check if a node's syncSource indicates the change came from sync
 * and should be ignored by the webhook handler.
 */
export function isSyncEcho(syncSource: string | null | undefined): boolean {
  return syncSource === 'sync'
}
