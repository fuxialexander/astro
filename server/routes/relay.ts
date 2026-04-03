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
import { getMachine, getTeamSharedMachineIds } from '../lib/registered-machines-store.js';
import type { TaskDispatch, ProviderType } from '../types/relay.js';
import { LOCAL_USER_ID } from '../lib/db/bootstrap-local.js';
import { requireAuth, type AuthUser } from '../middleware/auth.js';

export const relayRoute = new Hono();

// All relay routes require authentication
relayRoute.use('/*', requireAuth);

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
relayRoute.get('/machines', async (c) => {
  const user = c.get('user') as AuthUser | undefined;
  const snapshot = machineRegistry.getSnapshot();
  // Include machines shared with the user's teams
  const teamSharedIds = user?.teamIds ? await getTeamSharedMachineIds(user.teamIds) : new Set<string>();
  // Filter machines by authenticated user OR team sharing, exclude machines in grace period
  const userMachines = snapshot.machines.filter(m =>
    m.connectionStatus !== 'reconnecting' &&
    (!m.userId || m.userId === user?.id || m.userId === LOCAL_USER_ID || teamSharedIds.has(m.machineId))
  );

  // Cross-reference with persistent store to get user-set names
  const machinesWithDbNames = await Promise.all(
    userMachines.map(async (m) => {
      const dbMachine = await getMachine(m.machineId);
      // Prefer user-set name from DB if it differs from hostname (i.e., user renamed it)
      const name = (dbMachine?.name && dbMachine.name !== dbMachine.hostname && dbMachine.name !== m.machineId)
        ? dbMachine.name
        : m.name;
      return { ...m, resolvedName: name };
    })
  );

  return c.json({
    machines: machinesWithDbNames.map((m) => ({
      machineId: m.machineId,
      name: m.resolvedName,
      hostname: m.hostname,
      connectionStatus: m.connectionStatus,
      providers: m.providers.map((p) => ({
        type: p.type,
        status: p.status,
        currentTasks: p.currentTasks,
        maxConcurrentTasks: p.maxConcurrentTasks,
      })),
      executionStrategies: m.executionStrategies,
      resources: m.resources,
      load: m.load,
      connectedAt: m.connectedAt,
      lastHeartbeat: m.lastHeartbeat,
      tags: m.tags,
    })),
    summary: { ...snapshot.summary, total: userMachines.length },
  });
});

/**
 * GET /relay/machines/:machineId
 * Get details for a specific machine
 */
relayRoute.get('/machines/:machineId', async (c) => {
  const machineId = c.req.param('machineId');
  const user = c.get('user') as AuthUser | undefined;
  const machine = machineRegistry.get(machineId);

  if (!machine) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  // Verify ownership or team sharing
  if (machine.userId && machine.userId !== LOCAL_USER_ID && user?.id && machine.userId !== user.id) {
    const teamSharedIds = user.teamIds ? await getTeamSharedMachineIds(user.teamIds) : new Set<string>();
    if (!teamSharedIds.has(machineId)) {
      return c.json({ error: 'Machine not found' }, 404);
    }
  }

  return c.json({
    machine: {
      machineId: machine.machineId,
      name: machine.name,
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
 * GET /relay/machines/provider/:provider
 * Get machines by provider type (filtered by authenticated user)
 */
relayRoute.get('/machines/provider/:provider', (c) => {
  const provider = c.req.param('provider') as ProviderType;
  const user = c.get('user') as AuthUser | undefined;

  if (!['claude-sdk', 'codex', 'openclaw', 'opencode', 'pi', 'custom'].includes(provider)) {
    return c.json({ error: 'Invalid provider type' }, 400);
  }

  const machines = machineRegistry.getByProvider(provider)
    .filter(m => !m.userId || m.userId === user?.id || m.userId === LOCAL_USER_ID);

  return c.json({
    provider,
    machines: machines.map((m) => ({
      machineId: m.machineId,
      name: m.name,
      connectionStatus: m.connectionStatus,
      load: m.load,
    })),
    count: machines.length,
  });
});

/**
 * DELETE /relay/machines/:machineId
 * Force disconnect a machine (requires ownership)
 */
relayRoute.delete('/machines/:machineId', (c) => {
  const machineId = c.req.param('machineId');
  const user = c.get('user') as AuthUser | undefined;
  const machine = machineRegistry.get(machineId);

  if (!machine) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  // Verify ownership — only the machine's owner can disconnect it
  if (machine.userId && machine.userId !== LOCAL_USER_ID && user?.id && machine.userId !== user.id) {
    return c.json({ error: 'Machine not found' }, 404);
  }

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
 * Dispatch a task to an agent runner (verifies machine ownership)
 */
relayRoute.post('/dispatch', async (c) => {
  try {
    const user = c.get('user') as AuthUser | undefined;
    const body = await c.req.json() as {
      task: TaskDispatch;
      targetMachineId?: string;
    };

    if (!body.task) {
      return c.json({ error: 'Missing task object' }, 400);
    }

    const { task, targetMachineId } = body;

    // Validate required fields
    if (!task.taskId || !task.projectId || !task.nodeId || !task.title) {
      return c.json({
        error: 'Missing required task fields',
        required: ['taskId', 'projectId', 'nodeId', 'title'],
      }, 400);
    }

    // Verify the user owns the target machine
    if (targetMachineId && user?.id) {
      const targetMachine = machineRegistry.get(targetMachineId);
      if (targetMachine?.userId && targetMachine.userId !== LOCAL_USER_ID && targetMachine.userId !== user.id) {
        return c.json({ error: 'Machine not available' }, 403);
      }
    }

    // If Redis is connected, use pub/sub for routing
    if (redisPubSub.isConnected() && targetMachineId) {
      const machineInstance = await redisPubSub.getMachineInstance(targetMachineId);

      if (machineInstance && machineInstance !== redisPubSub.getInstanceId()) {
        // Machine is on another instance, route via pub/sub
        await redisPubSub.requestTaskDispatch(task, targetMachineId, user?.id);
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
    const success = relayServer.dispatchTask(task, targetMachineId, user?.id);

    if (!success) {
      return c.json({
        error: 'Failed to dispatch task',
        reason: targetMachineId
          ? `Machine ${targetMachineId} not available`
          : 'No available machine',
      }, 503);
    }

    // Track task-to-machine mapping
    const machine = targetMachineId
      ? machineRegistry.get(targetMachineId)
      : machineRegistry.findBestMachine(task.preferredProvider, user?.id);

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
 * Cancel a task (verifies machine ownership)
 */
relayRoute.post('/cancel', async (c) => {
  try {
    const user = c.get('user') as AuthUser | undefined;
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

    // Verify machine ownership if specified
    if (machineId && user?.id) {
      const targetMachine = machineRegistry.get(machineId);
      if (targetMachine?.userId && targetMachine.userId !== LOCAL_USER_ID && targetMachine.userId !== user.id) {
        return c.json({ error: 'Machine not available' }, 403);
      }
    }

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
  const provider = c.req.query('provider') as ProviderType | undefined;
  const user = c.get('user') as AuthUser | undefined;

  const machine = machineRegistry.findBestMachine(provider, user?.id);

  if (!machine) {
    return c.json({
      error: 'No available machine',
      provider,
    }, 404);
  }

  return c.json({
    machine: {
      machineId: machine.machineId,
      name: machine.name,
      providers: machine.providers,
      load: machine.load,
    },
  });
});

// ============================================================================
// Claude Code Sessions
// ============================================================================

/**
 * GET /relay/sessions?machineId=xxx
 * List Claude Code sessions on connected machines.
 * If machineId is provided, queries that single machine.
 * If omitted, fans out to all user-owned connected machines.
 */
// ── Sessions cache: per-user in-memory cache with 60s TTL ──
const sessionsCache = new Map<string, {
  sessions: Array<import('../types/relay.js').ClaudeCodeSessionInfo & { machineId: string; machineName: string }>
  fetchedAt: number
}>()
const SESSIONS_CACHE_TTL = 60_000 // 60 seconds
// Default maxAge for agent-runner: only scan files from last 24h
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000

relayRoute.get('/sessions', async (c) => {
  const user = c.get('user') as AuthUser | undefined
  const machineId = c.req.query('machineId')
  const sinceParam = c.req.query('since')
  const sinceTs = sinceParam ? parseInt(sinceParam, 10) : 0
  const TIMEOUT_MS = 15000
  const cacheKey = user?.id || 'local'

  /** Helper: request sessions from a single machine */
  async function requestFromMachine(
    targetMachineId: string,
    maxAgeMs?: number,
  ): Promise<{ machineId: string; machineName: string; sessions: Array<import('../types/relay.js').ClaudeCodeSessionInfo>; error?: string }> {
    const machine = machineRegistry.get(targetMachineId)
    const machineName = machine?.name || targetMachineId

    const correlationId = crypto.randomUUID()

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        relayServer.removeListener('sessions_list:response', handler)
        resolve({ machineId: targetMachineId, machineName, sessions: [], error: 'Request timed out' })
      }, TIMEOUT_MS)

      function handler(data: { correlationId: string; sessions: Array<import('../types/relay.js').ClaudeCodeSessionInfo>; error?: string }) {
        if (data.correlationId !== correlationId) return
        clearTimeout(timeout)
        relayServer.removeListener('sessions_list:response', handler)
        resolve({
          machineId: targetMachineId,
          machineName,
          sessions: data.sessions || [],
          error: data.error,
        })
      }

      relayServer.on('sessions_list:response', handler)

      const sent = relayServer.requestSessionsList(targetMachineId, correlationId, maxAgeMs)
      if (!sent) {
        clearTimeout(timeout)
        relayServer.removeListener('sessions_list:response', handler)
        resolve({ machineId: targetMachineId, machineName, sessions: [], error: 'Machine not connected' })
      }
    })
  }

  try {
    if (machineId) {
      // Verify user owns this machine before querying
      const machineInfo = machineRegistry.get(machineId)
      if (machineInfo?.userId && machineInfo.userId !== LOCAL_USER_ID && user?.id && machineInfo.userId !== user.id) {
        return c.json({ error: 'Machine not found' }, 404)
      }

      // Single machine request (always fresh, no cache for targeted queries)
      const result = await requestFromMachine(machineId, DEFAULT_MAX_AGE_MS)
      const sessions = result.sessions
        .filter((s) => !sinceTs || s.lastModified > sinceTs)
        .map((s) => ({
          ...s,
          machineId: result.machineId,
          machineName: result.machineName,
        }))
      return c.json({ sessions, errors: result.error ? [{ machineId, error: result.error }] : [], delta: sinceTs > 0 })
    }

    // ── Check cache first ──
    const cached = sessionsCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < SESSIONS_CACHE_TTL) {
      // Serve from cache, apply since filter
      const filteredSessions = sinceTs > 0
        ? cached.sessions.filter((s) => s.lastModified > sinceTs)
        : cached.sessions
      return c.json({ sessions: filteredSessions, errors: [], delta: sinceTs > 0, cached: true })
    }

    // Fan out to all user-owned connected machines
    const snapshot = machineRegistry.getSnapshot()
    const userMachines = snapshot.machines.filter(
      (m) => !m.userId || m.userId === user?.id || m.userId === LOCAL_USER_ID
    )

    if (userMachines.length === 0) {
      return c.json({ sessions: [], errors: [] })
    }

    const results = await Promise.allSettled(
      userMachines.map((m) => requestFromMachine(m.machineId, DEFAULT_MAX_AGE_MS))
    )

    const allSessions: Array<import('../types/relay.js').ClaudeCodeSessionInfo & { machineId: string; machineName: string }> = []
    const errors: Array<{ machineId: string; machineName: string; error: string }> = []

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { machineId: mId, machineName, sessions, error } = result.value
        for (const s of sessions) {
          allSessions.push({ ...s, machineId: mId, machineName })
        }
        if (error) errors.push({ machineId: mId, machineName, error })
      }
    }

    // Sort by lastModified descending
    allSessions.sort((a, b) => b.lastModified - a.lastModified)

    // ── Update cache (store full results, filter for response) ──
    sessionsCache.set(cacheKey, { sessions: allSessions, fetchedAt: Date.now() })

    const filteredSessions = sinceTs > 0
      ? allSessions.filter((s) => s.lastModified > sinceTs)
      : allSessions

    return c.json({ sessions: filteredSessions, errors, delta: sinceTs > 0 })
  } catch (err) {
    console.error('[relay] Error fetching sessions:', err)
    return c.json({ sessions: [], errors: [{ machineId: machineId || 'all', error: 'Internal error' }] })
  }
})

// ============================================================================
// Slurm/HPC Specific Routes
// ============================================================================

/**
 * GET /relay/slurm/clusters
 * Get all HPC machines (machines with hpcCapability metadata).
 * Filtered by authenticated user's ownership.
 */
relayRoute.get('/slurm/clusters', (c) => {
  const user = c.get('user') as AuthUser | undefined;
  const allMachines = machineRegistry.getAll()
    .filter(m => !m.userId || m.userId === user?.id || m.userId === LOCAL_USER_ID);
  const hpcCapableMachines = allMachines.filter(m =>
    m.providers.some(p => p.hpcCapability)
  );

  return c.json({
    clusters: hpcCapableMachines.map(m => {
      const hpcProvider = m.providers.find(p => p.hpcCapability);
      return {
        machineId: m.machineId,
        name: m.name,
        hostname: m.hostname,
        connectionStatus: m.connectionStatus,
        provider: hpcProvider ? {
          status: hpcProvider.status,
          version: hpcProvider.version,
          maxConcurrentTasks: hpcProvider.maxConcurrentTasks,
          currentTasks: hpcProvider.currentTasks,
          capabilities: hpcProvider.capabilities,
        } : null,
        resources: m.resources,
        load: m.load,
        lastHeartbeat: m.lastHeartbeat,
        metadata: m.metadata,
        hpcCapability: hpcProvider?.hpcCapability,
      };
    }),
    count: hpcCapableMachines.length,
  });
});

/**
 * GET /relay/slurm/clusters/:machineId
 * Get detailed Slurm cluster info for a specific machine
 */
relayRoute.get('/slurm/clusters/:machineId', (c) => {
  const machineId = c.req.param('machineId');
  const user = c.get('user') as AuthUser | undefined;
  const machine = machineRegistry.get(machineId);

  if (!machine) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  // Verify ownership
  if (machine.userId && machine.userId !== LOCAL_USER_ID && user?.id && machine.userId !== user.id) {
    return c.json({ error: 'Machine not found' }, 404);
  }

  const hpcProvider = machine.providers.find(p => p.hpcCapability);
  if (!hpcProvider) {
    return c.json({ error: 'Machine does not have HPC capability' }, 400);
  }

  return c.json({
    cluster: {
      machineId: machine.machineId,
      name: machine.name,
      hostname: machine.hostname,
      platform: machine.platform,
      connectionStatus: machine.connectionStatus,
      provider: {
        type: hpcProvider.type,
        status: hpcProvider.status,
        version: hpcProvider.version,
        maxConcurrentTasks: hpcProvider.maxConcurrentTasks,
        currentTasks: hpcProvider.currentTasks,
        capabilities: hpcProvider.capabilities,
      },
      hpcCapability: hpcProvider.hpcCapability,
      resources: machine.resources,
      load: machine.load,
      tags: machine.tags,
      metadata: machine.metadata,
      connectedAt: machine.connectedAt,
      lastHeartbeat: machine.lastHeartbeat,
    },
  });
});

/**
 * GET /relay/slurm/jobs
 * Get all active Slurm jobs across all clusters
 * (This would require tracking Slurm jobs in the registry)
 */
relayRoute.get('/slurm/jobs', (c) => {
  const user = c.get('user') as AuthUser | undefined;
  return c.json({
    jobs: [],
    clusters: machineRegistry.getAll()
      .filter(m => m.providers.some(p => p.hpcCapability))
      .filter(m => !m.userId || m.userId === user?.id || m.userId === LOCAL_USER_ID)
      .map(m => m.machineId),
    message: 'Jobs are tracked via the agent runner and reported through relay events',
  });
});

/**
 * POST /relay/slurm/dispatch
 * Dispatch a task specifically to Slurm
 * Enhanced version of /relay/dispatch for HPC workflows
 */
relayRoute.post('/slurm/dispatch', async (c) => {
  try {
    const body = await c.req.json() as {
      task: TaskDispatch;
      targetClusterId?: string;
      slurmConfig?: {
        partition?: string;
        nodes?: number;
        ntasks?: number;
        cpusPerTask?: number;
        mem?: string;
        time?: string;
        gpu?: { type?: string; count: number };
        qos?: string;
        account?: string;
        modules?: string[];
        workdir?: string;
      };
    };

    if (!body.task) {
      return c.json({ error: 'Missing task object' }, 400);
    }

    const { task, targetClusterId, slurmConfig } = body;

    // Validate required fields
    if (!task.taskId || !task.projectId || !task.nodeId || !task.title) {
      return c.json({
        error: 'Missing required task fields',
        required: ['taskId', 'projectId', 'nodeId', 'title'],
      }, 400);
    }

    // Use task's preferred provider (user selection), no longer forced to claude-sdk.
    // All providers (Claude SDK, Codex, OpenClaw, etc.) support multi-turn agentic
    // loops and can drive Slurm workflows via shell commands.
    const hpcTask: TaskDispatch = {
      ...task,
      preferredProvider: task.preferredProvider || undefined,
      metadata: {
        ...task.metadata,
        slurmConfig: slurmConfig ? JSON.stringify(slurmConfig) : undefined,
      },
    };

    // Find target cluster — match preferred provider if specified, otherwise any HPC machine
    let targetMachineId = targetClusterId;
    if (!targetMachineId) {
      const slurmUser = c.get('user') as AuthUser | undefined;
      const bestMachine = machineRegistry.findBestMachine(task.preferredProvider || undefined, slurmUser?.id);
      if (!bestMachine) {
        return c.json({
          error: 'No HPC machine available',
          hint: 'Connect an HPC machine with Slurm installed and a supported AI provider (Claude SDK, Codex, etc.)',
        }, 503);
      }
      targetMachineId = bestMachine.machineId;
    }

    // Verify target has HPC capability
    const targetMachine = machineRegistry.get(targetMachineId);
    if (!targetMachine) {
      return c.json({ error: 'Target machine not found' }, 404);
    }

    const hasHpcCapability = targetMachine.providers.some(
      p => p.hpcCapability && p.status === 'available'
    );
    if (!hasHpcCapability) {
      return c.json({
        error: 'Target machine does not have HPC capability',
        machineId: targetMachineId,
      }, 400);
    }

    // Dispatch to relay server
    const hpcUser = c.get('user') as AuthUser | undefined;
    const success = relayServer.dispatchTask(hpcTask, targetMachineId, hpcUser?.id);

    if (!success) {
      return c.json({
        error: 'Failed to dispatch task to HPC machine',
        machineId: targetMachineId,
      }, 503);
    }

    // Track task mapping if Redis is available
    if (redisPubSub.isConnected()) {
      await redisPubSub.mapTaskToMachine(task.taskId, targetMachineId);
    }

    return c.json({
      success: true,
      taskId: task.taskId,
      machineId: targetMachineId,
      clusterName: targetMachine.name,
      provider: 'claude-sdk',
      slurmConfig,
      message: 'Task dispatched to HPC machine',
    });
  } catch (err) {
    console.error('[relay] Error dispatching Slurm task:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});
