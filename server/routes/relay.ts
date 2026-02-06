/**
 * Relay Server HTTP API Routes
 *
 * Provides HTTP endpoints for:
 * - Machine registry status and management
 * - Task dispatch and cancellation
 * - Relay server health and metrics
 */

import { Hono } from 'hono';
import { relayServer } from '../lib/relay-server.js';
import { machineRegistry } from '../lib/machine-registry.js';
import { redisPubSub } from '../lib/redis-pubsub.js';
import type { TaskDispatch, EnvironmentType, ProviderType } from '../types/relay.js';

export const relayRoute = new Hono();

// ============================================================================
// Health & Status
// ============================================================================

/**
 * GET /relay/health
 * Health check for the relay server
 */
relayRoute.get('/health', (c) => {
  const status = relayServer.getStatus();
  const redisConnected = redisPubSub.isConnected();

  return c.json({
    status: 'ok',
    relay: {
      running: status.running,
      port: status.port,
      connectedMachines: status.machines,
    },
    redis: {
      connected: redisConnected,
      instanceId: redisPubSub.getInstanceId(),
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /relay/status
 * Detailed status of the relay server
 */
relayRoute.get('/status', (c) => {
  const status = relayServer.getStatus();
  const snapshot = machineRegistry.getSnapshot();

  return c.json({
    server: {
      running: status.running,
      port: status.port,
      config: {
        heartbeatIntervalMs: status.config.heartbeatIntervalMs,
        heartbeatTimeoutMs: status.config.heartbeatTimeoutMs,
        rateLimit: status.config.rateLimit,
      },
    },
    machines: snapshot.summary,
    redis: {
      connected: redisPubSub.isConnected(),
      instanceId: redisPubSub.getInstanceId(),
    },
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Machine Registry
// ============================================================================

/**
 * GET /relay/machines
 * List all connected machines
 */
relayRoute.get('/machines', (c) => {
  const snapshot = machineRegistry.getSnapshot();

  return c.json({
    machines: snapshot.machines.map((m) => ({
      machineId: m.machineId,
      name: m.name,
      environmentType: m.environmentType,
      connectionStatus: m.connectionStatus,
      providers: m.providers.map((p) => ({
        type: p.type,
        status: p.status,
        currentTasks: p.currentTasks,
        maxConcurrentTasks: p.maxConcurrentTasks,
      })),
      resources: m.resources,
      load: m.load,
      connectedAt: m.connectedAt,
      lastHeartbeat: m.lastHeartbeat,
      tags: m.tags,
    })),
    summary: snapshot.summary,
  });
});

/**
 * GET /relay/machines/:machineId
 * Get details for a specific machine
 */
relayRoute.get('/machines/:machineId', (c) => {
  const machineId = c.req.param('machineId');
  const machine = machineRegistry.get(machineId);

  if (!machine) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  return c.json({
    machine: {
      machineId: machine.machineId,
      name: machine.name,
      environmentType: machine.environmentType,
      hostname: machine.hostname,
      platform: machine.platform,
      connectionStatus: machine.connectionStatus,
      providers: machine.providers,
      resources: machine.resources,
      load: machine.load,
      tags: machine.tags,
      metadata: machine.metadata,
      connectedAt: machine.connectedAt,
      lastHeartbeat: machine.lastHeartbeat,
      sessionId: machine.sessionId,
    },
  });
});

/**
 * GET /relay/machines/environment/:environment
 * Get machines by environment type
 */
relayRoute.get('/machines/environment/:environment', (c) => {
  const environment = c.req.param('environment') as EnvironmentType;

  if (!['local', 'hpc', 'cloud'].includes(environment)) {
    return c.json({ error: 'Invalid environment type' }, 400);
  }

  const machines = machineRegistry.getByEnvironment(environment);

  return c.json({
    environment,
    machines: machines.map((m) => ({
      machineId: m.machineId,
      name: m.name,
      connectionStatus: m.connectionStatus,
      providers: m.providers,
      load: m.load,
    })),
    count: machines.length,
  });
});

/**
 * GET /relay/machines/provider/:provider
 * Get machines by provider type
 */
relayRoute.get('/machines/provider/:provider', (c) => {
  const provider = c.req.param('provider') as ProviderType;

  if (!['claude-code', 'slurm', 'aws', 'gcp', 'custom'].includes(provider)) {
    return c.json({ error: 'Invalid provider type' }, 400);
  }

  const machines = machineRegistry.getByProvider(provider);

  return c.json({
    provider,
    machines: machines.map((m) => ({
      machineId: m.machineId,
      name: m.name,
      environmentType: m.environmentType,
      connectionStatus: m.connectionStatus,
      load: m.load,
    })),
    count: machines.length,
  });
});

/**
 * DELETE /relay/machines/:machineId
 * Force disconnect a machine
 */
relayRoute.delete('/machines/:machineId', (c) => {
  const machineId = c.req.param('machineId');

  const disconnected = machineRegistry.disconnect(machineId, 'admin_disconnect');

  if (!disconnected) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  return c.json({
    success: true,
    machineId,
    message: 'Machine disconnected',
  });
});

// ============================================================================
// Task Dispatch
// ============================================================================

/**
 * POST /relay/dispatch
 * Dispatch a task to an agent runner
 */
relayRoute.post('/dispatch', async (c) => {
  try {
    const body = await c.req.json() as {
      task: TaskDispatch;
      targetMachineId?: string;
    };

    if (!body.task) {
      return c.json({ error: 'Missing task object' }, 400);
    }

    const { task, targetMachineId } = body;

    // Validate required fields
    if (!task.taskId || !task.projectId || !task.nodeId || !task.title || !task.environment) {
      return c.json({
        error: 'Missing required task fields',
        required: ['taskId', 'projectId', 'nodeId', 'title', 'environment'],
      }, 400);
    }

    // If Redis is connected, use pub/sub for routing
    if (redisPubSub.isConnected() && targetMachineId) {
      const machineInstance = await redisPubSub.getMachineInstance(targetMachineId);

      if (machineInstance && machineInstance !== redisPubSub.getInstanceId()) {
        // Machine is on another instance, route via pub/sub
        await redisPubSub.requestTaskDispatch(task, targetMachineId);
        await redisPubSub.mapTaskToMachine(task.taskId, targetMachineId);

        return c.json({
          success: true,
          taskId: task.taskId,
          machineId: targetMachineId,
          routed: true,
          message: 'Task routed to another relay instance',
        });
      }
    }

    // Dispatch locally
    const success = relayServer.dispatchTask(task, targetMachineId);

    if (!success) {
      return c.json({
        error: 'Failed to dispatch task',
        reason: targetMachineId
          ? `Machine ${targetMachineId} not available`
          : `No available machine for environment: ${task.environment}`,
      }, 503);
    }

    // Track task-to-machine mapping
    const machine = targetMachineId
      ? machineRegistry.get(targetMachineId)
      : machineRegistry.findBestMachine(task.environment, task.preferredProvider);

    if (machine && redisPubSub.isConnected()) {
      await redisPubSub.mapTaskToMachine(task.taskId, machine.machineId);
    }

    return c.json({
      success: true,
      taskId: task.taskId,
      machineId: machine?.machineId,
      routed: false,
      message: 'Task dispatched',
    });
  } catch (err) {
    console.error('[relay] Error dispatching task:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /relay/cancel
 * Cancel a task
 */
relayRoute.post('/cancel', async (c) => {
  try {
    const body = await c.req.json() as {
      taskId: string;
      machineId?: string;
      reason?: string;
    };

    if (!body.taskId) {
      return c.json({ error: 'Missing taskId' }, 400);
    }

    const { taskId, reason } = body;
    let { machineId } = body;

    // Find machine if not specified
    if (!machineId && redisPubSub.isConnected()) {
      machineId = await redisPubSub.getTaskMachine(taskId) || undefined;
    }

    if (!machineId) {
      return c.json({ error: 'Machine ID required for cancellation' }, 400);
    }

    // If Redis is connected, check if machine is on another instance
    if (redisPubSub.isConnected()) {
      const machineInstance = await redisPubSub.getMachineInstance(machineId);

      if (machineInstance && machineInstance !== redisPubSub.getInstanceId()) {
        // Route cancellation via pub/sub
        await redisPubSub.requestTaskCancel(taskId, machineId, reason);

        return c.json({
          success: true,
          taskId,
          machineId,
          routed: true,
          message: 'Cancellation routed to another relay instance',
        });
      }
    }

    // Cancel locally
    const success = relayServer.cancelTask(taskId, machineId, reason);

    if (!success) {
      return c.json({
        error: 'Failed to cancel task',
        reason: `Machine ${machineId} not available`,
      }, 503);
    }

    // Clean up task mapping
    if (redisPubSub.isConnected()) {
      await redisPubSub.removeTaskMapping(taskId);
    }

    return c.json({
      success: true,
      taskId,
      machineId,
      routed: false,
      message: 'Task cancellation sent',
    });
  } catch (err) {
    console.error('[relay] Error cancelling task:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /relay/tasks/:taskId/machine
 * Get the machine running a task
 */
relayRoute.get('/tasks/:taskId/machine', async (c) => {
  const taskId = c.req.param('taskId');

  if (redisPubSub.isConnected()) {
    const machineId = await redisPubSub.getTaskMachine(taskId);

    if (machineId) {
      const machine = machineRegistry.get(machineId);

      return c.json({
        taskId,
        machineId,
        machine: machine
          ? {
              name: machine.name,
              environmentType: machine.environmentType,
              connectionStatus: machine.connectionStatus,
            }
          : null,
      });
    }
  }

  return c.json({ error: 'Task not found' }, 404);
});

// ============================================================================
// Best Machine Selection
// ============================================================================

/**
 * GET /relay/best-machine
 * Find the best machine for a task
 */
relayRoute.get('/best-machine', (c) => {
  const environment = c.req.query('environment') as EnvironmentType;
  const provider = c.req.query('provider') as ProviderType | undefined;

  if (!environment || !['local', 'hpc', 'cloud'].includes(environment)) {
    return c.json({ error: 'Invalid or missing environment parameter' }, 400);
  }

  const machine = machineRegistry.findBestMachine(environment, provider);

  if (!machine) {
    return c.json({
      error: 'No available machine',
      environment,
      provider,
    }, 404);
  }

  return c.json({
    machine: {
      machineId: machine.machineId,
      name: machine.name,
      environmentType: machine.environmentType,
      providers: machine.providers,
      load: machine.load,
    },
  });
});
