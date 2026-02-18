#!/usr/bin/env tsx

/**
 * Clear All User Data Script
 *
 * Deletes all user data from the database while preserving the schema.
 * Useful for development, testing, and demos.
 *
 * Usage:
 *   npm run clear-data              # Interactive confirmation
 *   npm run clear-data -- --force   # Skip confirmation
 */

import { createClient } from '@supabase/supabase-js'
import * as readline from 'readline'

// Load environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Check if running in Supabase mode
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.log('❌ Supabase not configured')
  console.log('   This script is for Supabase mode only.')
  console.log('   For IndexedDB mode, clear browser data manually.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Tables to clear (in order to respect foreign key constraints)
const TABLES_TO_CLEAR = [
  'plan_edges',
  'plan_nodes',
  'executions',
  'approvals',
  'activity_log',
  'projects',
  'registered_machines',
  'user_profiles',
]

async function clearAllData() {
  console.log('🧹 Clearing all user data from Supabase...\n')

  let totalDeleted = 0

  for (const table of TABLES_TO_CLEAR) {
    try {
      // Count rows before deletion
      const { count: beforeCount } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })

      if (!beforeCount || beforeCount === 0) {
        console.log(`   ⊘ ${table.padEnd(25)} (empty)`)
        continue
      }

      // Delete all rows
      const { error, count } = await supabase
        .from(table)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all (dummy condition)

      if (error) {
        console.error(`   ✗ ${table.padEnd(25)} (error: ${error.message})`)
        continue
      }

      const deletedCount = count ?? beforeCount
      totalDeleted += deletedCount
      console.log(`   ✓ ${table.padEnd(25)} (${deletedCount} rows deleted)`)
    } catch (err) {
      console.error(`   ✗ ${table.padEnd(25)} (error: ${err})`)
    }
  }

  console.log(`\n✅ Cleared ${totalDeleted} rows total`)
  console.log('   Database schema preserved, all user data removed.\n')
}

async function clearAuthUsers() {
  console.log('🔐 Clearing auth users...\n')

  try {
    // Get all users
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()

    if (listError) {
      console.log(`   ⚠️  Could not list auth users (Supabase may not be running)`)
      console.log(`      ${listError.message}\n`)
      return
    }

    if (!users || users.length === 0) {
      console.log('   ⊘ No auth users to delete\n')
      return
    }

    // Delete each user
    let deletedCount = 0
    for (const user of users) {
      const { error } = await supabase.auth.admin.deleteUser(user.id)
      if (!error) {
        deletedCount++
      }
    }

    console.log(`   ✓ Deleted ${deletedCount} auth users\n`)
  } catch {
    console.log(`   ⚠️  Could not clear auth users (Supabase may not be running)\n`)
  }
}

async function promptConfirmation(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question('⚠️  This will permanently delete ALL user data. Continue? (yes/no): ', (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'yes')
    })
  })
}

async function main() {
  const forceFlag = process.argv.includes('--force')

  console.log('\n╔════════════════════════════════════════╗')
  console.log('║  Clear All User Data                   ║')
  console.log('╚════════════════════════════════════════╝\n')

  if (!forceFlag) {
    const confirmed = await promptConfirmation()
    if (!confirmed) {
      console.log('\n❌ Cancelled\n')
      process.exit(0)
    }
    console.log('')
  }

  await clearAllData()
  await clearAuthUsers()

  console.log('✨ Done!\n')
  process.exit(0)
}

main().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})
