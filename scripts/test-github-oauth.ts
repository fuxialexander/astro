/**
 * GitHub OAuth Integration Test Script
 *
 * This script tests the GitHub OAuth flow by simulating:
 * 1. Status check
 * 2. OAuth initiation
 * 3. Manual OAuth completion (opens browser)
 *
 * Run with: npx tsx scripts/test-github-oauth.ts
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const API_BASE = 'http://localhost:3001/api/github';

async function testGitHubOAuth() {
  console.log('🧪 Testing GitHub OAuth Integration\n');

  try {
    // Test 1: Check Status
    console.log('1️⃣ Checking GitHub connection status...');
    const statusRes = await fetch(`${API_BASE}/status`);
    const status = await statusRes.json();
    console.log('   Status:', status.connected ? '✅ Connected' : '❌ Not connected');
    if (status.user) {
      console.log('   User:', status.user.login);
    }
    console.log();

    // Test 2: Initiate OAuth
    console.log('2️⃣ Initiating OAuth flow...');
    const connectRes = await fetch(`${API_BASE}/connect`, { method: 'POST' });
    const connectData = await connectRes.json();

    if (!connectData.authUrl) {
      throw new Error('Failed to get OAuth URL');
    }

    console.log('   ✅ OAuth URL generated');
    console.log('   URL:', connectData.authUrl.substring(0, 100) + '...');
    console.log();

    // Test 3: Open browser for manual OAuth
    console.log('3️⃣ Opening browser for OAuth authorization...');
    console.log('   🌐 Please authorize in the browser window');
    console.log('   📝 After authorization, you will be redirected back');
    console.log();

    try {
      // Open browser (macOS)
      await execAsync(`open "${connectData.authUrl}"`);
      console.log('   ✅ Browser opened');
    } catch {
      console.log('   ⚠️  Could not auto-open browser');
      console.log('   Please manually open:', connectData.authUrl);
    }

    console.log();
    console.log('⏳ Waiting for OAuth callback...');
    console.log('   After you authorize, check the status again with:');
    console.log('   curl http://localhost:3001/api/github/status');
    console.log();
    console.log('   Or test repository fetching with:');
    console.log('   curl http://localhost:3001/api/github/repos');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
testGitHubOAuth();
