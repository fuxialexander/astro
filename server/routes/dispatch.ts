/**
 * Dispatch Routes
 *
 * HTTP API endpoints for the task execution dispatch framework.
 * All AI execution flows through the relay to agent runners.
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import {
  dispatchEngine,
  capKnowledgeEntries,
  slugifyTitle,
  type BranchPruneRequest,
  type DispatchPriority,
} from '../lib/dispatch/index.js'
import { relayServer } from '../lib/relay-server.js'
import { executionEventBus } from '../lib/execution-event-bus.js'
import { machineRegistry } from '../lib/machine-registry.js'
import type { ProviderType, ImageAttachment } from '../types/relay.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { LOCAL_USER_ID } from '../lib/db/bootstrap-local.js'
import { executionContextStore, activeDispatchStreams } from '../lib/execution-context-store.js'
import { astroEventTransport } from '../lib/events/astro-event-transport.js'
import { db } from '../lib/db/index.js'
import { projects, planNodes, planNodeDependencies, blobs, userProfiles, taskExecutions, streamingEvents, projectKnowledge, machineInstructions, registeredMachines } from '../lib/db/schema.js'
import { eq, isNull, and, or, inArray } from 'drizzle-orm'
import type { TaskResult as DispatchTaskResult } from '../lib/dispatch/types.js'
import type { Project } from '../../src/types/index.js'
import { buildInteractivePlanPrompt, buildSummaryPrompt, sanitizeGitHubName, sanitizeGitBranch, formatMachineInstruction } from '../lib/prompt-templates.js'
import { extractPlanJsonFromText } from '@astro/core'
import { streamingEventLog } from '../lib/streaming-event-log.js'
import { autoDispatchDownstream } from './data.js'

// Track workingDirectory per dispatched task (for safety decision lookup)
const dispatchedTaskDirs = new Map<string, string>()  // taskId → workingDirectory
// Track approved safety decisions per workingDirectory
const approvedSafetyDirs = new Map<string, string>()  // workingDirectory → decision

/**
 * Derive a short hex ID from a UUID for compact display (like git short SHAs).
 * "550e8400-e29b-41d4-a716-446655440000" → "550e84"
 */
function getShortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toLowerCase()
}

/**
 * Derive the default delivery mode from remoteType.
 * Mirrors the agent-runner's deriveDeliveryMode() logic so the server
 * sends the correct mode instead of always defaulting to 'pr'.
 */
function deriveDefaultDeliveryMode(remoteType?: string): 'pr' | 'push' | 'branch' {
  switch (remoteType) {
    case 'github':
    case 'gitlab':
    case 'bitbucket':
      return 'pr'
    case 'generic':
      return 'push'
    case 'none':
    default:
      return 'branch'
  }
}

/**
 * Derive a unique short node ID that avoids collision with the project ID prefix.
 * AI-generated node IDs are prefixed with projectId.slice(0,8), so getShortId()
 * produces identical results for both project and node. This function uses the
 * last 6 hex chars of the UUID (skips the shared project prefix) by default,
 * falling back to the server-assigned node number when no UUID is available.
 */
function getShortNodeId(nodeId: string, nodeNumber?: number | null): string {
  // Use last 6 hex chars of the UUID — unique across nodes since the suffix differs
  const hex = nodeId.replace(/-/g, '').toLowerCase()
  if (hex.length >= 6) {
    return hex.slice(-6)
  }
  // Fallback: use server-assigned node number
  if (nodeNumber != null) {
    return `n${nodeNumber}`
  }
  return hex || 'unknown'
}


/**
 * Auto-extract knowledge entries from a task's execution summary.
 * Called fire-and-forget after task completion.
 *
 * Extracts up to 3 entries:
 * 1. `findings_{slug}` — keyFindings joined as bullet points
 * 2. `summary_{slug}` — executiveSummary text
 * 3. `work_{slug}` — workCompleted one-liner (only if no other entries)
 */
async function extractKnowledgeFromSummary(
  projectId: string,
  nodeId: string,
  taskTitle: string,
  summary: NonNullable<import('../types/relay.js').TaskResultMessage['result']['summary']>,
): Promise<void> {
  const slug = slugifyTitle(taskTitle) || nodeId.slice(0, 12)
  const now = new Date()
  const entries: Array<{ key: string; value: string }> = []

  // 1. Key findings as bullet points
  if (summary.keyFindings && summary.keyFindings.length > 0) {
    const value = summary.keyFindings.map(f => `- ${f}`).join('\n')
    if (value.length <= 2000) {
      entries.push({ key: `findings_${slug}`, value })
    } else {
      // Truncate to fit
      entries.push({ key: `findings_${slug}`, value: value.slice(0, 2000) })
    }
  }

  // 2. Executive summary
  if (summary.executiveSummary) {
    const value = summary.executiveSummary.slice(0, 2000)
    entries.push({ key: `summary_${slug}`, value })
  }

  // 3. If neither findings nor executive summary, store workCompleted as fallback
  if (entries.length === 0 && summary.workCompleted) {
    entries.push({ key: `work_${slug}`, value: summary.workCompleted.slice(0, 2000) })
  }

  // Upsert all entries (fire-and-forget, errors caught by caller)
  for (const entry of entries) {
    await db.insert(projectKnowledge)
      .values({
        projectId,
        key: entry.key,
        value: entry.value,
        sourceNodeId: nodeId,
        sourceTaskTitle: taskTitle || null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [projectKnowledge.projectId, projectKnowledge.key],
        set: {
          value: entry.value,
          sourceNodeId: nodeId,
          sourceTaskTitle: taskTitle || null,
          updatedAt: now,
        },
      })
      .execute()
  }

  if (entries.length > 0) {
    console.log(`[dispatch] Extracted ${entries.length} knowledge entries from task "${taskTitle}" (node ${nodeId.slice(0, 8)})`)
  }
}

/**
 * Generate a structured execution summary for tasks that completed without one.
 * Uses the same provider that ran the task (provider-agnostic).
 * Called fire-and-forget after successful task completion.
 */
async function generatePostExecutionSummary(opts: {
  projectId: string
  nodeId: string
  taskTitle: string
  taskDescription: string
  executionOutput: string
  fileChanges: Array<{ path: string; action: string }>
  status: 'success' | 'failure'
  preferredProvider?: string
  machineId?: string
  userId?: string
}): Promise<void> {
  const summaryTaskId = `summary-${opts.nodeId}-${Date.now()}`
  const prompt = buildSummaryPrompt({
    taskTitle: opts.taskTitle,
    taskDescription: opts.taskDescription,
    executionOutput: opts.executionOutput,
    fileChanges: opts.fileChanges,
    status: opts.status,
  })

  const task: import('../types/relay.js').TaskDispatch = {
    taskId: summaryTaskId,
    projectId: opts.projectId,
    nodeId: opts.nodeId,
    title: 'summarize',
    description: `Post-execution summary for ${opts.taskTitle}`.slice(0, 200),
    prompt,
    type: 'summarize',
    preferredProvider: opts.preferredProvider as import('../types/relay.js').ProviderType | undefined,
    maxTurns: 1,
    workingDirectory: undefined,
    skipSafetyCheck: true,
    useWorktree: false,
  }

  const result = await new Promise<{ success: boolean; output?: string }>((resolve) => {
    let output = ''
    const timeout = setTimeout(() => {
      cleanup()
      resolve({ success: false })
    }, 120_000)

    const onText = (msg: import('../types/relay.js').TaskTextMessage) => {
      if (msg.taskId !== summaryTaskId) return
      output += msg.text
    }

    const onResult = (msg: import('../types/relay.js').TaskResultMessage) => {
      if (msg.result.taskId !== summaryTaskId) return
      clearTimeout(timeout)
      cleanup()
      resolve({
        success: msg.result.status === 'completed',
        output: msg.result.output || output,
      })
    }

    const cleanup = () => {
      relayServer.off('task:text', onText)
      relayServer.off('task:result', onResult)
    }

    relayServer.on('task:text', onText)
    relayServer.on('task:result', onResult)

    const dispatched = relayServer.dispatchTask(task, opts.machineId, opts.userId)
    if (!dispatched) {
      clearTimeout(timeout)
      cleanup()
      resolve({ success: false })
    }
  })

  if (!result.success || !result.output) {
    console.warn(`[dispatch] Post-execution summary generation failed for node ${opts.nodeId}`)
    return
  }

  // Parse the JSON summary from the output
  let summary: import('../types/relay.js').ExecutionSummaryResult | undefined
  try {
    const jsonMatch = result.output.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      summary = {
        status: parsed.status || opts.status,
        workCompleted: parsed.workCompleted || '',
        executiveSummary: parsed.executiveSummary,
        keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
        filesChanged: Array.isArray(parsed.filesChanged) ? parsed.filesChanged : [],
        followUps: Array.isArray(parsed.followUps) ? parsed.followUps : [],
      }
    }
  } catch {
    // JSON parse failed — construct a text-based fallback
    summary = {
      status: opts.status === 'success' ? 'success' : 'failure',
      workCompleted: result.output.slice(0, 500),
      keyFindings: [],
      filesChanged: opts.fileChanges.map((f) => f.path),
      followUps: [],
    }
  }

  if (!summary) return

  console.log(`[dispatch] Generated post-execution summary for node ${opts.nodeId}: ${summary.workCompleted.slice(0, 80)}`)

  // Persist concise summary to plan node so replan context picks it up.
  // extractLessonsFromPlan reads node.executionOutput as the executionSummary string.
  // If the raw executionOutput is already set, we prepend a structured summary block.
  const conciseSummary = [
    summary.workCompleted,
    ...(summary.keyFindings.length > 0
      ? ['Key findings:', ...summary.keyFindings.map(f => `- ${f}`)]
      : []),
    ...(summary.followUps.length > 0
      ? ['Follow-ups:', ...summary.followUps.map(f => `- ${f}`)]
      : []),
  ].join('\n')

  try {
    await db.update(planNodes)
      .set({ executionOutput: conciseSummary, updatedAt: new Date() })
      .where(and(
        eq(planNodes.clientId, opts.nodeId),
        eq(planNodes.projectId, opts.projectId),
        isNull(planNodes.executionOutput),  // Only set if not already populated
      ))
      .execute()
  } catch (err) {
    console.warn(`[dispatch] Failed to persist summary to plan node ${opts.nodeId}:`, err)
  }

  // Extract knowledge from the generated summary
  await extractKnowledgeFromSummary(opts.projectId, opts.nodeId, opts.taskTitle, summary)
}

// Validation schemas
const dispatchTaskSchema = z.object({
  nodeId: z.string().min(1).max(100),
  projectId: z.string().min(1).max(100),
  title: z.string().min(1).max(1000).optional(),
  description: z.string().min(1).max(200000).optional(),
  dependencies: z.array(z.string().max(100)).max(100).optional(),
  verification: z.enum(['auto', 'human']).optional(),
  visionDoc: z.string().max(100000).optional(),
  dependencyOutputs: z.array(z.object({
    nodeId: z.string().max(100),
    title: z.string().max(1000),
    output: z.string().max(100000),
  })).max(100).optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  preferredProvider: z.string().max(100).optional(),
  targetMachineId: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  maxTurns: z.number().int().min(1).refine(
    (value) => Number.isSafeInteger(value),
    { message: 'maxTurns must be a safe integer' }
  ).optional(),
  workingDirectory: z.string().max(1000).refine(
    (path) => !path.includes('..'),
    { message: 'Path traversal not allowed' }
  ).optional(),
  /** @deprecated Always equals workingDirectory. Kept for backward compat with in-flight requests. */
  sourceDirectory: z.string().max(1000).optional(),
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  computeBackend: z.string().max(100).optional(),
  deliveryMode: z.enum(['pr', 'push', 'branch', 'copy', 'direct']).optional(),
  remoteType: z.enum(['github', 'gitlab', 'bitbucket', 'generic', 'none']).optional(),
  agentDir: z.string().max(100).optional(),
  worktreeStrategy: z.enum(['copy', 'reference', 'direct']).optional(),
  useWorktree: z.boolean().optional(),
  imageRefs: z.array(z.string().uuid()).max(20).optional(),
  isInteractivePlan: z.boolean().optional(),
  skipSafetyCheck: z.boolean().optional(),
  acceptanceCriteria: z.array(z.object({
    id: z.string(),
    description: z.string(),
    type: z.enum(['test', 'build', 'lint', 'command', 'manual']),
    command: z.string().optional(),
    autoVerifiable: z.boolean(),
  })).optional(),
  dispatchSignature: z.string().max(500).optional(),
  dispatchSigningPayload: z.object({
    v: z.literal(1),
    nodeId: z.string(),
    projectId: z.string(),
    machineId: z.string(),
    timestamp: z.string(),
    nonce: z.string(),
  }).optional(),
  resumeSessionId: z.string().max(200).optional(),
  forkSession: z.boolean().optional(),
  replanContext: z.object({
    previousPlanSummary: z.string().optional(),
    lessons: z.array(z.object({
      taskTitle: z.string(),
      taskDescription: z.string(),
      status: z.enum(['success', 'partial', 'failure', 'not_executed']),
      executionSummary: z.string().optional(),
      followUps: z.array(z.string()).optional(),
    })),
    changeDescription: z.string().optional(),
  }).optional(),
})

const dispatchRoute = new Hono()

// All dispatch routes require authentication
dispatchRoute.use('/*', requireAuth)

/**
 * Dispatch a task for execution
 *
 * POST /api/dispatch/task
 *
 * All tasks are dispatched via relay to agent runners.
 */
dispatchRoute.post('/task', async (c) => {
  console.log(`[dispatch] POST /task received from ${c.req.header('x-forwarded-for') || 'unknown'}`)
  // Validate input
  let body: z.infer<typeof dispatchTaskSchema>
  try {
    const rawBody = await c.req.json()
    // Convert null values to undefined — DB nullable columns return null,
    // but Zod .optional() only accepts undefined. Belt-and-suspenders fix
    // in case the client sends null for optional fields.
    for (const key of Object.keys(rawBody)) {
      if (rawBody[key] === null) rawBody[key] = undefined
    }
    body = dispatchTaskSchema.parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error('[dispatch] Zod validation failed:', JSON.stringify(err.issues))
      return c.json({ success: false, error: 'Invalid input', details: err.issues }, 400)
    }
    console.error('[dispatch] JSON parse failed:', err instanceof Error ? err.message : String(err))
    return c.json({ success: false, error: 'Invalid JSON' }, 400)
  }

  const {
    nodeId,
    projectId,
    dependencyOutputs = [],
    priority = 'normal',
    preferredProvider,
    model,
    force = false,
    dryRun = false,
    computeBackend,
    agentDir,
    worktreeStrategy,
    useWorktree,
    imageRefs,
    isInteractivePlan,
    maxTurns,
    skipSafetyCheck,
    dispatchSignature,
    dispatchSigningPayload,
    resumeSessionId,
    forkSession,
    replanContext,
  } = body

  // These variables may be resolved from DB when not provided by the client
  let {
    title,
    description,
    dependencies = [],
    verification,
    visionDoc,
    targetMachineId,
    workingDirectory,
    deliveryMode,
    remoteType,
    acceptanceCriteria,
  } = body

  // PR body enrichment fields (resolved from DB)
  let githubIssueUrl: string | undefined
  let githubIssueNumber: number | undefined
  let baseBranch: string | undefined
  let nodeNumber: number | null | undefined
  let githubContext: import('../lib/prompt-templates.js').GitHubContextForPrompt | undefined
  // ── Early serial execution check for 'direct' delivery mode ──────
  // Fail-fast optimization: if the client explicitly sends deliveryMode='direct',
  // we can reject duplicate dispatches before the DB lookups (saves ~2 queries).
  // This only fires when deliveryMode is in the request body. If the client
  // omits deliveryMode (relying on DB resolution), the late check
  // (search: "Late serial execution check") handles it after the project record is fetched.
  // Note: serial execution is a SAFETY constraint (prevents file corruption),
  // not a dependency check — it applies even with force=true.
  //
  // ⚠️ TOCTOU note: There is a small race window between this check and
  // the actual task insertion into the dispatch queue. Two concurrent requests
  // could both pass this check simultaneously. In practice this is mitigated by:
  // (a) 'direct' mode is uncommon, (b) concurrent clicks are rare, and
  // (c) agents themselves use file-level locks. A DB-level advisory lock or
  // unique partial index could eliminate this window if needed in the future.
  if (deliveryMode === 'direct' && !dryRun) {
    const stats = await dispatchEngine.getStats()
    const activeForProject = stats.activePerProject?.[projectId] ?? 0
    if (activeForProject > 0) {
      return c.json(
        {
          success: false,
          error: 'Serial execution required: this project uses direct delivery mode (no git). Only one task can run at a time to prevent file conflicts.',
        },
        409
      )
    }
  }

  // ── Server-side resolution: fill missing fields from DB ──────────
  // Always fetch plan node + project so that PR enrichment fields
  // (githubIssueUrl, githubIssueNumber) are resolved even when the
  // frontend sends all primary fields (title, description, etc.).
  const user = c.get('user') as AuthUser | undefined
  try {
    // Fetch plan node
    const [dbNode] = await db.select().from(planNodes)
      .where(eq(planNodes.clientId, nodeId)).limit(1)
    // Fetch project (team-scoped: verify the user has access)
    const [dbProject] = await db.select().from(projects)
      .where(and(
        eq(projects.id, projectId),
        or(
          eq(projects.teamId, user!.teamId),
          and(isNull(projects.teamId), eq(projects.ownerId, user!.id))
        )
      )).limit(1)
    if (!dbProject) {
      return c.json({ success: false, error: 'Project not found or not authorized' }, 404)
    }

    if (dbNode) {
      nodeNumber = dbNode.number
      title ??= dbNode.title
      description ??= dbNode.description || dbNode.content || dbNode.title
      verification ??= (dbNode.verification as 'auto' | 'human') || undefined
      acceptanceCriteria ??= dbNode.acceptanceCriteria as typeof acceptanceCriteria
      githubIssueUrl ??= (dbNode as Record<string, unknown>).githubIssueUrl as string | undefined
      githubIssueNumber ??= (dbNode as Record<string, unknown>).githubIssueNumber as number | undefined

      // Resolve dependencies from DB if not provided
      if (dependencies.length === 0) {
        const depRows = await db.select({ depId: planNodeDependencies.dependsOnClientId })
          .from(planNodeDependencies)
          .where(and(
            eq(planNodeDependencies.nodeProjectId, projectId),
            eq(planNodeDependencies.nodeClientId, nodeId)
          ))
        dependencies = depRows.map(r => r.depId)
      }

      // Build dependency outputs from DB if not provided
      if (dependencyOutputs.length === 0 && dependencies.length > 0) {
        const allProjectNodes = await db.select({
          clientId: planNodes.clientId,
          title: planNodes.title,
          executionOutput: planNodes.executionOutput,
          status: planNodes.status,
          type: planNodes.type,
          projectId: planNodes.projectId,
          prUrl: planNodes.prUrl,
          prNumber: planNodes.prNumber,
          branchName: planNodes.branchName,
        }).from(planNodes)
          .where(eq(planNodes.projectId, projectId))

        for (const depId of dependencies) {
          const depNode = allProjectNodes.find(n => n.clientId === depId)
          if (depNode?.executionOutput) {
            dependencyOutputs.push({
              nodeId: depNode.clientId,
              title: depNode.title,
              output: depNode.executionOutput,
              ...(depNode.prUrl && { prUrl: depNode.prUrl }),
              ...(depNode.prNumber && { prNumber: depNode.prNumber }),
              ...(depNode.branchName && { branchName: depNode.branchName }),
            })
          } else if (depNode && (depNode.status === 'completed' || depNode.status === 'auto_verified')) {
            // Milestones and tasks without output but with completed status
            // still satisfy dependencies
            dependencyOutputs.push({
              nodeId: depNode.clientId,
              title: depNode.title,
              output: `[${depNode.type || 'node'} ${depNode.status}]`,
              ...(depNode.prUrl && { prUrl: depNode.prUrl }),
              ...(depNode.prNumber && { prNumber: depNode.prNumber }),
              ...(depNode.branchName && { branchName: depNode.branchName }),
            })
          }
        }
      }
    }

    if (dbProject) {
      visionDoc ??= dbProject.visionDoc || undefined
      // Resolution precedence: body > DB > undefined.
      // This precedence is relied upon by the two serial execution checks:
      //   - EARLY check (search: "Early serial execution check"): runs when body provides deliveryMode
      //   - LATE check (search: "Serial execution constraint for 'direct'"): runs when deliveryMode resolved from DB
      deliveryMode ??= (dbProject.deliveryMode as typeof deliveryMode) || undefined
      const source = dbProject.source as { localPath?: string; remoteType?: string; baseBranch?: string } | null
      remoteType ??= (source?.remoteType as typeof remoteType) || undefined
      baseBranch = source?.baseBranch || undefined

      // Build GitHub context for plan prompts
      if (dbProject.githubOwner?.trim() && dbProject.githubRepo?.trim()) {
        githubContext = {
          hasRepo: true,
          owner: dbProject.githubOwner.trim(),
          repo: dbProject.githubRepo.trim(),
          baseBranch: baseBranch?.trim() || 'main',
        }
      }

      // Resolve working directory from project
      if (!workingDirectory) {
        if (dbProject.defaultMachineId && dbProject.workingDirectory && !dbProject.repository) {
          workingDirectory = dbProject.workingDirectory
        } else {
          const localPath = source?.localPath ?? dbProject.workingDirectory
          if (localPath) {
            workingDirectory = localPath
          } else if (dbProject.repository) {
            workingDirectory = dbProject.repository
          }
        }
      }
    }
  } catch (err) {
    console.error('[dispatch] Failed to resolve fields from DB:', err)
    return c.json(
      { success: false, error: 'Failed to resolve task details from database' },
      500
    )
  }

  // Server-side fallback: use project's defaultMachineId when client doesn't specify a machine
  if (!targetMachineId) {
    try {
      const [projectForMachine] = await db.select({ defaultMachineId: projects.defaultMachineId })
        .from(projects).where(eq(projects.id, projectId)).limit(1)
      if (projectForMachine?.defaultMachineId) {
        targetMachineId = projectForMachine.defaultMachineId
      }
    } catch { /* findBestMachine will handle as final fallback */ }
  }

  // Validate required fields after resolution
  if (!title) {
    return c.json(
      { success: false, error: 'Task title is required (not found in request or database)' },
      400
    )
  }
  description ??= title

  // Validate working directory (interactive plan sessions can brainstorm without one)
  if (!workingDirectory && !isInteractivePlan) {
    return c.json(
      { success: false, error: 'No working directory or repository configured' },
      400
    )
  }

  // Dry run dependency validation (fail fast before prompt assembly)
  if (dryRun) {
    const pendingDeps = dependencies.filter((depId) => {
      const depOutput = dependencyOutputs.find((d) => d.nodeId === depId)
      return !depOutput
    })

    if (pendingDeps.length > 0 && !force) {
      return c.json({
        success: false,
        dryRun: true,
        validationIssues: [`Pending dependencies: ${pendingDeps.join(', ')}`],
      })
    }
  }

  // Check dependencies (unless forced)
  if (!force && dependencies.length > 0) {
    const pendingDeps = dependencies.filter((depId) => {
      const depOutput = dependencyOutputs.find((d) => d.nodeId === depId)
      return !depOutput
    })

    if (pendingDeps.length > 0) {
      return c.json(
        {
          success: false,
          error: `Dependencies not met: ${pendingDeps.join(', ')}`,
        },
        400
      )
    }
  }

  // ── Late serial execution check for 'direct' delivery mode ──────
  // Without git isolation, parallel execution on the same directory is unsafe.
  // This check only runs when deliveryMode was resolved from the project's DB
  // record (not provided in the request body). If the client explicitly sent
  // deliveryMode='direct', the early check (search: "Early serial execution check")
  // already handled it before DB lookups.
  // Guard: !dryRun — dry-run requests don't actually execute tasks.
  // Same TOCTOU caveat as the early check applies here.
  const deliveryModeResolvedFromDb = !body.deliveryMode
  if (deliveryMode === 'direct' && deliveryModeResolvedFromDb && !dryRun) {
    const stats = await dispatchEngine.getStats()
    const activeForProject = stats.activePerProject?.[projectId] ?? 0
    if (activeForProject > 0) {
      return c.json(
        {
          success: false,
          error: 'Serial execution required: this project uses direct delivery mode (no git). Only one task can run at a time to prevent file conflicts.',
        },
        409
      )
    }
  }

  const executionId = `exec-${nodeId}-${Date.now()}`

  console.log(`[dispatch] ${executionId}: relay dispatch, workingDirectory=${workingDirectory}`)

  // All dispatch goes through relay
  return await dispatchViaRelay(c, {
    nodeId,
    projectId,
    executionId,
    title,
    description,
    visionDoc,
    dependencyOutputs,
    preferredProvider,
    targetMachineId,
    model,
    maxTurns,
    priority,
    workingDirectory,
    computeBackend,
    deliveryMode,
    remoteType,
    baseBranch,
    agentDir,
    worktreeStrategy,
    useWorktree,
    imageRefs,
    isInteractivePlan,
    skipSafetyCheck,
    verification,
    acceptanceCriteria,
    githubIssueUrl,
    githubIssueNumber,
    githubContext,
    resumeSessionId,
    forkSession,
    dispatchSignature,
    dispatchSigningPayload,
    dryRun,
    nodeNumber,
    replanContext,
  })
})

/**
 * Dispatch via relay server to agent runner (SSE streaming)
 */
async function dispatchViaRelay(
  c: Parameters<Parameters<typeof dispatchRoute.post>[1]>[0],
  params: {
    nodeId: string
    projectId: string
    executionId: string
    title?: string
    description?: string
    visionDoc?: string
    dependencyOutputs: Array<{ nodeId: string; title: string; output: string }>
    preferredProvider?: ProviderType
    targetMachineId?: string
    model?: string
    maxTurns?: number
    priority: DispatchPriority
    workingDirectory?: string
    computeBackend?: string
    deliveryMode?: string
    remoteType?: string
    baseBranch?: string
    agentDir?: string
    worktreeStrategy?: string
    useWorktree?: boolean
    imageRefs?: string[]
    isInteractivePlan?: boolean
    skipSafetyCheck?: boolean
    verification?: 'auto' | 'human'
    acceptanceCriteria?: Array<{ id: string; description: string; type: string; command?: string; autoVerifiable: boolean }>
    githubIssueUrl?: string
    githubIssueNumber?: number
    githubContext?: import('../lib/prompt-templates.js').GitHubContextForPrompt
    resumeSessionId?: string
    forkSession?: boolean
    dispatchSignature?: string
    dispatchSigningPayload?: { v: 1; nodeId: string; projectId: string; machineId: string; timestamp: string; nonce: string }
    dryRun?: boolean
    nodeNumber?: number | null
    replanContext?: z.infer<typeof dispatchTaskSchema>['replanContext']
  }
) {
  // Derive Astro base URL: env var > request Origin header
  const astroBaseUrl = process.env.ASTRO_BASE_URL || c.req.header('origin')

  const {
    nodeId,
    projectId,
    executionId,
    title,
    description,
    visionDoc,
    dependencyOutputs,
    preferredProvider,
    targetMachineId,
    model,
    maxTurns,
    priority,
    workingDirectory,
    computeBackend,
    deliveryMode,
    remoteType,
    baseBranch,
    agentDir,
    worktreeStrategy,
    useWorktree,
    imageRefs,
    isInteractivePlan,
    skipSafetyCheck,
    verification,
    acceptanceCriteria,
    githubIssueUrl,
    githubIssueNumber,
    githubContext,
    resumeSessionId,
    forkSession,
    dispatchSignature,
    dispatchSigningPayload,
    dryRun,
    nodeNumber,
    replanContext,
  } = params

  // Compute short hex IDs early — needed for prompt building + relay dispatch
  const shortProjectId = getShortId(projectId)
  const shortNodeId = getShortNodeId(nodeId, nodeNumber)

  // Extract user for ownership verification
  const user = c.get('user') as AuthUser | undefined

  // Find target machine (skip for dry runs — prompt assembly doesn't need a machine)
  let machineId = targetMachineId
  if (!dryRun) {
    if (!machineId) {
      const bestMachine = machineRegistry.findBestMachine(preferredProvider, user?.id)
      if (!bestMachine) {
        return c.json(
          {
            success: false,
            error: `No available machine. Start an agent runner with: npx astro-agent start --relay wss://<your-relay-url>`,
          },
          400
        )
      }
      machineId = bestMachine.machineId
    } else {
      // Verify ownership of explicitly targeted machine
      const targetMachine = machineRegistry.get(machineId)
      if (targetMachine?.userId && targetMachine.userId !== LOCAL_USER_ID && user?.id && targetMachine.userId !== user.id) {
        return c.json(
          { success: false, error: `Machine ${machineId} not found or not authorized` },
          403
        )
      }
    }

    // Register execution context for user-scoped SSE filtering + ownership validation
    executionContextStore.register({
      executionId,
      projectId,
      nodeId,
      userId: user?.id || LOCAL_USER_ID,
      machineId: machineId!,
    })
  }

  // Build prompt — interactive plans use the dedicated planning prompt template;
  // regular executions use the standard task execution prompt.
  let relaySystemPrompt: string | undefined
  const promptParts: string[] = []

  // Detect "Push to GitHub" task node — these get special dispatch instructions
  const isPushToGithub = !isInteractivePlan && /push\s+to\s+github|publish\s+to\s+github/i.test(title)

  // Look up machine instruction for prompt injection.
  // Flow: machineId → registeredMachines.defaultInstructionId → machineInstructions.content
  let skillsInjection: string | undefined
  if (machineId) {
    try {
      const [machine] = await db.select({ defaultInstructionId: registeredMachines.defaultInstructionId })
        .from(registeredMachines).where(eq(registeredMachines.id, machineId)).limit(1)
      if (machine?.defaultInstructionId) {
        const [instruction] = await db.select({ content: machineInstructions.content, name: machineInstructions.name })
          .from(machineInstructions).where(eq(machineInstructions.id, machine.defaultInstructionId)).limit(1)
        if (instruction?.content) {
          skillsInjection = formatMachineInstruction(instruction.name, instruction.content)
        }
      }
    } catch (err) {
      console.warn('[dispatch] Failed to fetch machine instruction:', err instanceof Error ? err.message : String(err))
    }
  }

  if (isInteractivePlan) {
    // Use the dedicated interactive plan prompt as a system prompt.
    // It includes vision doc, repo context, git state, and planning instructions.
    relaySystemPrompt = buildInteractivePlanPrompt(description, {
      visionDoc: visionDoc || undefined,
      skillsSummary: skillsInjection,
      githubContext,
      replanContext,
      providerId: preferredProvider,
    })
    // The user prompt is just the description
    promptParts.push(description)
  } else {

    if (visionDoc) {
      promptParts.push(`## Project Vision\n\n${visionDoc}`)
    }

    // Inject project knowledge entries (capped at 16000 chars, most recent first)
    try {
      const knowledgeRows = await db.select().from(projectKnowledge).where(eq(projectKnowledge.projectId, projectId))
      if (knowledgeRows.length > 0) {
        const capped = capKnowledgeEntries(knowledgeRows, 16000)
        if (capped.length > 0) {
          const knowledgeSection = capped
            .map((entry) => {
              const source = entry.sourceTaskTitle ? ` (from: "${entry.sourceTaskTitle}")` : ''
              return `### ${entry.key}${source}\n\n${entry.value}`
            })
            .join('\n\n')
          promptParts.push(`## Project Knowledge\n\n${knowledgeSection}`)
        }
      }
    } catch (err) {
      console.warn('[dispatch] Failed to fetch knowledge entries:', err instanceof Error ? err.message : String(err))
      // Non-fatal — continue without knowledge
    }

    if (dependencyOutputs.length > 0) {
      const depsSection = dependencyOutputs
        .map((d) => {
          const safeTitle = d.title.replace(/[\r\n]/g, ' ').slice(0, 200)
          const prInfo = d.prUrl ? `\n**PR:** [#${d.prNumber || '?'}](${d.prUrl})` : ''
          const branchInfo = d.branchName ? `\n**Branch:** \`${d.branchName}\`` : ''
          return `### ${safeTitle}${prInfo}${branchInfo}\n\n${d.output}`
        })
        .join('\n\n---\n\n')
      promptParts.push(`## Previous Task Outputs\n\n${depsSection}`)
    }

    // Push to GitHub nodes get special instructions — override delivery mode and workspace section
    if (isPushToGithub && githubContext?.hasRepo) {
      const projectBranchName = `astro/${shortProjectId}`
      const targetBranch = sanitizeGitBranch(baseBranch || githubContext.baseBranch || 'main')
      const ghOwner = sanitizeGitHubName(githubContext.owner || '')
      const ghRepo = sanitizeGitHubName(githubContext.repo || '')

      if (!ghOwner || !ghRepo) {
        return c.json(
          { success: false, error: 'Invalid GitHub repository configuration: owner or repo name contains only invalid characters' },
          400
        )
      }

      // Build explicit sub-PR listing from dependency outputs
      const subPrs = dependencyOutputs
        .filter(d => d.prUrl && d.prNumber)
        .map(d => {
          const sanitizedTitle = d.title.replace(/[\r\n]/g, ' ').slice(0, 200)
          return `- **${sanitizedTitle}**: [PR #${d.prNumber}](${d.prUrl})`
        })
      const subPrSection = subPrs.length > 0
        ? `\n### Sub-PRs merged into \`${projectBranchName}\`\n\nThese task PRs have already been merged into the project branch:\n${subPrs.join('\n')}\n\nUse these PR links in the final PR body to give reviewers context on what changed.`
        : `\n### Sub-PRs\n\nNo per-task PR links found in dependency outputs. You can discover them by running:\n\`\`\`bash\ngh pr list --base '${projectBranchName}' --state merged --json number,title,url\n\`\`\`\nInclude any found PRs in the final PR body.`

      promptParts.push(`## Push to GitHub — Open Final Project PR

You are opening the FINAL pull request for this project on \`${ghOwner}/${ghRepo}\`.
This merges **all** completed task work from the project branch \`${projectBranchName}\` into \`${targetBranch}\`.

### Branch model

- **Project branch:** \`${projectBranchName}\` — this is the accumulative branch where all task PRs have been merged.
- **Target branch:** \`${targetBranch}\` — the final PR merges the project branch here.
- Each task created its own branch (e.g. \`${projectBranchName}-n1\`, \`${projectBranchName}-n2\`) and merged into \`${projectBranchName}\` via sub-PRs.
- Your job is to push \`${projectBranchName}\` → \`${targetBranch}\` as a single final PR.
${subPrSection}

### Step-by-step

1. **Discover sub-PRs** (if not all listed above)
   \`\`\`bash
   gh pr list --base '${projectBranchName}' --state merged --json number,title,url
   \`\`\`
   Collect all sub-PRs merged into the project branch. These are the per-task PRs.

2. **Check for an existing final PR**
   \`\`\`bash
   gh pr list --head '${projectBranchName}' --base '${targetBranch}' --json number,state
   \`\`\`
   - If an **open** PR exists → update its body/title instead of creating a new one.
   - If a **closed/merged** PR exists → create a new one.

3. **Create the PR** (when no open PR exists)
   - Head: \`${projectBranchName}\`
   - Base: \`${targetBranch}\`
   - Title: \`[Astro] <project name>\`
   - Body: comprehensive summary of every completed task, referencing the sub-PRs above with links.
   \`\`\`bash
   gh pr create --base '${targetBranch}' --head '${projectBranchName}' --title "..." --body "..."
   \`\`\`

4. **Wait for CI checks**
   \`\`\`bash
   gh pr checks <PR_NUMBER> --watch
   \`\`\`
   If all checks pass → report success and finish.

5. **Fix failures & retry** (up to 3 cycles)
   - Read failure details: \`gh pr checks <PR_NUMBER>\`
   - For **test / lint / build** failures: fix the code, commit, and push to \`${projectBranchName}\`:
     \`\`\`bash
     git add -A && git commit -m "fix: ..."
     git push origin HEAD:refs/heads/${projectBranchName}
     \`\`\`
   - For **AI code-review feedback**: read comments via
     \`gh api repos/${ghOwner}/${ghRepo}/pulls/<PR_NUMBER>/reviews\`
     and \`gh api repos/${ghOwner}/${ghRepo}/pulls/<PR_NUMBER>/comments\`.
     Address each suggestion, commit, and push with the same command above.
   - Re-run: \`gh pr checks <PR_NUMBER> --watch\`
   - After 3 failed cycles, report the remaining failures and stop.

### Important constraints
- You are in a worktree that branched from the project branch \`${projectBranchName}\`.
- When pushing fixes, you MUST push to the project branch explicitly:
  \`git push origin HEAD:refs/heads/${projectBranchName}\`
  A bare \`git push\` will push to the wrong (task-level) branch.
- Do **not** create new branches or merge the PR yourself — only ensure checks pass.

### Executive Summary

**IMPORTANT: When you have finished the task, you MUST end your response with an executive summary in exactly this format:**

## Executive Summary
**Status:** success | partial | failure
**What was done:** One sentence describing the overall outcome.
- Key finding or change 1
- Key finding or change 2
- Key finding or change 3
**Follow-ups:**
- Suggested follow-up action (if any)

This summary is shown to the user for review. Keep each bullet concise (under 100 characters). Include 2-5 key findings. The summary must be the very last thing you output.`)
    } else {

    // Build delivery-mode-aware workspace instructions
    {
      const effectiveDelivery = deliveryMode ?? deriveDefaultDeliveryMode(remoteType)
      const effectiveUseWorktree = useWorktree !== false
      const effectiveAgentDir = agentDir ?? '.astro'
      const usesWorktree = workingDirectory && effectiveUseWorktree && effectiveDelivery !== 'direct'
      const branchName = `astro/${shortProjectId}-${shortNodeId}`

      if (effectiveDelivery === 'pr' && usesWorktree) {
        promptParts.push(`## Workspace & Delivery

You are working in a git worktree (isolated branch) created from the project at: ${workingDirectory}
Your branch: ${branchName}
The worktree is located under \`${effectiveAgentDir}/worktrees/\` in the git root.

**IMPORTANT:**
- All your changes are on this isolated branch — commit freely
- NEVER cd to or modify files in the original project directory (${workingDirectory})
- When you are done, commit all changes with a descriptive commit message
- After you finish, your branch will be automatically pushed and a PR will be created on GitHub
- Do NOT run \`git push\` or \`gh pr create\` yourself — the platform handles this`)
      } else if (effectiveDelivery === 'push' && usesWorktree) {
        promptParts.push(`## Workspace & Delivery

You are working in a git worktree (isolated branch) created from the project at: ${workingDirectory}
Your branch: ${branchName}
The worktree is located under \`${effectiveAgentDir}/worktrees/\` in the git root.

**IMPORTANT:**
- All changes are on this isolated branch — commit freely
- NEVER modify files in the original project directory (${workingDirectory})
- When done, commit all changes with a descriptive commit message
- Your branch will be automatically pushed to the remote (user will create a PR manually)
- Do NOT run \`git push\` yourself — the platform handles this`)
      } else if (effectiveDelivery === 'branch' && usesWorktree) {
        promptParts.push(`## Workspace & Delivery

You are working in a git worktree (isolated branch) created from the project at: ${workingDirectory}
Your branch: ${branchName}
The worktree is located under \`${effectiveAgentDir}/worktrees/\` in the git root.

**IMPORTANT:**
- All changes are on this isolated branch — commit freely
- NEVER modify files in the original project directory (${workingDirectory})
- When done, commit all changes with a descriptive commit message
- Your branch will stay local — the user will merge it manually`)
      } else if (effectiveDelivery === 'copy' && usesWorktree) {
        promptParts.push(`## Workspace & Delivery

You are working in a temporary copy of the project at: ${workingDirectory}
The original project is at: ${workingDirectory}

**IMPORTANT:**
- Your changes are in a copy — the original is untouched until you finish
- When done, your changes will be diffed against the original and presented for review`)
      } else if (effectiveDelivery === 'direct' || !usesWorktree) {
        promptParts.push(`## Workspace & Delivery

You are working directly in the project directory: ${workingDirectory}
There is no branch isolation — changes are made in-place.

**IMPORTANT:**
- Be careful — changes are applied directly to the project files
- When done, commit all changes with a descriptive commit message`)
      }
    }

    promptParts.push(`## Current Task\n\n**${title}**\n\n${description}`)

    // Inject available skills so the agent knows what tools are available
    if (skillsInjection) {
      promptParts.push(`## Available Skills & Tools\n\n${skillsInjection}`)
    }

    // Build verification section based on acceptance criteria and verification field
    const criteria = acceptanceCriteria || []
    const autoChecks = criteria.filter(c => c.autoVerifiable && c.command)
    const manualChecks = criteria.filter(c => !c.autoVerifiable)

    let verificationSection: string
    if (autoChecks.length > 0) {
      const checkList = autoChecks.map(c => `- **${c.description}**: Run \`${c.command}\``).join('\n')
      verificationSection = `Before finishing, run these verification checks:\n\n${checkList}\n\nReport results of each check.`
      if (verification === 'auto') {
        verificationSection += `\nIf all checks pass, the task will be auto-approved. If any fails, a human will review.`
      }
      if (manualChecks.length > 0) {
        verificationSection += `\n\nA human reviewer will also evaluate:\n${manualChecks.map(c => `- ${c.description}`).join('\n')}`
      }
    } else if (verification === 'auto') {
      verificationSection = `This task uses **automatic verification**. Before finishing:
- Run the test suite if tests exist for the modified code
- Ensure the build passes (\`npm run build\` or equivalent)
- Run the linter if configured
- Report test results, build status, and any warnings in your final output
If all checks pass, the task will be auto-approved. If any check fails, a human will review.`
    } else {
      verificationSection = `This task requires **human judgment** after completion. A human reviewer will evaluate your work. Make sure to:
- Clearly summarize what you did and why
- Note any trade-offs or decisions you made
- Highlight anything the reviewer should pay attention to
- If you are uncertain about any implementation choice, use \`ask_user_question\` to get guidance before proceeding`
      if (manualChecks.length > 0) {
        verificationSection += `\n\nThe reviewer will check:\n${manualChecks.map(c => `- ${c.description}`).join('\n')}`
      }
    }

    promptParts.push(`## Instructions

Execute the task described above. Focus on completing the task thoroughly and correctly.
- Use appropriate tools to accomplish the task
- Report progress and any issues encountered

### Asking the User for Decisions

You have an \`ask_user_question\` tool. When you call it, execution pauses and the user sees your question with selectable options in their dashboard. They pick an option, and you resume with their answer. **Use it actively** — it's better to ask than to guess wrong.

**Ask the user when:**
- Multiple implementation approaches are equally valid (e.g., library choice, architectural pattern)
- A design decision affects user-facing behavior or UX
- You're unsure about scope — should you do the minimal fix or a broader refactor?
- Trade-offs exist where user priorities matter (performance vs. simplicity, etc.)
- You discover something unexpected that changes the task's scope or approach

**Proceed independently when:**
- Standard best practices clearly apply
- The decision is a technical implementation detail invisible to users
- There's an obvious "right" answer based on codebase conventions

### Verification

${verificationSection}

### Executive Summary

**IMPORTANT: When you have finished the task, you MUST end your response with an executive summary in exactly this format:**

## Executive Summary
**Status:** success | partial | failure
**What was done:** One sentence describing the overall outcome.
- Key finding or change 1
- Key finding or change 2
- Key finding or change 3
**Follow-ups:**
- Suggested follow-up action (if any)

This summary is shown to the user for review. Keep each bullet concise (under 100 characters). Include 2-5 key findings. The summary must be the very last thing you output.`)
    } // end: else (not isPushToGithub)
  }

  // Fetch images from blob DB if referenced in task content
  let images: ImageAttachment[] | undefined
  if (imageRefs?.length && user) {
    try {
      // Ownership check: only fetch blobs belonging to user's team or owned by user
      const blobRows = await db.select({
        id: blobs.id,
        data: blobs.data,
        mimeType: blobs.mimeType,
        filename: blobs.filename,
      }).from(blobs).where(and(
        inArray(blobs.id, imageRefs),
        or(
          eq(blobs.teamId, user.teamId),
          and(isNull(blobs.teamId), eq(blobs.ownerId, user.id))
        )
      ))

      if (blobRows.length > 0) {
        images = blobRows.map(row => ({
          blobId: row.id,
          mimeType: row.mimeType,
          data: row.data,
          filename: row.filename,
        }))
        promptParts.push(`## Attached Images\n\nThis task includes ${images.length} image(s) embedded in the content. They are provided as part of this message for your visual analysis.`)
      }
    } catch (err) {
      console.warn('[dispatch] Failed to fetch blobs for image refs:', err)
    }
  }

  const relayPrompt = promptParts.join('\n\n---\n\n')

  // Dry run: return assembled prompt without dispatching
  if (dryRun) {
    return c.json({
      success: true,
      dryRun: true,
      validationIssues: [],
      prompt: relayPrompt,
      systemPrompt: relaySystemPrompt,
      taskMeta: {
        astroBaseUrl,
        githubIssueUrl,
        githubIssueNumber,
        deliveryMode: isPushToGithub ? 'push' : (deliveryMode ?? deriveDefaultDeliveryMode(remoteType)),
        shortProjectId,
        shortNodeId,
      },
    })
  }

  // Fetch project record from DB for event hooks (git-pull-hook needs workingDirectory)
  // Already verified project access above, so this is a safe lookup
  let projectRecord: Project | undefined
  try {
    const [row] = await db.select().from(projects).where(
      and(
        eq(projects.id, projectId),
        or(
          eq(projects.teamId, user!.teamId),
          and(isNull(projects.teamId), eq(projects.ownerId, user!.id))
        )
      )
    ).limit(1)
    projectRecord = row as unknown as Project | undefined
  } catch (err) {
    console.warn('[dispatch] Failed to fetch project for event hooks:', err)
  }

  // Compute the project-level accumulation branch
  const projectBranch = `astro/${shortProjectId}`

  // Persist projectBranch to the project record (idempotent — only sets if not already set)
  try {
    await db.update(projects)
      .set({ projectBranch, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), isNull(projects.projectBranch)))
  } catch (err) {
    console.warn(`[dispatch] Failed to persist projectBranch for project ${projectId}:`, err)
  }

  // Dispatch via relay
  const taskDispatch = {
    taskId: executionId,
    projectId,
    nodeId,
    shortProjectId,
    shortNodeId,
    title,
    description,
    prompt: relayPrompt,
    visionDoc,
    preferredProvider,
    model: model || undefined,
    maxTurns: maxTurns || undefined,
    executionStrategy: computeBackend,
    priority: priority === 'critical' ? 0 : priority === 'high' ? 1 : priority === 'normal' ? 2 : 3,
    workingDirectory,
    deliveryMode: isPushToGithub ? 'push' : (deliveryMode ?? deriveDefaultDeliveryMode(remoteType)),
    remoteType,
    baseBranch: baseBranch || undefined,
    projectBranch,
    agentDir,
    worktreeStrategy,
    useWorktree,
    images,
    skipSafetyCheck: (skipSafetyCheck && nodeId.startsWith('playground-')) || (!!workingDirectory && approvedSafetyDirs.has(workingDirectory)),
    ...(isInteractivePlan ? { type: 'plan' as const, useWorktree: false, deliveryMode: 'direct' as const } : {}),
    ...(relaySystemPrompt ? { systemPrompt: relaySystemPrompt } : {}),
    ...(astroBaseUrl && { astroBaseUrl }),
    ...(githubIssueUrl && { githubIssueUrl }),
    ...(githubIssueNumber !== undefined && { githubIssueNumber }),
    ...(dispatchSignature && { dispatchSignature }),
    ...(dispatchSigningPayload && { dispatchSigningPayload }),
    ...(resumeSessionId && { resumeSessionId }),
    ...(forkSession && { forkSession }),
  }

  // Track directory for safety decision caching
  if (workingDirectory) dispatchedTaskDirs.set(executionId, workingDirectory)

  // Disable proxy buffering so SSE chunks flush immediately (Fly.io, nginx)
  c.header('X-Accel-Buffering', 'no')

  return streamSSE(c, async (stream) => {
    let alive = true
    let lastActivity = Date.now()
    let resultSent = false
    let waitingForApproval = false
    let hasReceivedEvent = false // Whether we've received any event from agent-runner
    // Accumulated text from `text` events — used for plan extraction in onResult.
    // msg.result.output is equivalent for completed sessions; accumulatedText is the
    // fallback when the relay strips output from the result message.
    let accumulatedText = ''
    // Accumulated file changes — used for post-execution summary generation
    const collectedFileChanges: Array<{ path: string; action: string }> = []
    // Two-tier timeout: short startup period, longer once events are flowing.
    // If the agent-runner never picks up the task (crash, busy, bad state),
    // we detect it quickly instead of hanging for days.
    const STARTUP_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes — session_init arrives within seconds for all providers
    const MAX_STARTUP_RETRIES = 10 // Retry dispatch up to 10 times before failing
    const FINAL_STARTUP_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes — last attempt covers slow machine cold starts
    let startupRetries = 0
    const ACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 hours — approval pause mechanism protects human-in-the-loop

    const onResult = async (msg: import('../types/relay.js').TaskResultMessage) => {
      if (!alive || msg.result.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      resultSent = true
      executionContextStore.remove(executionId)
      dispatchedTaskDirs.delete(executionId)

      // Map relay metrics to dispatch metrics (adding aliases used by hooks)
      const relayMetrics = msg.result.metrics
      const dispatchMetrics = relayMetrics ? {
        durationMs: relayMetrics.durationMs,
        inputTokens: relayMetrics.inputTokens,
        outputTokens: relayMetrics.outputTokens,
        totalCost: relayMetrics.totalCost,
        estimatedCostUsd: relayMetrics.totalCost,  // Alias used by observation collector & usage hooks
        tokensUsed: (relayMetrics.inputTokens ?? 0) + (relayMetrics.outputTokens ?? 0) || undefined,
        model: relayMetrics.model,
        numTurns: relayMetrics.numTurns,
        turnsUsed: relayMetrics.numTurns,  // Alias used by usage-metrics-hook
      } : undefined

      // Compute final node status early so we can include it in the SSE event.
      // The frontend uses this to set the correct plan node status immediately.
      const isSuccess = msg.result.status === 'completed'
      const deliveryOk = !msg.result.deliveryStatus ||
        msg.result.deliveryStatus === 'success' ||
        msg.result.deliveryStatus === 'skipped'
      let yoloEnabled = false
      if (isSuccess && user?.id) {
        try {
          const [profile] = await db.select({ settings: userProfiles.settings })
            .from(userProfiles).where(eq(userProfiles.id, user.id)).limit(1)
          const settings = profile?.settings as Record<string, string> | null
          // Playground tasks use separate playgroundYoloMode setting
          yoloEnabled = nodeId.startsWith('playground-')
            ? settings?.playgroundYoloMode === 'true'
            : settings?.yoloMode === 'true'
        } catch { /* fail closed — no auto-verify */ }
      }
      // In YOLO mode, auto-verify even if delivery failed — the user opted out of
      // manual review. Delivery errors are still visible in the UI. Without YOLO,
      // delivery failure requires human judgment (the work is done but not shipped).
      const finalNodeStatus = isSuccess
        ? ((verification === 'auto' || yoloEnabled) && (deliveryOk || yoloEnabled) ? 'auto_verified' : 'awaiting_judgment')
        : 'awaiting_judgment'

      const resultData = {
        executionId,
        nodeId,
        status: msg.result.status === 'completed' ? 'success' : 'failure',
        output: msg.result.output,
        error: msg.result.error,
        duration: msg.result.duration,
        metrics: dispatchMetrics,
        branchName: msg.result.branchName,
        prUrl: msg.result.prUrl,
        prNumber: msg.result.prNumber,
        deliveryStatus: msg.result.deliveryStatus,
        deliveryError: msg.result.deliveryError,
        summary: msg.result.summary,
        finalStatus: finalNodeStatus,
      }
      // Server-side plan extraction for interactive plan sessions
      if (isInteractivePlan) {
        const textForExtraction = accumulatedText || msg.result.output || ''
        const planJson = extractPlanJsonFromText(textForExtraction)
        if (planJson) {
          // Regex extraction succeeded — emit plan_result synchronously before result
          const planSeq = await streamingEventLog.append(executionId, 'plan_result', planJson)
          stream.writeSSE({ id: String(planSeq), event: 'plan_result', data: JSON.stringify(planJson) }).catch(() => { alive = false })
        }
      }

      // Persist result event (also flushes any pending text)
      const seq = await streamingEventLog.append(executionId, 'result', resultData)

      stream.writeSSE({
        id: String(seq),
        event: 'result',
        data: JSON.stringify(resultData),
      }).catch(() => { alive = false })

      // Emit task.completed AstroEvent for observability hooks (observation collector, usage metrics, langfuse)
      const dispatchResult: DispatchTaskResult = {
        taskId: executionId,
        status: msg.result.status === 'completed' ? 'success' : 'failure',
        stdout: msg.result.output,
        errorMessage: msg.result.error,
        metrics: dispatchMetrics,
        branchName: msg.result.branchName,
        prUrl: msg.result.prUrl,
        prNumber: msg.result.prNumber,
        commitBeforeSha: msg.result.commitBeforeSha,
        commitAfterSha: msg.result.commitAfterSha,
        deliveryStatus: msg.result.deliveryStatus,
        deliveryError: msg.result.deliveryError,
      }
      astroEventTransport.emitEvent({
        type: 'task.completed',
        taskId: executionId,
        nodeId,
        projectId,
        executionId,
        machineId: machineId || undefined,
        result: dispatchResult,
        node: {
          id: nodeId,
          projectId,
          shortNodeId,
          shortProjectId,
          type: 'task',
          title,
          description,
          status: msg.result.status === 'completed' ? 'completed' : 'planned',
          parentId: null,
          dependencies: [],
          verification: 'auto',
          autoPr: true,
          position: { x: 0, y: 0 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        project: projectRecord,
        timestamp: new Date(),
      }).catch((err) => {
        console.error('[dispatch] Error emitting task.completed event:', err)
      })

      // Persist execution result + PR/branch metadata to plan_nodes (server-side)
      // This ensures node status is updated even if the frontend SSE connection drops.
      // finalNodeStatus was computed above (before SSE event) so the frontend gets it too.
      if (yoloEnabled) {
        console.log(`[dispatch] YOLO auto-verified: task=${nodeId} (verification=${verification})`)
      }

      const nodePatch: Partial<typeof planNodes.$inferInsert> = {
        status: finalNodeStatus,
        executionOutput: msg.result.output ?? null,
        executionCompletedAt: new Date(),
        executionError: msg.result.error ?? null,
        updatedAt: new Date(),
      }
      if (msg.result.branchName) nodePatch.branchName = msg.result.branchName
      if (msg.result.prUrl) nodePatch.prUrl = msg.result.prUrl
      if (msg.result.prNumber) nodePatch.prNumber = msg.result.prNumber
      if (msg.result.commitBeforeSha) nodePatch.commitBeforeSha = msg.result.commitBeforeSha
      if (msg.result.commitAfterSha) nodePatch.commitAfterSha = msg.result.commitAfterSha

      db.update(planNodes)
        .set(nodePatch)
        .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
        .execute()
        .then(() => {
          // Auto-dispatch downstream tasks server-side (works even if browser disconnected)
          if (finalNodeStatus === 'auto_verified') {
            autoDispatchDownstream(projectId, nodeId).catch((err) => {
              console.error('[dispatch] Auto-dispatch downstream failed:', err)
            })
          }
        })
        .catch((err: unknown) => {
          console.error('[dispatch] Error persisting execution result to plan node:', err)
        })

      // Auto-assign defaultMachineId on the project if not yet set
      if (msg.result.status === 'completed' && machineId) {
        db.update(projects)
          .set({ defaultMachineId: machineId, updatedAt: new Date() })
          .where(and(eq(projects.id, projectId), isNull(projects.defaultMachineId)))
          .execute()
          .catch((err: unknown) => {
            console.error('[dispatch] Error auto-assigning defaultMachineId:', err)
          })
      }

      // Auto-extract knowledge from task summary into project_knowledge
      if (msg.result.summary && msg.result.status === 'completed') {
        extractKnowledgeFromSummary(
          projectId, nodeId, title || '', msg.result.summary,
        ).catch((err: unknown) => {
          console.error('[dispatch] Error extracting knowledge from summary:', err)
        })
      } else if (!msg.result.summary && msg.result.status === 'completed' && !isInteractivePlan) {
        // Provider didn't generate a structured summary — generate one server-side
        // using the same provider that ran the task (fire-and-forget).
        const executionOutput = accumulatedText || msg.result.output || ''
        if (executionOutput.length > 0) {
          generatePostExecutionSummary({
            projectId,
            nodeId,
            taskTitle: title || '',
            taskDescription: description || '',
            executionOutput,
            fileChanges: collectedFileChanges,
            status: 'success',
            preferredProvider: preferredProvider || undefined,
            machineId: machineId || undefined,
            userId: user?.id,
          }).catch((err: unknown) => {
            console.error('[dispatch] Error generating post-execution summary:', err)
          })
        }
      }

      stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
      alive = false
    }

    const onText = (msg: import('../types/relay.js').TaskTextMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      waitingForApproval = false
      // Buffer text for batch persistence (flushed when next structural event arrives)
      streamingEventLog.appendText(executionId, msg.text)
      accumulatedText += msg.text
      stream.writeSSE({ event: 'text', data: msg.text }).catch(() => { alive = false })
      executionEventBus.emit('task:stdout', { output: { taskId: executionId, data: msg.text, stream: 'stdout', timestamp: new Date() } })
    }

    const onSessionInit = async (msg: import('../types/relay.js').TaskSessionInitMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      const data = { sessionId: msg.sessionId, model: msg.model }
      const seq = await streamingEventLog.append(executionId, 'session_init', data)
      stream.writeSSE({
        id: String(seq),
        event: 'session_init',
        data: JSON.stringify(data),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:session_init', { taskId: executionId, sessionId: msg.sessionId, model: msg.model || 'unknown' })
    }

    const onProgress = async (msg: import('../types/relay.js').TaskProgressMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      const data = { message: msg.message, percentage: msg.progress }
      const seq = await streamingEventLog.append(executionId, 'progress', data)
      stream.writeSSE({
        id: String(seq),
        event: 'progress',
        data: JSON.stringify(data),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:progress', { taskId: executionId, message: msg.message, progress: msg.progress })
    }

    const onToolTrace = async (msg: import('../types/relay.js').TaskToolTraceMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      waitingForApproval = false

      // Only send tool_use SSE when toolInput is present (avoid orphan tool_use
      // events for result-only traces from relay's separate toolUse/toolResult flow)
      if (msg.toolInput !== undefined) {
        const data = { toolName: msg.toolName, toolInput: msg.toolInput }
        const seq = await streamingEventLog.append(executionId, 'tool_use', data)
        stream.writeSSE({
          id: String(seq),
          event: 'tool_use',
          data: JSON.stringify(data),
        }).catch(() => { alive = false })
        executionEventBus.emit('task:tool_trace', { taskId: executionId, toolName: msg.toolName, toolInput: msg.toolInput })
      }
      if (msg.toolResult !== undefined) {
        const resultData = { toolName: msg.toolName, success: msg.success, result: msg.toolResult }
        const seq = await streamingEventLog.append(executionId, 'tool_result', resultData)
        stream.writeSSE({
          id: String(seq),
          event: 'tool_result',
          data: JSON.stringify(resultData),
        }).catch(() => { alive = false })
        executionEventBus.emit('task:tool_trace', { taskId: executionId, toolName: msg.toolName, toolResult: typeof msg.toolResult === 'string' ? msg.toolResult.slice(0, 100000) : msg.toolResult, success: msg.success ?? true })
      }
    }

    const onFileChange = async (msg: import('../types/relay.js').TaskFileChangeMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      // Compute line counts from diff when not provided
      let linesAdded = msg.linesAdded
      let linesRemoved = msg.linesRemoved
      if (linesAdded == null && linesRemoved == null && msg.diff) {
        for (const line of msg.diff.split('\n')) {
          if (line.startsWith('+') && !line.startsWith('+++')) linesAdded = (linesAdded ?? 0) + 1
          else if (line.startsWith('-') && !line.startsWith('---')) linesRemoved = (linesRemoved ?? 0) + 1
        }
      }
      const data = { path: msg.path, action: msg.action, linesAdded, linesRemoved }
      const seq = await streamingEventLog.append(executionId, 'file_change', data)
      stream.writeSSE({
        id: String(seq),
        event: 'file_change',
        data: JSON.stringify(data),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:file_change', { taskId: executionId, path: msg.path, action: msg.action })
      collectedFileChanges.push({ path: msg.path, action: msg.action })
    }

    const onMachineDisconnected = async (disconnectedId: string) => {
      if (!alive || disconnectedId !== machineId) return
      console.log(`[dispatch] Machine ${machineId} disconnected during task ${executionId}`)
      const errorData = { error: 'Remote machine disconnected during task execution', recoverable: false }
      const seq = await streamingEventLog.append(executionId, 'error', errorData)
      stream.writeSSE({
        id: String(seq),
        event: 'error',
        data: JSON.stringify(errorData),
      }).catch(() => {})
      stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
      alive = false
    }

    const onApprovalRequest = async (msg: { taskId: string; requestId: string; question: string; options: string[]; machineId?: string }) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true

      // YOLO mode: auto-approve with first option instead of showing card
      if (user?.id && msg.options.length > 0) {
        try {
          const [profile] = await db.select({ settings: userProfiles.settings })
            .from(userProfiles).where(eq(userProfiles.id, user.id)).limit(1)
          const settings = profile?.settings as Record<string, string> | null
          const isPlayground = nodeId.startsWith('playground-')
          const yoloOn = isPlayground
            ? settings?.playgroundYoloMode === 'true'
            : settings?.yoloMode === 'true'
          if (yoloOn) {
            const targetMachineId = msg.machineId || machineId || ''
            const autoAnswer = msg.options[0]
            console.log(`[dispatch] YOLO auto-approved relay approval: execution=${executionId} requestId=${msg.requestId} answer="${autoAnswer}"`)
            relayServer.sendApprovalResponse(executionId, targetMachineId, msg.requestId, true, autoAnswer)
            // Persist both request and response so hydration shows it as answered
            streamingEventLog.append(executionId, 'approval_request', { requestId: msg.requestId, question: msg.question, options: msg.options, machineId: targetMachineId }).catch(() => {})
            streamingEventLog.append(executionId, 'approval_response', { requestId: msg.requestId, answer: autoAnswer, answered: true }).catch(() => {})
            return
          }
        } catch {
          // fail open — proceed with normal approval flow
        }
      }

      waitingForApproval = true
      // Persist approval_request so it survives page refresh
      const approvalData = { requestId: msg.requestId, question: msg.question, options: msg.options, machineId: msg.machineId || machineId }
      streamingEventLog.append(executionId, 'approval_request', approvalData).catch(() => {})
    }

    // P3: Listen for task:stdout to reset activity timer (fixes SLURM output tailing + blocking Bash commands)
    const onStdout = (msg: import('../types/relay.js').TaskStdoutMessage) => {
      if (!alive || msg.output.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
    }

    const onSafetyPrompt = (msg: { taskId: string; safetyTier: string; warning?: string; options: Array<{ id: string; label: string; description?: string }>; machineId?: string }) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      waitingForApproval = true
      // Persist safety_prompt so it survives page refresh
      const safetyData = { safetyTier: msg.safetyTier, warning: msg.warning, options: msg.options, machineId: msg.machineId || machineId }
      streamingEventLog.append(executionId, 'safety_prompt', safetyData).catch(() => {})
    }

    // P2: Handle dead job detection — terminate this SSE stream when relay detects task is dead
    const onTaskDead = (data: { taskId: string; machineId: string; reason: string }) => {
      if (!alive || data.taskId !== executionId) return
      console.log(`[dispatch] Task ${executionId} declared dead by heartbeat cross-ref: ${data.reason}`)
      const errorData = { error: `Dead job detected: ${data.reason}`, recoverable: true }
      streamingEventLog.append(executionId, 'error', errorData).then((seq) => {
        stream.writeSSE({ id: String(seq), event: 'error', data: JSON.stringify(errorData) }).catch(() => {})
        stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
      }).catch(() => {
        stream.writeSSE({ event: 'error', data: JSON.stringify(errorData) }).catch(() => {})
        stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
      })
      alive = false
    }

    // Mark this task as having an active dispatch stream so events.ts
    // relay-direct handlers skip it (avoiding duplicate SSE events).
    // Skip for server-side dispatch: no browser SSE consumer, so events.ts
    // must forward relay events to the frontend's realtime SSE.
    const isServerSideDispatch = c.req.header('X-Server-Dispatch') === 'true'
    if (!isServerSideDispatch) {
      activeDispatchStreams.add(executionId)
    }

    relayServer.on('task:result', onResult)
    relayServer.on('task:text', onText)
    relayServer.on('task:session_init', onSessionInit)
    relayServer.on('task:progress', onProgress)
    relayServer.on('task:tool_trace', onToolTrace)
    relayServer.on('task:file_change', onFileChange)
    relayServer.on('task:stdout', onStdout)
    relayServer.on('machine:disconnected', onMachineDisconnected)
    relayServer.on('task:approval_request', onApprovalRequest)
    relayServer.on('task:safety_prompt', onSafetyPrompt)
    relayServer.on('task:dead', onTaskDead)

    const cleanup = () => {
      if (!isServerSideDispatch) activeDispatchStreams.delete(executionId)
      relayServer.off('task:result', onResult)
      relayServer.off('task:text', onText)
      relayServer.off('task:session_init', onSessionInit)
      relayServer.off('task:progress', onProgress)
      relayServer.off('task:tool_trace', onToolTrace)
      relayServer.off('task:file_change', onFileChange)
      relayServer.off('task:stdout', onStdout)
      relayServer.off('machine:disconnected', onMachineDisconnected)
      relayServer.off('task:approval_request', onApprovalRequest)
      relayServer.off('task:safety_prompt', onSafetyPrompt)
      relayServer.off('task:dead', onTaskDead)
    }

    // Dispatch after listeners registered
    const dispatched = relayServer.dispatchTask(taskDispatch, machineId, user?.id)

    if (!dispatched) {
      cleanup()
      const errorData = { error: `Failed to dispatch to machine: ${machineId}`, recoverable: false }
      const seq = await streamingEventLog.append(executionId, 'error', errorData)
      await stream.writeSSE({
        id: String(seq),
        event: 'error',
        data: JSON.stringify(errorData),
      })
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) })
      return
    }

    // Send init event (persist first so page-refresh hydration can recover machineId)
    const targetMachine = machineRegistry.get(machineId!)
    const pathwayType = isInteractivePlan ? 'interactive-plan' : (computeBackend === 'slurm' ? 'hpc' : 'execution')
    const initDataForSSE = {
      executionId,
      nodeId,
      machineId,
      providerId: preferredProvider || targetMachine?.providers[0]?.type,
      providerName: preferredProvider || targetMachine?.providers[0]?.type,
      computeBackend,
      pathwayType,
      systemPrompt: relaySystemPrompt || undefined,
    }
    const initSeq = await streamingEventLog.append(executionId, 'init', {
      ...initDataForSSE,
      hasSystemPrompt: !!relaySystemPrompt,
    })
    await stream.writeSSE({
      id: String(initSeq),
      event: 'init',
      data: JSON.stringify(initDataForSSE),
    })

    // Update plan_nodes.status to in_progress server-side.
    // The frontend also sets this via Zustand on the init SSE event, but for
    // server-side dispatch (auto-cascading) there is no frontend listener,
    // so the DB must be updated here to keep status accurate.
    if (!nodeId.startsWith('plan-') && !nodeId.startsWith('playground-')) {
      db.update(planNodes)
        .set({
          status: 'in_progress',
          executionId,
          executionStartedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
        .execute()
        .catch((err: unknown) => {
          console.error('[dispatch] Failed to set plan_node in_progress:', err)
        })
    }

    // Emit task:init via event bus so the global SSE stream (/api/events/stream)
    // learns the executionId→nodeId mapping and can track live progress.
    // This is essential for both server-side dispatch (no browser SSE consumer)
    // and browser-initiated dispatch (so the realtime store bootstraps tracking,
    // enabling the dashboard/active-tasks to show the task even after page refresh).
    // The realtime store handler is idempotent (skips if execution entry exists).
    executionEventBus.emit('task:init', {
      executionId,
      nodeId,
      projectId,
      machineId,
      providerId: initDataForSSE.providerId,
      providerName: initDataForSSE.providerName,
      computeBackend,
    })

    // Keepalive + two-tier activity timeout
    // Tier 1 (STARTUP_TIMEOUT_MS): 3 min startup, 10 retries + 10 min final = ~40 min worst case.
    //   If no events at all, agent-runner likely failed (crash, busy, bad state).
    // Tier 2 (ACTIVITY_TIMEOUT_MS): 2 hours between events during execution.
    //   Approval pause mechanism resets timer indefinitely while approvals are pending.
    //   task:stdout listener keeps SLURM/blocking-command sessions alive.
    const heartbeat = setInterval(() => {
      if (!alive) { clearInterval(heartbeat); return }
      // Use longer timeout on the final startup attempt to cover slow cold starts
      const startupTimeout = startupRetries >= MAX_STARTUP_RETRIES ? FINAL_STARTUP_TIMEOUT_MS : STARTUP_TIMEOUT_MS
      const timeoutMs = hasReceivedEvent ? ACTIVITY_TIMEOUT_MS : startupTimeout
      if (Date.now() - lastActivity > timeoutMs) {
        // Don't timeout if we're waiting for user approval (ask_user_question)
        if (dispatchEngine.hasPendingApprovalForExecution(executionId) || waitingForApproval) {
          lastActivity = Date.now() // Reset timer while approval is pending
        } else if (!resultSent) {
          // Startup timeout: retry dispatch up to MAX_STARTUP_RETRIES times
          if (!hasReceivedEvent && startupRetries < MAX_STARTUP_RETRIES) {
            startupRetries++
            console.log(`[dispatch] Startup timeout for ${executionId}, retry ${startupRetries}/${MAX_STARTUP_RETRIES}`)
            // Cancel previous dispatch to prevent duplicate concurrent executions
            relayServer.cancelTask(executionId, machineId || '')
            lastActivity = Date.now() // Reset timer for next attempt
            const retried = relayServer.dispatchTask(taskDispatch, machineId, user?.id)
            if (retried) {
              stream.writeSSE({
                event: 'text',
                data: `\n[Astro] Agent runner did not respond — retrying (attempt ${startupRetries + 1}/${MAX_STARTUP_RETRIES + 1})...\n`,
              }).catch(() => { alive = false })
              return // Continue waiting
            }
            // If re-dispatch failed, fall through to error
          }

          const errorMsg = hasReceivedEvent
            ? 'Activity timeout — agent runner stopped responding after 2 hours of inactivity'
            : `Startup timeout — agent runner did not start after ${MAX_STARTUP_RETRIES + 1} attempts (~${Math.round((MAX_STARTUP_RETRIES * STARTUP_TIMEOUT_MS + FINAL_STARTUP_TIMEOUT_MS) / 60000)} min). The machine may be busy or the agent process failed to launch. Try re-executing the task.`
          const errorData = { error: errorMsg, recoverable: true }

          // Update plan_nodes so the node doesn't stay in_progress if browser is disconnected
          db.update(planNodes)
            .set({ status: 'planned', executionError: errorMsg, updatedAt: new Date() })
            .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
            .execute()
            .catch((err) => console.error(`[dispatch] Failed to update plan_node on timeout:`, err))

          const sendDone = () => {
            stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
          }
          streamingEventLog.append(executionId, 'error', errorData).then((seq) => {
            stream.writeSSE({
              id: String(seq),
              event: 'error',
              data: JSON.stringify(errorData),
            }).catch(() => {})
            sendDone()
          }).catch(() => {
            stream.writeSSE({
              event: 'error',
              data: JSON.stringify(errorData),
            }).catch(() => {})
            sendDone()
          })
          alive = false
          clearInterval(heartbeat)
          return
        }
      }
      // Flush buffered text to DB periodically so catch-up hydration has recent data
      streamingEventLog.flushText(executionId).catch(() => {})
      stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => { alive = false; clearInterval(heartbeat) })
    }, 15000)

    stream.onAbort(() => {
      alive = false
      clearInterval(heartbeat)
      cleanup()
      // Flush any buffered text before disconnect
      streamingEventLog.flushText(executionId).catch((err) => {
        console.error(`[dispatch] Failed to flush text on disconnect for ${executionId}:`, err)
      })
      // Task continues running on the agent runner — results arrive via relay → global SSE → realtime-store
    })

    // Wait for completion
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!alive) { clearInterval(check); resolve() }
      }, 500)
    })

    // Clean up relay listeners and activeDispatchStreams on normal completion
    clearInterval(heartbeat)
    cleanup()
  })
}

/**
 * Steer a running agent task
 *
 * POST /api/dispatch/steer
 *
 * All steering goes through relay to agent runners.
 */
const steerSchema = z.object({
  taskId: z.string().min(1),
  machineId: z.string().min(1),
  message: z.string().min(1).max(50000),
  action: z.enum(['guidance', 'redirect', 'pause', 'resume']).optional(),
  interrupt: z.boolean().optional(),
})

dispatchRoute.post('/steer', async (c) => {
  const raw = await c.req.json()
  const parsed = steerSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ success: false, error: 'taskId, machineId, and message are required' }, 400)
  }
  const { taskId, machineId, message, action, interrupt } = parsed.data

  // Validate user owns this task
  const steerUser = c.get('user') as AuthUser | undefined
  if (steerUser?.id && steerUser.id !== LOCAL_USER_ID) {
    const ctx = executionContextStore.get(taskId)
    if (ctx && ctx.userId !== steerUser.id && ctx.userId !== LOCAL_USER_ID) {
      return c.json({ success: false, error: 'Not authorized for this task' }, 403)
    }
  }

  const sent = relayServer.steerTask(taskId, machineId, message, action, interrupt)

  if (!sent) {
    return c.json(
      { success: false, error: `Failed to steer task ${taskId} on machine ${machineId}` },
      500
    )
  }

  // Persist steer message to streaming_events for page-refresh recovery
  streamingEventLog.append(taskId, 'steer_message', {
    message, action, interrupt,
  }).catch(() => {})

  return c.json({ success: true, taskId, machineId, message: 'Steer message sent' })
})

/**
 * Send approval response back to agent runner
 */
const approvalSchema = z.object({
  taskId: z.string().min(1),
  machineId: z.string().min(1),
  requestId: z.string().min(1),
  answered: z.boolean(),
  answer: z.string().max(50000).optional(),
  message: z.string().max(50000).optional(),
})

dispatchRoute.post('/approval', async (c) => {
  const raw = await c.req.json()
  const parsed = approvalSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ success: false, error: 'taskId, machineId, and requestId are required' }, 400)
  }
  const { taskId, machineId, requestId, answered, answer, message } = parsed.data

  // Validate user owns this task
  const approvalUser = c.get('user') as AuthUser | undefined
  if (approvalUser?.id && approvalUser.id !== LOCAL_USER_ID) {
    const ctx = executionContextStore.get(taskId)
    if (ctx && ctx.userId !== approvalUser.id && ctx.userId !== LOCAL_USER_ID) {
      return c.json({ success: false, error: 'Not authorized for this task' }, 403)
    }
  }

  const sent = relayServer.sendApprovalResponse(taskId, machineId, requestId, answered, answer, message)

  if (!sent) {
    return c.json(
      { success: false, error: `Failed to send approval response for task ${taskId} on machine ${machineId}` },
      500
    )
  }

  // Persist approval_response so hydration knows this approval was answered
  streamingEventLog.append(taskId, 'approval_response', { requestId, answer, answered }).catch(() => {})

  return c.json({ success: true, taskId, machineId, requestId, message: 'Approval response sent' })
})

/**
 * Send safety decision back to agent runner
 */
dispatchRoute.post('/safety-decision', async (c) => {
  const { taskId, machineId, decision } = await c.req.json<{
    taskId: string
    machineId: string
    decision: string
  }>()

  if (!taskId) {
    return c.json({ success: false, error: 'taskId is required' }, 400)
  }

  if (!machineId) {
    return c.json({ success: false, error: 'machineId is required' }, 400)
  }

  if (!decision) {
    return c.json({ success: false, error: 'decision is required' }, 400)
  }

  const validDecisions = ['proceed', 'init-git', 'sandbox', 'cancel']
  if (!validDecisions.includes(decision)) {
    return c.json({ success: false, error: `Invalid decision. Must be one of: ${validDecisions.join(', ')}` }, 400)
  }

  // Validate user owns this task
  const safetyUser = c.get('user') as AuthUser | undefined
  if (safetyUser?.id && safetyUser.id !== LOCAL_USER_ID) {
    const ctx = executionContextStore.get(taskId)
    if (ctx && ctx.userId !== safetyUser.id && ctx.userId !== LOCAL_USER_ID) {
      return c.json({ success: false, error: 'Not authorized for this task' }, 403)
    }
  }

  const sent = relayServer.sendSafetyDecision(
    taskId,
    machineId,
    decision as 'proceed' | 'init-git' | 'sandbox' | 'cancel'
  )

  if (!sent) {
    return c.json(
      { success: false, error: `Failed to send safety decision for task ${taskId} on machine ${machineId}` },
      500
    )
  }

  // Persist safety_response so hydration knows this prompt was answered
  streamingEventLog.append(taskId, 'safety_response', { decision }).catch(() => {})

  // Cache safety approval for this working directory so subsequent tasks skip the prompt
  if (decision !== 'cancel') {
    const workdir = dispatchedTaskDirs.get(taskId)
    if (workdir) {
      approvedSafetyDirs.set(workdir, decision)
    }
    // Emit event so SSE handlers can track per-project approval
    const ctx = executionContextStore.get(taskId)
    if (ctx) {
      relayServer.emit('task:safety_approved', { taskId, projectId: ctx.projectId, decision })
    }
  }

  return c.json({ success: true, taskId, machineId, decision, message: 'Safety decision sent' })
})

/**
 * Cancel a task
 */
dispatchRoute.post('/cancel', async (c) => {
  const { nodeId, executionId, machineId } = await c.req.json<{
    nodeId?: string
    executionId?: string
    machineId?: string
  }>()

  const id = executionId ?? nodeId
  if (!id) {
    return c.json({ success: false, error: 'nodeId or executionId required' }, 400)
  }

  // Validate user owns this task
  const cancelUser = c.get('user') as AuthUser | undefined
  if (cancelUser?.id && cancelUser.id !== LOCAL_USER_ID) {
    const ctx = executionContextStore.get(id)
    if (ctx && ctx.userId !== cancelUser.id && ctx.userId !== LOCAL_USER_ID) {
      return c.json({ success: false, error: 'Not authorized for this task' }, 403)
    }
  }

  // Cancel via relay
  relayServer.cancelTask(id, machineId || '')

  // Also cancel via dispatch engine
  if (nodeId) {
    await dispatchEngine.cancel(nodeId)
  }

  return c.json({ success: true, aborted: true })
})

/**
 * Prune a branch
 */
const pruneSchema = z.object({
  projectId: z.string().uuid(),
  nodeId: z.string().min(1),
  reason: z.string().max(5000).optional(),
})

dispatchRoute.post('/prune', async (c) => {
  const raw = await c.req.json()
  const parsed = pruneSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid request', details: parsed.error.issues }, 400)
  }
  const result = await dispatchEngine.pruneBranch(parsed.data as BranchPruneRequest)

  if (!result.success) {
    return c.json(result, 400)
  }

  return c.json(result)
})

/**
 * Respond to approval request
 */
dispatchRoute.post('/approve', async (c) => {
  const { approvalId, approved, selectedOption } = await c.req.json<{
    approvalId: string
    approved: boolean
    selectedOption?: string
  }>()

  if (!approvalId) {
    return c.json({ success: false, error: 'approvalId required' }, 400)
  }

  if (approved === undefined || approved === null) {
    return c.json({ success: false, error: 'approved (boolean) required' }, 400)
  }

  try {
    await dispatchEngine.respondToApproval(approvalId, approved, selectedOption)
    return c.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ success: false, error: message }, 400)
  }
})

/**
 * Request dynamic approval (called by MCP tool server)
 */
dispatchRoute.post('/request-dynamic-approval', async (c) => {
  const { executionId, question, options } = await c.req.json<{
    executionId: string
    question: string
    options: string[]
  }>()

  if (!executionId) {
    return c.json({ success: false, error: 'executionId required' }, 400)
  }

  if (!question || typeof question !== 'string') {
    return c.json({ success: false, error: 'question required (string)' }, 400)
  }

  if (!Array.isArray(options) || options.length < 2 || options.length > 5) {
    return c.json({ success: false, error: 'options must be array of 2-5 strings' }, 400)
  }

  // Check YOLO mode: auto-approve with first option
  // Playground tasks (exec-playground-*) use separate playgroundYoloMode setting
  const user = c.get('user') as AuthUser | undefined
  if (user?.id) {
    try {
      const [profile] = await db.select({ settings: userProfiles.settings })
        .from(userProfiles).where(eq(userProfiles.id, user.id)).limit(1)
      const settings = profile?.settings as Record<string, string> | null
      const isPlayground = executionId.includes('playground-')
      const yoloMode = isPlayground
        ? settings?.playgroundYoloMode === 'true'
        : settings?.yoloMode === 'true'
      if (yoloMode && options.length > 0) {
        console.log(`[dispatch] YOLO auto-approved: execution=${executionId} answer="${options[0]}"`)
        return c.json({ success: true, selectedOption: options[0] })
      }
    } catch {
      // fail open — proceed with normal approval flow
    }
  }

  try {
    const selectedOption = await dispatchEngine.requestDynamicApproval(
      executionId,
      question,
      options
    )
    return c.json({ success: true, selectedOption })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ success: false, error: message }, 400)
  }
})

/**
 * Get dispatch queue status
 */
dispatchRoute.get('/status', async (c) => {
  const stats = dispatchEngine.getStats()
  return c.json({
    engine: {
      running: stats.running,
      activeExecutions: stats.activeExecutions,
    },
    queue: {
      total: stats.total,
      byStatus: stats.byStatus,
      activeTotal: stats.activeTotal,
      activePerProject: stats.activePerProject,
    },
  })
})

/**
 * Find ready tasks for a project
 */
dispatchRoute.get('/ready/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const readyTasks = await dispatchEngine.findReadyTasks(projectId)
  return c.json({
    projectId,
    readyTasks,
    count: readyTasks.length,
  })
})

/**
 * Start the dispatch engine
 */
dispatchRoute.post('/engine/start', async (c) => {
  dispatchEngine.start()
  return c.json({ success: true, message: 'Dispatch engine started' })
})

/**
 * Stop the dispatch engine
 */
dispatchRoute.post('/engine/stop', async (c) => {
  dispatchEngine.stop()
  return c.json({ success: true, message: 'Dispatch engine stopped' })
})

/**
 * Reset a task for re-execution
 *
 * Cancels via relay and resets dispatch engine state.
 */
dispatchRoute.post('/reset', async (c) => {
  const { nodeId, executionId, machineId } = await c.req.json<{
    nodeId?: string
    executionId?: string
    machineId?: string
  }>()

  if (!nodeId) {
    return c.json({ success: false, error: 'nodeId required' }, 400)
  }

  // Cancel via relay if we have an execution ID
  if (executionId) {
    relayServer.cancelTask(executionId, machineId || '')
  }

  // Cancel via dispatch engine to clean up queue entries, pending approvals, and active state
  await dispatchEngine.cancel(nodeId)

  return c.json({ success: true })
})

/**
 * Clean up after a completed/pruned task
 *
 * In relay mode, cleanup is handled by the agent runner.
 * This endpoint is kept for API compatibility.
 */
dispatchRoute.post('/cleanup', async (c) => {
  const { executionId, nodeId } = await c.req.json<{
    executionId?: string
    nodeId?: string
  }>()

  if (!executionId && !nodeId) {
    return c.json({ success: false, error: 'executionId or nodeId required' }, 400)
  }

  // In relay mode, the agent runner handles worktree cleanup.
  // We could forward a cleanup command via relay if needed.
  return c.json({ success: true, removed: false })
})

/**
 * Reset a task node for re-execution.
 *
 * Performs a full cleanup:
 * 1. Close the PR if one exists (via GitHub API)
 * 2. Delete the remote branch (via GitHub API)
 * 3. Send worktree cleanup command to agent runner (via relay)
 * 4. Clear PR/branch fields from the plan node in DB
 * 5. Reset node status back to 'planned'
 */
dispatchRoute.post('/reset', async (c) => {
  const { nodeId, projectId, machineId: requestMachineId } = await c.req.json<{
    nodeId: string
    projectId: string
    machineId?: string
  }>()

  if (!nodeId || !projectId) {
    return c.json({ success: false, error: 'nodeId and projectId required' }, 400)
  }

  const user = c.get('user') as AuthUser | undefined
  const userId = user?.id || LOCAL_USER_ID

  // Load the node to get current PR/branch data
  const [node] = await db.select().from(planNodes).where(eq(planNodes.clientId, nodeId)).limit(1)
  if (!node) {
    return c.json({ success: false, error: 'Node not found' }, 404)
  }

  const errors: string[] = []

  // Load project to get GitHub owner/repo
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)

  // Get GitHub token for the authenticated user (used for PR close + branch delete)
  const { githubStore } = await import('../lib/github-store.js')
  const ghConnection = await githubStore.getConnection(userId)
  const ghToken = ghConnection?.accessToken
  const ghRepo = project?.githubOwner && project?.githubRepo
    ? `${project.githubOwner}/${project.githubRepo}`
    : null

  // 1. Close PR if exists (via GitHub API using user's token)
  if (node.prNumber && ghRepo) {
    if (!ghToken) {
      console.warn('[dispatch/reset] No GitHub token available to close PR')
      errors.push('No GitHub token — cannot close PR (connect GitHub in Settings)')
    } else {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${ghRepo}/pulls/${node.prNumber}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${ghToken}`,
              Accept: 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ state: 'closed' }),
          },
        )
        if (response.ok) {
          console.log(`[dispatch/reset] Closed PR #${node.prNumber}`)
        } else {
          const errText = await response.text()
          console.warn(`[dispatch/reset] Failed to close PR #${node.prNumber}: ${response.status} ${errText}`)
          errors.push(`Failed to close PR #${node.prNumber}: ${response.status}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[dispatch/reset] Error closing PR: ${msg}`)
        errors.push(`Error closing PR: ${msg}`)
      }
    }
  }

  // 2. Delete remote TASK branch via GitHub API (using user's token)
  // Guard: never delete the project branch — it accumulates work across tasks.
  // Project branches follow the pattern 'astro/{shortProjectId}' (no node suffix).
  const isProjectBranch = node.branchName && project?.projectBranch && node.branchName === project.projectBranch
  if (node.branchName && ghRepo && ghToken && !isProjectBranch) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${ghRepo}/git/refs/heads/${node.branchName}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        },
      )
      if (response.ok || response.status === 422) {
        console.log(`[dispatch/reset] Deleted remote branch ${node.branchName}`)
      } else {
        const errText = await response.text()
        console.warn(`[dispatch/reset] Failed to delete branch ${node.branchName}: ${response.status} ${errText}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[dispatch/reset] Error deleting remote branch: ${msg}`)
    }
  } else if (isProjectBranch) {
    console.log(`[dispatch/reset] Skipping deletion of project branch ${node.branchName}`)
  }

  // 3. Send cleanup command to agent runner via relay
  const targetMachineId = requestMachineId || project?.defaultMachineId
  if (targetMachineId && node.branchName) {
    const sent = relayServer.cleanupTask(nodeId, targetMachineId, node.branchName)
    if (sent) {
      console.log(`[dispatch/reset] Cleanup command sent to machine ${targetMachineId}`)
    } else {
      console.warn(`[dispatch/reset] Could not send cleanup to machine ${targetMachineId} (not connected)`)
      // Non-fatal — machine may be offline
    }
  }

  // 4. Clear PR/branch fields and reset status in DB
  try {
    await db.update(planNodes)
      .set({
        prUrl: null,
        prNumber: null,
        branchName: null,
        commitBeforeSha: null,
        commitAfterSha: null,
        executionId: null,
        executionOutput: null,
        executionError: null,
        executionStartedAt: null,
        executionCompletedAt: null,
        status: 'planned',
        updatedAt: new Date(),
      })
      .where(eq(planNodes.clientId, nodeId))
    console.log(`[dispatch/reset] Node ${nodeId} reset to planned state`)
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
    console.error(`[dispatch/reset] Failed to reset node in DB: ${msg}`)
    return c.json({ success: false, error: `Database update failed: ${msg}` }, 500)
  }

  // 5. Delete task execution records from DB so they don't reappear after page refresh
  try {
    // Find execution records for this node
    const nodeExecutions = await db.select({ executionId: taskExecutions.executionId })
      .from(taskExecutions)
      .where(eq(taskExecutions.nodeClientId, nodeId))

    if (nodeExecutions.length > 0) {
      const executionIds = nodeExecutions.map(e => e.executionId)

      // Delete streaming events for these executions first (FK constraint)
      await db.delete(streamingEvents)
        .where(inArray(streamingEvents.executionId, executionIds))

      // Delete the execution records themselves
      await db.delete(taskExecutions)
        .where(eq(taskExecutions.nodeClientId, nodeId))

      console.log(`[dispatch/reset] Deleted ${nodeExecutions.length} execution record(s) and associated streaming events for node ${nodeId}`)
    }
  } catch (dbErr) {
    // Non-fatal: log but don't fail the reset — the node is already reset
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
    console.warn(`[dispatch/reset] Failed to delete execution records: ${msg}`)
    errors.push(`Failed to clean up execution records: ${msg}`)
  }

  return c.json({
    success: true,
    errors: errors.length > 0 ? errors : undefined,
    reset: {
      prClosed: !!node.prNumber,
      branchDeleted: !!node.branchName,
      nodeReset: true,
    },
  })
})

/**
 * Bulk reset multiple plan nodes at once.
 *
 * For each node:
 * 1. Close PR if it has one (via GitHub API)
 * 2. Delete remote task branch if not a project branch (via GitHub API)
 * 3. Send worktree cleanup command to relay for nodes with a machineId
 * 4. Bulk-delete streaming_events rows for all node IDs
 * 5. Bulk-delete taskExecutions rows for all node IDs
 * 6. Reset all node fields and status back to 'planned'
 *
 * Individual node operations are wrapped in try/catch so one failure doesn't block others.
 */
const bulkResetSchema = z.object({
  nodeIds: z.array(z.string().min(1).max(100)).min(1).max(500),
  projectId: z.string().min(1).max(100),
})

dispatchRoute.post('/bulk-reset', async (c) => {
  const rawBody = await c.req.json()
  const parsed = bulkResetSchema.safeParse(rawBody)
  if (!parsed.success) {
    return c.json({ success: false, error: `Validation error: ${parsed.error.message}` }, 400)
  }

  const { nodeIds, projectId } = parsed.data
  const user = c.get('user') as AuthUser | undefined
  const userId = user?.id || LOCAL_USER_ID
  const errors: string[] = []

  // 1. Load all referenced plan nodes in a single query
  const nodes = await db.select().from(planNodes).where(inArray(planNodes.clientId, nodeIds))
  if (nodes.length === 0) {
    return c.json({ success: false, error: 'No matching nodes found' }, 404)
  }

  // 2. Load the project to check for GitHub connection
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)

  // Get GitHub token for the authenticated user
  const { githubStore } = await import('../lib/github-store.js')
  const ghConnection = await githubStore.getConnection(userId)
  const ghToken = ghConnection?.accessToken
  const ghRepo = project?.githubOwner && project?.githubRepo
    ? `${project.githubOwner}/${project.githubRepo}`
    : null

  // 3. For each node: close PR and delete remote branch
  for (const node of nodes) {
    // Close PR if exists
    if (node.prNumber && ghRepo) {
      if (!ghToken) {
        errors.push(`No GitHub token — cannot close PR #${node.prNumber} for node ${node.clientId}`)
      } else {
        try {
          const response = await fetch(
            `https://api.github.com/repos/${ghRepo}/pulls/${node.prNumber}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${ghToken}`,
                Accept: 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ state: 'closed' }),
            },
          )
          if (response.ok) {
            console.log(`[dispatch/bulk-reset] Closed PR #${node.prNumber} for node ${node.clientId}`)
          } else {
            const errText = await response.text()
            console.warn(`[dispatch/bulk-reset] Failed to close PR #${node.prNumber}: ${response.status} ${errText}`)
            errors.push(`Failed to close PR #${node.prNumber}: ${response.status}`)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[dispatch/bulk-reset] Error closing PR #${node.prNumber}: ${msg}`)
          errors.push(`Error closing PR #${node.prNumber}: ${msg}`)
        }
      }
    }

    // Delete remote TASK branch (never delete the project branch)
    const isProjectBranch = node.branchName && project?.projectBranch && node.branchName === project.projectBranch
    if (node.branchName && ghRepo && ghToken && !isProjectBranch) {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${ghRepo}/git/refs/heads/${node.branchName}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${ghToken}`,
              Accept: 'application/vnd.github.v3+json',
            },
          },
        )
        if (response.ok || response.status === 422) {
          console.log(`[dispatch/bulk-reset] Deleted remote branch ${node.branchName}`)
        } else {
          const errText = await response.text()
          console.warn(`[dispatch/bulk-reset] Failed to delete branch ${node.branchName}: ${response.status} ${errText}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[dispatch/bulk-reset] Error deleting remote branch ${node.branchName}: ${msg}`)
      }
    }

    // Send cleanup command to agent runner via relay
    const targetMachineId = project?.defaultMachineId
    if (targetMachineId && node.branchName) {
      const sent = relayServer.cleanupTask(node.clientId, targetMachineId, node.branchName)
      if (sent) {
        console.log(`[dispatch/bulk-reset] Cleanup command sent to machine ${targetMachineId} for node ${node.clientId}`)
      } else {
        console.warn(`[dispatch/bulk-reset] Could not send cleanup to machine ${targetMachineId} for node ${node.clientId} (not connected)`)
      }
    }
  }

  // 4. Bulk-delete streaming_events for all node IDs
  try {
    // Find all execution IDs for these nodes
    const nodeExecutions = await db.select({ executionId: taskExecutions.executionId })
      .from(taskExecutions)
      .where(inArray(taskExecutions.nodeClientId, nodeIds))

    if (nodeExecutions.length > 0) {
      const executionIds = nodeExecutions.map(e => e.executionId)

      // Delete streaming events for these executions (FK constraint requires this first)
      await db.delete(streamingEvents)
        .where(inArray(streamingEvents.executionId, executionIds))

      console.log(`[dispatch/bulk-reset] Deleted streaming events for ${executionIds.length} execution(s)`)
    }
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
    console.warn(`[dispatch/bulk-reset] Failed to delete streaming events: ${msg}`)
    errors.push(`Failed to clean up streaming events: ${msg}`)
  }

  // 5. Bulk-delete taskExecutions for all node IDs
  try {
    await db.delete(taskExecutions)
      .where(inArray(taskExecutions.nodeClientId, nodeIds))
    console.log(`[dispatch/bulk-reset] Deleted task executions for ${nodeIds.length} node(s)`)
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
    console.warn(`[dispatch/bulk-reset] Failed to delete task executions: ${msg}`)
    errors.push(`Failed to clean up task executions: ${msg}`)
  }

  // 6. Bulk-reset all plan node fields and status
  try {
    await db.update(planNodes)
      .set({
        prUrl: null,
        prNumber: null,
        branchName: null,
        commitBeforeSha: null,
        commitAfterSha: null,
        executionId: null,
        executionOutput: null,
        executionError: null,
        executionStartedAt: null,
        executionCompletedAt: null,
        status: 'planned',
        updatedAt: new Date(),
      })
      .where(inArray(planNodes.clientId, nodeIds))
    console.log(`[dispatch/bulk-reset] Reset ${nodeIds.length} node(s) to planned state`)
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
    console.error(`[dispatch/bulk-reset] Failed to reset nodes in DB: ${msg}`)
    return c.json({ success: false, error: `Database update failed: ${msg}` }, 500)
  }

  return c.json({
    success: true,
    errors: errors.length > 0 ? errors : undefined,
    nodesReset: nodeIds.length,
  })
})

export { dispatchRoute }
