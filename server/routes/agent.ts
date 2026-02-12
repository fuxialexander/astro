import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  providerRegistry,
  type TaskDispatch,
  type TaskType,
} from '../lib/providers/index.js'
import { createSession, abortSession, removeSession, getSession, updateSession } from '../lib/session-manager.js'
import { buildPlanSystemPrompt, buildChatSystemPrompt, buildTaskExecutionPrompt, buildTaskChatSystemPrompt } from '../lib/prompt-templates.js'
import { readRepoContext } from '../lib/repo-context.js'
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
  }>()

  const { description, visionDoc, projectId, model, providerId, workingDirectory, fileTree } = body
  const taskId = `gen-${projectId}-${Date.now()}`
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

      // Read repo context if working directory is provided
      const repoContext = workingDirectory
        ? readRepoContext(workingDirectory, fileTree)
        : undefined

      const systemPrompt = buildPlanSystemPrompt(visionDoc, repoContext)

      // Build task dispatch — more turns when repo context available (agent may explore)
      const task: TaskDispatch = {
        taskId,
        type: 'planning',
        prompt: description,
        systemPrompt,
        model,
        maxTurns: workingDirectory ? 10 : 1,
        context: {
          projectId,
          visionDoc,
          ...(workingDirectory ? { workingDirectory } : {}),
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
                await stream.writeSSE({
                  event: 'plan_result',
                  data: JSON.stringify(parsed),
                })
              }
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
