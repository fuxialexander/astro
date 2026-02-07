import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  providerRegistry,
  type TaskDispatch,
  type TaskType,
} from '../lib/providers/index.js'
import { createSession, abortSession, removeSession, getSession, updateSession } from '../lib/session-manager.js'
import { buildPlanSystemPrompt, buildChatSystemPrompt, buildTaskExecutionPrompt, buildTaskChatSystemPrompt } from '../lib/prompt-templates.js'

const agentRoute = new Hono()

agentRoute.post('/generate-plan', async (c) => {
  const body = await c.req.json<{
    description: string
    visionDoc?: string
    projectId: string
    model?: string
    providerId?: string
  }>()

  const { description, visionDoc, projectId, model, providerId } = body
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

      const systemPrompt = buildPlanSystemPrompt(visionDoc)

      // Build task dispatch
      const task: TaskDispatch = {
        taskId,
        type: 'planning',
        prompt: description,
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
      let assistantText = ''

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
              await stream.writeSSE({
                event: 'plan_result',
                data: JSON.stringify(data),
              })
            }
            break
          }

          case 'result':
            // Try to extract plan from assistant text if no structured output
            if (!event.result.output && assistantText) {
              const jsonMatch = assistantText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, assistantText]
              const candidate = (jsonMatch[1] || assistantText).trim()
              try {
                const parsed = JSON.parse(candidate)
                if (parsed.nodes && parsed.edges) {
                  await stream.writeSSE({
                    event: 'plan_result',
                    data: JSON.stringify(parsed),
                  })
                }
              } catch {
                // Not valid JSON — that's fine, text was already streamed
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
      if (e instanceof Error && e.name === 'AbortError') {
        await stream.writeSSE({ event: 'aborted', data: '' })
      } else {
        const message = e instanceof Error ? e.message : 'unknown error'
        await stream.writeSSE({ event: 'error', data: message })
      }
    } finally {
      removeSession(taskId)
    }
  })
})

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
      if (e instanceof Error && e.name === 'AbortError') {
        await stream.writeSSE({ event: 'aborted', data: '' })
      } else {
        const message = e instanceof Error ? e.message : 'unknown error'
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
      if (e instanceof Error && e.name === 'AbortError') {
        await stream.writeSSE({ event: 'aborted', data: '' })
      } else {
        const message = e instanceof Error ? e.message : 'unknown error'
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
                // Truncate large results
                result: typeof event.result === 'string'
                  ? event.result.slice(0, 5000)
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
      if (e instanceof Error && e.name === 'AbortError') {
        await stream.writeSSE({
          event: 'aborted',
          data: JSON.stringify({ reason: 'User cancelled' }),
        })
      } else {
        const message = e instanceof Error ? e.message : 'Unknown error'
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
