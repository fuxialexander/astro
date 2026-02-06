import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { createSession, abortSession, removeSession } from "../lib/session-manager.js"
import { buildPlanSystemPrompt, buildChatSystemPrompt, PLAN_GRAPH_SCHEMA } from "../lib/prompt-templates.js"

const agentRoute = new Hono()

agentRoute.post("/generate-plan", async (c) => {
  const body = await c.req.json<{
    description: string
    visionDoc?: string
    projectId: string
    model?: string
  }>()

  const { description, visionDoc, projectId, model } = body
  const sessionId = `gen-${projectId}-${Date.now()}`
  const abortController = createSession(sessionId)

  return streamSSE(c, async (stream) => {
    try {
      const systemPrompt = buildPlanSystemPrompt(visionDoc)

      // Embed the instruction in the prompt itself for reliability
      const fullPrompt = `${systemPrompt}\n\n---\n\nProject description:\n${description}`

      const gen = query({
        prompt: fullPrompt,
        options: {
          abortController,
          model: model || "claude-sonnet-4-5-20250929",
          maxTurns: 1,
          tools: [],
          persistSession: false,
        },
      })

      let assistantText = ""

      for await (const msg of gen) {
        if (msg.type === "assistant") {
          // Extract text from the message content blocks
          for (const block of msg.message.content) {
            if (block.type === "text") {
              assistantText += block.text
              await stream.writeSSE({ event: "text", data: block.text })
            }
          }
        } else if (msg.type === "result") {
          // Try structured_output first, then result text, then assistant text
          const jsonSource = (msg.subtype === "success" && msg.structured_output)
            ? JSON.stringify(msg.structured_output)
            : (msg.subtype === "success" && msg.result) || assistantText

          if (jsonSource) {
            const text = typeof jsonSource === "string" ? jsonSource : JSON.stringify(jsonSource)
            // Try to extract JSON from the text (may be wrapped in markdown code blocks)
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text]
            const candidate = (jsonMatch[1] || text).trim()
            try {
              const parsed = JSON.parse(candidate)
              if (parsed.nodes && parsed.edges) {
                await stream.writeSSE({
                  event: "plan_result",
                  data: JSON.stringify(parsed),
                })
              }
            } catch {
              // Not valid JSON — that's fine, text was already streamed
            }
          }

          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({ sessionId }),
          })
          break // Critical: exit the loop so the stream closes
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        await stream.writeSSE({ event: "aborted", data: "" })
      } else {
        const message = e instanceof Error ? e.message : "unknown error"
        await stream.writeSSE({ event: "error", data: message })
      }
    } finally {
      removeSession(sessionId)
    }
  })
})

agentRoute.post("/chat", async (c) => {
  const body = await c.req.json<{
    message: string
    sessionId?: string
    projectId: string
    visionDoc?: string
    model?: string
  }>()

  const { message, sessionId: existingSessionId, projectId, visionDoc, model } = body
  const sessionId = existingSessionId || `chat-${projectId}-${Date.now()}`
  const abortController = createSession(sessionId)

  return streamSSE(c, async (stream) => {
    try {
      const systemPrompt = buildChatSystemPrompt(visionDoc)

      const gen = query({
        prompt: message,
        options: {
          abortController,
          model: model || "claude-sonnet-4-5-20250929",
          systemPrompt,
          maxTurns: 1,
          tools: [],
          permissionMode: "plan",
          persistSession: false,
          ...(existingSessionId ? { resume: existingSessionId } : {}),
        },
      })

      for await (const msg of gen) {
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "text") {
              await stream.writeSSE({ event: "text", data: block.text })
            }
          }
        } else if (msg.type === "result") {
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({ sessionId }),
          })
          break
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        await stream.writeSSE({ event: "aborted", data: "" })
      } else {
        const message = e instanceof Error ? e.message : "unknown error"
        await stream.writeSSE({ event: "error", data: message })
      }
    } finally {
      removeSession(sessionId)
    }
  })
})

agentRoute.post("/abort", async (c) => {
  const { sessionId } = await c.req.json<{ sessionId: string }>()
  const aborted = abortSession(sessionId)
  return c.json({ aborted })
})

export { agentRoute }
