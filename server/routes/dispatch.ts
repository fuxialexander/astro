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
  type BranchPruneRequest,
  type DispatchPriority,
} from '../lib/dispatch/index.js'
import { relayServer } from '../lib/relay-server.js'
import { executionEventBus } from '../lib/execution-event-bus.js'
import { machineRegistry } from '../lib/machine-registry.js'
import type { ProviderType, ImageAttachment } from '../types/relay.js'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { LOCAL_USER_ID } from '../lib/db/bootstrap-local.js'
import { executionContextStore } from '../lib/execution-context-store.js'
import { astroEventTransport } from '../lib/events/astro-event-transport.js'
import { db } from '../lib/db/index.js'
import { projects, planNodes, planNodeDependencies, blobs, environmentConfigs } from '../lib/db/schema.js'
import { eq, isNull, and, or, inArray } from 'drizzle-orm'
import type { TaskResult as DispatchTaskResult } from '../lib/dispatch/types.js'
import type { Project } from '../../src/types/index.js'
import { buildInteractivePlanPrompt } from '../lib/prompt-templates.js'
import { skillManager } from '../lib/skill-manager.js'

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

// Validation schemas
const dispatchTaskSchema = z.object({
  nodeId: z.string().min(1).max(100),
  projectId: z.string().min(1).max(100),
  title: z.string().min(1).max(1000).optional(),
  description: z.string().min(1).max(50000).optional(),
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
  maxTurns: z.number().int().min(1).max(200).optional(),
  workingDirectory: z.string().max(1000).refine(
    (path) => !path.includes('..'),
    { message: 'Path traversal not allowed' }
  ).optional(),
  sourceDirectory: z.string().max(1000).refine(
    (path) => !path.includes('..'),
    { message: 'Path traversal not allowed' }
  ).optional(),
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
  // Validate input
  let body: z.infer<typeof dispatchTaskSchema>
  try {
    const rawBody = await c.req.json()
    body = dispatchTaskSchema.parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ success: false, error: 'Invalid input', details: err.issues }, 400)
    }
    return c.json({ success: false, error: 'Invalid JSON' }, 400)
  }

  let {
    nodeId,
    projectId,
    title,
    description,
    dependencies = [],
    verification,
    visionDoc,
    dependencyOutputs = [],
    priority = 'normal',
    preferredProvider,
    targetMachineId,
    model,
    workingDirectory,
    sourceDirectory,
    force = false,
    dryRun = false,
    computeBackend,
    deliveryMode,
    remoteType,
    agentDir,
    worktreeStrategy,
    useWorktree,
    imageRefs,
    isInteractivePlan,
    skipSafetyCheck,
    acceptanceCriteria,
    dispatchSignature,
    dispatchSigningPayload,
    resumeSessionId,
    forkSession,
  } = body

  // PR body enrichment fields (resolved from DB)
  let githubIssueUrl: string | undefined
  let githubIssueNumber: number | undefined

  // ── Server-side resolution: fill missing fields from DB ──────────
  // Allows clients to send just { projectId, nodeId } and have the
  // server assemble the full dispatch payload from the database.
  if (!title || !description || !workingDirectory || !visionDoc || !deliveryMode) {
    try {
      // Fetch plan node
      const [dbNode] = await db.select().from(planNodes)
        .where(eq(planNodes.clientId, nodeId)).limit(1)
      // Fetch project
      const [dbProject] = await db.select().from(projects)
        .where(eq(projects.id, projectId)).limit(1)

      if (dbNode) {
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
            projectId: planNodes.projectId,
          }).from(planNodes)
            .where(eq(planNodes.projectId, projectId))

          for (const depId of dependencies) {
            const depNode = allProjectNodes.find(n => n.clientId === depId)
            if (depNode?.executionOutput) {
              dependencyOutputs.push({
                nodeId: depNode.clientId,
                title: depNode.title,
                output: depNode.executionOutput,
              })
            }
          }
        }
      }

      if (dbProject) {
        visionDoc ??= dbProject.visionDoc || undefined
        deliveryMode ??= (dbProject.deliveryMode as typeof deliveryMode) || undefined
        const source = dbProject.source as { localPath?: string; remoteType?: string } | null
        remoteType ??= (source?.remoteType as typeof remoteType) || undefined

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

  // Dry run validation
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

    return c.json({
      success: true,
      dryRun: true,
      validationIssues: [],
    })
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

  // Serial execution constraint for 'direct' delivery mode (non-git directories).
  // Without git isolation, parallel execution on the same directory is unsafe.
  if (deliveryMode === 'direct') {
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
    priority,
    workingDirectory,
    sourceDirectory,
    computeBackend,
    deliveryMode,
    remoteType,
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
    resumeSessionId,
    forkSession,
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
    priority: DispatchPriority
    workingDirectory?: string
    sourceDirectory?: string
    computeBackend?: string
    deliveryMode?: string
    remoteType?: string
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
    resumeSessionId?: string
    forkSession?: boolean
  }
) {
  const astroBaseUrl = process.env.ASTRO_BASE_URL || undefined

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
    priority,
    workingDirectory,
    sourceDirectory,
    computeBackend,
    deliveryMode,
    remoteType,
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
    resumeSessionId,
    forkSession,
  } = params

  // Compute short hex IDs early — needed for prompt building + relay dispatch
  const shortProjectId = getShortId(projectId)
  const shortNodeId = getShortId(nodeId)

  // Extract user for ownership verification
  const user = c.get('user') as AuthUser | undefined

  // Find target machine
  let machineId = targetMachineId
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

  // Build prompt — interactive plans use the dedicated planning prompt template;
  // regular executions use the standard task execution prompt.
  let relaySystemPrompt: string | undefined
  const promptParts: string[] = []

  // Get available skills for prompt injection
  const skillsInjection = skillManager.getSkillPromptInjection() || undefined

  if (isInteractivePlan) {
    // Use the dedicated interactive plan prompt as a system prompt.
    // It includes vision doc, repo context, git state, and planning instructions.
    relaySystemPrompt = buildInteractivePlanPrompt(description, {
      visionDoc: visionDoc || undefined,
      skillsSummary: skillsInjection,
    })
    // The user prompt is just the description
    promptParts.push(description)
  } else {
    if (visionDoc) {
      promptParts.push(`## Project Vision\n\n${visionDoc}`)
    }

    if (dependencyOutputs.length > 0) {
      const depsSection = dependencyOutputs
        .map((d) => `### ${d.title}\n\n${d.output}`)
        .join('\n\n---\n\n')
      promptParts.push(`## Previous Task Outputs\n\n${depsSection}`)
    }

    // Build delivery-mode-aware workspace instructions
    {
      const effectiveDelivery = deliveryMode ?? 'pr'
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

    if (sourceDirectory) {
      promptParts.push(`## Data Access\n\nThe original project directory is: ${sourceDirectory}\nLarge untracked files (training data, model caches, datasets) remain in the original directory. Use absolute paths to reference them. Always use absolute paths when writing code that accesses data files.`)
    }

    // Inject custom environment context if configured
    if (user && computeBackend) {
      try {
        const machineFilter = machineId
          ? eq(environmentConfigs.machineId, machineId)
          : isNull(environmentConfigs.machineId)
        const [envConfig] = await db.select().from(environmentConfigs).where(
          and(
            eq(environmentConfigs.userId, user.id),
            eq(environmentConfigs.backendId, computeBackend),
            machineFilter
          )
        )
        if (envConfig?.customContext) {
          promptParts.push(`## Custom Environment Instructions\n\n${envConfig.customContext}`)
        }
      } catch (err) {
        console.warn('[dispatch] Failed to fetch environment config:', err)
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

${verificationSection}`)
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

  // Fetch project record from DB for event hooks (git-pull-hook needs workingDirectory)
  let projectRecord: Project | undefined
  try {
    const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
    projectRecord = row as unknown as Project | undefined
  } catch (err) {
    console.warn('[dispatch] Failed to fetch project for event hooks:', err)
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
    executionStrategy: computeBackend,
    priority: priority === 'critical' ? 0 : priority === 'high' ? 1 : priority === 'normal' ? 2 : 3,
    workingDirectory,
    sourceDirectory,
    deliveryMode: deliveryMode ?? 'pr',
    remoteType,
    agentDir,
    worktreeStrategy,
    useWorktree,
    images,
    skipSafetyCheck: (skipSafetyCheck && nodeId.startsWith('playground-')) || (!!workingDirectory && approvedSafetyDirs.has(workingDirectory)),
    ...(isInteractivePlan ? { type: 'plan' as const } : {}),
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
    const ACTIVITY_TIMEOUT_MS = 5 * 24 * 60 * 60 * 1000 // 5 days

    const onResult = (msg: import('../types/relay.js').TaskResultMessage) => {
      if (!alive || msg.result.taskId !== executionId) return
      lastActivity = Date.now()
      resultSent = true
      executionContextStore.remove(executionId)

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

      stream.writeSSE({
        event: 'result',
        data: JSON.stringify({
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
        }),
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
      }
      astroEventTransport.emitEvent({
        type: 'task.completed',
        taskId: executionId,
        nodeId,
        projectId,
        executionId,
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

      stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
      alive = false
    }

    const onText = (msg: import('../types/relay.js').TaskTextMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      waitingForApproval = false
      stream.writeSSE({ event: 'text', data: msg.text }).catch(() => { alive = false })
      executionEventBus.emit('task:stdout', { output: { taskId: executionId, data: msg.text, stream: 'stdout', timestamp: new Date() } })
    }

    const onSessionInit = (msg: import('../types/relay.js').TaskSessionInitMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'session_init',
        data: JSON.stringify({ sessionId: msg.sessionId, model: msg.model }),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:session_init', { taskId: executionId, sessionId: msg.sessionId, model: msg.model || 'unknown' })
    }

    const onProgress = (msg: import('../types/relay.js').TaskProgressMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'progress',
        data: JSON.stringify({ message: msg.message, percentage: msg.progress }),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:progress', { taskId: executionId, message: msg.message, progress: msg.progress })
    }

    const onToolTrace = (msg: import('../types/relay.js').TaskToolTraceMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      waitingForApproval = false

      // Only send tool_use SSE when toolInput is present (avoid orphan tool_use
      // events for result-only traces from relay's separate toolUse/toolResult flow)
      if (msg.toolInput !== undefined) {
        stream.writeSSE({
          event: 'tool_use',
          data: JSON.stringify({ toolName: msg.toolName, toolInput: msg.toolInput }),
        }).catch(() => { alive = false })
        executionEventBus.emit('task:tool_trace', { taskId: executionId, toolName: msg.toolName, toolInput: msg.toolInput })
      }
      if (msg.toolResult !== undefined) {
        stream.writeSSE({
          event: 'tool_result',
          data: JSON.stringify({ toolName: msg.toolName, success: msg.success, result: msg.toolResult }),
        }).catch(() => { alive = false })
        executionEventBus.emit('task:tool_trace', { taskId: executionId, toolName: msg.toolName, toolResult: typeof msg.toolResult === 'string' ? msg.toolResult.slice(0, 100000) : msg.toolResult, success: msg.success ?? true })
      }
    }

    const onFileChange = (msg: import('../types/relay.js').TaskFileChangeMessage) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'file_change',
        data: JSON.stringify({ path: msg.path, action: msg.action, linesAdded: msg.linesAdded, linesRemoved: msg.linesRemoved }),
      }).catch(() => { alive = false })
      executionEventBus.emit('task:file_change', { taskId: executionId, path: msg.path, action: msg.action })
    }

    const onMachineDisconnected = (disconnectedId: string) => {
      if (!alive || disconnectedId !== machineId) return
      console.log(`[dispatch] Machine ${machineId} disconnected during task ${executionId}`)
      stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: 'Remote machine disconnected during task execution', recoverable: false }),
      }).catch(() => {})
      stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
      alive = false
    }

    const onApprovalRequest = (msg: { taskId: string; requestId: string; question: string; options: string[] }) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      waitingForApproval = true
    }

    const onSafetyPrompt = (msg: { taskId: string; safetyTier: string; warning?: string; options: Array<{ id: string; label: string; description?: string }> }) => {
      if (!alive || msg.taskId !== executionId) return
      lastActivity = Date.now()
      waitingForApproval = true
    }

    relayServer.on('task:result', onResult)
    relayServer.on('task:text', onText)
    relayServer.on('task:session_init', onSessionInit)
    relayServer.on('task:progress', onProgress)
    relayServer.on('task:tool_trace', onToolTrace)
    relayServer.on('task:file_change', onFileChange)
    relayServer.on('machine:disconnected', onMachineDisconnected)
    relayServer.on('task:approval_request', onApprovalRequest)
    relayServer.on('task:safety_prompt', onSafetyPrompt)

    const cleanup = () => {
      relayServer.off('task:result', onResult)
      relayServer.off('task:text', onText)
      relayServer.off('task:session_init', onSessionInit)
      relayServer.off('task:progress', onProgress)
      relayServer.off('task:tool_trace', onToolTrace)
      relayServer.off('task:file_change', onFileChange)
      relayServer.off('machine:disconnected', onMachineDisconnected)
      relayServer.off('task:approval_request', onApprovalRequest)
      relayServer.off('task:safety_prompt', onSafetyPrompt)
    }

    // Dispatch after listeners registered
    const dispatched = relayServer.dispatchTask(taskDispatch, machineId)

    if (!dispatched) {
      cleanup()
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: `Failed to dispatch to machine: ${machineId}` }),
      })
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) })
      return
    }

    // Send init event
    const targetMachine = machineRegistry.get(machineId!)
    await stream.writeSSE({
      event: 'init',
      data: JSON.stringify({
        executionId,
        nodeId,
        machineId,
        providerId: preferredProvider || targetMachine?.providers[0]?.type,
        providerName: preferredProvider || targetMachine?.providers[0]?.type,
        computeBackend,
      }),
    })

    // Keepalive + activity timeout
    const heartbeat = setInterval(() => {
      if (!alive) { clearInterval(heartbeat); return }
      if (Date.now() - lastActivity > ACTIVITY_TIMEOUT_MS) {
        // Don't timeout if we're waiting for user approval (ask_user_question)
        if (dispatchEngine.hasPendingApprovalForExecution(executionId) || waitingForApproval) {
          lastActivity = Date.now() // Reset timer while approval is pending
        } else if (!resultSent) {
          stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ error: 'Activity timeout — agent runner stopped responding', recoverable: false }),
          }).catch(() => {})
          stream.writeSSE({ event: 'done', data: JSON.stringify({ executionId, nodeId }) }).catch(() => {})
          alive = false
          clearInterval(heartbeat)
          return
        }
      }
      stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => { alive = false; clearInterval(heartbeat) })
    }, 15000)

    stream.onAbort(() => {
      alive = false
      clearInterval(heartbeat)
      cleanup()
      // Task continues running on the agent runner — results arrive via relay → global SSE → realtime-store
    })

    // Wait for completion
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!alive) { clearInterval(check); resolve() }
      }, 500)
    })
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

  // Cache safety approval for this working directory so subsequent tasks skip the prompt
  if (decision !== 'cancel') {
    const workdir = dispatchedTaskDirs.get(taskId)
    if (workdir) {
      approvedSafetyDirs.set(workdir, decision)
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

export { dispatchRoute }
