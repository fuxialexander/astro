#!/usr/bin/env node
/**
 * Test WebSocket Relay Connection
 *
 * Usage: node scripts/test-relay-connection.js
 */

import WebSocket from 'ws';
import fs from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Read config
const configPath = join(homedir(), 'Library/Preferences/astro-agent-nodejs/config.json');
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (err) {
  console.error('❌ Failed to read config:', configPath);
  console.error(err.message);
  process.exit(1);
}

console.log('🔗 Testing Relay Connection\n');
console.log('Config:', configPath);
console.log('Relay URL:', config.relayUrl);
console.log('Machine ID:', config.machineId);
console.log('User ID from token:', extractUserId(config.wsToken));
console.log('');

// Test connection
const url = new URL('/ws', config.relayUrl);
const headers = {
  'Authorization': `Bearer ${config.wsToken}`,
};

console.log('Connecting to:', url.href);
console.log('');

const ws = new WebSocket(url.href, { headers });

ws.on('open', () => {
  console.log('✅ WebSocket CONNECTED!\n');

  // Send registration message
  const registerMsg = {
    type: 'register',
    timestamp: new Date().toISOString(),
    payload: {
      runnerId: config.runnerId,
      machineId: config.machineId,
      environmentType: config.environmentType || 'remote',
      version: '0.1.0',
      providers: [],
      resources: {
        hostname: 'test-cli',
        platform: 'darwin',
        arch: 'arm64',
        cpu: { model: 'test', cores: 1, speed: 2400, loadAvg: [0, 0, 0] },
        memory: { total: 1000000, free: 500000, used: 500000, usedPercent: 50 },
        gpu: [],
      },
    },
  };

  console.log('📤 Sending registration message...\n');
  ws.send(JSON.stringify(registerMsg));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📥 Received message:', msg.type);
  console.log(JSON.stringify(msg, null, 2));
  console.log('');

  if (msg.type === 'registered') {
    console.log('✅ REGISTRATION SUCCESSFUL!\n');
    console.log('🎉 Relay connection is working correctly!\n');
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket ERROR:', err.message);
  if (err.message.includes('401')) {
    console.error('\n💡 This is a JWT verification error.');
    console.error('   Make sure:');
    console.error('   1. Backend is running with RELAY_JWT_SECRET set');
    console.error('   2. RELAY_JWT_SECRET = DEVICE_AUTH_JWT_SECRET');
    console.error('   3. Backend was restarted after setting the secret\n');
  }
  process.exit(1);
});

ws.on('close', (code, reason) => {
  if (code !== 1000) {
    console.log('❌ WebSocket CLOSED:', code, reason.toString());
    process.exit(1);
  }
});

// Helper to extract userId from JWT
function extractUserId(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64'));
    return payload.userId;
  } catch {
    return 'unknown';
  }
}
