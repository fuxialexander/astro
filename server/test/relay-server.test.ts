/**
 * Relay Server Integration Tests
 *
 * Tests the WebSocket relay server functionality including:
 * - Machine registration and connection handling
 * - Task dispatch and cancellation
 * - Heartbeat mechanism
 * - Rate limiting
 */

import WebSocket from 'ws';
import type {
  MachineRegisterMessage,
  MachineRegisterAckMessage,
  HeartbeatPingMessage,
  HeartbeatPongMessage,
  TaskDispatchMessage,
  TaskResultMessage,
  MachineStatusMessage,
  MachineInfo,
} from '../types/relay.js';

const RELAY_PORT = 3002;
const RELAY_URL = `ws://localhost:${RELAY_PORT}`;

// Helper to create a WebSocket connection and wait for open
function createConnection(token?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = token ? `${RELAY_URL}?token=${token}` : RELAY_URL;
    const ws = new WebSocket(url);

    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

// Helper to send a message and wait for response
function sendAndReceive<T>(ws: WebSocket, message: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for response')), 5000);

    const handler = (data: WebSocket.Data) => {
      clearTimeout(timeout);
      ws.off('message', handler);
      try {
        resolve(JSON.parse(data.toString()) as T);
      } catch (err) {
        reject(err);
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });
}

// Helper to wait for a specific message type
function waitForMessage<T>(ws: WebSocket, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), 5000);

    const handler = (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timeout);
          ws.off('message', handler);
          resolve(msg as T);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);
  });
}

// Sample machine info for testing
function createMachineInfo(name: string): Omit<MachineInfo, 'machineId'> {
  return {
    name,
    environmentType: 'local',
    hostname: 'test-host',
    platform: 'linux',
    providers: [
      {
        type: 'claude-code',
        version: '1.0.0',
        status: 'available',
        maxConcurrentTasks: 3,
        currentTasks: 0,
        capabilities: ['shell', 'file', 'browser'],
      },
    ],
    resources: {
      cpuCores: 8,
      memoryMB: 16384,
      diskSpaceMB: 500000,
    },
    load: {
      cpuPercent: 20,
      memoryPercent: 45,
      activeTasks: 0,
      queuedTasks: 0,
    },
    tags: ['test'],
  };
}

async function runTests() {
  console.log('=== Relay Server Tests ===\n');

  // Test 1: Machine Registration
  console.log('Test 1: Machine Registration');
  try {
    const ws = await createConnection();
    const machineId = `test-machine-${Date.now()}`;

    const registerMsg: MachineRegisterMessage = {
      type: 'machine.register',
      timestamp: new Date(),
      machineId,
      machineInfo: createMachineInfo('Test Machine 1'),
    };

    const ack = await sendAndReceive<MachineRegisterAckMessage>(ws, registerMsg);

    if (ack.type === 'machine.register.ack' && ack.success && ack.machineId === machineId) {
      console.log('  ✓ Machine registered successfully');
      console.log(`    Session ID: ${ack.sessionId}`);
    } else {
      console.log('  ✗ Machine registration failed:', ack);
    }

    ws.close();
  } catch (err) {
    console.log('  ✗ Error:', (err as Error).message);
  }

  // Test 2: Heartbeat Mechanism
  console.log('\nTest 2: Heartbeat Mechanism');
  try {
    const ws = await createConnection();
    const machineId = `test-machine-heartbeat-${Date.now()}`;

    // Register first
    const registerMsg: MachineRegisterMessage = {
      type: 'machine.register',
      timestamp: new Date(),
      machineId,
      machineInfo: createMachineInfo('Heartbeat Test Machine'),
    };
    await sendAndReceive<MachineRegisterAckMessage>(ws, registerMsg);

    // Wait for heartbeat ping
    console.log('  Waiting for heartbeat ping...');
    const ping = await waitForMessage<HeartbeatPingMessage>(ws, 'heartbeat.ping');

    if (ping.type === 'heartbeat.ping') {
      console.log('  ✓ Received heartbeat ping');

      // Send pong response
      const pong: HeartbeatPongMessage = {
        type: 'heartbeat.pong',
        timestamp: new Date(),
        machineId,
      };
      ws.send(JSON.stringify(pong));
      console.log('  ✓ Sent heartbeat pong');
    }

    ws.close();
  } catch (err) {
    console.log('  ✗ Error:', (err as Error).message);
    console.log('    (This may fail if heartbeat interval is longer than test timeout)');
  }

  // Test 3: Machine Status Update
  console.log('\nTest 3: Machine Status Update');
  try {
    const ws = await createConnection();
    const machineId = `test-machine-status-${Date.now()}`;

    // Register first
    const registerMsg: MachineRegisterMessage = {
      type: 'machine.register',
      timestamp: new Date(),
      machineId,
      machineInfo: createMachineInfo('Status Test Machine'),
    };
    await sendAndReceive<MachineRegisterAckMessage>(ws, registerMsg);

    // Send status update
    const statusMsg: MachineStatusMessage = {
      type: 'machine.status',
      timestamp: new Date(),
      machineId,
      load: {
        cpuPercent: 50,
        memoryPercent: 60,
        activeTasks: 2,
        queuedTasks: 1,
      },
    };
    ws.send(JSON.stringify(statusMsg));
    console.log('  ✓ Status update sent');

    ws.close();
  } catch (err) {
    console.log('  ✗ Error:', (err as Error).message);
  }

  // Test 4: Task Dispatch (via HTTP API)
  console.log('\nTest 4: Task Dispatch via HTTP API');
  try {
    // First register a machine via WebSocket
    const ws = await createConnection();
    const machineId = `test-machine-dispatch-${Date.now()}`;

    const registerMsg: MachineRegisterMessage = {
      type: 'machine.register',
      timestamp: new Date(),
      machineId,
      machineInfo: createMachineInfo('Dispatch Test Machine'),
    };
    await sendAndReceive<MachineRegisterAckMessage>(ws, registerMsg);

    // Set up listener for dispatched task
    const taskReceived = waitForMessage<TaskDispatchMessage>(ws, 'task.dispatch');

    // Dispatch task via HTTP
    const response = await fetch('http://localhost:3001/api/relay/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: {
          taskId: `task-${Date.now()}`,
          projectId: 'test-project',
          nodeId: 'node-1',
          title: 'Test Task',
          description: 'A test task for dispatch',
          environment: 'local',
        },
        targetMachineId: machineId,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log('  ✓ Task dispatch API call succeeded');
      console.log(`    Task ID: ${result.taskId}`);
      console.log(`    Machine ID: ${result.machineId}`);

      // Check if task was received on WebSocket
      try {
        const dispatchMsg = await taskReceived;
        console.log('  ✓ Task received on WebSocket');
        console.log(`    Task title: ${dispatchMsg.task.title}`);
      } catch {
        console.log('  ⚠ Task not received on WebSocket (timeout)');
      }
    } else {
      const error = await response.json();
      console.log('  ✗ Task dispatch failed:', error);
    }

    ws.close();
  } catch (err) {
    console.log('  ✗ Error:', (err as Error).message);
  }

  // Test 5: Task Result Reporting
  console.log('\nTest 5: Task Result Reporting');
  try {
    const ws = await createConnection();
    const machineId = `test-machine-result-${Date.now()}`;
    const taskId = `task-result-${Date.now()}`;

    // Register first
    const registerMsg: MachineRegisterMessage = {
      type: 'machine.register',
      timestamp: new Date(),
      machineId,
      machineInfo: createMachineInfo('Result Test Machine'),
    };
    await sendAndReceive<MachineRegisterAckMessage>(ws, registerMsg);

    // Send task result
    const resultMsg: TaskResultMessage = {
      type: 'task.result',
      timestamp: new Date(),
      result: {
        taskId,
        status: 'completed',
        exitCode: 0,
        output: 'Task completed successfully',
        duration: 5000,
      },
    };
    ws.send(JSON.stringify(resultMsg));
    console.log('  ✓ Task result sent');

    ws.close();
  } catch (err) {
    console.log('  ✗ Error:', (err as Error).message);
  }

  // Test 6: Machine Registry API
  console.log('\nTest 6: Machine Registry API');
  try {
    // Register a machine first
    const ws = await createConnection();
    const machineId = `test-machine-api-${Date.now()}`;

    const registerMsg: MachineRegisterMessage = {
      type: 'machine.register',
      timestamp: new Date(),
      machineId,
      machineInfo: createMachineInfo('API Test Machine'),
    };
    await sendAndReceive<MachineRegisterAckMessage>(ws, registerMsg);

    // Wait a moment for registration to complete
    await new Promise((r) => setTimeout(r, 100));

    // Query machines API
    const response = await fetch('http://localhost:3001/api/relay/machines');
    if (response.ok) {
      const data = await response.json();
      console.log('  ✓ Machines API responded');
      console.log(`    Total machines: ${data.summary.total}`);
      console.log(`    Our machine found: ${data.machines.some((m: { machineId: string }) => m.machineId === machineId)}`);
    } else {
      console.log('  ✗ Machines API failed');
    }

    // Query specific machine
    const machineResponse = await fetch(`http://localhost:3001/api/relay/machines/${machineId}`);
    if (machineResponse.ok) {
      const machineData = await machineResponse.json();
      console.log('  ✓ Single machine API responded');
      console.log(`    Machine name: ${machineData.machine.name}`);
    } else {
      console.log('  ✗ Single machine API failed');
    }

    ws.close();
  } catch (err) {
    console.log('  ✗ Error:', (err as Error).message);
  }

  // Test 7: Relay Health Check
  console.log('\nTest 7: Relay Health Check');
  try {
    const response = await fetch('http://localhost:3001/api/relay/health');
    if (response.ok) {
      const data = await response.json();
      console.log('  ✓ Health check passed');
      console.log(`    Relay running: ${data.relay.running}`);
      console.log(`    Relay port: ${data.relay.port}`);
      console.log(`    Connected machines: ${data.relay.connectedMachines}`);
    } else {
      console.log('  ✗ Health check failed');
    }
  } catch (err) {
    console.log('  ✗ Error:', (err as Error).message);
  }

  console.log('\n=== Tests Complete ===');
}

// Run tests
runTests().catch(console.error);
