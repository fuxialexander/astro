#!/usr/bin/env tsx

/**
 * ============================================================================
 * Sync Feature Flags for Internal Teams
 * ============================================================================
 *
 * PURPOSE:
 *   Astro uses team-level feature flags to hide unreleased features from
 *   external users while internal developers can see and test them. This
 *   script writes the flag overrides to the database for internal teams.
 *
 *   External teams have no overrides, so they fall back to GLOBAL_DEFAULTS
 *   (which default to false for unreleased features). Internal teams get
 *   explicit overrides set by this script.
 *
 *   Safe to run repeatedly — it always produces the same result (idempotent).
 *
 * ============================================================================
 * HOW THE FEATURE FLAG SYSTEM WORKS
 * ============================================================================
 *
 *   The flag check (both frontend and backend) uses this priority:
 *
 *     team.feature_flags[flag]  >  GLOBAL_DEFAULTS[flag]  >  false
 *
 *   - team.feature_flags: JSONB column on the `teams` table in the DB.
 *     Written by this script (or raw SQL). Not editable by users — the
 *     RLS policy prevents teams from modifying their own flags.
 *
 *   - GLOBAL_DEFAULTS: Hardcoded in two files (must stay in sync):
 *       Frontend:  src/hooks/use-feature-flag.ts
 *       Backend:   server/lib/feature-flags.ts
 *     These are the fallback when a team has no override for a flag.
 *
 *   - false: If a flag isn't in GLOBAL_DEFAULTS either, it's off.
 *
 *   Frontend hook:  useFeatureFlag('my-feature')  → boolean
 *   Backend check:  hasFeature(teamId, 'my-feature')  → boolean
 *
 * ============================================================================
 * COMMANDS
 * ============================================================================
 *
 *   # Enable all internal flags on internal teams (the normal deploy step):
 *   npx tsx scripts/sync-feature-flags.ts
 *
 *   # Preview what would change without writing to DB:
 *   npx tsx scripts/sync-feature-flags.ts --dry-run
 *
 *   # Show every team and their current flags (read-only):
 *   npx tsx scripts/sync-feature-flags.ts --status
 *
 * ============================================================================
 * ENVIRONMENT
 * ============================================================================
 *
 *   This script connects to whatever database your current .env points to.
 *   Make sure you're in the right environment before running:
 *
 *   Local mode (PGlite):
 *     npm run env:local
 *     npx tsx scripts/sync-feature-flags.ts
 *
 *   Production (remote Supabase):
 *     npm run env:prod
 *     npx tsx scripts/sync-feature-flags.ts
 *
 *   You can verify which env you're targeting:
 *     npm run env:switch    # prints current mode
 *
 *   IMPORTANT: The feature_flags column must exist. If you get
 *   "feature_flags column does not exist", run migrations first:
 *     - Local:  start the server once (npm run dev:local)
 *     - Prod:   supabase db push
 *
 * ============================================================================
 * COOKBOOK: FULL FEATURE LIFECYCLE
 * ============================================================================
 *
 * --- Step 1: Build a new feature behind a flag ---
 *
 *   a) Pick a flag name (kebab-case): e.g. 'my-new-feature'
 *
 *   b) Register the flag in GLOBAL_DEFAULTS (set to false in both files):
 *        src/hooks/use-feature-flag.ts:
 *          const GLOBAL_DEFAULTS = { ..., 'my-new-feature': false }
 *        server/lib/feature-flags.ts:
 *          const GLOBAL_DEFAULTS = { ..., 'my-new-feature': false }
 *
 *   c) Gate your code:
 *        Frontend route:   <FeatureFlagRoute flag="my-new-feature">...</FeatureFlagRoute>
 *        Frontend hook:    if (!useFeatureFlag('my-new-feature')) return null
 *        Sidebar item:     { ..., featureFlag: 'my-new-feature' }
 *        API route:        if (!hasFeature(teamId, 'my-new-feature')) return 404
 *        Dashboard widget: {enabled && <MyWidget />}
 *
 *   d) Add the flag to INTERNAL_FLAGS below (set to true):
 *        const INTERNAL_FLAGS = { ..., 'my-new-feature': true }
 *
 *   e) Merge to main and deploy. External users see nothing.
 *
 * --- Step 2: Enable for internal testing ---
 *
 *   After deploying, run this script against production:
 *
 *     npm run env:prod
 *     npx tsx scripts/sync-feature-flags.ts
 *
 *   Your internal teams now see the feature. External teams don't.
 *   Run --status to verify:
 *
 *     npx tsx scripts/sync-feature-flags.ts --status
 *
 * --- Step 3: Release to everyone (GA) ---
 *
 *   When the feature is ready for all users:
 *
 *   a) Flip GLOBAL_DEFAULTS to true (both files):
 *        'my-new-feature': true
 *
 *   b) Remove from INTERNAL_FLAGS below (no longer needed):
 *        delete the 'my-new-feature': true line
 *
 *   c) Run this script to clean up internal team records:
 *        npx tsx scripts/sync-feature-flags.ts
 *
 *   d) Deploy. Everyone sees the feature now.
 *
 * --- Step 4: Cleanup (optional, after GA is stable) ---
 *
 *   Remove the flag checks from code entirely:
 *   - Remove useFeatureFlag('my-new-feature') checks
 *   - Remove FeatureFlagRoute wrappers
 *   - Remove featureFlag from sidebar items
 *   - Remove hasFeature() checks from API routes
 *   - Remove from GLOBAL_DEFAULTS (both files)
 *
 * --- Emergency: Kill a feature instantly ---
 *
 *   If a released feature is broken:
 *
 *   a) Set GLOBAL_DEFAULTS to false (both files)
 *   b) Deploy. Feature is hidden for everyone immediately.
 *   No database changes needed — the code default wins when there's
 *   no team override, and external teams have no overrides.
 *
 * ============================================================================
 * ADDING A NEW INTERNAL TEAM
 * ============================================================================
 *
 *   Add the team name (exact, case-sensitive) to the INTERNAL_TEAMS array
 *   below, then run this script. The team must already exist in the database.
 *   You can find team names with: --status
 *
 * ============================================================================
 */

import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'

// Load environment variables from .env.local (symlinked to .env.prod or .env.local.dev).
// We do this before any imports that depend on env vars (like initDb/isLocalMode).
const envFile = resolve(import.meta.dirname ?? '.', '..', '.env.local')
try {
  const resolved = realpathSync(envFile)
  const envName = resolved.endsWith('.env.prod') ? 'prod' : resolved.endsWith('.env.local.dev') ? 'dev' : 'local'
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
  console.log(`Environment: ${envName} (from ${resolved})`)
} catch {
  console.log('Environment: local (no .env.local found — using PGlite)')
}

import { initDb, db } from '../packages/core/src/db/index.js'
import { teams } from '../packages/core/src/db/schema.js'
import { eq, inArray, sql } from 'drizzle-orm'

// ─── Configuration ───────────────────────────────────────────────────
// Edit these two sections when adding features or internal teams.

/**
 * Names of teams that should see all unreleased features.
 * These are matched by team name (case-sensitive).
 */
const INTERNAL_TEAMS: string[] = [
  'Local',                // local-mode default team
  "Xi Fu's workspace",    // co-founder (production)
  "Zhuoran's workspace",  // co-founder (production)
]

/**
 * Feature flags to enable on internal teams.
 * Every flag here should exist in GLOBAL_DEFAULTS (server + frontend)
 * with a default of false. When you release a feature (set global
 * default to true), remove it from here.
 */
const INTERNAL_FLAGS: Record<string, boolean> = {
  'github-integration': true,
  'webhook-automation': true,
  'loop-nodes': true,

  'delivery-branches': true,
}

// ─── Script logic ────────────────────────────────────────────────────

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const statusOnly = args.includes('--status')

async function main() {
  await initDb()

  // Verify the feature_flags column exists before proceeding
  try {
    await db.execute(sql`SELECT feature_flags FROM teams LIMIT 0`)
  } catch {
    console.error(
      'ERROR: The feature_flags column does not exist on the teams table.\n' +
      '\n' +
      'You need to run migrations first:\n' +
      '  - Local mode:  start the server once (npm run dev:local) to run PGlite migrations\n' +
      '  - Production:  apply the Supabase migration (supabase db push)\n',
    )
    process.exit(1)
  }

  if (statusOnly) {
    await showStatus()
    return
  }

  await syncFlags()
}

async function showStatus() {
  const allTeams = await db.select({
    id: teams.id,
    name: teams.name,
    featureFlags: teams.featureFlags,
  }).from(teams)

  if (allTeams.length === 0) {
    console.log('No teams found in database.')
    return
  }

  console.log('\nAll teams and their feature flags:\n')
  console.log('  %-40s %-12s %s', 'TEAM NAME', 'INTERNAL?', 'FLAGS')
  console.log('  ' + '-'.repeat(70))

  for (const team of allTeams) {
    const isInternal = INTERNAL_TEAMS.includes(team.name)
    const flags = team.featureFlags ?? {}
    const flagStr = Object.keys(flags).length > 0
      ? Object.entries(flags).map(([k, v]) => `${k}=${v}`).join(', ')
      : '(none)'
    console.log(
      '  %-40s %-12s %s',
      team.name,
      isInternal ? 'YES' : 'no',
      flagStr,
    )
  }

  console.log('\nInternal flags config:', JSON.stringify(INTERNAL_FLAGS))
  console.log('')
}

async function syncFlags() {
  if (INTERNAL_TEAMS.length === 0) {
    console.log('No internal teams configured. Edit INTERNAL_TEAMS in this script.')
    process.exit(1)
  }

  console.log(`\nSyncing feature flags for ${INTERNAL_TEAMS.length} internal team(s)...`)
  console.log(`  Teams: ${INTERNAL_TEAMS.join(', ')}`)
  console.log(`  Flags: ${JSON.stringify(INTERNAL_FLAGS)}`)
  if (dryRun) console.log('  (dry run — no changes will be made)\n')
  else console.log('')

  // Find the teams by name
  const matchedTeams = await db.select({
    id: teams.id,
    name: teams.name,
    featureFlags: teams.featureFlags,
  }).from(teams).where(inArray(teams.name, INTERNAL_TEAMS))

  // Report any teams not found
  const foundNames = new Set(matchedTeams.map(t => t.name))
  const missingNames = INTERNAL_TEAMS.filter(n => !foundNames.has(n))
  if (missingNames.length > 0) {
    console.log(`  WARNING: These teams were not found in the database:`)
    for (const name of missingNames) {
      console.log(`    - "${name}"`)
    }
    console.log('')
  }

  if (matchedTeams.length === 0) {
    console.log('  No matching teams found. Nothing to do.')
    process.exit(0)
  }

  // Update each team
  let updated = 0
  let skipped = 0

  for (const team of matchedTeams) {
    const currentFlags = team.featureFlags ?? {}
    const currentKeys = Object.keys(currentFlags).sort()
    const targetKeys = Object.keys(INTERNAL_FLAGS).sort()
    const needsUpdate = currentKeys.length !== targetKeys.length
      || currentKeys.some((k, i) => k !== targetKeys[i])
      || targetKeys.some(k => currentFlags[k] !== INTERNAL_FLAGS[k])

    if (!needsUpdate) {
      console.log(`  [skip] "${team.name}" — already up to date`)
      skipped++
      continue
    }

    // Show what changed
    const added = Object.keys(INTERNAL_FLAGS).filter(k => !(k in currentFlags) || currentFlags[k] !== INTERNAL_FLAGS[k])
    const removed = Object.keys(currentFlags).filter(k => !(k in INTERNAL_FLAGS))

    if (added.length > 0) console.log(`  [set]  "${team.name}" — enabling: ${added.join(', ')}`)
    if (removed.length > 0) console.log(`  [set]  "${team.name}" — removing: ${removed.join(', ')}`)
    if (added.length === 0 && removed.length === 0) console.log(`  [set]  "${team.name}" — updating flag values`)

    if (!dryRun) {
      await db.update(teams)
        .set({ featureFlags: INTERNAL_FLAGS })
        .where(eq(teams.id, team.id))
    }

    updated++
  }

  console.log(`\nDone. ${updated} team(s) updated, ${skipped} already up to date.`)
  if (dryRun && updated > 0) {
    console.log('  (This was a dry run. Run without --dry-run to apply changes.)')
  }
}

main().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
