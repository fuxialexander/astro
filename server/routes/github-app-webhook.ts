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
  }
  // Other event types can be added here in the future
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
