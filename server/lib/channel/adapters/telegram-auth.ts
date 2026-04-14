/**
 * Telegram Authorization
 *
 * Callback-button allowlist gating for incoming Telegram messages. The
 * allowlist can be sourced from the `TELEGRAM_ALLOWED_USERS` env var (CSV)
 * and/or per-connected-account settings. A literal "*" entry means "allow
 * all" — useful for development or for single-tenant deployments where
 * the bot token itself is the security boundary.
 *
 * Pure module — no side effects, no external dependencies.
 */

export interface AllowlistConfig {
  /** Values parsed from the TELEGRAM_ALLOWED_USERS env var (CSV). */
  envAllowlist: string[]
  /** Optional per-account override from connectedAccounts.settings.allowlistUsers. */
  accountAllowlist?: string[]
}

/** Split a CSV string, trim entries, and drop empty strings. */
function parseCsv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Parse the TELEGRAM_ALLOWED_USERS env var (CSV) and merge with an optional
 * per-account allowlist override. Both lists are returned separately so
 * callers can distinguish the source of a match if needed.
 */
export function parseAllowlist(
  envValue: string | undefined,
  accountAllowlist?: string[],
): AllowlistConfig {
  const envAllowlist = parseCsv(envValue)
  const accountCleaned = accountAllowlist
    ?.map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0)
  return {
    envAllowlist,
    accountAllowlist: accountCleaned && accountCleaned.length > 0 ? accountCleaned : undefined,
  }
}

/**
 * Check whether a Telegram user ID is allowed.
 *
 * Rules:
 * - If BOTH lists are empty/unset → allow all (opt-in restrictive).
 * - If either list contains "*" → allow all.
 * - Otherwise, allow iff the userId (as a string) appears in either list.
 * - A null/undefined userId is denied unless one of the lists is wildcard
 *   or both lists are empty.
 */
export function isUserAllowed(
  userId: string | number | null | undefined,
  cfg: AllowlistConfig,
): boolean {
  const env = cfg.envAllowlist ?? []
  const acct = cfg.accountAllowlist ?? []

  // Both empty → unrestricted (opt-in restrictive model).
  if (env.length === 0 && acct.length === 0) return true

  // Wildcard in either list → allow all.
  if (env.includes('*') || acct.includes('*')) return true

  if (userId === null || userId === undefined) return false
  const id = String(userId).trim()
  if (id.length === 0) return false

  return env.includes(id) || acct.includes(id)
}
