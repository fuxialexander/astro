/**
 * Start command - starts the agent runner
 */

import chalk from 'chalk';
import ora from 'ora';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../lib/config.js';
import { detectProviders } from '../lib/providers.js';
import { getMachineResources, formatResourceSummary } from '../lib/resources.js';
import { WebSocketClient } from '../lib/websocket-client.js';
import { TaskExecutor } from '../lib/task-executor.js';
import type { RunnerEvent, Task } from '../types.js';

interface StartOptions {
  foreground?: boolean;
  relay?: string;
  maxTasks?: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

// Get package version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getVersion(): Promise<string> {
  try {
    const packageJson = await import(join(__dirname, '../../package.json'), {
      with: { type: 'json' },
    });
    return packageJson.default.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

export async function startCommand(options: StartOptions = {}): Promise<void> {
  // Check if setup is complete
  if (!config.isSetupComplete()) {
    console.log(chalk.yellow('Setup has not been completed.'));
    console.log(chalk.dim('Run: npx @nexus/agent setup'));
    process.exit(1);
  }

  // Get configuration
  const runnerId = config.getRunnerId();
  const machineId = config.getMachineId();
  const relayUrl = options.relay ?? config.getRelayUrl();
  const maxTasks = options.maxTasks ?? 4;
  const logLevel = options.logLevel ?? config.getLogLevel();

  // Background mode: spawn detached process
  if (!options.foreground) {
    console.log(chalk.bold('Starting Nexus Agent Runner in background...\n'));

    const scriptPath = process.argv[1];
    const args = ['start', '--foreground'];

    if (options.relay) args.push('--relay', options.relay);
    if (options.maxTasks) args.push('--max-tasks', String(options.maxTasks));
    if (options.logLevel) args.push('--log-level', options.logLevel);

    const child = spawn(process.execPath, [scriptPath!, ...args], {
      detached: true,
      stdio: 'ignore',
    });

    child.unref();

    console.log(chalk.green('✓ Agent runner started in background'));
    console.log(chalk.dim(`  PID: ${child.pid}`));
    console.log(chalk.dim(`  Runner ID: ${runnerId}`));
    console.log();
    console.log('To view logs:');
    console.log(chalk.cyan('  npx @nexus/agent logs'));
    console.log();
    console.log('To stop:');
    console.log(chalk.cyan('  npx @nexus/agent stop'));

    return;
  }

  // Foreground mode: run directly
  console.log(chalk.bold('\n🤖 Nexus Agent Runner\n'));

  const version = await getVersion();
  console.log(chalk.dim(`Version: ${version}`));
  console.log(chalk.dim(`Runner ID: ${runnerId}`));
  console.log(chalk.dim(`Machine ID: ${machineId}`));
  console.log(chalk.dim(`Relay: ${relayUrl}`));
  console.log(chalk.dim(`Max concurrent tasks: ${maxTasks}`));
  console.log(chalk.dim(`Log level: ${logLevel}`));
  console.log();

  // Detect resources
  const resourceSpinner = ora('Detecting machine resources...').start();
  let resources;
  try {
    resources = await getMachineResources();
    resourceSpinner.succeed('Machine resources detected');
    if (logLevel === 'debug') {
      console.log(chalk.dim(formatResourceSummary(resources)));
    }
  } catch (error) {
    resourceSpinner.fail('Failed to detect resources');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  }

  // Detect providers
  const providerSpinner = ora('Detecting agent providers...').start();
  let providers: Awaited<ReturnType<typeof detectProviders>> = [];
  try {
    providers = await detectProviders();
    if (providers.length > 0) {
      providerSpinner.succeed(`Found ${providers.length} provider(s): ${providers.map((p) => p.name).join(', ')}`);
    } else {
      providerSpinner.warn('No providers available');
    }
  } catch {
    providerSpinner.fail('Failed to detect providers');
    providers = [];
  }

  console.log();

  // Create WebSocket client
  const connectSpinner = ora('Connecting to relay server...').start();

  const wsClient = new WebSocketClient({
    runnerId,
    machineId,
    environmentType: config.getEnvironmentType(),
    providers,
    version,
    wsToken: config.getWsToken(),
    config: {
      relayUrl,
      maxConcurrentTasks: maxTasks,
      logLevel,
    },
    onEvent: (event) => handleEvent(event, logLevel),
  });

  // Create task executor
  const taskExecutor = new TaskExecutor({
    wsClient,
    maxConcurrentTasks: maxTasks,
  });

  // Set up task handlers
  wsClient['onTaskDispatch'] = (task: Task) => {
    taskExecutor.submitTask(task).catch((error) => {
      log('error', `Failed to submit task ${task.id}: ${error.message}`, logLevel);
    });
  };

  wsClient['onTaskCancel'] = (taskId: string) => {
    taskExecutor.cancelTask(taskId);
  };

  // Handle graceful shutdown
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log();
    log('info', `Received ${signal}, shutting down...`, logLevel);

    // Cancel all running tasks
    const counts = taskExecutor.getTaskCounts();
    if (counts.running > 0 || counts.queued > 0) {
      log('info', `Cancelling ${counts.running} running and ${counts.queued} queued tasks`, logLevel);
      taskExecutor.cancelAll();
    }

    // Disconnect WebSocket
    wsClient.disconnect();

    log('info', 'Shutdown complete', logLevel);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Connect to relay
  try {
    await wsClient.connect();
    connectSpinner.succeed('Connected to relay server');
    config.updateLastConnected();
  } catch (error) {
    connectSpinner.fail('Failed to connect to relay server');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    console.log();
    console.log(chalk.yellow('The agent will continue trying to reconnect...'));
    console.log(chalk.dim('Press Ctrl+C to stop'));
    console.log();

    // Still try to reconnect
    wsClient.connect().catch(() => {
      // Reconnection handled internally
    });
  }

  console.log();
  console.log(chalk.green('Agent runner is active'));
  console.log(chalk.dim('Waiting for tasks...'));
  console.log(chalk.dim('Press Ctrl+C to stop'));
  console.log();

  // Keep process alive
  await new Promise(() => {
    // Never resolves - keeps the process running
  });
}

function handleEvent(event: RunnerEvent, logLevel: string): void {
  switch (event.type) {
    case 'connected':
      log('info', 'Connected to relay server', logLevel);
      break;
    case 'disconnected':
      log('warn', `Disconnected from relay: ${event.reason}`, logLevel);
      break;
    case 'reconnecting':
      log('info', `Reconnecting (attempt ${event.attempt})...`, logLevel);
      break;
    case 'task_received':
      log('info', `Received task: ${event.task.id}`, logLevel);
      log('debug', `  Provider: ${event.task.provider}`, logLevel);
      log('debug', `  Prompt: ${event.task.prompt.slice(0, 100)}...`, logLevel);
      break;
    case 'task_started':
      log('info', `Started task: ${event.taskId}`, logLevel);
      break;
    case 'task_completed':
      log('info', `Completed task: ${event.result.taskId} (${event.result.status})`, logLevel);
      if (event.result.error) {
        log('debug', `  Error: ${event.result.error}`, logLevel);
      }
      break;
    case 'task_cancelled':
      log('info', `Cancelled task: ${event.taskId}`, logLevel);
      break;
    case 'error':
      log('error', `Error: ${event.error.message}`, logLevel);
      break;
  }
}

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, configLevel: string): void {
  const levels = ['debug', 'info', 'warn', 'error'];
  const levelIndex = levels.indexOf(level);
  const configLevelIndex = levels.indexOf(configLevel);

  if (levelIndex < configLevelIndex) {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}]`;

  switch (level) {
    case 'debug':
      console.log(chalk.dim(`${prefix} ${message}`));
      break;
    case 'info':
      console.log(`${prefix} ${message}`);
      break;
    case 'warn':
      console.log(chalk.yellow(`${prefix} ${message}`));
      break;
    case 'error':
      console.error(chalk.red(`${prefix} ${message}`));
      break;
  }
}
