import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  providerRegistry,
  type TaskDispatch,
} from '../lib/providers/index.js'
import { createSession, abortSession, removeSession, getSession } from '../lib/session-manager.js'
import { buildPlanSystemPrompt, buildChatSystemPrompt } from '../lib/prompt-templates.js'

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

export { agentRoute }
