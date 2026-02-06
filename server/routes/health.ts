import { Hono } from "hono"
import { query } from "@anthropic-ai/claude-agent-sdk"

const healthRoute = new Hono()

healthRoute.get("/health", async (c) => {
  try {
    const abortController = new AbortController()
    // Use a minimal prompt to check auth — immediately abort after init
    const gen = query({
      prompt: "respond with ok",
      options: {
        abortController,
        maxTurns: 1,
        permissionMode: "plan",
        tools: [],
        persistSession: false,
      },
    })

    let model = "unknown"
    let authenticated = false

    for await (const msg of gen) {
      if (msg.type === "system" && msg.subtype === "init") {
        model = msg.model
        authenticated = true
        abortController.abort()
        break
      }
      if (msg.type === "result") {
        authenticated = true
        break
      }
    }

    return c.json({ status: "ok", authenticated, model })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown error"
    // If auth fails, still return ok but unauthenticated
    if (message.includes("auth") || message.includes("login")) {
      return c.json({ status: "ok", authenticated: false, model: null })
    }
    return c.json({ status: "error", authenticated: false, error: message }, 500)
  }
})

export { healthRoute }
