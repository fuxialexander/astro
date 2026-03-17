#!/usr/bin/env tsx
/**
 * Verify that event transport hooks are disabled in test mode
 */

import { astroEventTransport } from '../server/lib/events/astro-event-transport.js'

console.log('\n=== Verifying Event Transport Test Mode Behavior ===\n')

// Check current state
console.log('1. Current state:')
console.log(`   - Enabled: ${astroEventTransport.isEnabled()}`)
console.log(`   - Registered hooks: ${astroEventTransport.listHooks().length}`)
console.log(`   - Hook names: [${astroEventTransport.listHooks().join(', ')}]`)
console.log(`   - NODE_ENV: ${process.env.NODE_ENV}`)

// Test setEnabled behavior
console.log('\n2. Testing setEnabled(false):')
astroEventTransport.setEnabled(false)
console.log(`   - Enabled after setEnabled(false): ${astroEventTransport.isEnabled()}`)

console.log('\n3. Testing setEnabled(true):')
astroEventTransport.setEnabled(true)
console.log(`   - Enabled after setEnabled(true): ${astroEventTransport.isEnabled()}`)

// Verify test mode detection
console.log('\n4. Test mode detection:')
if (process.env.NODE_ENV === 'test') {
  console.log('   ✓ Running in TEST mode')
  if (astroEventTransport.listHooks().length === 0) {
    console.log('   ✓ No hooks registered (expected in test mode)')
  } else {
    console.log('   ✗ UNEXPECTED: Hooks registered in test mode!')
    console.log(`     Hooks: ${astroEventTransport.listHooks().join(', ')}`)
  }
  if (!astroEventTransport.isEnabled()) {
    console.log('   ✓ Transport is disabled (expected in test mode)')
  } else {
    console.log('   ✗ UNEXPECTED: Transport is enabled in test mode!')
  }
} else {
  console.log('   ✓ Running in NORMAL mode')
  if (astroEventTransport.listHooks().length > 0) {
    console.log(`   ✓ ${astroEventTransport.listHooks().length} hooks registered (expected in normal mode)`)
    console.log(`     Hooks: ${astroEventTransport.listHooks().join(', ')}`)
  } else {
    console.log('   ⚠️  No hooks registered (hooks may not be registered yet)')
  }
}

console.log('\n=== Verification Complete ===\n')
