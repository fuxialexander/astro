#!/bin/bash
# Test token validation in agent runner config

set -e

echo "Testing Agent Runner Token Validation"
echo "======================================"
echo ""

cd packages/agent-runner

# Test 1: Reject string "null"
echo "Test 1: Should reject wsToken='null'"
node -e "
const { config } = require('./dist/lib/config.js');
config.setWsToken('null');
const token = config.getWsToken();
if (token === undefined) {
  console.log('✓ PASS: String \"null\" was rejected');
  process.exit(0);
} else {
  console.log('✗ FAIL: String \"null\" was accepted:', token);
  process.exit(1);
}
"

# Test 2: Reject empty string
echo "Test 2: Should reject wsToken=''"
node -e "
const { config } = require('./dist/lib/config.js');
config.setWsToken('');
const token = config.getWsToken();
if (token === undefined) {
  console.log('✓ PASS: Empty string was rejected');
  process.exit(0);
} else {
  console.log('✗ FAIL: Empty string was accepted:', token);
  process.exit(1);
}
"

# Test 3: Reject invalid JWT format
echo "Test 3: Should reject invalid JWT format"
node -e "
const { config } = require('./dist/lib/config.js');
config.setWsToken('not-a-valid-jwt');
const token = config.getWsToken();
if (token === undefined) {
  console.log('✓ PASS: Invalid JWT format was rejected');
  process.exit(0);
} else {
  console.log('✗ FAIL: Invalid JWT was accepted:', token);
  process.exit(1);
}
"

# Test 4: Accept valid JWT format
echo "Test 4: Should accept valid JWT format"
node -e "
const { config } = require('./dist/lib/config.js');
const validJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
config.setWsToken(validJwt);
const token = config.getWsToken();
if (token === validJwt) {
  console.log('✓ PASS: Valid JWT was accepted');
  process.exit(0);
} else {
  console.log('✗ FAIL: Valid JWT was rejected');
  process.exit(1);
}
"

# Test 5: Machine ID validation
echo "Test 5: Should reject machineId='null'"
node -e "
const { config } = require('./dist/lib/config.js');
config.setMachineId('null');
const id = config.getMachineId();
// getMachineId auto-generates if not set, so check it's not 'null'
if (id !== 'null' && id !== null && id !== undefined && id !== '') {
  console.log('✓ PASS: String \"null\" was rejected, auto-generated ID:', id.substring(0, 20));
  process.exit(0);
} else {
  console.log('✗ FAIL: String \"null\" was accepted as machine ID:', id);
  process.exit(1);
}
"

echo ""
echo "======================================"
echo "All validation tests passed!"
echo "======================================"
