/**
 * HIPAA Mode — startup configuration assertions.
 *
 * HIPAA deployments run as a dedicated process with ASTRO_HIPAA_MODE=true,
 * targeted at a single covered-entity customer. This module enforces the
 * deployment-level invariants at boot: required env vars must be present,
 * and forbidden vendors must be absent. Failure aborts startup.
 *
 * See docs: /Users/xf2217/.claude/plans/make-a-plan-for-golden-shamir.md
 */

import { isHipaaMode } from './app-mode.js'

export { isHipaaMode }

/** Env vars that must be set when running in HIPAA mode. */
const REQUIRED_HIPAA_ENV_VARS = [
  'ASTRO_ENCRYPTION_KEY',    // envelope-encryption master key (Phase 0/4)
  'AWS_REGION',              // Bedrock + KMS + S3 region
  'S3_AUDIT_BUCKET',         // WORM audit log export target (Phase 5)
  'RELAY_JWT_SECRET',        // hardened X-Internal-Dispatch secret
]

/** Env vars that must NOT be set when running in HIPAA mode. */
const FORBIDDEN_HIPAA_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'FLY_APP_NAME',
  // Cloudflare credentials that grant access to non-AWS vendors. We use an
  // explicit allowlist (not a CLOUDFLARE_* prefix scan) so legitimate SaaS
  // identifiers like CLOUDFLARE_PAGES_PROJECT or CLOUDFLARE_ACCOUNT_ID don't
  // trip the check.
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CLOUDFLARE_TUNNEL_TOKEN',
  'CLOUDFLARED_DOMAIN',
  'CLOUDFLARED_TOKEN',
]

/**
 * Assert HIPAA startup config is correct. If not, print a descriptive error
 * and call process.exit(1).
 *
 * No-op when ASTRO_HIPAA_MODE is not set.
 */
export function assertHipaaStartupConfig(): void {
  if (!isHipaaMode()) return

  const errors: string[] = []

  for (const name of REQUIRED_HIPAA_ENV_VARS) {
    if (!process.env[name]) {
      errors.push(`HIPAA mode requires env var ${name} but it is missing or empty.`)
    }
  }

  // Claude Code must route through Bedrock (the Anthropic-via-Bedrock path is covered by the AWS BAA).
  if (process.env.CLAUDE_CODE_USE_BEDROCK !== '1') {
    errors.push(
      `HIPAA mode requires CLAUDE_CODE_USE_BEDROCK=1 (got ${JSON.stringify(process.env.CLAUDE_CODE_USE_BEDROCK ?? '')}). ` +
        `Bedrock routing is required so AI calls stay inside the AWS BAA boundary.`,
    )
  }

  for (const name of FORBIDDEN_HIPAA_ENV_VARS) {
    if (process.env[name]) {
      errors.push(
        `HIPAA mode forbids env var ${name} (detected non-empty value). ` +
          `HIPAA deployments must not reach non-AWS vendors.`,
      )
    }
  }

  if (errors.length > 0) {
    console.error('❌ HIPAA startup configuration failed:')
    for (const err of errors) {
      console.error(`   - ${err}`)
    }
    // Hard fail — never fall back to a degraded mode in HIPAA.
    throw new Error(
      `HIPAA startup configuration failed (${errors.length} error(s)). Aborting boot.`,
    )
  }

  console.log('[hipaa] ✅ HIPAA startup configuration OK')
}
