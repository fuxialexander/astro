/**
 * Built-in Monitoring & Telegram Alerts
 *
 * Sends Telegram notifications on:
 * - Server startup/restart (with environment info)
 * - JWKS key fetch failures (auth degradation)
 * - Periodic health summary (optional, configurable)
 *
 * Configuration via environment variables:
 *   MONITOR_TELEGRAM_BOT_TOKEN  — Dedicated monitoring bot token (from @BotFather)
 *   MONITOR_TELEGRAM_CHAT_ID    — Chat ID for monitoring alerts
 *
 * Falls back to TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID if the MONITOR_ variants
 * are not set. Use separate bots to keep monitoring alerts out of user notifications.
 */

const TELEGRAM_BOT_TOKEN = process.env.MONITOR_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || ''
const TELEGRAM_CHAT_ID = process.env.MONITOR_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || ''
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

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  const timestamped = `${message}\n\n<i>${timestamp}</i>`

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: timestamped,
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
  const msg = [
    `<b>Astro Server Started</b>`,
    ``,
    `Mode: ${info.mode}`,
    `Port: ${info.port}`,
    info.connectedRunners !== undefined ? `Runners: ${info.connectedRunners}` : null,
    `Host: ${process.env.FLY_ALLOC_ID ? 'Fly.io (' + process.env.FLY_REGION + ')' : 'local'}`,
  ].filter(Boolean).join('\n')

  await sendTelegramAlert(msg)
}

/**
 * Send an alert when something is degraded or down.
 */
export async function notifyAlert(title: string, details: string): Promise<void> {
  const msg = `<b>${title}</b>\n\n${details}`
  await sendTelegramAlert(msg)
}

// --- Periodic health check (monitors external services from within the server) ---

let healthCheckInterval: ReturnType<typeof setInterval> | null = null

interface CheckResult {
  name: string
  status: 'ok' | 'down' | 'skipped'
  latencyMs?: number
  detail?: string
}

async function checkFrontend(): Promise<CheckResult> {
  const name = 'Frontend'
  if (!MONITOR_FRONTEND_URL) return { name, status: 'skipped' }
  const start = Date.now()
  try {
    const res = await fetch(MONITOR_FRONTEND_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    })
    return { name, status: res.ok ? 'ok' : 'down', latencyMs: Date.now() - start, detail: res.ok ? undefined : `HTTP ${res.status}` }
  } catch (err) {
    return { name, status: 'down', latencyMs: Date.now() - start, detail: (err as Error).message?.slice(0, 50) }
  }
}

async function checkJwks(): Promise<CheckResult> {
  const name = 'Supabase Auth'
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) return { name, status: 'skipped' }
  const start = Date.now()
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { name, status: 'down', latencyMs: Date.now() - start, detail: `HTTP ${res.status}` }
    const data = await res.json() as { keys?: unknown[] }
    return {
      name,
      status: (data.keys && data.keys.length > 0) ? 'ok' : 'down',
      latencyMs: Date.now() - start,
      detail: (data.keys && data.keys.length > 0) ? `${data.keys.length} key(s)` : 'no keys',
    }
  } catch (err) {
    return { name, status: 'down', latencyMs: Date.now() - start, detail: (err as Error).message?.slice(0, 50) }
  }
}

async function checkSupabaseDb(): Promise<CheckResult> {
  const name = 'Supabase DB'
  if (!process.env.DATABASE_URL && !process.env.SUPABASE_URL) return { name, status: 'skipped' }
  const start = Date.now()
  try {
    const { db } = await import('./db/index.js')
    const { sql } = await import('drizzle-orm')
    const result = await db.execute(sql`SELECT 1 as ok`)
    const ok = result && (Array.isArray(result) ? result.length > 0 : true)
    return { name, status: ok ? 'ok' : 'down', latencyMs: Date.now() - start }
  } catch (err) {
    return { name, status: 'down', latencyMs: Date.now() - start, detail: (err as Error).message?.slice(0, 50) }
  }
}

async function checkBackendApi(): Promise<CheckResult> {
  const name = 'Backend API'
  const start = Date.now()
  try {
    const res = await fetch('http://localhost:3001/api/health', {
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return { name, status: 'down', latencyMs: Date.now() - start, detail: `HTTP ${res.status}` }
    const data = await res.json() as { status?: string; relay?: { connectedRunners?: number } }
    return { name, status: 'ok', latencyMs: Date.now() - start, detail: `${data.relay?.connectedRunners ?? 0} runners` }
  } catch (err) {
    return { name, status: 'down', latencyMs: Date.now() - start, detail: (err as Error).message?.slice(0, 50) }
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

function checkLine(result: CheckResult): string {
  if (result.status === 'skipped') return `\u2B1C ${result.name} — skipped`
  const icon = result.status === 'ok' ? '\u2705' : '\u274C'
  const latency = result.latencyMs !== undefined ? `${result.latencyMs}ms` : ''
  const detail = result.detail ? ` (${result.detail})` : ''
  return `${icon} <b>${result.name}</b> — ${latency}${detail}`
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
  const checks = await Promise.all([
    checkBackendApi(),
    checkFrontend(),
    checkJwks(),
    checkSupabaseDb(),
  ])

  totalChecks++

  const failed = checks.filter(c => c.status === 'down')
  const allOk = failed.length === 0

  if (allOk) {
    if (consecutiveFailures >= 3) {
      const lines = [
        `\u2705 <b>Astro Recovered</b>`,
        ``,
        ...checks.map(checkLine),
      ]
      await sendTelegramAlert(lines.join('\n'))
    }
    consecutiveFailures = 0
  } else {
    consecutiveFailures++
    failedChecks++

    if (consecutiveFailures === 1 || consecutiveFailures % 12 === 0) {
      const lines = [
        `\u274C <b>Astro Health Check Failed</b>`,
        ``,
        ...checks.map(checkLine),
        ``,
        `Consecutive failures: ${consecutiveFailures}`,
      ]
      await sendTelegramAlert(lines.join('\n'))
    }
  }

  // Periodic status report every 8 hours
  if (Date.now() - lastStatusReportAt >= STATUS_REPORT_INTERVAL) {
    const uptimePct = totalChecks > 0 ? ((totalChecks - failedChecks) / totalChecks * 100).toFixed(1) : '100.0'
    const host = process.env.FLY_ALLOC_ID ? 'Fly.io (' + process.env.FLY_REGION + ')' : 'local'

    const mem = process.memoryUsage()
    const relay = await getRelayStats()
    const overallIcon = allOk ? '\u2705' : '\u274C'

    const lines = [
      `${overallIcon} <b>Astro Status Report</b>`,
      ``,
      ...checks.map(checkLine),
      ``,
      `<b>Relay</b>`,
      `  Runners: ${relay.runners} | Tasks: ${relay.activeTasks} | SSE: ${relay.sseConnections}`,
      ``,
      `<b>Server</b>`,
      `  Uptime: ${formatUptime(process.uptime())}`,
      `  Heap: ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}`,
      `  RSS: ${formatBytes(mem.rss)}`,
      `  Host: ${host}`,
      ``,
      `<b>Period (${totalChecks} checks)</b>`,
      `  Availability: ${uptimePct}% (${failedChecks} failed)`,
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
