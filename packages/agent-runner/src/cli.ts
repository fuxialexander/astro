#!/usr/bin/env node

/**
 * Nexus Agent Runner CLI
 *
 * Lightweight agent runner for local, remote, and HPC environments.
 * Connects to the Nexus relay server to receive and execute tasks.
 *
 * Usage:
 *   npx @nexus/agent setup     - Initial setup and configuration
 *   npx @nexus/agent start     - Start the agent runner
 *   npx @nexus/agent stop      - Stop running agent
 *   npx @nexus/agent status    - Show current status
 */

import { Command } from 'commander';
import { setupCommand, startCommand, statusCommand, stopCommand } from './commands/index.js';

const program = new Command();

program
  .name('nexus-agent')
  .description('Nexus Agent Runner - Execute tasks from the Nexus planning platform')
  .version('0.1.0');

// Setup command
program
  .command('setup')
  .description('Run initial setup: detect providers, authenticate, configure relay')
  .option('--relay <url>', 'Custom relay server URL')
  .option('--skip-auth', 'Skip device authentication')
  .option('--non-interactive', 'Run in non-interactive mode')
  .action(async (options) => {
    try {
      await setupCommand({
        relay: options.relay,
        skipAuth: options.skipAuth,
        nonInteractive: options.nonInteractive,
      });
    } catch (error) {
      console.error('Setup failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Start command
program
  .command('start')
  .description('Start the agent runner')
  .option('-f, --foreground', 'Run in foreground (default: background)')
  .option('--relay <url>', 'Override relay server URL')
  .option('--max-tasks <number>', 'Maximum concurrent tasks', parseInt)
  .option('--log-level <level>', 'Log level: debug, info, warn, error')
  .action(async (options) => {
    try {
      await startCommand({
        foreground: options.foreground,
        relay: options.relay,
        maxTasks: options.maxTasks,
        logLevel: options.logLevel,
      });
    } catch (error) {
      console.error('Start failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Stop command
program
  .command('stop')
  .description('Stop the running agent')
  .action(async () => {
    try {
      await stopCommand();
    } catch (error) {
      console.error('Stop failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show agent runner status')
  .action(async () => {
    try {
      await statusCommand();
    } catch (error) {
      console.error('Status check failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Config command (show/edit config)
program
  .command('config')
  .description('Show or modify configuration')
  .option('--show', 'Show current configuration')
  .option('--reset', 'Reset configuration to defaults')
  .option('--set <key=value>', 'Set a configuration value')
  .action(async (options) => {
    const { config } = await import('./lib/config.js');

    if (options.reset) {
      config.reset();
      console.log('Configuration reset to defaults.');
      return;
    }

    if (options.set) {
      const [key, value] = options.set.split('=');
      if (!key || value === undefined) {
        console.error('Invalid format. Use: --set key=value');
        process.exit(1);
      }

      switch (key) {
        case 'relay':
        case 'relayUrl':
          config.setRelayUrl(value);
          console.log(`Set relay URL to: ${value}`);
          break;
        case 'logLevel':
          if (!['debug', 'info', 'warn', 'error'].includes(value)) {
            console.error('Invalid log level. Use: debug, info, warn, error');
            process.exit(1);
          }
          config.setLogLevel(value as 'debug' | 'info' | 'warn' | 'error');
          console.log(`Set log level to: ${value}`);
          break;
        case 'autoStart':
          config.setAutoStart(value === 'true');
          console.log(`Set auto-start to: ${value}`);
          break;
        default:
          console.error(`Unknown configuration key: ${key}`);
          console.log('Available keys: relay, logLevel, autoStart');
          process.exit(1);
      }
      return;
    }

    // Show configuration (default)
    const currentConfig = config.getConfig();
    console.log('\nCurrent Configuration:\n');
    console.log(`  Runner ID:   ${currentConfig.runnerId || '(not set)'}`);
    console.log(`  Machine ID:  ${currentConfig.machineId || '(not set)'}`);
    console.log(`  Relay URL:   ${currentConfig.relayUrl}`);
    console.log(`  Auto-start:  ${currentConfig.autoStart}`);
    console.log(`  Log level:   ${currentConfig.logLevel}`);
    console.log(`  Providers:   ${currentConfig.providers.length > 0 ? currentConfig.providers.join(', ') : '(none)'}`);
    console.log(`  Device auth: ${currentConfig.deviceToken ? 'configured' : 'not configured'}`);
    console.log(`\n  Config file: ${config.getConfigPath()}`);
    console.log();
  });

// Providers command (list detected providers)
program
  .command('providers')
  .description('List detected agent providers')
  .action(async () => {
    const { detectProviders, formatProvidersSummary } = await import('./lib/providers.js');

    console.log('\nDetecting agent providers...\n');
    const providers = await detectProviders();
    console.log(formatProvidersSummary(providers));
    console.log();
  });

// Resources command (show machine resources)
program
  .command('resources')
  .description('Show machine resources (CPU, memory, GPU)')
  .action(async () => {
    const { getMachineResources, formatResourceSummary } = await import('./lib/resources.js');

    console.log('\nDetecting machine resources...\n');
    const resources = await getMachineResources();
    console.log(formatResourceSummary(resources));
    console.log();
  });

// Hosts command (discover SSH hosts)
program
  .command('hosts')
  .description('Discover remote hosts from SSH config')
  .action(async () => {
    const { discoverRemoteHosts, formatDiscoveredHosts } = await import('./lib/ssh-discovery.js');

    console.log('\nDiscovering remote hosts...\n');
    const hosts = await discoverRemoteHosts();
    console.log(formatDiscoveredHosts(hosts));
  });

// Parse arguments
program.parse();
