/**
 * Built-in Monitoring & Telegram Alerts
 *
 * Sends Telegram notifications on:
 * - Server startup/restart (with environment info)
 * - JWKS key fetch failures (auth degradation)
 * - Periodic health summary (optional, configurable)
 *
 * Configuration via environment variables:
 *   TELEGRAM_BOT_TOKEN  — Bot token from @BotFather
 *   TELEGRAM_CHAT_ID    — Group chat ID for alerts
 *
 * If either variable is unset, all alert functions are silent no-ops.
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ''
const MONITOR_FRONTEND_URL = process.env.FRONTEND_URL || process.env.ASTRO_BASE_URL || ''

function isConfigured(): boolean {
  return !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID)
}

/**
 * Send a message to the configured Telegram chat.
 * Silent no-op if Telegram is not configured.
 */
export async function sendTelegramAlert(message: string): Promise<void> {
  if (!isConfigured()) return

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    })
    if (!res.ok) {
      console.warn(`[monitor] Telegram send failed: ${res.status} ${res.statusText}`)
    }
  } catch (err) {
    console.warn('[monitor] Telegram send error:', (err as Error).message)
  }
}

/**
 * Send a startup notification with server info.
 * Call this after the server is fully initialized and listening.
 */
export async function notifyServerStartup(info: {
  port: number
  mode: string
  connectedRunners?: number
}): Promise<void> {
  const time = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  const msg = [
    `<b>Astro Server Started</b>`,
    ``,
    `Mode: ${info.mode}`,
    `Port: ${info.port}`,
    info.connectedRunners !== undefined ? `Runners: ${info.connectedRunners}` : null,
    `Time: ${time}`,
    `Host: ${process.env.FLY_ALLOC_ID ? 'Fly.io (' + process.env.FLY_REGION + ')' : 'local'}`,
  ].filter(Boolean).join('\n')

  await sendTelegramAlert(msg)
}

/**
 * Send an alert when something is degraded or down.
 */
export async function notifyAlert(title: string, details: string): Promise<void> {
  const time = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  const msg = `<b>${title}</b>\n\n${details}\nTime: ${time}`
  await sendTelegramAlert(msg)
}

// --- Periodic health check (monitors external services from within the server) ---

let healthCheckInterval: ReturnType<typeof setInterval> | null = null

interface CheckResult {
  status: 'ok' | 'down' | 'skipped'
  latencyMs?: number
}

async function checkFrontend(): Promise<CheckResult> {
  if (!MONITOR_FRONTEND_URL) return { status: 'skipped' }
  const start = Date.now()
  try {
    const res = await fetch(MONITOR_FRONTEND_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    })
    return { status: res.ok ? 'ok' : 'down', latencyMs: Date.now() - start }
  } catch {
    return { status: 'down', latencyMs: Date.now() - start }
  }
}

async function checkJwks(): Promise<CheckResult> {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) return { status: 'skipped' }
  const start = Date.now()
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { status: 'down', latencyMs: Date.now() - start }
    const data = await res.json() as { keys?: unknown[] }
    return {
      status: (data.keys && data.keys.length > 0) ? 'ok' : 'down',
      latencyMs: Date.now() - start,
    }
  } catch {
    return { status: 'down', latencyMs: Date.now() - start }
  }
}

// Track consecutive failures to avoid alert storms
let consecutiveFailures = 0
// Track stats for periodic status report
let totalChecks = 0
let failedChecks = 0
let lastStatusReportAt = Date.now()
const STATUS_REPORT_INTERVAL = 8 * 60 * 60 * 1000 // 8 hours

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function statusIcon(status: string): string {
  if (status === 'ok') return 'ok'
  if (status === 'skipped') return 'skipped'
  return 'DOWN'
}

function latencyStr(result: CheckResult): string {
  if (result.status === 'skipped') return 'skipped'
  const label = statusIcon(result.status)
  return result.latencyMs !== undefined ? `${label} (${result.latencyMs}ms)` : label
}

async function getRelayStats(): Promise<{ runners: number; activeTasks: number; sseConnections: number }> {
  try {
    const { machineRegistry } = await import('./machine-registry.js')
    const { getSSEConnectionCounts } = await import('./sse-connection-tracker.js')
    const machines = machineRegistry.getAll()
    const activeTasks = machines.reduce((sum, m) => sum + m.load.activeTasks, 0)
    const sse = getSSEConnectionCounts()
    return { runners: machines.length, activeTasks, sseConnections: sse.total }
  } catch {
    return { runners: -1, activeTasks: -1, sseConnections: -1 }
  }
}

async function runHealthCheck(): Promise<void> {
  const [frontend, jwks] = await Promise.all([
    checkFrontend(),
    checkJwks(),
  ])

  totalChecks++

  const allOk = (frontend.status === 'ok' || frontend.status === 'skipped') &&
                (jwks.status === 'ok' || jwks.status === 'skipped')

  if (allOk) {
    if (consecutiveFailures >= 3) {
      await sendTelegramAlert('<b>Astro Recovered</b>\n\nAll services are back online.')
    }
    consecutiveFailures = 0
  } else {
    consecutiveFailures++
    failedChecks++

    if (consecutiveFailures === 1 || consecutiveFailures % 12 === 0) {
      const lines: string[] = ['<b>Astro Health Check Failed</b>', '']
      if (frontend.status !== 'ok' && frontend.status !== 'skipped') lines.push(`Frontend: ${latencyStr(frontend)}`)
      if (jwks.status !== 'ok' && jwks.status !== 'skipped') lines.push(`Auth (JWKS): ${latencyStr(jwks)}`)
      lines.push(`Consecutive failures: ${consecutiveFailures}`)

      await sendTelegramAlert(lines.join('\n'))
    }
  }

  // Periodic status report every 8 hours
  if (Date.now() - lastStatusReportAt >= STATUS_REPORT_INTERVAL) {
    const uptimePct = totalChecks > 0 ? ((totalChecks - failedChecks) / totalChecks * 100).toFixed(1) : '100.0'
    const time = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    const host = process.env.FLY_ALLOC_ID ? 'Fly.io (' + process.env.FLY_REGION + ')' : 'local'

    const mem = process.memoryUsage()
    const relay = await getRelayStats()

    const lines = [
      `<b>Astro Status Report</b>`,
      ``,
      `<b>Services</b>`,
      `  Frontend: ${latencyStr(frontend)}`,
      `  Auth (JWKS): ${latencyStr(jwks)}`,
      `  Status: ${consecutiveFailures === 0 ? 'All systems operational' : consecutiveFailures + ' consecutive failures'}`,
      ``,
      `<b>Relay</b>`,
      `  Connected runners: ${relay.runners}`,
      `  Active tasks: ${relay.activeTasks}`,
      `  SSE connections: ${relay.sseConnections}`,
      ``,
      `<b>Server</b>`,
      `  Process uptime: ${formatUptime(process.uptime())}`,
      `  Memory (heap): ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}`,
      `  Memory (RSS): ${formatBytes(mem.rss)}`,
      `  Host: ${host}`,
      ``,
      `<b>Period</b>`,
      `  Checks: ${uptimePct}% passed (${totalChecks - failedChecks}/${totalChecks})`,
      `  Time: ${time}`,
    ]
    await sendTelegramAlert(lines.join('\n'))
    lastStatusReportAt = Date.now()
    totalChecks = 0
    failedChecks = 0
  }
}

/**
 * Start periodic health checks.
 * Checks frontend and Supabase JWKS every 5 minutes.
 * Sends Telegram alerts on failure (with dedup to avoid alert storms).
 */
export function startHealthCheckMonitor(): void {
  if (!isConfigured()) {
    console.log('[monitor] Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set) — monitoring disabled')
    return
  }

  console.log('[monitor] Health check monitor started (every 5 min, status report every 8 hrs)')

  // Run first check after 30 seconds (let server finish startup)
  setTimeout(() => {
    runHealthCheck()
    healthCheckInterval = setInterval(runHealthCheck, 5 * 60 * 1000)
  }, 30_000)
}

/**
 * Stop periodic health checks (for graceful shutdown).
 */
export function stopHealthCheckMonitor(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval)
    healthCheckInterval = null
  }
}
