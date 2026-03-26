/**
 * GitHub App Webhook Handler
 *
 * Receives webhook events from the GitHub App and handles:
 * - @astro mentions in issue/PR comments → routes through AI agent via channel router
 *
 * The webhook URL should be configured in the GitHub App settings as:
 *   https://<your-domain>/api/github-app/webhook
 *
 * Environment variables:
 *   GITHUB_APP_WEBHOOK_SECRET — shared secret for HMAC-SHA256 verification
 *   GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY — for generating installation tokens
 */

import { Hono } from 'hono'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { channelRouter } from '../lib/channel/channel-router.js'
import { lookupGitHubProject } from '../lib/github-store.js'
import { resolveGitHubToken } from '../lib/github-client.js'
import { syncGitHubRepoCacheByProjectId, upsertIssueCacheEntries } from '../lib/github-repo-cache.js'
import { db } from '../lib/db/index.js'
import { planNodes, planEdges } from '../lib/db/schema.js'
import { eq, and, isNull, or } from 'drizzle-orm'
import { handleCheckRunAutomation, handleReviewAutomation } from '../lib/github-webhook-automation.js'
import { postGitHubComment } from '../plugins/channel-github/github-api.js'
import type { InboundMessage } from '../lib/channel/channel-types.js'

const app = new Hono()

// ── Signature verification ────────────────────────────────────────────────

function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

// ── Webhook endpoint ──────────────────────────────────────────────────────

app.post('/webhook', async (c) => {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET
  const rawBody = await c.req.text()

  // Verify signature if secret is configured
  if (secret) {
    const sig = c.req.header('x-hub-signature-256') ?? ''
    if (!verifySignature(secret, rawBody, sig)) {
      return c.json({ error: 'Invalid signature' }, 401)
    }
  }

  const eventType = c.req.header('x-github-event')
  if (!eventType) {
    return c.json({ error: 'Missing X-GitHub-Event header' }, 400)
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>

  // Process asynchronously — return 200 immediately to GitHub
  processWebhook(eventType, payload).catch((err) => {
    console.error(`[github-app-webhook] Error processing ${eventType}:`, err)
  })

  return c.json({ ok: true })
})

// ── Event processing ──────────────────────────────────────────────────────

async function processWebhook(eventType: string, payload: Record<string, unknown>): Promise<void> {
  if (eventType === 'issue_comment') {
    await handleIssueComment(payload)
    // issue_comment doesn't change issue/PR state — skip cache sync
    return
  }

  if (['issues', 'pull_request', 'pull_request_review', 'check_suite', 'check_run'].includes(eventType)) {
    await syncRepoCacheForWebhook(eventType, payload)
  }

  // Agent automation — dispatch agents in response to GitHub events
  const repo = payload.repository as Record<string, unknown> | undefined
  const repoFullName = repo?.full_name as string | undefined
  if (repoFullName) {
    const projectId = await lookupGitHubProject(repoFullName)
    if (projectId) {
      const ctx = { projectId, repoFullName }
      if (eventType === 'check_run') {
        handleCheckRunAutomation(ctx, payload).catch((err) => {
          console.error(`[github-app-webhook] Automation error (check_run):`, err)
        })
      } else if (eventType === 'pull_request_review') {
        handleReviewAutomation(ctx, payload).catch((err) => {
          console.error(`[github-app-webhook] Automation error (pull_request_review):`, err)
        })
      }
    }
  }
}

// Dedup map: projectId → last sync timestamp. Prevents webhook cascades
// (e.g., 5 check_run events from one PR) from triggering 5 full syncs.
const webhookSyncCooldowns = new Map<string, number>()
const WEBHOOK_SYNC_COOLDOWN_MS = 30_000 // 30 seconds

async function syncRepoCacheForWebhook(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const repo = payload.repository as Record<string, unknown> | undefined
  const repoFullName = repo?.full_name as string | undefined
  if (!repoFullName) return

  const projectId = await lookupGitHubProject(repoFullName)
  if (!projectId) return

  try {
    // For check_suite, check_run, and pull_request_review we need to re-derive
    // CI status or review decision which requires multiple API calls.
    // Fall back to full sync for these complex events — but deduplicate within cooldown window.
    if (['check_suite', 'check_run', 'pull_request_review'].includes(eventType)) {
      const lastSync = webhookSyncCooldowns.get(projectId) ?? 0
      if (Date.now() - lastSync < WEBHOOK_SYNC_COOLDOWN_MS) {
        console.log(`[github-app-webhook] Skipping duplicate ${eventType} sync for ${repoFullName} (within ${WEBHOOK_SYNC_COOLDOWN_MS / 1000}s cooldown)`)
        return
      }
      webhookSyncCooldowns.set(projectId, Date.now())
      await syncGitHubRepoCacheByProjectId(projectId)
      return
    }

    // For issues/pull_request events, do a targeted single-entry upsert
    if (eventType === 'issues') {
      const issue = payload.issue as Record<string, unknown> | undefined
      if (issue) {
        await upsertIssueCacheEntries(projectId, [{
          number: issue.number as number,
          title: issue.title as string,
          body: (issue.body as string | null) ?? null,
          state: (issue.state as string) === 'closed' ? 'closed' : 'open',
          html_url: issue.html_url as string,
          created_at: issue.created_at as string,
          updated_at: issue.updated_at as string,
          closed_at: (issue.closed_at as string | null) ?? null,
          comments: (issue.comments as number) ?? 0,
          user: issue.user as { login?: string } | null,
          labels: ((issue.labels as Array<Record<string, unknown>>) ?? []).map((l) => ({
            name: String(l.name ?? ''),
            color: typeof l.color === 'string' ? l.color : undefined,
          })),
          assignees: ((issue.assignees as Array<Record<string, unknown>>) ?? []).map((a) => ({
            login: typeof a.login === 'string' ? a.login : undefined,
          })),
        }])

        // Auto-clear plan node when issue is closed (PR merged or manually closed)
        const action = payload.action as string
        if (action === 'closed' && projectId) {
          const issueNumber = issue.number as number
          const [node] = await db.select({ id: planNodes.id, clientId: planNodes.clientId })
            .from(planNodes)
            .where(and(
              eq(planNodes.projectId, projectId),
              eq(planNodes.githubIssueNumber, issueNumber),
              isNull(planNodes.deletedAt),
            ))
            .limit(1)

          if (node) {
            const deletionActionId = `webhook-close-${Date.now()}`
            await db.update(planNodes).set({
              status: 'completed',
              deletedAt: new Date(),
              deletionActionId,
              updatedAt: new Date(),
            }).where(eq(planNodes.id, node.id))

            // Soft-delete associated edges
            await db.update(planEdges).set({
              deletedAt: new Date(),
              deletionActionId,
            }).where(and(
              eq(planEdges.projectId, projectId),
              or(
                eq(planEdges.sourceClientId, node.clientId),
                eq(planEdges.targetClientId, node.clientId)
              ),
              isNull(planEdges.deletedAt),
            ))

            console.log(`[github-app-webhook] Cleared plan node for closed issue #${issueNumber} in project ${projectId}`)
          }
        }

        return
      }
    }

    // For pull_request events, fall back to full sync since PR enrichment
    // requires multiple API calls (CI status, reviews, mergeable state)
    await syncGitHubRepoCacheByProjectId(projectId)
  } catch (error) {
    console.error(`[github-app-webhook] Cache sync failed for ${repoFullName}:`, error)
  }
}

/**
 * Handle issue_comment events — detect @astro mentions, route through AI,
 * and post response back as a comment.
 */
async function handleIssueComment(payload: Record<string, unknown>): Promise<void> {
  const action = payload.action as string
  if (action !== 'created') return

  const comment = payload.comment as Record<string, unknown> | undefined
  const issue = payload.issue as Record<string, unknown> | undefined
  const repo = payload.repository as Record<string, unknown> | undefined

  if (!comment || !issue || !repo) return

  const commentBody = (comment.body as string) ?? ''

  // Only handle @astro mentions
  if (!commentBody.toLowerCase().includes('@astro')) return

  const sender = comment.user as Record<string, unknown> | undefined
  // Ignore bot comments to prevent infinite loops
  if (sender?.type === 'Bot') return

  const repoFullName = repo.full_name as string
  const [owner, repoName] = repoFullName.split('/')
  const issueNumber = issue.number as number
  const commentId = comment.id as number

  // Look up the Astro project linked to this repo
  const projectId = await lookupGitHubProject(repoFullName)
  if (!projectId) {
    console.log(`[github-app-webhook] No Astro project linked to ${repoFullName} — skipping @astro mention`)
    return
  }

  console.log(`[github-app-webhook] @astro mention in ${repoFullName}#${issueNumber} by ${sender?.login}`)

  // Route through channel router for AI response
  const message: InboundMessage = {
    sourceMessageId: String(commentId),
    channel: 'github',
    text: commentBody,
    sender: {
      id: String(sender?.id ?? 'unknown'),
      name: (sender?.login as string) ?? 'unknown',
      avatarUrl: sender?.avatar_url as string | undefined,
    },
    conversationRef: {
      channelId: repoFullName,
      threadId: String(issueNumber),
      metadata: { owner, repo: repoName, issueNumber },
    },
    projectId,
  }

  const response = await channelRouter.routeMessage(message)

  // Get a token to post the comment back
  const tokenResult = await resolveGitHubToken(owner, repoName)
  if (!tokenResult) {
    console.error(`[github-app-webhook] No GitHub token available to post response to ${repoFullName}#${issueNumber}`)
    return
  }

  await postGitHubComment(
    tokenResult.token,
    owner,
    repoName,
    issueNumber,
    response.text,
  )
}

export default app
