#!/usr/bin/env tsx

/**
 * Cleanup Duplicate Machines Script
 *
 * Finds and removes duplicate machine registrations (same hostname+platform+user).
 * Keeps the most recently registered/used machine and removes older duplicates.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.log('❌ Supabase not configured')
  console.log('   This script requires Supabase mode.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface Machine {
  id: string
  user_id: string
  hostname: string
  platform: string
  name: string
  registered_at: string
  last_seen_at: string
  is_connected: boolean
}

async function findDuplicates() {
  const { data: machines, error } = await supabase
    .from('registered_machines')
    .select('*')
    .eq('is_revoked', false)
    .order('registered_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch machines:', error)
    return []
  }

  if (!machines || machines.length === 0) {
    return []
  }

  // Group by hostname+platform+user
  const groups = new Map<string, Machine[]>()

  for (const machine of machines as Machine[]) {
    const key = `${machine.user_id}:${machine.hostname}:${machine.platform}`
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(machine)
  }

  // Find groups with duplicates
  const duplicates: Array<{ keep: Machine; remove: Machine[] }> = []

  for (const [, groupMachines] of groups) {
    if (groupMachines.length > 1) {
      // Sort by last_seen_at (most recent first), then registered_at
      groupMachines.sort((a, b) => {
        const lastSeenDiff = new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
        if (lastSeenDiff !== 0) return lastSeenDiff
        return new Date(b.registered_at).getTime() - new Date(a.registered_at).getTime()
      })

      // Keep the most recently used machine, remove the rest
      const [keep, ...remove] = groupMachines
      duplicates.push({ keep, remove })
    }
  }

  return duplicates
}

async function removeDuplicates() {
  console.log('🔍 Finding duplicate machines...\n')

  const duplicates = await findDuplicates()

  if (duplicates.length === 0) {
    console.log('✅ No duplicates found!\n')
    return
  }

  console.log(`Found ${duplicates.length} duplicate sets:\n`)

  let totalRemoved = 0

  for (const { keep, remove } of duplicates) {
    console.log(`📦 ${keep.hostname} (${keep.platform})`)
    console.log(`   ✓ Keeping: ${keep.id} (${keep.name})`)
    console.log(`     Last seen: ${new Date(keep.last_seen_at).toLocaleString()}`)

    for (const machine of remove) {
      console.log(`   ✗ Removing: ${machine.id} (${machine.name})`)
      console.log(`     Last seen: ${new Date(machine.last_seen_at).toLocaleString()}`)

      // Delete the duplicate
      const { error } = await supabase
        .from('registered_machines')
        .delete()
        .eq('id', machine.id)

      if (error) {
        console.error(`     ❌ Failed to delete: ${error.message}`)
      } else {
        totalRemoved++
      }
    }
    console.log('')
  }

  console.log(`✅ Removed ${totalRemoved} duplicate machines\n`)
}

removeDuplicates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
