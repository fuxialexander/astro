import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import {
  providerRegistry,
  type TaskDispatch,
  type TaskType,
  type AgentProvider,
} from '../lib/providers/index.js'
import { createSession, abortSession, removeSession, getSession, updateSession } from '../lib/session-manager.js'
import { buildPlanSystemPrompt, buildChatSystemPrompt, buildTaskExecutionPrompt, buildTaskChatSystemPrompt, buildSummaryPrompt, PLAN_GRAPH_SCHEMA } from '../lib/prompt-templates.js'
import { existsSync } from 'node:fs'
import { readRepoContext } from '../lib/repo-context.js'
import { relayServer } from '../lib/relay-server.js'
import { requireAuth } from '../middleware/auth.js'
import { errorMessage, isAbortError } from '../lib/error-utils.js'
import * as chatSessionPool from '../lib/chat-session-pool.js'
import { isServerMode } from '../lib/app-mode.js'
import type { TaskDispatch as RelayTaskDispatch, TaskResultMessage, TaskTextMessage, TaskToolTraceMessage, TaskFileChangeMessage, TaskSessionInitMessage } from '../types/relay.js'

// Validation schemas
const generatePlanSchema = z.object({
  description: z.string().min(1).max(50000),
  visionDoc: z.string().max(100000).optional(),
  projectId: z.string().min(1).max(100),
  model: z.string().max(100).optional(),
  providerId: z.string().max(100).optional(),
  workingDirectory: z.string().max(1000).refine(
    (path) => !path.includes('..'),
    { message: 'Path traversal not allowed' }
  ).optional(),
  fileTree: z.array(z.string().max(1000)).max(10000).optional(),
  keyFiles: z.object({
    claudeMd: z.string().max(100000).optional(),
    readmeMd: z.string().max(100000).optional(),
    packageInfo: z.string().max(100000).optional(),
  }).optional(),
  targetMachineId: z.string().max(100).optional(),
})

const chatSchema = z.object({
  message: z.string().min(1).max(50000),
  sessionId: z.string().max(100).optional(),
  projectId: z.string().min(1).max(100),
  visionDoc: z.string().max(100000).optional(),
  model: z.string().max(100).optional(),
  providerId: z.string().max(100).optional(),
  planNodes: z.array(z.any()).max(1000).optional(),
  planEdges: z.array(z.any()).max(1000).optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(50000),
  })).max(100).optional(),
})

/**
 * Resolve the model for a given provider. If the requested model is not
 * supported by the provider, fall back to the provider's default model.
 */
function resolveModelForProvider(provider: AgentProvider, requestedModel?: string): string | undefined {
  if (!requestedModel) return undefined
  const caps = provider.capabilities()
  const supported = caps.availableModels?.includes(requestedModel)
  if (supported) return requestedModel
  console.log(`[agent] Model "${requestedModel}" not supported by ${provider.name}, using default "${caps.defaultModel}"`)
  return caps.defaultModel
}

/**
 * Get the best provider for chat endpoints.
 * Prefers anthropic-direct (avoids CLI usage policy false positives on voice input)
 * unless the caller explicitly requested a different provider.
 */
function getChatProvider(requestedProviderId?: string): AgentProvider | null {
  // If user explicitly requested a non-claude-code provider, respect it
  if (requestedProviderId && requestedProviderId !== 'claude-code') {
    return providerRegistry.getProvider(requestedProviderId)
  }
  // Prefer anthropic-direct for chat (avoids CLI usage policy false positives)
  const directReg = providerRegistry.getRegisteredProvider('anthropic-direct')
  if (directReg?.available) {
    return directReg.provider
  }
  // Fall back to requested or default
  return requestedProviderId
    ? providerRegistry.getProvider(requestedProviderId)
    : providerRegistry.getDefaultProvider()
}

/**
 * Stream a task via relay in server mode.
 * Dispatches a RelayTaskDispatch to an agent runner and streams relay events
 * back to the browser as SSE. Used by all AI endpoints when isServerMode().
 */
async function streamChatViaRelay(
  c: Parameters<Parameters<Hono['post']>[1]>[0],
  opts: {
    taskId: string
    projectId: string
    nodeId: string
    prompt: string
    systemPrompt?: string
    maxTurns?: number
    type?: 'chat' | 'plan' | 'execution' | 'summarize'
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>
    workingDirectory?: string
    targetMachineId?: string
  }
) {
  const task: RelayTaskDispatch = {
    taskId: opts.taskId,
    projectId: opts.projectId,
    nodeId: opts.nodeId,
    title: opts.type || 'chat',
    description: opts.prompt.slice(0, 200),
    environment: 'remote',
    prompt: opts.prompt,
    systemPrompt: opts.systemPrompt,
    type: opts.type,
    messages: opts.messages,
    maxTurns: opts.maxTurns ?? 50,
    workingDirectory: opts.workingDirectory,
  }

  return streamSSE(c, async (stream) => {
    let alive = true
    let lastActivity = Date.now()
    const ACTIVITY_TIMEOUT_MS = 300_000

    const onText = (msg: TaskTextMessage) => {
      if (!alive || msg.taskId !== opts.taskId) return
      lastActivity = Date.now()
      stream.writeSSE({ event: 'text', data: msg.text }).catch(() => { alive = false })
    }

    const onResult = (msg: TaskResultMessage) => {
      if (!alive || msg.result.taskId !== opts.taskId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ sessionId: opts.taskId }),
      }).catch(() => {})
      alive = false
    }

    const onToolTrace = (msg: TaskToolTraceMessage) => {
      if (!alive || msg.taskId !== opts.taskId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'tool_use',
        data: JSON.stringify({ toolName: msg.toolName, toolInput: msg.toolInput }),
      }).catch(() => { alive = false })
      if (msg.toolResult !== undefined) {
        stream.writeSSE({
          event: 'tool_result',
          data: JSON.stringify({ toolName: msg.toolName, success: msg.success, result: msg.toolResult }),
        }).catch(() => { alive = false })
      }
    }

    const onFileChange = (msg: TaskFileChangeMessage) => {
      if (!alive || msg.taskId !== opts.taskId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'file_change',
        data: JSON.stringify({ path: msg.path, action: msg.action }),
      }).catch(() => { alive = false })
    }

    const onSessionInit = (msg: TaskSessionInitMessage) => {
      if (!alive || msg.taskId !== opts.taskId) return
      lastActivity = Date.now()
      stream.writeSSE({
        event: 'session_init',
        data: JSON.stringify({ sessionId: msg.sessionId, model: msg.model }),
      }).catch(() => { alive = false })
    }

    const onMachineDisconnected = () => {
      if (!alive) return
      stream.writeSSE({
        event: 'error',
        data: 'Remote machine disconnected during task execution',
      }).catch(() => {})
      alive = false
    }

    relayServer.on('task:text', onText)
    relayServer.on('task:result', onResult)
    relayServer.on('task:tool_trace', onToolTrace)
    relayServer.on('task:file_change', onFileChange)
    relayServer.on('task:session_init', onSessionInit)
    relayServer.on('machine:disconnected', onMachineDisconnected)

    const cleanup = () => {
      relayServer.off('task:text', onText)
      relayServer.off('task:result', onResult)
      relayServer.off('task:tool_trace', onToolTrace)
      relayServer.off('task:file_change', onFileChange)
      relayServer.off('task:session_init', onSessionInit)
      relayServer.off('machine:disconnected', onMachineDisconnected)
    }

    // Dispatch after listeners are registered
    const dispatched = relayServer.dispatchTask(task, opts.targetMachineId)

    if (!dispatched) {
      cleanup()
      await stream.writeSSE({
        event: 'error',
        data: 'No agent runner connected. Start one with: npx astro-agent start --relay wss://<your-relay-url>',
      })
      return
    }

    // Keepalive + activity timeout
    const heartbeat = setInterval(() => {
      if (!alive) { clearInterval(heartbeat); return }
      if (Date.now() - lastActivity > ACTIVITY_TIMEOUT_MS) {
        stream.writeSSE({ event: 'error', data: 'Activity timeout — agent runner stopped responding' }).catch(() => {})
        alive = false
        clearInterval(heartbeat)
        return
      }
      stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => { alive = false; clearInterval(heartbeat) })
    }, 15000)

    stream.onAbort(() => {
      alive = false
      clearInterval(heartbeat)
      cleanup()
      relayServer.cancelTask(opts.taskId, opts.targetMachineId || '')
    })

    // Wait for completion
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!alive) { clearInterval(check); clearInterval(heartbeat); cleanup(); resolve() }
      }, 500)
    })
  })
}

/**
 * Non-streaming relay dispatch for server mode.
 * Dispatches task, waits for result, returns output as JSON.
 * Used by /summarize which is non-streaming.
 */
async function executeViaRelay(opts: {
  taskId: string
  projectId: string
  nodeId: string
  prompt: string
  systemPrompt?: string
  maxTurns?: number
  type?: 'chat' | 'plan' | 'execution' | 'summarize'
}): Promise<{ success: boolean; output?: string; error?: string }> {
  const task: RelayTaskDispatch = {
    taskId: opts.taskId,
    projectId: opts.projectId,
    nodeId: opts.nodeId,
    title: opts.type || 'summarize',
    description: opts.prompt.slice(0, 200),
    environment: 'remote',
    prompt: opts.prompt,
    systemPrompt: opts.systemPrompt,
    type: opts.type,
    maxTurns: opts.maxTurns ?? 1,
  }

  return new Promise((resolve) => {
    let output = ''
    const timeout = setTimeout(() => {
      cleanup()
      resolve({ success: false, error: 'Relay task timed out' })
    }, 120_000)

    const onText = (msg: TaskTextMessage) => {
      if (msg.taskId !== opts.taskId) return
      output += msg.text
    }

    const onResult = (msg: TaskResultMessage) => {
      if (msg.result.taskId !== opts.taskId) return
      clearTimeout(timeout)
      cleanup()
      resolve({
        success: msg.result.status === 'completed',
        output: msg.result.output || output,
        error: msg.result.error,
      })
    }

    const cleanup = () => {
      relayServer.off('task:text', onText)
      relayServer.off('task:result', onResult)
    }

    relayServer.on('task:text', onText)
    relayServer.on('task:result', onResult)

    const dispatched = relayServer.dispatchTask(task)
    if (!dispatched) {
      clearTimeout(timeout)
      cleanup()
      resolve({ success: false, error: 'No agent runner connected' })
    }
  })
}

const agentRoute = new Hono()

// All agent routes require authentication
agentRoute.use('/*', requireAuth)

agentRoute.post('/generate-plan', async (c) => {
  // Validate input
  let body: z.infer<typeof generatePlanSchema>
  try {
    const rawBody = await c.req.json()
    body = generatePlanSchema.parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { description, visionDoc, projectId, model, providerId, workingDirectory, fileTree, keyFiles, targetMachineId } = body
  const taskId = `gen-${projectId}-${Date.now()}`

  console.log(`[plan-gen] Request received: projectId=${projectId}, provider=${providerId || 'default'}, model=${model || 'default'}, targetMachineId=${targetMachineId || 'none'}, workingDirectory=${workingDirectory || 'none'}`)

  // Check if working directory exists locally (remote paths won't exist on this server)
  const isLocalDir = workingDirectory ? existsSync(workingDirectory) : false

  // Determine if we should dispatch via relay (remote machine)
  // In server mode, always use relay — the server has no AI providers.
  // In local mode, use relay only when a remote machine is explicitly targeted.
  const useRelay = isServerMode() || (!!targetMachineId && !isLocalDir)

  if (useRelay) {
    console.log(`[plan-gen] Routing to relay: machineId=${targetMachineId}`)
    // Dispatch plan generation to remote machine via relay
    return await generatePlanViaRelay(c, {
      taskId,
      projectId,
      description,
      visionDoc,
      workingDirectory,
      fileTree,
      keyFiles,
      targetMachineId: targetMachineId!,
    })
  }

  // Local execution path
  const abortController = createSession(taskId, providerId)

  return streamSSE(c, async (stream) => {
    try {
      // Get provider (use specified or default)
      const provider = providerId
        ? providerRegistry.getProvider(providerId)
        : providerRegistry.getDefaultProvider()

      if (!provider) {
        await stream.writeSSE({
          event: 'error',
          data: 'No agent provider available. Ensure a provider is installed and authenticated.',
        })
        return
      }

      console.log(`[plan-gen] Using provider: ${provider.id} (isLocalDir=${isLocalDir})`)

      // Read repo context: for local dirs, read key files + file tree from disk;
      // for remote dirs, use key files from the remote setup response + file tree
      let repoContext
      if (isLocalDir) {
        repoContext = readRepoContext(workingDirectory!, fileTree)
      } else if (fileTree || keyFiles) {
        // Remote case: build context from provided data (not local disk)
        repoContext = readRepoContext('', fileTree)
        // Merge in key files returned by remote repo setup
        if (keyFiles) {
          if (keyFiles.claudeMd) repoContext.claudeMd = keyFiles.claudeMd
          if (keyFiles.readmeMd) repoContext.readmeMd = keyFiles.readmeMd
          if (keyFiles.packageInfo) repoContext.packageInfo = keyFiles.packageInfo
        }
      }

      console.log(`[plan-gen] Repo context: ${isLocalDir ? 'local' : fileTree ? 'remote/provided' : 'none'}, fileTree=${fileTree?.length ?? 0} files`)

      const systemPrompt = buildPlanSystemPrompt(visionDoc, repoContext)

      // Claude SDK supports native outputFormat for structured JSON;
      // other providers need the schema embedded in the prompt.
      const isClaudeProvider = provider.id === 'claude-code'
      const schemaPromptSuffix = isClaudeProvider
        ? ''
        : `\n\n## Required Output JSON Schema\nYour response MUST be a single JSON object matching this schema (no markdown fences, no prose):\n${JSON.stringify(PLAN_GRAPH_SCHEMA, null, 2)}`

      // Build task dispatch — more turns when local repo available (agent may explore);
      // With outputFormat, the SDK may need retries for schema validation, so give at least 3.
      // anthropic-direct handles everything in 1 turn; claude-code needs more.
      // For repos: 100 turns allows thorough exploration, file reading, and plan generation.
      const maxTurns = isClaudeProvider
        ? (isLocalDir ? 100 : 3)  // 100 turns for repo exploration; 3 for structured output retries
        : 1
      const task: TaskDispatch = {
        taskId,
        type: 'planning',
        prompt: description + schemaPromptSuffix,
        systemPrompt,
        model: resolveModelForProvider(provider, model),
        maxTurns,
        context: {
          projectId,
          visionDoc,
          // Only set workingDirectory if it exists locally — the provider uses it as cwd
          ...(isLocalDir ? { workingDirectory } : {}),
        },
        abortController,
        // Force structured JSON output for plan generation (Claude SDK only; ignored by other providers)
        ...(isClaudeProvider ? { outputFormat: { type: 'json_schema' as const, schema: PLAN_GRAPH_SCHEMA } } : {}),
      }

      // Stream the execution
      let assistantText = ''
      let planResultSent = false

      for await (const event of provider.stream(task)) {
        switch (event.type) {
          case 'init':
            // Session initialized - update session metadata
            if (event.sessionId) {
              const session = getSession(taskId)
              if (session) {
                session.sessionId = event.sessionId
              }
            }
            break

          case 'text':
            assistantText += event.text
            await stream.writeSSE({ event: 'text', data: event.text })
            break

          case 'structured_output': {
            // Check if this is a plan result
            const data = event.output.data as Record<string, unknown>
            if (data && typeof data === 'object' && 'nodes' in data && 'edges' in data) {
              planResultSent = true
              const nodes = data.nodes as unknown[]
              const edges = data.edges as unknown[]
              console.log(`[plan-gen] Plan result sent (structured): ${nodes.length} nodes, ${edges.length} edges`)
              await stream.writeSSE({
                event: 'plan_result',
                data: JSON.stringify(data),
              })
            }
            break
          }

          case 'result': {
            // Try to extract plan from assistant text if no structured output already sent
            if (!planResultSent) {
              // Try accumulated assistant text first
              if (assistantText) {
                const parsed = extractPlanJson(assistantText)
                if (parsed) {
                  planResultSent = true
                  const nodes = (parsed.nodes as unknown[]) || []
                  const edges = (parsed.edges as unknown[]) || []
                  console.log(`[plan-gen] Plan result sent (extracted from text): ${nodes.length} nodes, ${edges.length} edges`)
                  await stream.writeSSE({
                    event: 'plan_result',
                    data: JSON.stringify(parsed),
                  })
                }
              }

              // Fallback: try result stdout (provider may have full text there even if text events weren't yielded)
              if (!planResultSent && event.result.stdout) {
                const parsed = extractPlanJson(event.result.stdout)
                if (parsed) {
                  planResultSent = true
                  const nodes = (parsed.nodes as unknown[]) || []
                  const edges = (parsed.edges as unknown[]) || []
                  console.log(`[plan-gen] Plan result sent (extracted from stdout): ${nodes.length} nodes, ${edges.length} edges`)
                  await stream.writeSSE({
                    event: 'plan_result',
                    data: JSON.stringify(parsed),
                  })
                }
              }

              if (!planResultSent) {
                console.warn(`[plan-gen] No plan result extracted. assistantText length=${assistantText.length}, stdout length=${event.result.stdout?.length ?? 0}, status=${event.result.status}`)
                if (assistantText.length > 0) {
                  console.warn(`[plan-gen] assistantText preview: ${assistantText.slice(0, 500)}`)
                }
                if (event.result.stdout && event.result.stdout.length > 0 && event.result.stdout !== assistantText) {
                  console.warn(`[plan-gen] stdout preview: ${event.result.stdout.slice(0, 500)}`)
                }

                // Send an error to the frontend so the user knows what happened.
                // Determine the most likely cause based on available evidence.
                let failureDetail: string
                if (event.result.status === 'error' && event.result.errorMessage) {
                  // Provider already reported an error (e.g., max turns, budget limit)
                  failureDetail = event.result.errorMessage
                } else if (assistantText.length > 0) {
                  // Got partial output but couldn't parse a plan — likely truncated
                  const trimmed = assistantText.trimEnd()
                  const mentionsPlanKeys = trimmed.includes('"nodes"') || trimmed.includes('"edges"')
                  if (mentionsPlanKeys && !trimmed.endsWith('}')) {
                    failureDetail = 'The AI response was truncated before the plan could be completed. This usually means the output token limit was reached. Try simplifying the project description or breaking it into smaller projects.'
                  } else {
                    failureDetail = 'The AI response did not contain a valid plan structure. The output may have been in an unexpected format. Try regenerating the plan.'
                  }
                } else {
                  failureDetail = 'No output was produced during plan generation. This may indicate a provider configuration or authentication issue.'
                }

                console.warn(`[plan-gen] Sending error to client: ${failureDetail}`)
                await stream.writeSSE({
                  event: 'error',
                  data: failureDetail,
                })
              }
            }

            console.log(`[plan-gen] Generation done: taskId=${taskId}, planSent=${planResultSent}`)
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({
                sessionId: event.result.sessionId ?? taskId,
                providerId: provider.id,
              }),
            })
            break
          }

          case 'error':
            // For plan generation, max_turns errors are expected when the plan is
            // produced as text before the SDK considers the task "complete".
            // Don't send the error to the client yet — the result handler will
            // check if a plan was extracted and only send error if it wasn't.
            if (event.error?.includes('Max turns reached')) {
              console.log(`[plan-gen] Max turns reached for taskId=${taskId}, will check for plan in result handler`)
            } else {
              console.error(`[plan-gen] Error: taskId=${taskId}`, event.error)
              await stream.writeSSE({ event: 'error', data: event.error })
            }
            break

          case 'aborted':
            console.log(`[plan-gen] Aborted: taskId=${taskId}`)
            await stream.writeSSE({ event: 'aborted', data: event.reason ?? '' })
            break
        }
      }
    } catch (e: unknown) {
      if (isAbortError(e)) {
        console.log(`[plan-gen] Aborted (catch): taskId=${taskId}`)
        await stream.writeSSE({ event: 'aborted', data: '' })
      } else {
        const message = errorMessage(e)
        console.error(`[plan-gen] Error (catch): taskId=${taskId}`, message)
        await stream.writeSSE({ event: 'error', data: message })
      }
    } finally {
      removeSession(taskId)
    }
  })
})

/**
 * Generate a plan via relay server on a remote machine.
 *
 * Builds the full plan prompt (system + user description), dispatches to the
 * remote agent runner, and streams relay events back as plan SSE events.
 * The agent runner executes with Claude SDK using the local repo as cwd.
 */
async function generatePlanViaRelay(
  c: Parameters<Parameters<typeof agentRoute.post>[1]>[0],
  params: {
    taskId: string
    projectId: string
    description: string
    visionDoc?: string
    workingDirectory?: string
    fileTree?: string[]
    keyFiles?: { claudeMd?: string; readmeMd?: string; packageInfo?: string }
    targetMachineId: string
  }
) {
  const {
    taskId,
    projectId,
    description,
    visionDoc,
    workingDirectory,
    fileTree,
    keyFiles,
    targetMachineId,
  } = params

  // Build repo context from provided data (key files + file tree from remote setup)
  let repoContext
  if (fileTree || keyFiles) {
    repoContext = readRepoContext('', fileTree)
    if (keyFiles) {
      if (keyFiles.claudeMd) repoContext.claudeMd = keyFiles.claudeMd
      if (keyFiles.readmeMd) repoContext.readmeMd = keyFiles.readmeMd
      if (keyFiles.packageInfo) repoContext.packageInfo = keyFiles.packageInfo
    }
  }

  // Build the full plan prompt: system prompt + user description
  // The remote agent runner will use this as the prompt with the repo as cwd.
  // Since the relay runs via query() without outputFormat, we add an explicit
  // JSON-output reminder so the agent doesn't produce natural language.
  const systemPrompt = buildPlanSystemPrompt(visionDoc, repoContext)
  const fullPrompt = `${systemPrompt}\n\n---\n\n## User Request\n\n${description}\n\n---\n\nIMPORTANT: Respond with ONLY the JSON plan object. Start your response with { and end with }. No prose, no markdown fences, no explanation. The JSON must have "projectName", "nodes", and "edges" keys.`

  // Build relay task dispatch with pre-built prompt
  const taskDispatch: import('../types/relay.js').TaskDispatch = {
    taskId,
    projectId,
    nodeId: `plan-${projectId}`,
    title: 'Plan Generation',
    description,
    visionDoc,
    environment: 'remote',
    workingDirectory,
    prompt: fullPrompt,
    maxTurns: 100, // 100 turns for plan generation (explore repo + produce JSON)
    outputFormat: { type: 'json_schema', schema: PLAN_GRAPH_SCHEMA },
  }

  return streamSSE(c, async (stream) => {
    let alive = true
    let lastActivity = Date.now()
    let assistantText = ''
    let planResultSent = false
    const ACTIVITY_TIMEOUT_MS = 300_000

    // Subscribe to relay events filtered by this taskId BEFORE dispatching
    const onResult = (msg: import('../types/relay.js').TaskResultMessage) => {
      if (!alive || msg.result.taskId !== taskId) return
      lastActivity = Date.now()

      // Try to extract plan from accumulated text
      if (!planResultSent && assistantText) {
        const parsed = extractPlanJson(assistantText)
        if (parsed) {
          planResultSent = true
          stream.writeSSE({
            event: 'plan_result',
            data: JSON.stringify(parsed),
          }).catch(() => { alive = false })
        }
      }

      // Also check the result output for plan JSON
      if (!planResultSent && msg.result.output) {
        const parsed = extractPlanJson(msg.result.output)
        if (parsed) {
          planResultSent = true
          stream.writeSSE({
            event: 'plan_result',
            data: JSON.stringify(parsed),
          }).catch(() => { alive = false })
        }
      }

      // If no plan was extracted, notify the client with an error
      if (!planResultSent) {
        let failureDetail: string
        const resultOutput = msg.result.output ?? ''
        console.warn(`[plan-gen] Relay: extraction failed. assistantText length=${assistantText.length}, result.output length=${resultOutput.length}, status=${msg.result.status}`)
        if (assistantText.length > 0) {
          console.warn(`[plan-gen] assistantText preview: ${assistantText.slice(0, 500)}`)
        }
        if (resultOutput.length > 0 && resultOutput !== assistantText) {
          console.warn(`[plan-gen] result.output preview: ${resultOutput.slice(0, 500)}`)
        }

        if (assistantText.length > 0 || resultOutput.length > 0) {
          const combined = assistantText || resultOutput
          const trimmed = combined.trimEnd()
          const mentionsPlanKeys = trimmed.includes('"nodes"') || trimmed.includes('"edges"')
          if (mentionsPlanKeys && !trimmed.endsWith('}')) {
            failureDetail = 'The AI response was truncated before the plan could be completed. This usually means the output token limit was reached. Try simplifying the project description.'
          } else {
            failureDetail = 'The AI response did not contain a valid plan structure. Try regenerating the plan.'
          }
        } else {
          failureDetail = 'No output was produced during plan generation on the remote machine.'
        }
        console.warn(`[plan-gen] Relay: no plan extracted. ${failureDetail}`)
        stream.writeSSE({ event: 'error', data: failureDetail }).catch(() => { alive = false })
      }

      stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ sessionId: taskId }),
      }).catch(() => {})
      alive = false
    }

    const onStdout = (msg: import('../types/relay.js').TaskStdoutMessage) => {
      if (!alive || msg.output.taskId !== taskId) return
      lastActivity = Date.now()
      assistantText += msg.output.data
      stream.writeSSE({ event: 'text', data: msg.output.data }).catch(() => { alive = false })
    }

    const onText = (msg: import('../types/relay.js').TaskTextMessage) => {
      if (!alive || msg.taskId !== taskId) return
      lastActivity = Date.now()
      assistantText += msg.text
      stream.writeSSE({ event: 'text', data: msg.text }).catch(() => { alive = false })
    }

    const onMachineDisconnected = (disconnectedId: string) => {
      if (!alive || disconnectedId !== targetMachineId) return
      console.log(`[agent] Machine ${targetMachineId} disconnected during plan generation ${taskId}`)
      stream.writeSSE({
        event: 'error',
        data: 'Remote machine disconnected during plan generation',
      }).catch(() => {})
      alive = false
    }

    relayServer.on('task:result', onResult)
    relayServer.on('task:stdout', onStdout)
    relayServer.on('task:text', onText)
    relayServer.on('machine:disconnected', onMachineDisconnected)

    // Now dispatch (after listeners registered to avoid race conditions)
    const dispatched = relayServer.dispatchTask(taskDispatch, targetMachineId)

    if (!dispatched) {
      relayServer.off('task:result', onResult)
      relayServer.off('task:stdout', onStdout)
      relayServer.off('task:text', onText)
      relayServer.off('machine:disconnected', onMachineDisconnected)
      await stream.writeSSE({
        event: 'error',
        data: `Failed to dispatch plan generation to machine: ${targetMachineId}`,
      })
      return
    }

    // Keepalive + activity timeout
    const heartbeat = setInterval(() => {
      if (!alive) { clearInterval(heartbeat); return }
      if (Date.now() - lastActivity > ACTIVITY_TIMEOUT_MS) {
        console.log(`[agent] Activity timeout for plan generation ${taskId}`)
        stream.writeSSE({
          event: 'error',
          data: 'Remote machine stopped responding (activity timeout)',
        }).catch(() => {})
        alive = false
        clearInterval(heartbeat)
        return
      }
      stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
        alive = false
        clearInterval(heartbeat)
      })
    }, 15000)

    stream.onAbort(() => {
      alive = false
      clearInterval(heartbeat)
      relayServer.off('task:result', onResult)
      relayServer.off('task:stdout', onStdout)
      relayServer.off('task:text', onText)
      relayServer.off('machine:disconnected', onMachineDisconnected)
      // Try to cancel the task on the remote machine
      relayServer.cancelTask(taskId, targetMachineId)
    })

    // Wait for completion or disconnect
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!alive) { clearInterval(check); resolve() }
      }, 500)
    })
  })
}

/**
 * Extract a plan JSON object from accumulated assistant text.
 * Handles multi-turn conversations where the JSON may appear in the last message
 * mixed with prose or wrapped in code fences.
 */
function extractPlanJson(text: string): Record<string, unknown> | null {
  // Try code fence extraction first
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim())
      if (parsed.nodes && parsed.edges) return parsed
    } catch { /* continue */ }
  }

  // Find the last complete JSON object containing nodes and edges
  // Search backwards for the last '{' that starts a valid plan object
  let lastValidPlan: Record<string, unknown> | null = null
  let searchFrom = 0

  while (true) {
    const start = text.indexOf('{', searchFrom)
    if (start === -1) break

    // Find matching closing brace
    let depth = 0
    let end = -1
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }

    if (end === -1) break

    const candidate = text.slice(start, end + 1)
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && parsed.nodes && parsed.edges) {
        lastValidPlan = parsed
      }
    } catch { /* not valid JSON, skip */ }

    searchFrom = start + 1
  }

  return lastValidPlan
}

agentRoute.post('/chat', async (c) => {
  // Validate input
  let body: z.infer<typeof chatSchema>
  try {
    const rawBody = await c.req.json()
    body = chatSchema.parse(rawBody)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid input', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { message, sessionId: existingSessionId, projectId, visionDoc, model, providerId, planNodes, planEdges, messages: historyMessages } = body
  const taskId = existingSessionId || `chat-${projectId}-${Date.now()}`

  // Server mode: route through relay — server has no AI providers
  if (isServerMode()) {
    const systemPrompt = buildChatSystemPrompt(visionDoc, planNodes, planEdges)
    return streamChatViaRelay(c, {
      taskId,
      projectId,
      nodeId: '',
      prompt: message,
      systemPrompt,
      type: 'chat',
      messages: historyMessages,
      maxTurns: 50,
    })
  }

  const abortController = createSession(taskId, providerId)

  return streamSSE(c, async (stream) => {
    // Track which pool key we resumed from (null if not using pool resume)
    let resumedPoolKey: string | null = null
    try {
      // Get provider — use the same provider for initial and follow-up messages.
      // anthropic-direct handles multi-turn statelessly via historyMessages,
      // so no need to switch to claude-code for session resumption.
      const provider = getChatProvider(providerId)

      if (!provider) {
        await stream.writeSSE({
          event: 'error',
          data: 'No agent provider available. Ensure a provider is installed and authenticated.',
        })
        return
      }

      const systemPrompt = buildChatSystemPrompt(visionDoc, planNodes, planEdges)

      // Build task dispatch — hybrid resume/fallback approach:
      // 1. If provider supports SDK resume, try pool-based resume first (fast, preserves context)
      // 2. Fall back to inline history if no pool entry or provider mismatch
      // 3. For providers with native messages support (anthropic-direct), pass history directly
      const supportsResume = provider.capabilities().supportsSessionResume === true
      const poolKey = `${projectId}:plan-chat`
      let chatPrompt = message
      let chatSessionId = existingSessionId

      if (supportsResume && historyMessages && historyMessages.length > 0) {
        // Provider supports SDK resume — try pool-based resume first
        const poolEntry = chatSessionPool.getSession(poolKey)
        if (poolEntry && poolEntry.providerId === provider.id) {
          // Resume from pool — no need to embed history
          chatSessionId = poolEntry.sdkSessionId
          resumedPoolKey = poolKey
        } else {
          // No pool entry or provider mismatch — embed history inline
          const historyText = historyMessages
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n\n')
          chatPrompt = `Previous conversation:\n${historyText}\n\nUser: ${message}`
          chatSessionId = undefined
        }
      } else if (!supportsResume && historyMessages && historyMessages.length > 0) {
        // Provider handles multi-turn via messages array (anthropic-direct)
        // No changes needed — messages passed directly below
      }

      const task: TaskDispatch = {
        taskId,
        sessionId: chatSessionId,
        type: 'chat',
        prompt: chatPrompt,
        systemPrompt,
        model: resolveModelForProvider(provider, model),
        maxTurns: 50, // Plan chat is always multi-turn (explore repo, refine plans)
        context: {
          projectId,
          visionDoc,
        },
        abortController,
        messages: !supportsResume ? historyMessages : undefined,
      }

      // Stream the execution
      for await (const event of provider.stream(task)) {
        switch (event.type) {
          case 'text':
            await stream.writeSSE({ event: 'text', data: event.text })
            break

          case 'result':
            // Store SDK session for future resume
            if (supportsResume && event.result.sessionId) {
              chatSessionPool.storeSession(poolKey, event.result.sessionId, provider.id)
            }
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({
                sessionId: event.result.sessionId ?? taskId,
                providerId: provider.id,
              }),
            })
            break

          case 'error':
            await stream.writeSSE({ event: 'error', data: event.error })
            break

          case 'aborted':
            await stream.writeSSE({ event: 'aborted', data: event.reason ?? '' })
            break
        }
      }
    } catch (e: unknown) {
      if (resumedPoolKey) {
        // Resume failed — remove stale pool entry
        chatSessionPool.removeSession(resumedPoolKey)
      }
      if (isAbortError(e)) {
        await stream.writeSSE({ event: 'aborted', data: '' })
      } else {
        const message = errorMessage(e)
        await stream.writeSSE({ event: 'error', data: message })
      }
    } finally {
      removeSession(taskId)
    }
  })
})

/**
 * Task-level chat for per-task AI assistance.
 * Context-aware: knows the task description, its position in the plan graph, the vision doc, and agent output.
 */
agentRoute.post('/task-chat', async (c) => {
  const body = await c.req.json<{
    message: string
    sessionId?: string
    nodeId: string
    projectId: string
    taskTitle: string
    taskDescription: string
    taskOutput?: string
    visionDoc?: string
    model?: string
    providerId?: string
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>
  }>()

  const {
    message,
    sessionId: existingSessionId,
    nodeId,
    projectId,
    taskTitle,
    taskDescription,
    taskOutput,
    visionDoc,
    model,
    providerId,
    messages: historyMessages,
  } = body

  const taskId = existingSessionId || `task-chat-${nodeId}-${Date.now()}`

  // Server mode: route through relay — server has no AI providers
  if (isServerMode()) {
    const systemPrompt = buildTaskChatSystemPrompt({
      taskTitle,
      taskDescription,
      taskOutput,
      visionDoc,
    })
    return streamChatViaRelay(c, {
      taskId,
      projectId,
      nodeId,
      prompt: message,
      systemPrompt,
      type: 'chat',
      messages: historyMessages,
      maxTurns: 50,
    })
  }

  const abortController = createSession(taskId, providerId)

  return streamSSE(c, async (stream) => {
    // Track which pool key we resumed from (null if not using pool resume)
    let resumedPoolKey: string | null = null
    try {
      // Get provider — use the same provider for initial and follow-up messages.
      // anthropic-direct handles multi-turn statelessly via historyMessages,
      // so no need to switch to claude-code for session resumption.
      const provider = getChatProvider(providerId)

      if (!provider) {
        await stream.writeSSE({
          event: 'error',
          data: 'No agent provider available. Ensure a provider is installed and authenticated.',
        })
        return
      }

      const systemPrompt = buildTaskChatSystemPrompt({
        taskTitle,
        taskDescription,
        taskOutput,
        visionDoc,
      })

      // Build task dispatch — hybrid resume/fallback approach (same as /chat)
      const supportsResume = provider.capabilities().supportsSessionResume === true
      const poolKey = `${projectId}:task-chat:${nodeId}`
      let chatPrompt = message
      let chatSessionId = existingSessionId

      if (supportsResume && historyMessages && historyMessages.length > 0) {
        // Provider supports SDK resume — try pool-based resume first
        const poolEntry = chatSessionPool.getSession(poolKey)
        if (poolEntry && poolEntry.providerId === provider.id) {
          // Resume from pool — no need to embed history
          chatSessionId = poolEntry.sdkSessionId
          resumedPoolKey = poolKey
        } else {
          // No pool entry or provider mismatch — embed history inline
          const historyText = historyMessages
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n\n')
          chatPrompt = `Previous conversation:\n${historyText}\n\nUser: ${message}`
          chatSessionId = undefined
        }
      } else if (!supportsResume && historyMessages && historyMessages.length > 0) {
        // Provider handles multi-turn via messages array (anthropic-direct)
        // No changes needed — messages passed directly below
      }

      const task: TaskDispatch = {
        taskId,
        sessionId: chatSessionId,
        type: 'chat',
        prompt: chatPrompt,
        systemPrompt,
        model: resolveModelForProvider(provider, model),
        maxTurns: 50, // Task chat is always multi-turn (explore context, steer agent)
        context: {
          projectId,
          nodeId,
          visionDoc,
          taskOutput,
        },
        abortController,
        messages: !supportsResume ? historyMessages : undefined,
      }

      // Stream the execution
      for await (const event of provider.stream(task)) {
        switch (event.type) {
          case 'text':
            await stream.writeSSE({ event: 'text', data: event.text })
            break

          case 'result':
            // Store SDK session for future resume
            if (supportsResume && event.result.sessionId) {
              chatSessionPool.storeSession(poolKey, event.result.sessionId, provider.id)
            }
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({
                sessionId: event.result.sessionId ?? taskId,
                providerId: provider.id,
              }),
            })
            break

          case 'error':
            await stream.writeSSE({ event: 'error', data: event.error })
            break

          case 'aborted':
            await stream.writeSSE({ event: 'aborted', data: event.reason ?? '' })
            break
        }
      }
    } catch (e: unknown) {
      if (resumedPoolKey) {
        // Resume failed — remove stale pool entry
        chatSessionPool.removeSession(resumedPoolKey)
      }
      if (isAbortError(e)) {
        await stream.writeSSE({ event: 'aborted', data: '' })
      } else {
        const message = errorMessage(e)
        await stream.writeSSE({ event: 'error', data: message })
      }
    } finally {
      removeSession(taskId)
    }
  })
})

agentRoute.post('/abort', async (c) => {
  const { sessionId, taskId } = await c.req.json<{ sessionId?: string; taskId?: string }>()
  const id = taskId ?? sessionId

  if (!id) {
    return c.json({ aborted: false, error: 'No sessionId or taskId provided' }, 400)
  }

  // First try to abort via the session manager
  const aborted = abortSession(id)

  // Also try to cancel via the provider if available
  const session = getSession(id)
  if (session?.providerId) {
    const provider = providerRegistry.getProvider(session.providerId)
    if (provider) {
      await provider.cancel(id)
    }
  }

  return c.json({ aborted })
})

/**
 * Compact (summarize) a conversation to reduce context size.
 * Takes the full message history and returns a compressed summary via SSE.
 */
agentRoute.post('/compact', async (c) => {
  const body = await c.req.json<{
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    projectId: string
    model?: string
    providerId?: string
  }>()

  const { messages, projectId, model, providerId } = body

  if (!messages || messages.length === 0) {
    return c.json({ error: 'No messages to compact' }, 400)
  }

  const taskId = `compact-${projectId}-${Date.now()}`

  // Server mode: route through relay — server has no AI providers
  if (isServerMode()) {
    const transcript = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n')

    const compactPrompt = `Summarize the following conversation into a concise but comprehensive context document. Preserve all important decisions, key facts, action items, and technical details. The summary will be used as context for future messages in the same session.

Focus on:
- Decisions made and their rationale
- Technical details and specifications discussed
- Action items and their status
- Key constraints or requirements mentioned
- Any plan modifications or task updates

Conversation:
${transcript}

Provide a structured summary that captures the essential context needed to continue this conversation effectively.`

    return streamChatViaRelay(c, {
      taskId,
      projectId,
      nodeId: '',
      prompt: compactPrompt,
      type: 'chat',
      maxTurns: 1,
    })
  }

  const abortController = createSession(taskId, providerId)

  return streamSSE(c, async (stream) => {
    try {
      const provider = getChatProvider(providerId)

      if (!provider) {
        await stream.writeSSE({
          event: 'error',
          data: 'No agent provider available.',
        })
        return
      }

      // Build a conversation transcript for summarization
      const transcript = messages
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n')

      const compactPrompt = `Summarize the following conversation into a concise but comprehensive context document. Preserve all important decisions, key facts, action items, and technical details. The summary will be used as context for future messages in the same session.

Focus on:
- Decisions made and their rationale
- Technical details and specifications discussed
- Action items and their status
- Key constraints or requirements mentioned
- Any plan modifications or task updates

Conversation:
${transcript}

Provide a structured summary that captures the essential context needed to continue this conversation effectively.`

      const task: TaskDispatch = {
        taskId,
        type: 'chat',
        prompt: compactPrompt,
        model: resolveModelForProvider(provider, model),
        maxTurns: 1,
        context: { projectId },
        abortController,
      }

      for await (const event of provider.stream(task)) {
        switch (event.type) {
          case 'text':
            await stream.writeSSE({ event: 'text', data: event.text })
            break

          case 'result':
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({
                sessionId: event.result.sessionId ?? taskId,
                providerId: provider.id,
              }),
            })
            break

          case 'error':
            await stream.writeSSE({ event: 'error', data: event.error })
            break

          case 'aborted':
            await stream.writeSSE({ event: 'aborted', data: event.reason ?? '' })
            break
        }
      }
    } catch (e: unknown) {
      if (isAbortError(e)) {
        await stream.writeSSE({ event: 'aborted', data: '' })
      } else {
        const message = errorMessage(e)
        await stream.writeSSE({ event: 'error', data: message })
      }
    } finally {
      removeSession(taskId)
    }
  })
})

/**
 * Dispatch a task node for execution via a local provider (Claude Code).
 * This is the core endpoint for zero-config local dispatch.
 */
agentRoute.post('/dispatch', async (c) => {
  const body = await c.req.json<{
    nodeId: string
    projectId: string
    taskTitle: string
    taskDescription: string
    taskType?: TaskType
    visionDoc?: string
    dependencyOutputs?: string
    workingDirectory?: string
    model?: string
    providerId?: string
    maxTurns?: number
  }>()

  const {
    nodeId,
    projectId,
    taskTitle,
    taskDescription,
    taskType = 'code_generation',
    visionDoc,
    dependencyOutputs,
    workingDirectory,
    model,
    providerId,
    maxTurns = 100,
  } = body

  const executionId = `exec-${nodeId}-${Date.now()}`

  // Server mode: route through relay — server has no AI providers
  if (isServerMode()) {
    const prompt = buildTaskExecutionPrompt({
      taskTitle,
      taskDescription,
      visionDoc,
      dependencyOutputs,
      workingDirectory,
    })
    return streamChatViaRelay(c, {
      taskId: executionId,
      projectId,
      nodeId,
      prompt,
      type: 'execution',
      workingDirectory,
      maxTurns: maxTurns,
    })
  }

  const abortController = createSession(executionId, providerId, {
    taskType,
    projectId,
  })

  return streamSSE(c, async (stream) => {
    try {
      // Get provider (prefer specified, then default available provider)
      const provider = providerId
        ? providerRegistry.getProvider(providerId)
        : providerRegistry.getDefaultProvider()

      if (!provider) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            error: 'No agent provider available',
            message: 'No local agent provider found. Ensure Claude Code is installed and authenticated.',
            suggestion: 'Run `claude login` to authenticate Claude Code.',
          }),
        })
        return
      }

      // Check if provider is available
      const registration = providerRegistry.getRegisteredProvider(provider.id)
      if (!registration?.available) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            error: 'Provider not available',
            message: `${provider.name} is installed but not authenticated.`,
            suggestion: 'Run `claude login` to authenticate.',
          }),
        })
        return
      }

      // Build the execution prompt with context injection
      const prompt = buildTaskExecutionPrompt({
        taskTitle,
        taskDescription,
        visionDoc,
        dependencyOutputs,
        workingDirectory,
      })

      // Build task dispatch
      const task: TaskDispatch = {
        taskId: executionId,
        type: taskType,
        prompt,
        model: resolveModelForProvider(provider, model),
        maxTurns,
        context: {
          projectId,
          visionDoc,
          dependencyContext: dependencyOutputs,
          workingDirectory,
        },
        abortController,
      }

      // Send init event
      await stream.writeSSE({
        event: 'init',
        data: JSON.stringify({
          executionId,
          nodeId,
          providerId: provider.id,
          providerName: provider.name,
        }),
      })

      // Stream the execution
      let fullOutput = ''
      let sessionId: string | undefined

      for await (const event of provider.stream(task)) {
        switch (event.type) {
          case 'init':
            sessionId = event.sessionId
            updateSession(executionId, { sessionId })
            await stream.writeSSE({
              event: 'session_init',
              data: JSON.stringify({
                sessionId: event.sessionId,
                model: event.model,
              }),
            })
            break

          case 'text':
            fullOutput += event.text
            await stream.writeSSE({ event: 'text', data: event.text })
            break

          case 'tool_use':
            await stream.writeSSE({
              event: 'tool_use',
              data: JSON.stringify({
                toolName: event.toolName,
                toolInput: event.toolInput,
              }),
            })
            break

          case 'tool_result':
            await stream.writeSSE({
              event: 'tool_result',
              data: JSON.stringify({
                toolName: event.toolName,
                success: event.success,
                result: typeof event.result === 'string'
                  ? event.result.slice(0, 100000)
                  : event.result,
              }),
            })
            break

          case 'file_change':
            await stream.writeSSE({
              event: 'file_change',
              data: JSON.stringify(event.change),
            })
            break

          case 'progress':
            await stream.writeSSE({
              event: 'progress',
              data: JSON.stringify({
                message: event.message,
                percentage: event.percentage,
              }),
            })
            break

          case 'result':
            await stream.writeSSE({
              event: 'result',
              data: JSON.stringify({
                executionId,
                nodeId,
                status: event.result.status,
                output: fullOutput,
                metrics: event.result.metrics,
                verification: event.result.verification,
                sessionId: event.result.sessionId,
              }),
            })
            break

          case 'error':
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({
                error: event.error,
                recoverable: event.recoverable,
              }),
            })
            break

          case 'aborted':
            await stream.writeSSE({
              event: 'aborted',
              data: JSON.stringify({
                reason: event.reason,
              }),
            })
            break
        }
      }

      // Send done event
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          executionId,
          nodeId,
          sessionId,
        }),
      })
    } catch (e: unknown) {
      if (isAbortError(e)) {
        await stream.writeSSE({
          event: 'aborted',
          data: JSON.stringify({ reason: 'User cancelled' }),
        })
      } else {
        const message = errorMessage(e)
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: message }),
        })
      }
    } finally {
      removeSession(executionId)
    }
  })
})

/**
 * Summarize execution results.
 * Single-turn, no tools, no streaming. Returns structured JSON summary.
 */
agentRoute.post('/summarize', async (c) => {
  const body = await c.req.json<{
    taskTitle: string
    taskDescription: string
    executionOutput: string
    fileChanges: Array<{ path: string; action: string }>
    status: 'success' | 'failure'
  }>()

  console.log(`[summarize] Summary generation requested for task: ${body.taskTitle} (status: ${body.status})`)

  // Server mode: route through relay — server has no AI providers
  if (isServerMode()) {
    const prompt = buildSummaryPrompt(body)
    const taskId = `summary-${Date.now()}`
    const result = await executeViaRelay({
      taskId,
      projectId: '',
      nodeId: '',
      prompt,
      type: 'summarize',
      maxTurns: 1,
    })

    if (result.success && result.output) {
      try {
        const jsonMatch = result.output.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const summary = JSON.parse(jsonMatch[0])
          return c.json({ summary })
        }
      } catch {
        return c.json({
          summary: {
            workCompleted: result.output.slice(0, 200),
            filesChanged: body.fileChanges.map((f) => f.path),
            status: body.status,
            followUps: [],
          },
        })
      }
    }

    return c.json({ error: result.error || 'Failed to generate summary via relay' }, 500)
  }

  try {
    // Get provider — prefer anthropic-direct for this lightweight task
    const provider = getChatProvider()

    if (!provider) {
      console.error('[summarize] No provider available for summary generation')
      return c.json({ error: 'No provider available' }, 503)
    }

    console.log('[summarize] Using provider for summary generation')

    const prompt = buildSummaryPrompt(body)
    const taskId = `summary-${Date.now()}`

    const task: TaskDispatch = {
      taskId,
      type: 'chat',
      prompt,
      model: 'claude-3-5-haiku-20241022', // Use cheapest model for summaries
      maxTurns: 1,
      context: { projectId: '' },
    }

    console.log('[summarize] Executing summary generation task...')
    const result = await provider.execute(task)
    console.log(`[summarize] Summary generation completed with status: ${result.status}`)

    if (result.status === 'success' && result.stdout) {
      try {
        // Try to parse the JSON from the response
        const jsonMatch = result.stdout.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const summary = JSON.parse(jsonMatch[0])
          console.log('[summarize] Successfully generated and parsed JSON summary')
          return c.json({ summary })
        }
      } catch (parseError) {
        console.warn('[summarize] JSON parsing failed, returning basic summary:', errorMessage(parseError))
        // If JSON parsing fails, return a basic summary
        return c.json({
          summary: {
            workCompleted: result.stdout.slice(0, 200),
            filesChanged: body.fileChanges.map((f) => f.path),
            status: body.status,
            followUps: [],
          },
        })
      }
    }

    console.error(`[summarize] Summary generation failed: result.status=${result.status}, stdout length=${result.stdout?.length || 0}`)
    return c.json({ error: 'Failed to generate summary' }, 500)
  } catch (error) {
    console.error('[summarize] Error:', errorMessage(error))
    return c.json({ error: 'Summary generation failed' }, 500)
  }
})

/**
 * Get provider status - used for zero-config detection.
 * Returns the status of all registered providers.
 */
agentRoute.get('/providers', async (c) => {
  const summary = providerRegistry.getStatusSummary()
  return c.json(summary)
})

/**
 * Re-detect providers - force a re-probe of all providers.
 */
agentRoute.post('/providers/detect', async (c) => {
  const results = await providerRegistry.detectAll()
  const summary = providerRegistry.getStatusSummary()

  return c.json({
    detected: results.size,
    ...summary,
  })
})

export { agentRoute }
