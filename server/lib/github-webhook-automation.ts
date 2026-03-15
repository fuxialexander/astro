/**
 * GitHub Webhook Automation
 *
 * Reacts to GitHub webhook events by auto-creating task nodes and dispatching
 * agents. Currently supports:
 *   - check_run failure → create "Fix CI" task and dispatch agent
 *   - pull_request_review changes_requested → create "Address Review" task and dispatch agent
 *
 * Each reaction is gated by per-project `githubSyncSettings.automation` flags.
 */

import { randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { db } from './db/index.js'
import { projects, planNodes } from './db/schema.js'
import { serverSideDispatch } from './server-side-dispatch.js'
import type { GitHubSyncSettings } from '../../packages/core/src/types.js'

interface WebhookContext {
  projectId: string
  repoFullName: string
}

function truncate(text: string | null | undefined, max = 6000): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated]` : text
}

async function getAutomationSettings(projectId: string): Promise<GitHubSyncSettings['automation'] | null> {
  const [project] = await db.select({
    githubSyncSettings: projects.githubSyncSettings,
  }).from(projects).where(eq(projects.id, projectId)).limit(1)

  if (!project) return null
  const settings = project.githubSyncSettings as GitHubSyncSettings | null
  return settings?.automation ?? null
}

/**
 * Check if a task for the same PR + action already exists and is not terminal.
 * Prevents duplicate tasks when multiple webhooks fire for the same event.
 */
async function hasPendingTask(projectId: string, prNumber: number, titlePrefix: string): Promise<boolean> {
  const rows = await db.select({ title: planNodes.title, status: planNodes.status })
    .from(planNodes)
    .where(and(
      eq(planNodes.projectId, projectId),
      eq(planNodes.prNumber, prNumber),
    ))

  return rows.some((r) =>
    r.title.startsWith(titlePrefix) &&
    !['completed', 'pruned'].includes(r.status)
  )
}

/**
 * Per-project rate limiter for automated dispatches.
 * Prevents unbounded agent spawning from rapid webhook events.
 */
const automationCooldowns = new Map<string, number>()
const AUTOMATION_COOLDOWN_MS = 60_000 // 1 minute between automated dispatches per project

function isRateLimited(projectId: string): boolean {
  const lastDispatch = automationCooldowns.get(projectId) ?? 0
  if (Date.now() - lastDispatch < AUTOMATION_COOLDOWN_MS) return true
  automationCooldowns.set(projectId, Date.now())
  return false
}

/**
 * Handle check_run events — auto-create "Fix CI" task when a check fails.
 */
export async function handleCheckRunAutomation(ctx: WebhookContext, payload: Record<string, unknown>): Promise<void> {
  const checkRun = payload.check_run as Record<string, unknown> | undefined
  if (!checkRun) return

  // Only react to completed check runs that failed
  if (checkRun.status !== 'completed') return
  const conclusion = checkRun.conclusion as string
  if (!['failure', 'timed_out'].includes(conclusion)) return

  const automation = await getAutomationSettings(ctx.projectId)
  if (!automation?.fixCi) return

  if (isRateLimited(ctx.projectId)) {
    console.log(`[webhook-automation] Rate-limited Fix CI dispatch for ${ctx.repoFullName}`)
    return
  }

  // Extract PR info from check run
  const pullRequests = checkRun.pull_requests as Array<Record<string, unknown>> | undefined
  if (!pullRequests?.length) return

  for (const pr of pullRequests) {
    const prNumber = pr.number as number
    const prUrl = (pr.url as string)?.replace('api.github.com/repos', 'github.com').replace('/pulls/', '/pull/') ?? ''
    const headBranch = ((pr.head as Record<string, unknown>)?.ref as string) ?? 'unknown'
    const baseBranch = ((pr.base as Record<string, unknown>)?.ref as string) ?? 'unknown'
    const checkName = (checkRun.name as string) ?? 'CI'

    const titlePrefix = `PR #${prNumber} Fix CI`
    if (await hasPendingTask(ctx.projectId, prNumber, titlePrefix)) {
      console.log(`[webhook-automation] Skipping duplicate Fix CI task for ${ctx.repoFullName}#${prNumber}`)
      continue
    }

    const clientId = `auto-fix-ci-${prNumber}-${randomUUID().slice(0, 8)}`
    const description = [
      `Investigate the failing CI check "${checkName}" on PR #${prNumber} and make the minimum code changes required to fix it.`,
      '',
      `Pull request: ${prUrl}`,
      `Branch: ${headBranch} -> ${baseBranch}`,
      `Check: ${checkName}`,
      `Conclusion: ${conclusion}`,
      '',
      truncate((checkRun.output as Record<string, unknown>)?.summary as string | null),
    ].join('\n').trim()

    await db.insert(planNodes).values({
      projectId: ctx.projectId,
      clientId,
      type: 'task',
      title: `${titlePrefix}: ${checkName}`,
      description,
      status: 'planned',
      verification: 'auto',
      prNumber,
      prUrl: prUrl || undefined,
      branchName: headBranch,
      links: [{
        id: `pr-${prNumber}`,
        type: 'github_pr',
        url: prUrl,
        title: `PR #${prNumber}`,
        state: 'open',
        number: prNumber,
      }],
    })

    console.log(`[webhook-automation] Created Fix CI task ${clientId} for ${ctx.repoFullName}#${prNumber}`)

    // Dispatch agent in background
    serverSideDispatch(clientId, ctx.projectId).catch((err) => {
      console.error(`[webhook-automation] Dispatch failed for ${clientId}:`, err)
    })
  }
}

/**
 * Handle pull_request_review events — auto-create "Address Review" task
 * when a review requests changes.
 */
export async function handleReviewAutomation(ctx: WebhookContext, payload: Record<string, unknown>): Promise<void> {
  const action = payload.action as string
  if (action !== 'submitted') return

  const review = payload.review as Record<string, unknown> | undefined
  if (!review) return
  if ((review.state as string)?.toUpperCase() !== 'CHANGES_REQUESTED') return

  const automation = await getAutomationSettings(ctx.projectId)
  if (!automation?.addressReviews) return

  if (isRateLimited(ctx.projectId)) {
    console.log(`[webhook-automation] Rate-limited Address Review dispatch for ${ctx.repoFullName}`)
    return
  }

  const pr = payload.pull_request as Record<string, unknown> | undefined
  if (!pr) return

  const prNumber = pr.number as number
  const prTitle = (pr.title as string) ?? ''
  const prUrl = (pr.html_url as string) ?? ''
  const headBranch = ((pr.head as Record<string, unknown>)?.ref as string) ?? 'unknown'
  const baseBranch = ((pr.base as Record<string, unknown>)?.ref as string) ?? 'unknown'
  const reviewer = ((review.user as Record<string, unknown>)?.login as string) ?? 'unknown'
  const reviewBody = (review.body as string) ?? ''

  const titlePrefix = `PR #${prNumber} Address Review`
  if (await hasPendingTask(ctx.projectId, prNumber, titlePrefix)) {
    console.log(`[webhook-automation] Skipping duplicate Address Review task for ${ctx.repoFullName}#${prNumber}`)
    return
  }

  const clientId = `auto-review-${prNumber}-${randomUUID().slice(0, 8)}`
  const description = [
    `Address the outstanding review feedback from ${reviewer} on PR #${prNumber}: "${prTitle}".`,
    '',
    `Pull request: ${prUrl}`,
    `Branch: ${headBranch} -> ${baseBranch}`,
    `Reviewer: ${reviewer}`,
    '',
    `Review comment:`,
    truncate(reviewBody),
  ].join('\n').trim()

  await db.insert(planNodes).values({
    projectId: ctx.projectId,
    clientId,
    type: 'task',
    title: `${titlePrefix}: ${prTitle}`,
    description,
    status: 'planned',
    verification: 'auto',
    prNumber,
    prUrl: prUrl || undefined,
    branchName: headBranch,
    links: [{
      id: `pr-${prNumber}`,
      type: 'github_pr',
      url: prUrl,
      title: prTitle,
      state: 'open',
      number: prNumber,
    }],
  })

  console.log(`[webhook-automation] Created Address Review task ${clientId} for ${ctx.repoFullName}#${prNumber}`)

  // Dispatch agent in background
  serverSideDispatch(clientId, ctx.projectId).catch((err) => {
    console.error(`[webhook-automation] Dispatch failed for ${clientId}:`, err)
  })
}
