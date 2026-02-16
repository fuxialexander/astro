#!/usr/bin/env tsx
/**
 * Verify that event transport hooks are disabled in test mode
 */

import { nexusEventTransport } from '../server/lib/events/nexus-event-transport.js'

console.log('\n=== Verifying Event Transport Test Mode Behavior ===\n')

// Check current state
console.log('1. Current state:')
console.log(`   - Enabled: ${nexusEventTransport.isEnabled()}`)
console.log(`   - Registered hooks: ${nexusEventTransport.listHooks().length}`)
console.log(`   - Hook names: [${nexusEventTransport.listHooks().join(', ')}]`)
console.log(`   - NODE_ENV: ${process.env.NODE_ENV}`)

// Test setEnabled behavior
console.log('\n2. Testing setEnabled(false):')
nexusEventTransport.setEnabled(false)
console.log(`   - Enabled after setEnabled(false): ${nexusEventTransport.isEnabled()}`)

console.log('\n3. Testing setEnabled(true):')
nexusEventTransport.setEnabled(true)
console.log(`   - Enabled after setEnabled(true): ${nexusEventTransport.isEnabled()}`)

// Verify test mode detection
console.log('\n4. Test mode detection:')
if (process.env.NODE_ENV === 'test') {
  console.log('   ✓ Running in TEST mode')
  if (nexusEventTransport.listHooks().length === 0) {
    console.log('   ✓ No hooks registered (expected in test mode)')
  } else {
    console.log('   ✗ UNEXPECTED: Hooks registered in test mode!')
    console.log(`     Hooks: ${nexusEventTransport.listHooks().join(', ')}`)
  }
  if (!nexusEventTransport.isEnabled()) {
    console.log('   ✓ Transport is disabled (expected in test mode)')
  } else {
    console.log('   ✗ UNEXPECTED: Transport is enabled in test mode!')
  }
} else {
  console.log('   ✓ Running in NORMAL mode')
  if (nexusEventTransport.listHooks().length > 0) {
    console.log(`   ✓ ${nexusEventTransport.listHooks().length} hooks registered (expected in normal mode)`)
    console.log(`     Hooks: ${nexusEventTransport.listHooks().join(', ')}`)
  } else {
    console.log('   ⚠️  No hooks registered (hooks may not be registered yet)')
  }
}

console.log('\n=== Verification Complete ===\n')
