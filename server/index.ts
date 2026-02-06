import { Hono } from "hono"
import { cors } from "hono/cors"
import { serve } from "@hono/node-server"
import { healthRoute } from "./routes/health.js"
import { agentRoute } from "./routes/agent.js"

const app = new Hono()

app.use("/*", cors({ origin: "http://localhost:5173" }))

app.route("/api", healthRoute)
app.route("/api/agent", agentRoute)

const port = 3001
console.log(`[backend] listening on http://localhost:${port}`)
serve({ fetch: app.fetch, port })
