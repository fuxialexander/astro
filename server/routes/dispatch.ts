/**
 * Dispatch Routes
 *
 * HTTP API endpoints for the task execution dispatch framework.
 * All AI execution flows through the relay to agent runners.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import {
  dispatchEngine,
  capKnowledgeEntries,
  slugifyTitle,
  type DispatchPriority,
} from '../lib/dispatch/index.js'
import { relayServer } from '../lib/relay-server.js'
import { executionEventBus } from '../lib/execution-event-bus.js'
import { machineRegistry } from '../lib/machine-registry.js'
import { getAvailableMachines } from '../lib/registered-machines-store.js'
import { getUserDispatchPublicKeys } from '../lib/user-dispatch-public-keys.js'
import type { ProviderType, ImageAttachment, MachineRegistryEntry } from '../types/relay.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { LOCAL_USER_ID } from '../lib/db/bootstrap-local.js'
import { executionContextStore } from '../lib/execution-context-store.js'
import { astroEventTransport } from '../lib/events/astro-event-transport.js'
import { db } from '../lib/db/index.js'
import { projects, planNodes, planNodeDependencies, blobs, userProfiles, taskExecutions, streamingEvents, projectKnowledge, machineInstructions, registeredMachines, scheduleRuns, teams } from '../lib/db/schema.js'
import { eq, isNull, and, inArray, sql } from 'drizzle-orm'
import type { TaskResult as DispatchTaskResult } from '../lib/dispatch/types.js'
import type { Project } from '../../src/types/index.js'
import { getDeliveryBranchForNode } from '../lib/dispatch/delivery-branch-manager.js'
import { hasFeature } from '../lib/feature-flags.js'
import { buildInteractivePlanPrompt, sanitizeGitHubName, sanitizeGitBranch, formatMachineInstruction, GENERATIVE_UI_HINT } from '../lib/prompt-templates.js'
import { MACHINE_INSTRUCTION_PRESETS } from '../lib/machine-instruction-presets.js'
import { DEFAULT_MACHINE_INSTRUCTION_FORMATTED } from '../lib/machine-instruction-presets.js'
import { BUILTIN_TEMPLATE_IDS } from '../../packages/core/src/index.js'
import { streamingEventLog } from '../lib/streaming-event-log.js'
import { autoDispatchDownstream, cascadePruneDownstream, revertMilestonesOnReset } from './data.js'
// loop-controller is dynamically imported to avoid circular dependency with data.ts
import { redisPubSub } from '../lib/redis-pubsub.js'
import { notifyCritical, notifyWarning } from '../lib/monitoring.js'
import { isYoloMode } from '../lib/yolo-mode.js'
import { serverSideDispatch } from '../lib/server-side-dispatch.js'

// Track workingDirectory per dispatched task (for safety decision lookup).
// Dual-layer: local Map for zero-latency + Redis write-through for cross-instance.
const dispatchedTaskDirs = new Map<string, string>()  // taskId → workingDirectory
// Track approved safety decisions per workingDirectory.
// Dual-layer: local Map + Redis write-through.
const approvedSafetyDirs = new Map<string, string>()  // workingDirectory → decision

// ─── User Decision Prompt Variants ──────────────────────────────
// Injected into the task prompt to guide how the agent handles ambiguity.
// Selected based on provider type and YOLO mode.

/** Default: agent has `ask_user_question` tool (Claude SDK, Codex, OpenCode) */
const ASK_USER_PROMPT = `### Asking the User for Decisions

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
- There's an obvious "right" answer based on codebase conventions`

/** Autonomous mode: YOLO enabled or provider doesn't support interactive approvals (e.g. OpenClaw) */
const AUTONOMOUS_PROMPT = `### Decision Making

You are running in **autonomous mode**. Proceed independently for all decisions — do not pause to ask the user for guidance. Use your best judgment based on the task description, codebase conventions, and standard best practices. If multiple approaches are valid, pick the most pragmatic one and note your reasoning in the output.`

/**
 * Derive a short hex ID from a UUID for compact display (like git short SHAs).
 * "550e8400-e29b-41d4-a716-446655440000" → "550e84"
 */
function getShortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toLowerCase()
}

async function autoDispatchReadyPlanTasks(projectId: string): Promise<number> {
  const completedStatuses = new Set(['completed', 'auto_verified'])

  const projectTaskNodes = await db.select({
    id: planNodes.clientId,
    type: planNodes.type,
    status: planNodes.status,
  }).from(planNodes).where(
    and(eq(planNodes.projectId, projectId), isNull(planNodes.deletedAt))
  )

  const liveTasks = projectTaskNodes.filter((node) =>
    node.type === 'task' && node.status === 'planned'
  )
  if (liveTasks.length === 0) return 0

  const depsRows = await db.select({
    nodeId: planNodeDependencies.nodeClientId,
    dependencyId: planNodeDependencies.dependsOnClientId,
  }).from(planNodeDependencies).where(
    and(
      eq(planNodeDependencies.nodeProjectId, projectId),
      inArray(planNodeDependencies.nodeClientId, liveTasks.map((node) => node.id)),
    )
  )

  const nodeStatus = new Map(projectTaskNodes.map((node) => [node.id, node.status]))
  const depsByNode = new Map<string, string[]>()
  for (const row of depsRows) {
    const deps = depsByNode.get(row.nodeId) || []
    deps.push(row.dependencyId)
    depsByNode.set(row.nodeId, deps)
  }

  const readyTaskIds = liveTasks
    .filter((node) => {
      const deps = depsByNode.get(node.id) || []
      return deps.every((depId) => completedStatuses.has(nodeStatus.get(depId) || 'planned'))
    })
    .map((node) => node.id)

  if (readyTaskIds.length === 0) return 0

  for (const readyTaskId of readyTaskIds) {
    serverSideDispatch(readyTaskId, projectId).catch((err) => {
      console.error(`[dispatch] Interactive plan YOLO auto-dispatch failed for ${readyTaskId}:`, err)
    })
  }

  return readyTaskIds.length
}

function pickBestMachineFromCandidates(
  candidates: MachineRegistryEntry[],
  preferredProvider?: ProviderType,
): MachineRegistryEntry | undefined {
  let filtered = candidates

  if (preferredProvider) {
    filtered = filtered.filter((machine) =>
      machine.providers.some((provider) =>
        provider.type === preferredProvider
        && provider.status === 'available'
        && provider.currentTasks < provider.maxConcurrentTasks,
      ),
    )
  }

  filtered = filtered.filter((machine) =>
    machine.connectionStatus === 'connected'
    && machine.providers.some((provider) =>
      provider.status === 'available'
      && provider.currentTasks < provider.maxConcurrentTasks,
    ),
  )

  if (filtered.length === 0) return undefined

  filtered.sort((a, b) => {
    const scoreA = a.load.cpuPercent + (a.load.activeTasks * 10)
    const scoreB = b.load.cpuPercent + (b.load.activeTasks * 10)
    return scoreA - scoreB
  })

  return filtered[0]
}

/**
 * Derive the default delivery mode from remoteType.
 * This is a last-resort fallback — only runs when neither the request body
 * nor the project DB provides a deliveryMode (line 462 resolves DB first).
 *
 * Mapping:
 *   github/gitlab/bitbucket  → 'pr'     (remote git with hosting platform)
 *   generic                  → 'push'   (remote git, unknown host)
 *   none / undefined         → 'direct' (safe default for ambiguous cases)
 *
 * Why 'direct' for 'none' and undefined:
 * The server doesn't have an `isGit` boolean — only `remoteType`. The value
 * 'none' is sent by the agent-runner for BOTH "non-git directory" (isGit=false)
 * and "local git, no remote" (isGit=true). The server cannot distinguish them.
 *
 * For local-git projects, the DB deliveryMode is set to 'branch' during
 * project creation (from the agent's suggestedDeliveryMode). Additionally,
 * the self-healing block (search: "Self-heal") derives deliveryMode from
 * the project's source column for projects that were created without it
 * (e.g., playground sessions, legacy projects). This fallback only fires
 * when none of the above provides a deliveryMode.
 *
 * 'direct' is the safe default: it activates the server-side serial execution
 * check (preventing concurrent dispatch) and works for both git and non-git
 * directories. If the directory actually has git, the agent-runner's
 * prepareTaskWorkspace() detects it and uses worktree isolation regardless.
 */
function deriveDefaultDeliveryMode(remoteType?: string): 'pr' | 'push' | 'branch' | 'direct' {
  switch (remoteType) {
    case 'github':
    case 'gitlab':
    case 'bitbucket':
      return 'pr'
    case 'generic':
      return 'push'
    case 'none':
    default:
      return 'direct'
  }
}

/**
 * Derive delivery mode from a project's source column.
 * Uses isGit to disambiguate remoteType='none' (local-git vs non-git).
 * Mirrors the frontend's deriveDeliveryMode() in project-source.ts.
 */
function deriveDeliveryModeFromSource(
  source: { isGit?: boolean; remoteType?: string }
): 'pr' | 'push' | 'branch' | 'direct' | undefined {
  if (source.isGit === undefined) return undefined
  if (!source.isGit) return 'direct'
  switch (source.remoteType) {
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
  branchSuffix: z.string().max(20).regex(/^[a-zA-Z0-9][a-zA-Z0-9T-]*$/).optional(),
  scheduleRunId: z.string().uuid().optional(),
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
    branchSuffix,
    scheduleRunId,
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
  let isBuiltinTemplate = false
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
  // Loop/type fields extracted from dbNode inside the try block (same pattern as nodeNumber, title, etc.)
  let nodeType: string | null | undefined
  let loopConfig: import('../../packages/core/src/types.js').LoopConfig | undefined
  let loopStatus: string | null | undefined
  let loopCurrentIteration: number | null | undefined
  try {
    // Fetch plan node (exclude soft-deleted)
    const [dbNode] = await db.select().from(planNodes)
      .where(and(eq(planNodes.clientId, nodeId), isNull(planNodes.deletedAt))).limit(1)
    // Fetch project (team-scoped: verify the user has access)
    const [dbProject] = await db.select().from(projects)
      .where(and(
        eq(projects.id, projectId),
        inArray(projects.teamId, user!.teamIds)
      )).limit(1)
    if (!dbProject) {
      return c.json({ success: false, error: 'Project not found or not authorized' }, 404)
    }

    // Guard against duplicate dispatch: if the node is already dispatched/in_progress,
    // reject unless force=true. Prevents race between frontend and server-side auto-execute.
    if (dbNode && !force && (dbNode.status === 'dispatched' || dbNode.status === 'in_progress')) {
      return c.json({ success: false, error: `Task already ${dbNode.status}` }, 409)
    }

    if (dbNode) {
      nodeNumber = dbNode.number
      title ??= dbNode.title
      description ??= dbNode.description || dbNode.content || dbNode.title
      verification ??= (dbNode.verification as 'auto' | 'human') || undefined
      acceptanceCriteria ??= dbNode.acceptanceCriteria as typeof acceptanceCriteria
      githubIssueUrl ??= (dbNode as Record<string, unknown>).githubIssueUrl as string | undefined
      githubIssueNumber ??= (dbNode as Record<string, unknown>).githubIssueNumber as number | undefined
      nodeType = dbNode.type
      loopConfig = dbNode.loopConfig as typeof loopConfig
      loopStatus = dbNode.loopStatus
      loopCurrentIteration = dbNode.loopCurrentIteration

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
        // Join task_executions to prefer the concise markdownSummary over raw executionOutput.
        // markdownSummary is ~500-2K chars vs. potentially 50K+ for raw output.
        const allProjectNodes = await db.select({
          clientId: planNodes.clientId,
          title: planNodes.title,
          executionOutput: planNodes.executionOutput,
          executionId: planNodes.executionId,
          status: planNodes.status,
          type: planNodes.type,
          projectId: planNodes.projectId,
          prUrl: planNodes.prUrl,
          prNumber: planNodes.prNumber,
          branchName: planNodes.branchName,
          markdownSummary: taskExecutions.markdownSummary,
        }).from(planNodes)
          .leftJoin(taskExecutions, eq(planNodes.executionId, taskExecutions.executionId))
          .where(and(eq(planNodes.projectId, projectId), isNull(planNodes.deletedAt)))

        // Per-dep cap for raw output fallback (chars). markdownSummary is used as-is when present.
        const DEP_RAW_FALLBACK_CAP = 4000
        // Total budget across all dep outputs (chars ≈ tokens / 4).
        const DEP_TOTAL_BUDGET = 20000

        let totalDepChars = 0

        for (const depId of dependencies) {
          if (totalDepChars >= DEP_TOTAL_BUDGET) break

          const depNode = allProjectNodes.find(n => n.clientId === depId)
          if (!depNode) continue

          let output: string | null = null
          if (depNode.markdownSummary) {
            // Prefer the LLM-generated summary — already concise and structured
            output = depNode.markdownSummary
          } else if (depNode.executionOutput) {
            // Fallback: take the TAIL of raw output (the end contains the result/summary, not the raw tool calls)
            const raw = depNode.executionOutput
            output = raw.length > DEP_RAW_FALLBACK_CAP
              ? '...[truncated]\n\n' + raw.slice(-DEP_RAW_FALLBACK_CAP)
              : raw
          } else if (depNode.status === 'completed' || depNode.status === 'auto_verified') {
            // Milestones and tasks without output but with completed status
            output = `[${depNode.type || 'node'} ${depNode.status}]`
          }

          if (output !== null) {
            // Enforce total dep budget — trim this entry if it would push us over
            const remaining = DEP_TOTAL_BUDGET - totalDepChars
            const trimmed = output.length > remaining ? output.slice(0, remaining) + '\n[budget exceeded — truncated]' : output
            totalDepChars += trimmed.length

            dependencyOutputs.push({
              nodeId: depNode.clientId,
              title: depNode.title,
              output: trimmed,
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
      const source = dbProject.source as { localPath?: string; remoteType?: string; baseBranch?: string; isGit?: boolean; type?: string; templateId?: string } | null
      remoteType ??= (source?.remoteType as typeof remoteType) || undefined

      // Self-heal: if deliveryMode is null but source has enough info, derive and backfill.
      // This catches playground-created projects (startPlaygroundSession skips detection)
      // and any legacy projects that predate DB storage of deliveryMode.
      if (!deliveryMode && source) {
        const derived = deriveDeliveryModeFromSource(source)
        if (derived) {
          deliveryMode = derived
          // Backfill so future dispatches hit the DB path directly
          db.update(projects)
            .set({ deliveryMode: derived, updatedAt: new Date() })
            .where(eq(projects.id, projectId))
            .catch(err => console.warn(`[dispatch] Failed to backfill deliveryMode for ${projectId}:`, err))
        }
      }
      baseBranch = source?.baseBranch || undefined

      // Builtin templates skip safety checks — verified against the known registry
      // to prevent bypass via user-editable project source field.
      isBuiltinTemplate = source?.type === 'template'
        && typeof source?.templateId === 'string'
        && BUILTIN_TEMPLATE_IDS.has(source.templateId)

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

  // workingDirectory is optional — when missing, the agent-runner auto-provisions
  // a temporary workspace under its workspace root. Interactive plan sessions
  // can also brainstorm without one.

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
    isBuiltinTemplate,
    skipSafetyCheck,
    verification,
    acceptanceCriteria,
    githubIssueUrl,
    githubIssueNumber,
    githubContext,
    branchSuffix,
    scheduleRunId,
    resumeSessionId,
    forkSession,
    dispatchSignature,
    dispatchSigningPayload,
    dryRun,
    nodeNumber,
    replanContext,
    nodeType,
    loopConfig,
    loopStatus,
    loopCurrentIteration,
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
    isBuiltinTemplate?: boolean
    skipSafetyCheck?: boolean
    verification?: 'auto' | 'human'
    acceptanceCriteria?: Array<{ id: string; description: string; type: string; command?: string; autoVerifiable: boolean }>
    githubIssueUrl?: string
    githubIssueNumber?: number
    githubContext?: import('../lib/prompt-templates.js').GitHubContextForPrompt
    branchSuffix?: string
    scheduleRunId?: string
    resumeSessionId?: string
    forkSession?: boolean
    dispatchSignature?: string
    dispatchSigningPayload?: { v: 1; nodeId: string; projectId: string; machineId: string; timestamp: string; nonce: string }
    dryRun?: boolean
    nodeNumber?: number | null
    replanContext?: z.infer<typeof dispatchTaskSchema>['replanContext']
    nodeType?: string | null
    loopConfig?: import('../../packages/core/src/types.js').LoopConfig
    loopStatus?: string | null
    loopCurrentIteration?: number | null
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
    deliveryMode: deliveryModeParam,
    remoteType,
    baseBranch,
    agentDir,
    worktreeStrategy,
    useWorktree: useWorktreeParam,
    imageRefs,
    isInteractivePlan,
    isBuiltinTemplate,
    skipSafetyCheck,
    verification,
    acceptanceCriteria,
    githubIssueUrl,
    githubIssueNumber,
    githubContext,
    branchSuffix,
    scheduleRunId,
    resumeSessionId,
    forkSession,
    dispatchSignature,
    dispatchSigningPayload,
    dryRun,
    nodeNumber,
    replanContext,
    nodeType,
    loopConfig,
    loopStatus,
    loopCurrentIteration,
  } = params
  const deliveryMode = deliveryModeParam
  const useWorktree = useWorktreeParam

  // Compute short hex IDs early — needed for prompt building + relay dispatch
  const shortProjectId = getShortId(projectId)
  const shortNodeId = getShortNodeId(nodeId, nodeNumber)

  // Extract user for ownership verification
  const user = c.get('user') as AuthUser | undefined
  let availableMachinesLoaded = false
  let accessibleMachinesById = new Map<string, Awaited<ReturnType<typeof getAvailableMachines>>[number]>()

  if (user?.id && !dryRun) {
    try {
      const availableMachines = await getAvailableMachines(user.id)
      accessibleMachinesById = new Map(availableMachines.map((machine) => [machine.id, machine]))
      availableMachinesLoaded = true
    } catch (err) {
      console.warn('[dispatch] Failed to load available machines:', err instanceof Error ? err.message : String(err))
    }
  }

  // Resolve YOLO mode early — affects prompt assembly (user decision section)
  let yoloEnabled = false
  if (user?.id) {
    try {
      const [profile] = await db.select({ settings: userProfiles.settings })
        .from(userProfiles).where(eq(userProfiles.id, user.id)).limit(1)
      const settings = profile?.settings as Record<string, string> | null
      const isPlayground = nodeId.startsWith('playground-')
      yoloEnabled = isPlayground
        ? settings?.playgroundYoloMode === 'true'
        : settings?.yoloMode !== 'false'  // Default ON when unset (matches frontend default)
    } catch { /* fail closed — default non-YOLO */ }
  }

  // Find target machine (skip for dry runs — prompt assembly doesn't need a machine)
  let machineId = targetMachineId
  let selectedMachineAccess = machineId ? accessibleMachinesById.get(machineId) : undefined
  let dispatchTrustedKeys: Awaited<ReturnType<typeof getUserDispatchPublicKeys>> | undefined
  if (!dryRun) {
    if (!machineId) {
      const bestMachine = availableMachinesLoaded && user?.id
        ? pickBestMachineFromCandidates(
            machineRegistry.getAll().filter((machine) =>
              accessibleMachinesById.has(machine.machineId)
              || !machine.userId
              || machine.userId === LOCAL_USER_ID,
            ),
            preferredProvider,
          )
        : machineRegistry.findBestMachine(preferredProvider, user?.id)
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
      selectedMachineAccess = accessibleMachinesById.get(machineId)
    } else {
      // Verify access to explicitly targeted machine (owner or team-shared)
      const targetMachine = machineRegistry.get(machineId)
      const ownerAllowed = !targetMachine?.userId
        || targetMachine.userId === LOCAL_USER_ID
        || targetMachine.userId === user?.id
      const sharedAllowed = !!selectedMachineAccess
      if (user?.id && !ownerAllowed && !sharedAllowed) {
        return c.json(
          { success: false, error: `Machine ${machineId} not found or not authorized` },
          403
        )
      }
    }

    if (dispatchSigningPayload && (
      dispatchSigningPayload.machineId !== machineId
      || dispatchSigningPayload.nodeId !== nodeId
      || dispatchSigningPayload.projectId !== projectId
    )) {
      return c.json(
        { success: false, error: 'Dispatch signing payload does not match the requested task or machine' },
        400,
      )
    }

    const isSharedMachine = !!(
      user?.id
      && selectedMachineAccess
      && selectedMachineAccess.userId !== user.id
      && selectedMachineAccess.teamId
    )

    if (user?.id && dispatchSignature && dispatchSigningPayload) {
      try {
        const trustedKeys = await getUserDispatchPublicKeys(user.id)
        if (trustedKeys.length > 0) {
          dispatchTrustedKeys = trustedKeys
        }
      } catch (err) {
        console.warn('[dispatch] Failed to load trusted dispatch keys:', err instanceof Error ? err.message : String(err))
      }
    }

    if (isSharedMachine) {
      if (!dispatchSignature || !dispatchSigningPayload) {
        return c.json(
          { success: false, error: 'Shared machine dispatch requires a signed browser intent' },
          403,
        )
      }
      if (!dispatchTrustedKeys || dispatchTrustedKeys.length === 0) {
        return c.json(
          { success: false, error: 'Shared machine dispatch requires a registered browser signing key. Authorize a device from this account first.' },
          403,
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
  const DEFAULT_INSTRUCTION_ID = 'builtin:default'
  if (machineId) {
    try {
      const [machine] = await db.select({ defaultInstructionId: registeredMachines.defaultInstructionId })
        .from(registeredMachines).where(eq(registeredMachines.id, machineId)).limit(1)
      const instrId = machine?.defaultInstructionId ?? DEFAULT_INSTRUCTION_ID
      if (instrId.startsWith('builtin:')) {
        const preset = MACHINE_INSTRUCTION_PRESETS.find((p) => p.id === instrId)
        if (preset) skillsInjection = formatMachineInstruction(preset.name, preset.content)
      } else {
        const [instruction] = await db.select({ content: machineInstructions.content, name: machineInstructions.name })
          .from(machineInstructions).where(eq(machineInstructions.id, instrId)).limit(1)
        if (instruction?.content) {
          skillsInjection = formatMachineInstruction(instruction.name, instruction.content)
        }
      }
    } catch (err) {
      console.warn('[dispatch] Failed to fetch machine instruction:', err instanceof Error ? err.message : String(err))
      notifyWarning(`Machine instruction fetch failed for ${machineId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  // Fallback: use built-in default compute guide (loaded from skills/machine_instruction_presets/)
  if (!skillsInjection) {
    skillsInjection = DEFAULT_MACHINE_INSTRUCTION_FORMATTED
  }

  // Generative UI hint — shared constant from prompt-templates, injected into ALL pathways
  skillsInjection = (skillsInjection || '') + '\n\n' + GENERATIVE_UI_HINT

  if (isInteractivePlan) {
    // Use the dedicated interactive plan prompt as a system prompt.
    // It includes vision doc, skills, GitHub context, and planning instructions.
    relaySystemPrompt = buildInteractivePlanPrompt(description, {
      projectId,
      visionDoc: visionDoc || undefined,
      hasWorkingDirectory: !!workingDirectory,
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
      const knowledgeRows = await db.select().from(projectKnowledge).where(and(eq(projectKnowledge.projectId, projectId), isNull(projectKnowledge.deletedAt)))
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
      notifyWarning(`Knowledge fetch failed for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`)
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
      const branchName = branchSuffix
        ? `astro/${shortProjectId}-${shortNodeId}-${branchSuffix}`
        : `astro/${shortProjectId}-${shortNodeId}`

      if (effectiveDelivery === 'pr' && usesWorktree) {
        promptParts.push(`## Workspace & Delivery

You are working in a git worktree (isolated branch) created from the project at: ${workingDirectory}
Your branch: ${branchName}
The worktree is located under \`${effectiveAgentDir}/worktrees/\` in the git root.

**IMPORTANT — read every bullet:**
- All your changes are on this isolated branch — commit freely
- NEVER cd to or modify files in the original project directory (${workingDirectory})
- **Before finishing, you MUST \`git add\` and \`git commit\` ALL changed files.** If you skip this step, your work will be lost. Run \`git status\` to verify nothing is left uncommitted.
- After you finish, the platform will automatically push your branch and create a PR on GitHub
- NEVER run \`git push\` or \`gh pr create\` yourself — the platform handles this`)
      } else if (effectiveDelivery === 'push' && usesWorktree) {
        promptParts.push(`## Workspace & Delivery

You are working in a git worktree (isolated branch) created from the project at: ${workingDirectory}
Your branch: ${branchName}
The worktree is located under \`${effectiveAgentDir}/worktrees/\` in the git root.

**IMPORTANT — read every bullet:**
- All changes are on this isolated branch — commit freely
- NEVER modify files in the original project directory (${workingDirectory})
- **Before finishing, you MUST \`git add\` and \`git commit\` ALL changed files.** If you skip this step, your work will be lost. Run \`git status\` to verify nothing is left uncommitted.
- Your branch will be automatically pushed to the remote (user will create a PR manually)
- NEVER run \`git push\` yourself — the platform handles this`)
      } else if (effectiveDelivery === 'branch' && usesWorktree) {
        promptParts.push(`## Workspace & Delivery

You are working in a git worktree (isolated branch) created from the project at: ${workingDirectory}
Your branch: ${branchName}
The worktree is located under \`${effectiveAgentDir}/worktrees/\` in the git root.

**IMPORTANT — read every bullet:**
- All changes are on this isolated branch — commit freely
- NEVER modify files in the original project directory (${workingDirectory})
- **Before finishing, you MUST \`git add\` and \`git commit\` ALL changed files.** If you skip this step, your work will be lost. Run \`git status\` to verify nothing is left uncommitted.
- Your branch will stay local — the user will merge it manually`)
      } else if (effectiveDelivery === 'copy' && usesWorktree) {
        promptParts.push(`## Workspace & Delivery

You are working in a temporary copy of the project at: ${workingDirectory}
The original project is at: ${workingDirectory}

**IMPORTANT:**
- Your changes are in a copy — the original is untouched until you finish
- When done, your changes will be diffed against the original and presented for review`)
      } else if (!workingDirectory) {
        promptParts.push(`## Workspace & Delivery

Your workspace will be auto-provisioned by the platform. You do not need to create or navigate to a directory — the runner sets up the working directory for you.

**IMPORTANT:**
- This is a temporary workspace — there is no pre-existing codebase or git history
- Work directly in the current directory provided by the runner
- When done, commit all changes with a descriptive commit message`)
      } else if (effectiveDelivery === 'direct' || !usesWorktree) {
        promptParts.push(`## Workspace & Delivery

You are working directly in the project directory: ${workingDirectory}
There is no branch isolation — changes are made in-place.

**IMPORTANT:**
- Changes are applied directly to the project files — there is no undo
- After making changes, remind the user to review and git commit/push their changes
- NEVER run \`git commit\` or \`git push\` yourself — let the user decide when and what to commit`)
      }
    }

    // Loop iteration context injection
    if (nodeType === 'loop' && loopConfig && loopStatus === 'iterating') {
      const { buildIterationContext, getLoopIterations } = await import('../lib/loop-controller.js')
      const iterations = await getLoopIterations(nodeId, projectId)
      const currentIter = loopCurrentIteration ?? 1
      // Filter out the 'running' iteration (the one we're about to dispatch)
      const completedIters = iterations.filter(i => i.status !== 'running')
      const iterationContext = buildIterationContext(loopConfig, completedIters, currentIter)
      promptParts.push(iterationContext)
    }

    // SECURITY (MEDIUM-002): wrap user-provided title and description in delimiters
    promptParts.push(`## Current Task\n\n<user_task>\n**${title}**\n\n${description}\n</user_task>`)

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
- If you are uncertain about any implementation choice, ask for guidance before proceeding`
      if (manualChecks.length > 0) {
        verificationSection += `\n\nThe reviewer will check:\n${manualChecks.map(c => `- ${c.description}`).join('\n')}`
      }
    }

    // Select the appropriate user-decision prompt based on provider and YOLO mode
    const userDecisionPrompt = (yoloEnabled || preferredProvider === 'openclaw')
      ? AUTONOMOUS_PROMPT
      : ASK_USER_PROMPT

    const isPlayground = nodeId.startsWith('playground-')
    const executiveSummarySection = isPlayground ? '' : `

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

This summary is shown to the user for review. Keep each bullet concise (under 100 characters). Include 2-5 key findings. The summary must be the very last thing you output.`

    promptParts.push(`## Instructions

Execute the task described above. Focus on completing the task thoroughly and correctly.
- Use appropriate tools to accomplish the task
- Report progress and any issues encountered

${userDecisionPrompt}

### Verification

${verificationSection}${executiveSummarySection}`)
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
        inArray(blobs.teamId, user.teamIds),
        isNull(blobs.deletedAt)
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
      notifyWarning(`Image blob fetch failed for task ${nodeId}: ${err instanceof Error ? err.message : String(err)}`)
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
        inArray(projects.teamId, user!.teamIds)
      )
    ).limit(1)
    projectRecord = row as unknown as Project | undefined
  } catch (err) {
    console.warn('[dispatch] Failed to fetch project for event hooks:', err)
  }

  // Compute delivery branch for this task's connected component.
  // Falls back to legacy project-level branch if delivery branches are not yet assigned
  // or if the feature flag is disabled for this team.
  let projectBranch = `astro/${shortProjectId}`
  let deliveryBranchIsSingleton = false
  try {
    // Check feature flag: look up team flags from the project's team
    let teamFlags: Record<string, boolean> | null = null
    if (projectRecord) {
      const [teamRow] = await db.select({ featureFlags: teams.featureFlags })
        .from(teams).where(eq(teams.id, projectRecord.teamId)).limit(1)
      teamFlags = teamRow?.featureFlags ?? null
    }

    if (hasFeature(teamFlags, 'delivery-branches')) {
      const deliveryBranch = await getDeliveryBranchForNode(db, projectId, nodeId, shortProjectId)
      if (deliveryBranch) {
        projectBranch = deliveryBranch.branchName
        deliveryBranchIsSingleton = deliveryBranch.isSingleton
        console.log(`[dispatch] Using delivery branch ${projectBranch} (singleton=${deliveryBranchIsSingleton}) for node ${nodeId}`)
      }
    }
  } catch (err) {
    console.warn(`[dispatch] Failed to resolve delivery branch for node ${nodeId}, falling back to project branch:`, err)
  }

  // Persist projectBranch to the project record for backward compatibility (idempotent)
  try {
    await db.update(projects)
      .set({ projectBranch: `astro/${shortProjectId}`, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), isNull(projects.projectBranch)))
  } catch (err) {
    console.warn(`[dispatch] Failed to persist projectBranch for project ${projectId}:`, err)
  }

  // Look up cached safety decision for this working directory.
  // Used only for skipSafetyCheck below — does NOT override delivery mode.
  // Delivery mode is always derived from the normal chain:
  //   request body → project DB → deriveDefaultDeliveryMode(remoteType)
  // Previously this block forced deliveryMode='direct' when safetyDecision='proceed',
  // which caused stale overrides when the user initialized git after the original decision.
  const safetyDecision = workingDirectory
    ? (approvedSafetyDirs.get(workingDirectory) ?? await redisPubSub.getApprovedSafetyDir(workingDirectory))
    : null

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
    deliveryBranchIsSingleton,
    agentDir,
    worktreeStrategy,
    useWorktree,
    images,
    skipSafetyCheck: isBuiltinTemplate || (skipSafetyCheck && nodeId.startsWith('playground-')) || (!!workingDirectory && safetyDecision !== null) || !workingDirectory,
    ...(isInteractivePlan ? { useWorktree: false, deliveryMode: 'direct' as const, type: 'plan' as const } : {}),
    ...(nodeId.startsWith('playground-') && !isInteractivePlan ? { type: 'playground' as const } : {}),
    ...(relaySystemPrompt ? { systemPrompt: relaySystemPrompt } : {}),
    ...(astroBaseUrl && { astroBaseUrl }),
    ...(githubIssueUrl && { githubIssueUrl }),
    ...(githubIssueNumber !== undefined && { githubIssueNumber }),
    ...(dispatchSignature && { dispatchSignature }),
    ...(dispatchSigningPayload && { dispatchSigningPayload }),
    ...(dispatchTrustedKeys && dispatchTrustedKeys.length > 0 && { dispatchTrustedKeys }),
    ...(resumeSessionId && { resumeSessionId }),
    ...(forkSession && { forkSession }),
  }

  // Track directory for safety decision caching (local + Redis write-through)
  if (workingDirectory) {
    dispatchedTaskDirs.set(executionId, workingDirectory)
    redisPubSub.setTaskDir(executionId, workingDirectory).catch((err) => {
      notifyWarning(`Redis setTaskDir failed for ${executionId}: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  // ── Background relay listeners ────────────────────────────────────────────
  // All subsequent relay events (text, tool_use, result, etc.) reach the frontend
  // exclusively through the global SSE bus (relay-server → executionEventBus → events.ts → realtime-store).
  // Background handlers here handle server-side DB persistence and lifecycle that must happen
  // regardless of whether the browser is still connected.
  {
    let resultSent = false
    let waitingForApproval = false
    // Captured from session_init event — used for server-side taskExecutions persistence
    let capturedSessionId: string | null = null
    let capturedModel: string | null = null
    // Two-tier timeout: short startup period, longer once events are flowing.
    const STARTUP_TIMEOUT_MS = 3 * 60 * 1000
    const MAX_STARTUP_RETRIES = 10
    const FINAL_STARTUP_TIMEOUT_MS = 10 * 60 * 1000
    let startupRetries = 0
    let lastActivity = Date.now()
    const dispatchStartTime = Date.now()
    let lastElapsedMsg = 0
    let hasReceivedEvent = false
    const loopTimeoutMinutes = (nodeType === 'loop' && loopConfig)
      ? loopConfig.iterationTimeoutMinutes
      : undefined
    const ACTIVITY_TIMEOUT_MS = loopTimeoutMinutes
      ? loopTimeoutMinutes * 60 * 1000
      : 2 * 60 * 60 * 1000

    const onResult = async (msg: import('../types/relay.js').TaskResultMessage) => {
      if (msg.result.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      resultSent = true
      executionContextStore.remove(executionId)
      dispatchedTaskDirs.delete(executionId)
      redisPubSub.removeTaskDir(executionId).catch((err) => {
        notifyWarning(`Redis removeTaskDir failed for ${executionId}: ${err instanceof Error ? err.message : String(err)}`)
      })

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

      const isSuccess = msg.result.status === 'completed'
      const deliveryOk = !msg.result.deliveryStatus ||
        msg.result.deliveryStatus === 'success' ||
        msg.result.deliveryStatus === 'skipped'
      const yoloEnabled = isSuccess
        ? await isYoloMode(user?.id, nodeId).catch(() => false)
        : false
      // In YOLO mode, auto-verify even if delivery failed — the user opted out of
      // manual review. Delivery errors are still visible in the UI. Without YOLO,
      // delivery failure requires human judgment (the work is done but not shipped).
      const finalNodeStatus = isSuccess
        ? ((verification === 'auto' || yoloEnabled) && (deliveryOk || yoloEnabled) ? 'auto_verified' : 'awaiting_judgment')
        : 'awaiting_judgment'

      // Notify on task failure via Telegram
      if (!isSuccess) {
        notifyCritical({
          title: 'Task Execution Failed',
          project: projectRecord?.name || projectId,
          task: title || nodeId,
          machine: machineId || 'unknown',
          error: msg.result.error || 'Agent returned non-completed status',
          impact: `Task finished with status "${msg.result.status}" — requires human review`,
          action: 'Review execution output in the activity feed and re-execute or adjust the task',
          errorType: 'task_failure',
        })
      }
      // Notify on delivery failure (work done but not shipped)
      if (isSuccess && msg.result.deliveryStatus === 'failure') {
        notifyCritical({
          title: 'Code Delivery Failed',
          project: projectRecord?.name || projectId,
          task: title || nodeId,
          machine: machineId || 'unknown',
          error: msg.result.deliveryError || 'Delivery step returned failure status',
          impact: 'Task completed but code was not pushed/PR was not created',
          action: 'Check git remote access, branch permissions, and GitHub token validity',
          errorType: 'delivery_failure',
        })
      }

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
      // Persist result event (also flushes any pending text)
      await streamingEventLog.appendTerminalIfAbsent(executionId, 'result', resultData)

      // Emit task.completed AstroEvent for observability hooks (observation collector, usage metrics)
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
        summary: msg.result.summary,
      }
      astroEventTransport.emitEvent({
        type: 'task.completed',
        taskId: executionId,
        nodeId,
        projectId,
        executionId,
        machineId: machineId || undefined,
        finalNodeStatus: finalNodeStatus,
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

      const completionTime = new Date()
      const nodePatch: Partial<typeof planNodes.$inferInsert> = {
        status: finalNodeStatus,
        executionOutput: msg.result.output ?? null,
        executionCompletedAt: completionTime,
        executionError: msg.result.error ?? null,
        endDate: completionTime.toISOString(),
        actualEndDate: completionTime,
        updatedAt: completionTime,
      }
      if (msg.result.branchName) nodePatch.branchName = msg.result.branchName
      if (msg.result.prUrl) nodePatch.prUrl = msg.result.prUrl
      if (msg.result.prNumber) nodePatch.prNumber = msg.result.prNumber
      if (msg.result.commitBeforeSha) nodePatch.commitBeforeSha = msg.result.commitBeforeSha
      if (msg.result.commitAfterSha) nodePatch.commitAfterSha = msg.result.commitAfterSha

      // Await DB write so node:status_changed is only emitted after commit.
      // Frontend re-reads from DB on notification (DB-authoritative pattern).
      try {
        await db.update(planNodes)
          .set(nodePatch)
          .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
          .execute()

        // Notify frontend: DB is committed, safe to re-read
        executionEventBus.emit('node:status_changed', {
          nodeId, projectId, status: finalNodeStatus, executionId,
        })

        // Check if this is a loop node iteration — loops must always advance,
        // regardless of finalNodeStatus (the loop controller handles failures internally)
        const [loopCheck] = await db.select({
          type: planNodes.type,
          loopStatus: planNodes.loopStatus,
        }).from(planNodes)
          .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
          .limit(1)

        if (loopCheck?.type === 'loop' && loopCheck.loopStatus === 'iterating') {
          const { advanceLoop } = await import('../lib/loop-controller.js')
          advanceLoop(nodeId, projectId, {
            executionId,
            output: msg.result.output ?? msg.result.summary?.workCompleted,
            status: msg.result.status === 'completed' ? 'success' : 'failure',
            branchName: msg.result.branchName,
          }).catch((err) => {
            console.error('[dispatch] Loop advance failed:', err)
          })
        } else if (isInteractivePlan && isSuccess && yoloEnabled) {
          const readyTaskCount = await autoDispatchReadyPlanTasks(projectId)
          if (readyTaskCount === 0) {
            console.log(`[dispatch] Interactive plan YOLO: no ready tasks to auto-dispatch for project ${projectId}`)
          } else {
            console.log(`[dispatch] Interactive plan YOLO auto-dispatched ${readyTaskCount} ready task(s) for project ${projectId}`)
          }
        } else if (finalNodeStatus === 'auto_verified' || finalNodeStatus === 'completed') {
          // Auto-dispatch downstream tasks server-side (works even if browser disconnected).
          // Triggers for both auto_verified (YOLO mode) and completed (human-verified),
          // so downstream tasks cascade regardless of verification mode.
          autoDispatchDownstream(projectId, nodeId).catch((err) => {
            console.error('[dispatch] Auto-dispatch downstream failed:', err)
          })
        }
      } catch (err: unknown) {
        console.error('[dispatch] Error persisting execution result to plan node:', err)
      }

      // Server-side taskExecutions persistence — ensures the execution record exists
      // even if the browser disconnects before the frontend can persist it.
      // Uses onConflictDoUpdate so that if the frontend already persisted this record
      // (via dataClient.saveExecution), the server-side data wins for metrics/status.
      try {
        const startedAt = dispatchMetrics?.durationMs
          ? new Date(completionTime.getTime() - dispatchMetrics.durationMs)
          : completionTime
        await db.insert(taskExecutions).values({
          executionId,
          nodeClientId: nodeId,
          projectId,
          userId: user?.id ?? null,
          status: isSuccess ? 'success' : 'failure',
          error: msg.result.error ?? null,
          startedAt,
          completedAt: completionTime,
          sessionId: capturedSessionId,
          machineId: machineId || null,
          providerId: preferredProvider || null,
          providerName: preferredProvider || null,
          durationMs: dispatchMetrics?.durationMs ?? null,
          inputTokens: dispatchMetrics?.inputTokens ?? null,
          outputTokens: dispatchMetrics?.outputTokens ?? null,
          tokensUsed: dispatchMetrics?.tokensUsed ?? null,
          estimatedCostUsd: dispatchMetrics?.estimatedCostUsd ?? null,
          model: capturedModel || dispatchMetrics?.model || null,
          turnsUsed: dispatchMetrics?.turnsUsed ?? null,
          summary: msg.result.summary ?? null,
        }).onConflictDoUpdate({
          target: taskExecutions.executionId,
          set: {
            status: isSuccess ? 'success' : 'failure',
            error: msg.result.error ?? null,
            completedAt: completionTime,
            sessionId: capturedSessionId,
            durationMs: dispatchMetrics?.durationMs ?? null,
            inputTokens: dispatchMetrics?.inputTokens ?? null,
            outputTokens: dispatchMetrics?.outputTokens ?? null,
            tokensUsed: dispatchMetrics?.tokensUsed ?? null,
            estimatedCostUsd: dispatchMetrics?.estimatedCostUsd ?? null,
            model: capturedModel || dispatchMetrics?.model || null,
            turnsUsed: dispatchMetrics?.turnsUsed ?? null,
            ...(msg.result.summary ? { summary: msg.result.summary } : {}),
          },
        })
      } catch (err: unknown) {
        console.error('[dispatch] Error persisting taskExecution record:', err)
      }

      // Update schedule run status if this dispatch was triggered by a cron schedule
      if (scheduleRunId) {
        const runStatus = (finalNodeStatus === 'auto_verified' || finalNodeStatus === 'completed') ? 'success' : 'failure'
        db.update(scheduleRuns)
          .set({ status: runStatus, completedAt: new Date(), executionIds: [executionId] })
          .where(eq(scheduleRuns.id, scheduleRunId))
          .execute()
          .catch((err: unknown) => {
            console.error('[dispatch] Error updating schedule run:', err)
          })
      }

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
      }

      // Clean up result/error listeners now that the result has been processed
      cleanupResult()
    }

    const onText = (msg: import('../types/relay.js').TaskTextMessage) => {
      if (msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      waitingForApproval = false
      // relay-server is the single persistence authority — no SSE write needed here.
    }

    const onOperational = (msg: import('../types/relay.js').TaskOperationalMessage) => {
      if (msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
    }

    const onSessionInit = (msg: import('../types/relay.js').TaskSessionInitMessage) => {
      if (msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      capturedSessionId = msg.sessionId || null
      capturedModel = msg.model || null

      // Batch-drain: deliver any pending steer messages that were queued before session_init
      drainPendingSteers(executionId, machineId).catch((err) => {
        console.warn(`[dispatch] Failed to drain pending steers on session_init:`, err)
      })
    }

    const onProgress = async (msg: import('../types/relay.js').TaskProgressMessage) => {
      if (msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      // relay-server persists progress events; no SSE write needed here.
    }

    const onToolTrace = (msg: import('../types/relay.js').TaskToolTraceMessage) => {
      if (msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      waitingForApproval = false
    }

    const onFileChange = (msg: import('../types/relay.js').TaskFileChangeMessage) => {
      if (msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
    }

    const onMachineDisconnected = async (disconnectedId: string) => {
      if (disconnectedId !== machineId || resultSent) return
      console.log(`[dispatch] Machine ${machineId} disconnected during task ${executionId}`)
      const errorData = { error: 'Remote machine disconnected during task execution', recoverable: false }
      notifyCritical({
        title: 'Machine Disconnected During Task',
        project: projectRecord?.name || projectId,
        task: title || nodeId,
        machine: machineId || 'unknown',
        error: 'Machine went offline while task was running',
        impact: 'Task execution interrupted — requires re-execution',
        action: 'Check machine connectivity and agent-runner process',
        errorType: 'machine_disconnect',
      })
      await streamingEventLog.appendTerminalIfAbsent(executionId, 'error', errorData)

      // DB-authoritative: update plan node status + notify frontend (all node types)
      const errorTime = new Date()
      try {
        await db.update(planNodes)
          .set({
            status: 'awaiting_judgment',
            executionError: 'Remote machine disconnected during task execution',
            endDate: errorTime.toISOString(),
            actualEndDate: errorTime,
            updatedAt: errorTime,
          })
          .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
          .execute()
        executionEventBus.emit('node:status_changed', {
          nodeId, projectId, status: 'awaiting_judgment', executionId,
        })
      } catch (err: unknown) {
        console.error('[dispatch] Failed to update plan_node on machine disconnect:', err)
      }

      // Update taskExecutions so the record doesn't stay 'running' forever
      db.update(taskExecutions)
        .set({ status: 'failure', error: 'Remote machine disconnected during task execution', completedAt: errorTime })
        .where(eq(taskExecutions.executionId, executionId))
        .execute()
        .catch((err: unknown) => {
          console.error('[dispatch] Error updating taskExecution on machine disconnect:', err)
        })

      // Update schedule run status so cron concurrency is unblocked
      if (scheduleRunId) {
        db.update(scheduleRuns)
          .set({ status: 'failure', completedAt: new Date(), errorMessage: 'Machine disconnected during execution' })
          .where(eq(scheduleRuns.id, scheduleRunId))
          .execute()
          .catch((err: unknown) => {
            console.error('[dispatch] Error updating schedule run on machine disconnect:', err)
          })
      }

      cleanupResult()
    }

    const onApprovalRequest = async (msg: { taskId: string; requestId: string; question: string; options: string[]; machineId?: string }) => {
      if (resultSent || msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true

      // YOLO mode: auto-approve with first option instead of showing card
      if (user?.id && msg.options.length > 0) {
        try {
          const yoloOn = await isYoloMode(user.id, nodeId)
          if (yoloOn) {
            const targetMachineId = msg.machineId || machineId || ''
            const autoAnswer = msg.options[0]
            console.log(`[dispatch] YOLO auto-approved relay approval: execution=${executionId} requestId=${msg.requestId} answer="${autoAnswer}"`)
            relayServer.sendApprovalResponse(executionId, targetMachineId, msg.requestId, true, autoAnswer)
            // Persist both request and response so hydration shows it as answered
            await streamingEventLog.appendApprovalRequestIfAbsent(executionId, { requestId: msg.requestId, question: msg.question, options: msg.options, machineId: targetMachineId })
              .catch((err) => console.warn('[dispatch] Failed to persist YOLO approval_request:', (err as Error).message))
            await streamingEventLog.appendApprovalResponseIfAbsent(executionId, { requestId: msg.requestId, answer: autoAnswer, answered: true })
              .catch((err) => console.warn('[dispatch] Failed to persist YOLO approval_response:', (err as Error).message))
            return
          }
        } catch {
          // fail open — proceed with normal approval flow
        }
      }

      waitingForApproval = true
      // Persist approval_request so it survives page refresh
      const approvalData = { requestId: msg.requestId, question: msg.question, options: msg.options, machineId: msg.machineId || machineId }
      streamingEventLog.appendApprovalRequestIfAbsent(executionId, approvalData)
        .catch((err) => console.warn('[dispatch] Failed to persist approval_request:', (err as Error).message))
    }

    // P3: Listen for task:stdout to reset activity timer (fixes SLURM output tailing + blocking Bash commands)
    const onStdout = (msg: import('../types/relay.js').TaskStdoutMessage) => {
      if (resultSent || msg.output.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
    }

    const onSafetyPrompt = (msg: { taskId: string; safetyTier: string; warning?: string; options: Array<{ id: string; label: string; description?: string }>; machineId?: string }) => {
      if (resultSent || msg.taskId !== executionId) return
      lastActivity = Date.now()
      hasReceivedEvent = true
      waitingForApproval = true
      // Persist safety_prompt so it survives page refresh
      const safetyData = { safetyTier: msg.safetyTier, warning: msg.warning, options: msg.options, machineId: msg.machineId || machineId }
      streamingEventLog.appendSafetyPromptIfAbsent(executionId, safetyData)
        .catch((err) => console.warn('[dispatch] Failed to persist safety_prompt:', (err as Error).message))
    }

    // P2: Handle dead job detection
    const onTaskDead = async (data: { taskId: string; machineId: string; reason: string }) => {
      if (data.taskId !== executionId || resultSent) return
      console.log(`[dispatch] Task ${executionId} declared dead by heartbeat cross-ref: ${data.reason}`)
      const errorData = { error: `Dead job detected: ${data.reason}`, recoverable: true }
      notifyCritical({
        title: 'Dead Job Detected',
        project: projectRecord?.name || projectId,
        task: title || nodeId,
        machine: data.machineId || machineId || 'unknown',
        error: data.reason,
        impact: 'Task was running but agent process is no longer active',
        action: 'Task status reset to planned — re-execute when ready',
        errorType: 'dead_job',
      })
      await streamingEventLog.appendTerminalIfAbsent(executionId, 'error', errorData).catch(() => {})

      // DB-authoritative: update plan node status + notify frontend (all node types)
      const errorTime = new Date()
      try {
        await db.update(planNodes)
          .set({
            status: 'planned',
            executionError: `Dead job detected: ${data.reason}`,
            executionId: null,
            executionStartedAt: null,
            executionOutput: null,
            executionCompletedAt: null,
            endDate: errorTime.toISOString(),
            actualEndDate: errorTime,
            updatedAt: errorTime,
          })
          .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
          .execute()
        executionEventBus.emit('node:status_changed', {
          nodeId, projectId, status: 'planned', executionId,
        })
      } catch (err: unknown) {
        console.error('[dispatch] Failed to update plan_node on dead job:', err)
      }

      // Update taskExecutions so the record doesn't stay 'running' forever
      db.update(taskExecutions)
        .set({ status: 'failure', error: `Dead job detected: ${data.reason}`, completedAt: new Date() })
        .where(eq(taskExecutions.executionId, executionId))
        .execute()
        .catch((err: unknown) => {
          console.error('[dispatch] Error updating taskExecution on dead job:', err)
        })

      // Update schedule run status so cron concurrency is unblocked
      if (scheduleRunId) {
        db.update(scheduleRuns)
          .set({ status: 'failure', completedAt: new Date(), errorMessage: `Dead job: ${data.reason}` })
          .where(eq(scheduleRuns.id, scheduleRunId))
          .execute()
          .catch((err: unknown) => {
            console.error('[dispatch] Error updating schedule run on dead job:', err)
          })
      }

      cleanupResult()
    }

    const onTaskError = (msg: { taskId: string; error: string }) => {
      if (msg.taskId !== executionId || resultSent) return
      // relay-server persists task errors; DB is updated by onResult/onMachineDisconnected.
      cleanupResult()
    }

    relayServer.on('task:result', onResult)
    relayServer.on('task:error', onTaskError)
    relayServer.on('task:text', onText)
    relayServer.on('task:operational', onOperational)
    relayServer.on('task:session_init', onSessionInit)
    relayServer.on('task:progress', onProgress)
    relayServer.on('task:tool_trace', onToolTrace)
    relayServer.on('task:file_change', onFileChange)
    relayServer.on('task:stdout', onStdout)
    relayServer.on('machine:disconnected', onMachineDisconnected)
    relayServer.on('task:approval_request', onApprovalRequest)
    relayServer.on('task:safety_prompt', onSafetyPrompt)
    relayServer.on('task:dead', onTaskDead)

    const cleanupResult = () => {
      relayServer.off('task:result', onResult)
      relayServer.off('task:error', onTaskError)
      relayServer.off('machine:disconnected', onMachineDisconnected)
      relayServer.off('task:dead', onTaskDead)
    }

    // Full cleanup: remove ALL listeners
    const cleanup = () => {
      relayServer.off('task:text', onText)
      relayServer.off('task:operational', onOperational)
      relayServer.off('task:session_init', onSessionInit)
      relayServer.off('task:progress', onProgress)
      relayServer.off('task:tool_trace', onToolTrace)
      relayServer.off('task:file_change', onFileChange)
      relayServer.off('task:stdout', onStdout)
      relayServer.off('task:approval_request', onApprovalRequest)
      relayServer.off('task:safety_prompt', onSafetyPrompt)
      cleanupResult()
    }

    // Dispatch after listeners registered
    const dispatched = relayServer.dispatchTask(taskDispatch, machineId, user?.id)

    if (!dispatched) {
      cleanup()
      const errorData = { error: `Failed to dispatch to machine: ${machineId}`, recoverable: false }
      notifyCritical({
        title: 'Task Dispatch Failed',
        project: projectRecord?.name || projectId,
        task: title || nodeId,
        machine: machineId || 'unknown',
        error: `Relay could not deliver task to machine ${machineId}`,
        impact: 'Task never started — machine may be disconnected or unreachable',
        action: 'Check machine connectivity in the dashboard; re-execute when machine is online',
        errorType: 'dispatch_failure',
      })
      await streamingEventLog.appendTerminalIfAbsent(executionId, 'error', errorData)

      // DB-authoritative: reset plan node to planned + notify frontend (all node types)
      const errorTime = new Date()
      try {
        await db.update(planNodes)
          .set({
            status: 'planned',
            executionError: `Failed to dispatch to machine: ${machineId}`,
            executionId: null,
            executionStartedAt: null,
            executionOutput: null,
            executionCompletedAt: null,
            updatedAt: errorTime,
          })
          .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
          .execute()
        executionEventBus.emit('node:status_changed', {
          nodeId, projectId, status: 'planned', executionId,
        })
      } catch (err: unknown) {
        console.error('[dispatch] Failed to update plan_node on dispatch failure:', err)
      }

      return c.json({ success: false, error: `Failed to dispatch to machine: ${machineId}` }, 503)
    }

    // Persist init event (page-refresh hydration recovers machineId from this)
    const targetMachine = machineRegistry.get(machineId!)
    const pathwayType = isInteractivePlan ? 'interactive-plan' : (computeBackend === 'slurm' ? 'hpc' : 'execution')
    const initData = {
      executionId,
      nodeId,
      machineId,
      providerId: preferredProvider || targetMachine?.providers[0]?.type,
      providerName: preferredProvider || targetMachine?.providers[0]?.type,
      computeBackend,
      pathwayType,
      systemPrompt: (() => {
        const prompt = relaySystemPrompt || relayPrompt
        if (!prompt) return undefined
        return prompt.length > 65536 ? prompt.slice(0, 65536) + '\n\n[… truncated for display]' : prompt
      })(),
    }
    await streamingEventLog.append(executionId, 'init', {
      ...initData,
      hasSystemPrompt: !!(relaySystemPrompt || relayPrompt),
    })

    // Update plan_nodes.status to in_progress server-side (DB-authoritative).
    {
      const now = new Date()
      try {
        await db.update(planNodes)
          .set({
            status: 'in_progress',
            executionId,
            executionStartedAt: now,
            startDate: now.toISOString(),
            updatedAt: now,
          })
          .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
          .execute()

        executionEventBus.emit('node:status_changed', {
          nodeId, projectId, status: 'in_progress', executionId,
        })
      } catch (err: unknown) {
        console.error('[dispatch] Failed to set plan_node in_progress:', err)
      }
    }

    // Create initial taskExecutions record server-side.
    try {
      await db.insert(taskExecutions).values({
        executionId,
        nodeClientId: nodeId,
        projectId,
        userId: user?.id ?? null,
        status: 'running',
        startedAt: new Date(),
        machineId: machineId || null,
        providerId: preferredProvider || null,
        providerName: preferredProvider || null,
      }).onConflictDoNothing()
    } catch (err: unknown) {
      console.error('[dispatch] Error creating initial taskExecution record:', err)
    }

    // Emit task:init via event bus so the global SSE stream learns the executionId→nodeId mapping.
    executionEventBus.emit('task:init', {
      executionId,
      nodeId,
      projectId,
      machineId,
      providerId: initData.providerId,
      providerName: initData.providerName,
      computeBackend,
    })

    // Background watchdog: retry dispatch on startup timeout, update DB on activity timeout.
    // All SSE writes are gone — the frontend receives events exclusively via the global SSE bus.
    const watchdog = setInterval(async () => {
      const startupTimeout = startupRetries >= MAX_STARTUP_RETRIES ? FINAL_STARTUP_TIMEOUT_MS : STARTUP_TIMEOUT_MS
      const timeoutMs = hasReceivedEvent ? ACTIVITY_TIMEOUT_MS : startupTimeout
      if (Date.now() - lastActivity > timeoutMs) {
        if (dispatchEngine.hasPendingApprovalForExecution(executionId) || waitingForApproval) {
          lastActivity = Date.now()
        } else if (!resultSent) {
          if (!hasReceivedEvent && startupRetries < MAX_STARTUP_RETRIES) {
            startupRetries++
            console.log(`[dispatch] Startup timeout for ${executionId}, retry ${startupRetries}/${MAX_STARTUP_RETRIES}`)
            relayServer.cancelTask(executionId, machineId || '')
            lastActivity = Date.now()
            const retried = relayServer.dispatchTask(taskDispatch, machineId, user?.id)
            if (retried) {
              const payload = {
                message: `Agent runner did not respond — retrying (attempt ${startupRetries + 1}/${MAX_STARTUP_RETRIES + 1})...`,
                source: 'astro' as const,
              }
              streamingEventLog.append(executionId, 'operational', payload).catch(() => {})
              return
            }
          }

          const errorMsg = hasReceivedEvent
            ? 'Activity timeout — agent runner stopped responding after 2 hours of inactivity'
            : `Startup timeout — agent runner did not start after ${MAX_STARTUP_RETRIES + 1} attempts (~${Math.round((MAX_STARTUP_RETRIES * STARTUP_TIMEOUT_MS + FINAL_STARTUP_TIMEOUT_MS) / 60000)} min). The machine may be busy or the agent process failed to launch. Try re-executing the task.`
          const errorData = { error: errorMsg, recoverable: true }

          notifyCritical({
            title: hasReceivedEvent ? 'Task Activity Timeout' : 'Task Startup Timeout',
            project: projectRecord?.name || projectId,
            task: title || nodeId,
            machine: machineId || 'unknown',
            error: errorMsg,
            impact: hasReceivedEvent
              ? 'Agent went silent mid-execution — task reset to planned'
              : `Agent never started after ${MAX_STARTUP_RETRIES + 1} dispatch attempts`,
            action: hasReceivedEvent
              ? 'Check agent-runner logs for crashes or resource exhaustion'
              : 'Verify machine is online, agent-runner process is healthy, and not overloaded',
            errorType: hasReceivedEvent ? 'activity_timeout' : 'startup_timeout',
          })

          try {
            await db.update(planNodes)
              .set({
                status: 'planned',
                executionError: errorMsg,
                executionId: null,
                executionStartedAt: null,
                executionOutput: null,
                executionCompletedAt: null,
                updatedAt: new Date(),
              })
              .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId)))
              .execute()
            executionEventBus.emit('node:status_changed', {
              nodeId, projectId, status: 'planned', executionId,
            })
          } catch (err) {
            console.error(`[dispatch] Failed to update plan_node on timeout:`, err)
          }

          db.update(taskExecutions)
            .set({ status: 'failure', error: errorMsg, completedAt: new Date() })
            .where(eq(taskExecutions.executionId, executionId))
            .execute()
            .catch((err: unknown) => {
              console.error('[dispatch] Error updating taskExecution on timeout:', err)
            })

          if (scheduleRunId) {
            db.update(scheduleRuns)
              .set({ status: 'failure', completedAt: new Date(), errorMessage: errorMsg })
              .where(eq(scheduleRuns.id, scheduleRunId))
              .execute()
              .catch((err: unknown) => {
                console.error('[dispatch] Error updating schedule run on timeout:', err)
              })
          }

          streamingEventLog.appendTerminalIfAbsent(executionId, 'error', errorData).catch(() => {})
          clearInterval(watchdog)
          cleanup()
          return
        }
      }
      // Flush buffered text to DB so reconnect catch-up is accurate.
      streamingEventLog.flushText(executionId).catch(() => {})

      // Periodic elapsed-time operational message (every 3 minutes while running).
      const TASK_ELAPSED_INTERVAL_MS = 180_000
      const nowMs = Date.now()
      if (hasReceivedEvent && nowMs - dispatchStartTime >= TASK_ELAPSED_INTERVAL_MS && nowMs - lastElapsedMsg >= TASK_ELAPSED_INTERVAL_MS) {
        lastElapsedMsg = nowMs
        const totalSec = Math.round((nowMs - dispatchStartTime) / 1000)
        const mins = Math.floor(totalSec / 60)
        const secs = totalSec % 60
        const elapsed = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
        const payload = { message: `Still working... (${elapsed} elapsed)`, source: 'astro' as const }
        streamingEventLog.append(executionId, 'operational', payload).catch(() => {})
      }
    }, 15000)

    // Stop the watchdog when any terminal event fires.
    // onResult/onMachineDisconnected/onTaskDead call cleanupResult() which removes result listeners,
    // but the watchdog interval must also be stopped to avoid firing after cleanup.
    const stopWatchdog = () => clearInterval(watchdog)
    relayServer.once('task:result', () => stopWatchdog())
    relayServer.once('task:dead', (d: { taskId: string }) => { if (d.taskId === executionId) stopWatchdog() })
    relayServer.once('task:error', (m: { taskId: string }) => { if (m.taskId === executionId) stopWatchdog() })
    relayServer.once('machine:disconnected', (id: string) => { if (id === machineId) stopWatchdog() })
  } // end background listeners block

  return c.json({ success: true, executionId, nodeId, projectId })
}

/**
 * Batch-drain pending steer messages from DB and deliver via relay.
 * Called on session_init to deliver messages queued before the agent was ready.
 * The relay server also drains after each steer_ack for mid-turn queued messages.
 */
async function drainPendingSteers(executionId: string, machineId: string): Promise<void> {
  // Atomically claim all pending steers (prevents race with steer endpoint)
  const batchId = crypto.randomUUID()
  const claimed = await streamingEventLog.claimPendingSteers(executionId, batchId)
  if (claimed.length === 0) return

  const messages = claimed.map((e) => {
    const d = e.data as Record<string, unknown>
    return (d.message as string) || ''
  }).filter(Boolean)

  if (messages.length === 0) return

  const batchedMessage = messages.join('\n\n')

  // Send the batched message via relay
  const sent = relayServer.steerTask(executionId, machineId, batchedMessage)

  if (sent) {
    console.log(`[dispatch] Drained ${claimed.length} pending steer(s) for ${executionId} (batch ${batchId})`)
  } else {
    // Relay send failed — revert claimed steers back to 'pending' so they can be retried
    const seqs = claimed.map((e) => e.seq)
    await streamingEventLog.batchUpdateSteerStatus(seqs, 'pending')
    console.warn(`[dispatch] Failed to drain pending steers for ${executionId} — reverted to pending`)
  }
}

/**
 * Check if a user is authorized for a task — either they own the execution
 * or they belong to the same team as the project. Returns true if authorized.
 */
async function isUserAuthorizedForTask(
  user: AuthUser,
  ctx: { userId: string; projectId: string } | undefined,
  taskId: string,
): Promise<boolean> {
  // Local mode: always authorized
  if (user.id === LOCAL_USER_ID) return true

  if (ctx) {
    // Owner of the execution — authorized
    if (ctx.userId === user.id || ctx.userId === LOCAL_USER_ID) return true

    // Team member check: does the user belong to the same team as the project?
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(
        eq(projects.id, ctx.projectId),
        inArray(projects.teamId, user.teamIds)
      )).limit(1)
    return !!project
  }

  // No context — try DB fallback via plan_nodes (taskId may be a node clientId)
  const [nodeRow] = await db.select({ projectId: planNodes.projectId })
    .from(planNodes).where(eq(planNodes.clientId, taskId)).limit(1)
  if (nodeRow) {
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(
        eq(projects.id, nodeRow.projectId),
        inArray(projects.teamId, user.teamIds)
      )).limit(1)
    return !!project
  }

  // Fallback: taskId may be an execution ID (e.g., steer on completed task after context TTL expired)
  const [execRow] = await db.select({ projectId: taskExecutions.projectId })
    .from(taskExecutions).where(eq(taskExecutions.executionId, taskId)).limit(1)
  if (execRow) {
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(
        eq(projects.id, execRow.projectId),
        inArray(projects.teamId, user.teamIds)
      )).limit(1)
    return !!project
  }

  // No context and no DB record — deny
  return false
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
  sessionId: z.string().max(100).nullish(),
  branchName: z.string().max(500).nullish(),
})

dispatchRoute.post('/steer', async (c) => {
  const raw = await c.req.json()
  const parsed = steerSchema.safeParse(raw)
  if (!parsed.success) {
    const missing = parsed.error.issues.map(i => i.path.join('.')).join(', ')
    return c.json({ success: false, error: `Validation failed: ${missing} — taskId, machineId, and message are required`, details: parsed.error.issues }, 400)
  }
  const { taskId, machineId, message, action, interrupt, sessionId, branchName } = parsed.data

  // Validate user has access to this task (owner or team member)
  const steerUser = c.get('user') as AuthUser | undefined
  if (steerUser?.id && steerUser.id !== LOCAL_USER_ID) {
    const ctx = await executionContextStore.getWithFallback(taskId)
    if (!await isUserAuthorizedForTask(steerUser, ctx, taskId)) {
      return c.json({ success: false, error: 'Not authorized for this task' }, 403)
    }
  }

  // Write-first: persist steer message with status 'pending' BEFORE relay call.
  // This ensures messages survive page refresh and can be batch-drained later.
  const seq = await streamingEventLog.append(taskId, 'steer_message', {
    message, action, interrupt, sessionId, branchName, status: 'pending',
  })

  // Attempt immediate delivery via relay
  const sent = relayServer.steerTask(taskId, machineId, message, action, interrupt, sessionId, branchName)

  if (sent) {
    // Mark as sent (relay accepted the WebSocket send)
    streamingEventLog.updateSteerStatus(seq, 'sent').catch(() => {})
  }
  // Even if relay send fails, the message is persisted as 'pending' and will be
  // batch-drained when session_init fires or between turns.

  return c.json({ success: true, taskId, machineId, message: sent ? 'Steer message sent' : 'Steer message queued' })
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
    const missing = parsed.error.issues.map(i => i.path.join('.')).join(', ')
    return c.json({ success: false, error: `Validation failed: ${missing} — taskId, machineId, and requestId are required`, details: parsed.error.issues }, 400)
  }
  const { taskId, machineId, requestId, answered, answer, message } = parsed.data

  // Validate user has access to this task (owner or team member)
  const approvalUser = c.get('user') as AuthUser | undefined
  if (approvalUser?.id && approvalUser.id !== LOCAL_USER_ID) {
    const ctx = await executionContextStore.getWithFallback(taskId)
    if (!await isUserAuthorizedForTask(approvalUser, ctx, taskId)) {
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

  // Persist approval_response so hydration knows this approval was answered.
  // MUST await — if this is fire-and-forget, a page refresh before the write
  // completes causes the catch-up query to miss the response, showing the
  // approval card as unanswered again. Uses idempotent version to prevent
  // duplicates from multi-tab or retry scenarios.
  try {
    await streamingEventLog.appendApprovalResponseIfAbsent(taskId, { requestId, answer: answer ?? '', answered: answered ?? true })
  } catch (err) {
    console.warn('[dispatch] Failed to persist approval_response:', (err as Error).message)
  }

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

  // Validate user has access to this task (owner or team member)
  const safetyUser = c.get('user') as AuthUser | undefined
  if (safetyUser?.id && safetyUser.id !== LOCAL_USER_ID) {
    const ctx = await executionContextStore.getWithFallback(taskId)
    if (!await isUserAuthorizedForTask(safetyUser, ctx, taskId)) {
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

  // Cache safety approval for this working directory so subsequent tasks skip the prompt.
  // Write-through to Redis for cross-instance visibility.
  if (decision !== 'cancel') {
    const workdir = dispatchedTaskDirs.get(taskId)
    // Fallback to Redis if local Map doesn't have it (cross-instance scenario)
    const resolvedWorkdir = workdir ?? await redisPubSub.getTaskDir(taskId)
    if (resolvedWorkdir) {
      approvedSafetyDirs.set(resolvedWorkdir, decision)
      redisPubSub.setApprovedSafetyDir(resolvedWorkdir, decision).catch(() => {})
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

  // Validate user has access to this task (in-memory context or DB fallback)
  // Validate user has access to this task (owner or team member)
  const cancelUser = c.get('user') as AuthUser | undefined
  if (cancelUser?.id && cancelUser.id !== LOCAL_USER_ID) {
    const ctx = await executionContextStore.getWithFallback(id)
    if (!await isUserAuthorizedForTask(cancelUser, ctx, nodeId ?? id)) {
      return c.json({ success: false, error: 'Not authorized for this task' }, 403)
    }
  }

  // Cancel via relay
  relayServer.cancelTask(id, machineId || '')

  // Also cancel via dispatch engine
  if (nodeId) {
    await dispatchEngine.cancel(nodeId)

    // DB-authoritative: reset node to 'planned' so it can be re-executed.
    // The dispatch engine's nodeUpdateCallback is not wired to the data API,
    // so we do the DB write + node:status_changed emission here directly.
    // This ensures all connected clients see the cancel immediately
    // (not just the client that initiated the cancel).
    try {
      const [node] = await db.select({ status: planNodes.status, projectId: planNodes.projectId, executionId: planNodes.executionId })
        .from(planNodes)
        .where(eq(planNodes.clientId, nodeId))
        .limit(1)
      if (node && (node.status === 'in_progress' || node.status === 'dispatched')) {
        await db.update(planNodes)
          .set({
            status: 'planned',
            executionId: null,
            executionStartedAt: null,
            executionOutput: null,
            executionCompletedAt: null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(planNodes.clientId, nodeId),
            inArray(planNodes.status, ['in_progress', 'dispatched']),
          ))
        executionEventBus.emit('node:status_changed', {
          nodeId,
          projectId: node.projectId,
          status: 'planned',
          executionId: node.executionId ?? undefined,
        })
      }
    } catch (err) {
      console.error('[dispatch] Failed to update node status on cancel:', err)
    }
  }

  return c.json({ success: true, aborted: true })
})

/**
 * Prune a branch
 *
 * DB-authoritative: Sets target node to 'pruned' in DB, emits node:status_changed,
 * cancels any active executions, and cascade-prunes downstream nodes.
 * Uses the same pattern as PATCH /plan/nodes/:id with cascadePruneDownstream.
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
  const { projectId, nodeId } = parsed.data

  // Verify user has access to the project via team scope
  const user = c.get('user') as AuthUser | undefined
  if (user?.id && user.id !== LOCAL_USER_ID) {
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(
        eq(projects.id, projectId),
        inArray(projects.teamId, user.teamIds)
      )).limit(1)
    if (!project) {
      return c.json({ success: false, error: 'Project not found or not authorized' }, 404)
    }
  }

  // 1. Look up the node (exclude soft-deleted)
  const [node] = await db.select()
    .from(planNodes)
    .where(and(eq(planNodes.clientId, nodeId), eq(planNodes.projectId, projectId), isNull(planNodes.deletedAt)))
    .limit(1)

  if (!node) {
    return c.json({ success: false, error: 'Node not found' }, 404)
  }

  if (node.status === 'pruned') {
    return c.json({ success: true, prunedNodes: [nodeId], cancelledTasks: [] })
  }

  // 2. Cancel active execution if running
  const cancelledTasks: string[] = []
  if (node.status === 'in_progress' || node.status === 'dispatched') {
    const cancelled = await dispatchEngine.cancel(nodeId)
    if (cancelled) cancelledTasks.push(nodeId)
  }

  // 3. Set node to 'pruned' in DB + emit node:status_changed
  try {
    await db.update(planNodes)
      .set({ status: 'pruned', updatedAt: new Date() })
      .where(eq(planNodes.clientId, nodeId))
    executionEventBus.emit('node:status_changed', {
      nodeId,
      projectId,
      status: 'pruned',
      executionId: node.executionId ?? undefined,
    })
  } catch (err) {
    console.error('[dispatch] Failed to prune node in DB:', err)
    return c.json({ success: false, error: 'Failed to update node status' }, 500)
  }

  // 4. Cascade prune downstream nodes (each emits its own node:status_changed)
  await cascadePruneDownstream(projectId, nodeId)

  return c.json({ success: true, prunedNodes: [nodeId], cancelledTasks })
})

/**
 * Respond to approval request
 *
 * Durable approval flow:
 *   1. Try in-memory Promise resolution (normal path, dispatch engine alive)
 *   2. If Promise not found: check DB for existing response → idempotent success
 *   3. If no DB response: try relay recovery (send directly via WebSocket)
 *   4. If relay unavailable: return descriptive error so frontend can clean up
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

    // Durable approval recovery: Promise lost (server restart or execution completed)
    if (message.includes('No pending approval found')) {
      const recovered = await tryRecoverApproval(approvalId, approved, selectedOption)
      if (recovered.status === 'already_responded') {
        return c.json({ success: true, duplicate: true })
      }
      if (recovered.status === 'relay_recovered') {
        return c.json({ success: true, recovered: true })
      }
      // Recovery failed — return clear error so frontend can clean up the stale card
      return c.json({
        success: false,
        error: 'Approval context lost (server may have restarted). The agent will re-prompt if needed.',
        stale: true,
      }, 410) // 410 Gone
    }

    return c.json({ success: false, error: message }, 400)
  }
})

/**
 * Try to recover an approval after the in-memory Promise is lost.
 *
 * Two event-type namespaces exist for approvals:
 *   - streamingEventLog: 'approval_request' / 'approval_response' (underscore, persisted with requestId)
 *   - astroEventTransport: 'approval.requested' / 'approval.responded' (dot, persisted with approvalId)
 *
 * The relay pathway uses requestId (from agent-runner). The dispatch engine uses approvalId.
 * Recovery works by:
 *   1. Find the relay approval_request for this execution (has requestId + machineId)
 *   2. Check if a relay approval_response already exists (idempotent success)
 *   3. Send the response directly via relay WebSocket
 */
async function tryRecoverApproval(
  approvalId: string,
  approved: boolean,
  selectedOption?: string
): Promise<{ status: 'already_responded' | 'relay_recovered' | 'unrecoverable' }> {
  try {
    // 1. Find the execution via the dispatch engine's approval.requested event
    //    (astroEventTransport uses dot notation with approvalId in data)
    const requestRows = await db.select({
      executionId: streamingEvents.executionId,
    })
      .from(streamingEvents)
      .where(
        and(
          eq(streamingEvents.eventType, 'approval.requested'),
          sql`${streamingEvents.data}->>'approvalId' = ${approvalId}`,
          isNull(streamingEvents.deletedAt),
        )
      )
      .limit(1)

    if (requestRows.length === 0) {
      return { status: 'unrecoverable' }
    }

    const { executionId } = requestRows[0]

    // Short-circuit: if the execution's node is already in a terminal state, skip recovery.
    // Look up via task_executions (not planNodes.executionId) because our reset-to-planned
    // fix clears planNodes.executionId to null — the task_executions record is preserved.
    const [execRow] = await db.select({ nodeClientId: taskExecutions.nodeClientId })
      .from(taskExecutions)
      .where(eq(taskExecutions.executionId, executionId))
      .limit(1)
    if (execRow) {
      const [nodeRow] = await db.select({ status: planNodes.status })
        .from(planNodes)
        .where(eq(planNodes.clientId, execRow.nodeClientId))
        .limit(1)
      if (nodeRow) {
        const terminal = new Set(['completed', 'auto_verified', 'pruned', 'planned'])
        if (terminal.has(nodeRow.status)) {
          return { status: 'already_responded' }
        }
      }
    }

    // 2. Find the matching relay approval_request for this execution
    //    (streamingEventLog uses underscore notation with requestId + machineId)
    const relayRows = await db.select({ data: streamingEvents.data })
      .from(streamingEvents)
      .where(
        and(
          eq(streamingEvents.executionId, executionId),
          eq(streamingEvents.eventType, 'approval_request'),
        )
      )
      .orderBy(sql`${streamingEvents.seq} DESC`)
      .limit(1)

    if (relayRows.length === 0) {
      return { status: 'unrecoverable' }
    }

    const relayData = relayRows[0].data as { requestId?: string; machineId?: string }
    if (!relayData.requestId || !relayData.machineId) {
      return { status: 'unrecoverable' }
    }

    // 3. Check if this relay approval was already responded to (idempotency via DB)
    //    Uses underscore notation (approval_response) with requestId — matches streamingEventLog
    const responseRows = await db.select({ seq: streamingEvents.seq })
      .from(streamingEvents)
      .where(
        and(
          eq(streamingEvents.executionId, executionId),
          eq(streamingEvents.eventType, 'approval_response'),
          sql`${streamingEvents.data}->>'requestId' = ${relayData.requestId}`,
        )
      )
      .limit(1)

    if (responseRows.length > 0) {
      return { status: 'already_responded' }
    }

    // 4. Try sending response via relay WebSocket
    const answer = selectedOption || (approved ? 'Approved' : 'Rejected')
    const sent = relayServer.sendApprovalResponse(
      executionId, relayData.machineId, relayData.requestId, approved, answer
    )
    if (!sent) {
      return { status: 'unrecoverable' }
    }

    // 5. Persist recovery for idempotency + hydration
    await streamingEventLog.appendApprovalResponseIfAbsent(executionId, {
      requestId: relayData.requestId,
      answer,
      answered: true,
    }).catch(() => {})

    console.log(`[dispatch] Recovered approval ${approvalId} via relay (durable fallback)`)
    return { status: 'relay_recovered' }
  } catch (err) {
    console.warn('[dispatch] Approval recovery failed:', err)
    return { status: 'unrecoverable' }
  }
}

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

  // Load the node to get current PR/branch data (exclude soft-deleted)
  const [node] = await db.select().from(planNodes).where(and(eq(planNodes.clientId, nodeId), isNull(planNodes.deletedAt))).limit(1)
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
    executionEventBus.emit('node:status_changed', {
      nodeId, projectId, status: 'planned',
    })

    // 4b. Revert milestones that were auto-completed based on this task
    revertMilestonesOnReset(projectId, [nodeId]).catch((err) => {
      console.warn('[dispatch/reset] Milestone revert failed:', err)
    })
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
    console.error(`[dispatch/reset] Failed to reset node in DB: ${msg}`)
    return c.json({ success: false, error: `Database update failed: ${msg}` }, 500)
  }

  // 5. Delete task execution records from DB so they don't reappear after page refresh
  try {
    // Find non-deleted execution records for this node
    const nodeExecutions = await db.select({ executionId: taskExecutions.executionId })
      .from(taskExecutions)
      .where(and(eq(taskExecutions.nodeClientId, nodeId), isNull(taskExecutions.deletedAt)))

    if (nodeExecutions.length > 0) {
      const executionIds = nodeExecutions.map(e => e.executionId)

      // Soft-delete streaming events for these executions
      const now = new Date()
      await db.update(streamingEvents).set({ deletedAt: now })
        .where(inArray(streamingEvents.executionId, executionIds))

      // Soft-delete the execution records themselves
      await db.update(taskExecutions).set({ deletedAt: now })
        .where(eq(taskExecutions.nodeClientId, nodeId))

      console.log(`[dispatch/reset] Soft-deleted ${nodeExecutions.length} execution record(s) and associated streaming events for node ${nodeId}`)
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

  // 1. Load all referenced plan nodes in a single query (exclude soft-deleted)
  const nodes = await db.select().from(planNodes).where(and(inArray(planNodes.clientId, nodeIds), isNull(planNodes.deletedAt)))
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
    // Find all non-deleted execution IDs for these nodes
    const nodeExecutions = await db.select({ executionId: taskExecutions.executionId })
      .from(taskExecutions)
      .where(and(inArray(taskExecutions.nodeClientId, nodeIds), isNull(taskExecutions.deletedAt)))

    if (nodeExecutions.length > 0) {
      const executionIds = nodeExecutions.map(e => e.executionId)

      // Soft-delete streaming events for these executions
      const now = new Date()
      await db.update(streamingEvents).set({ deletedAt: now })
        .where(inArray(streamingEvents.executionId, executionIds))

      console.log(`[dispatch/bulk-reset] Soft-deleted streaming events for ${executionIds.length} execution(s)`)
    }
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
    console.warn(`[dispatch/bulk-reset] Failed to delete streaming events: ${msg}`)
    errors.push(`Failed to clean up streaming events: ${msg}`)
  }

  // 5. Bulk-delete taskExecutions for all node IDs
  try {
    await db.update(taskExecutions).set({ deletedAt: new Date() })
      .where(inArray(taskExecutions.nodeClientId, nodeIds))
    console.log(`[dispatch/bulk-reset] Soft-deleted task executions for ${nodeIds.length} node(s)`)
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
    for (const nid of nodeIds) {
      executionEventBus.emit('node:status_changed', {
        nodeId: nid, projectId, status: 'planned',
      })
    }

    // 6b. Revert milestones that were auto-completed based on the reset tasks
    revertMilestonesOnReset(projectId, nodeIds).catch((err) => {
      console.warn('[dispatch/bulk-reset] Milestone revert failed:', err)
    })
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
