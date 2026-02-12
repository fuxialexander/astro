import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  providerRegistry,
  type TaskDispatch,
  type TaskType,
} from '../lib/providers/index.js'
import { createSession, abortSession, removeSession, getSession, updateSession } from '../lib/session-manager.js'
import { buildPlanSystemPrompt, buildChatSystemPrompt, buildTaskExecutionPrompt, buildTaskChatSystemPrompt } from '../lib/prompt-templates.js'
import { existsSync } from 'node:fs'
import { readRepoContext } from '../lib/repo-context.js'
import { relayServer } from '../lib/relay-server.js'
import { requireAuth } from '../middleware/auth.js'
import { errorMessage, isAbortError } from '../lib/error-utils.js'

const agentRoute = new Hono()

// All agent routes require authentication
agentRoute.use('/*', requireAuth)

agentRoute.post('/generate-plan', async (c) => {
  const body = await c.req.json<{
    description: string
    visionDoc?: string
    projectId: string
    model?: string
    providerId?: string
    workingDirectory?: string
    fileTree?: string[]
    keyFiles?: { claudeMd?: string; readmeMd?: string; packageInfo?: string }
    targetMachineId?: string
  }>()

  const { description, visionDoc, projectId, model, providerId, workingDirectory, fileTree, keyFiles, targetMachineId } = body
  const taskId = `gen-${projectId}-${Date.now()}`

  console.log(`[plan-gen] Request received: projectId=${projectId}, provider=${providerId || 'default'}, model=${model || 'default'}`)

  // Check if working directory exists locally (remote paths won't exist on this server)
  const isLocalDir = workingDirectory ? existsSync(workingDirectory) : false

  // Determine if we should dispatch via relay (remote machine)
  const useRelay = !!targetMachineId && !isLocalDir

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

      // Build task dispatch — more turns when local repo available (agent may explore);
      // remote repos only have file tree context, so 1 turn is enough
      const task: TaskDispatch = {
        taskId,
        type: 'planning',
        prompt: description,
        systemPrompt,
        model,
        maxTurns: isLocalDir ? 10 : 1,
        context: {
          projectId,
          visionDoc,
          // Only set workingDirectory if it exists locally — the provider uses it as cwd
          ...(isLocalDir ? { workingDirectory } : {}),
        },
        abortController,
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

          case 'result':
            // Try to extract plan from assistant text if no structured output already sent
            if (!planResultSent && assistantText) {
              const parsed = extractPlanJson(assistantText)
              if (parsed) {
                const nodes = (parsed.nodes as unknown[]) || []
                const edges = (parsed.edges as unknown[]) || []
                console.log(`[plan-gen] Plan result sent (extracted): ${nodes.length} nodes, ${edges.length} edges`)
                await stream.writeSSE({
                  event: 'plan_result',
                  data: JSON.stringify(parsed),
                })
              }
            }

            console.log(`[plan-gen] Generation done: taskId=${taskId}`)
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({
                sessionId: event.result.sessionId ?? taskId,
                providerId: provider.id,
              }),
            })
            break

          case 'error':
            console.error(`[plan-gen] Error: taskId=${taskId}`, event.error)
            await stream.writeSSE({ event: 'error', data: event.error })
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
  // The remote agent runner will use this as the prompt with the repo as cwd
  const systemPrompt = buildPlanSystemPrompt(visionDoc, repoContext)
  const fullPrompt = `${systemPrompt}\n\n---\n\n## User Request\n\n${description}`

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
  const body = await c.req.json<{
    message: string
    sessionId?: string
    projectId: string
    visionDoc?: string
    model?: string
    providerId?: string
  }>()

  const { message, sessionId: existingSessionId, projectId, visionDoc, model, providerId } = body
  const taskId = existingSessionId || `chat-${projectId}-${Date.now()}`
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

      const systemPrompt = buildChatSystemPrompt(visionDoc)

      // Build task dispatch
      const task: TaskDispatch = {
        taskId,
        sessionId: existingSessionId,
        type: 'chat',
        prompt: message,
        systemPrompt,
        model,
        maxTurns: 1,
        context: {
          projectId,
          visionDoc,
        },
        abortController,
      }

      // Stream the execution
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
  } = body

  const taskId = existingSessionId || `task-chat-${nodeId}-${Date.now()}`
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

      const systemPrompt = buildTaskChatSystemPrompt({
        taskTitle,
        taskDescription,
        taskOutput,
        visionDoc,
      })

      // Build task dispatch
      const task: TaskDispatch = {
        taskId,
        sessionId: existingSessionId,
        type: 'chat',
        prompt: message,
        systemPrompt,
        model,
        maxTurns: 1,
        context: {
          projectId,
          nodeId,
          visionDoc,
          taskOutput,
        },
        abortController,
      }

      // Stream the execution
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
    maxTurns = 50,
  } = body

  const executionId = `exec-${nodeId}-${Date.now()}`
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
        model,
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
