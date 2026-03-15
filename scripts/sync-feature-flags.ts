#!/usr/bin/env tsx

/**
 * Sync Feature Flags for Internal Teams
 *
 * This script sets feature flags on internal teams so they can see
 * unreleased features. Safe to run repeatedly — it always produces
 * the same result (idempotent).
 *
 * Usage:
 *   npx tsx scripts/sync-feature-flags.ts           # sync flags
 *   npx tsx scripts/sync-feature-flags.ts --dry-run  # show what would change
 *   npx tsx scripts/sync-feature-flags.ts --status    # show current flags
 *
 * How it works:
 *   1. Reads the INTERNAL_TEAMS and INTERNAL_FLAGS config below
 *   2. Finds those teams in the database (by name)
 *   3. Sets their feature_flags to exactly INTERNAL_FLAGS
 *   4. Reports what changed
 *
 * To add a new feature flag:
 *   1. Add it to GLOBAL_DEFAULTS in server/lib/feature-flags.ts (set to false)
 *   2. Add it to GLOBAL_DEFAULTS in src/hooks/use-feature-flag.ts (set to false)
 *   3. Add it to INTERNAL_FLAGS below (set to true)
 *   4. Run this script
 *
 * To release a feature to everyone:
 *   1. Change its GLOBAL_DEFAULTS value to true (both files)
 *   2. Remove it from INTERNAL_FLAGS below (no longer needed)
 *   3. Run this script to clean up internal team records
 */

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
  'Local',           // local-mode default team
  // Add your production team names here, e.g.:
  // 'Astro Core',
  // 'Alex Lab',
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
