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

async function checkFrontend(): Promise<'ok' | 'down' | 'skipped'> {
  if (!MONITOR_FRONTEND_URL) return 'skipped'
  try {
    const res = await fetch(MONITOR_FRONTEND_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok ? 'ok' : 'down'
  } catch {
    return 'down'
  }
}

async function checkJwks(): Promise<'ok' | 'down' | 'skipped'> {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) return 'skipped'
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return 'down'
    const data = await res.json() as { keys?: unknown[] }
    return (data.keys && data.keys.length > 0) ? 'ok' : 'down'
  } catch {
    return 'down'
  }
}

// Track consecutive failures to avoid alert storms
let consecutiveFailures = 0
// Track stats for periodic status report
let totalChecks = 0
let failedChecks = 0
let lastStatusReportAt = Date.now()
const STATUS_REPORT_INTERVAL = 8 * 60 * 60 * 1000 // 8 hours

async function runHealthCheck(): Promise<void> {
  const [frontend, jwks] = await Promise.all([
    checkFrontend(),
    checkJwks(),
  ])

  totalChecks++

  const allOk = (frontend === 'ok' || frontend === 'skipped') &&
                (jwks === 'ok' || jwks === 'skipped')

  if (allOk) {
    // If we were in a failure state and it recovered, send recovery notification
    if (consecutiveFailures >= 3) {
      await sendTelegramAlert('<b>Astro Recovered</b>\n\nAll services are back online.')
    }
    consecutiveFailures = 0
  } else {
    consecutiveFailures++
    failedChecks++

    // Only alert on 1st failure and every 12th failure (once per hour at 5-min interval)
    if (consecutiveFailures === 1 || consecutiveFailures % 12 === 0) {
      const lines: string[] = ['<b>Astro Health Check Failed</b>', '']
      if (frontend !== 'ok' && frontend !== 'skipped') lines.push(`Frontend: ${frontend}`)
      if (jwks !== 'ok' && jwks !== 'skipped') lines.push(`Auth (JWKS): ${jwks}`)
      lines.push(`Consecutive failures: ${consecutiveFailures}`)

      await sendTelegramAlert(lines.join('\n'))
    }
  }

  // Periodic status report every 8 hours
  if (Date.now() - lastStatusReportAt >= STATUS_REPORT_INTERVAL) {
    const uptime = totalChecks > 0 ? ((totalChecks - failedChecks) / totalChecks * 100).toFixed(1) : '100.0'
    const time = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    const host = process.env.FLY_ALLOC_ID ? 'Fly.io (' + process.env.FLY_REGION + ')' : 'local'
    const lines = [
      '<b>Astro Status Report</b>',
      '',
      `Status: ${consecutiveFailures === 0 ? 'All systems operational' : consecutiveFailures + ' consecutive failures'}`,
      `Frontend: ${frontend}`,
      `Auth (JWKS): ${jwks}`,
      `Uptime: ${uptime}% (${totalChecks - failedChecks}/${totalChecks} checks passed)`,
      `Host: ${host}`,
      `Time: ${time}`,
    ]
    await sendTelegramAlert(lines.join('\n'))
    lastStatusReportAt = Date.now()
    // Reset counters for next reporting period
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
