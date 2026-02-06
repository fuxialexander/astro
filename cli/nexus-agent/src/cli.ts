#!/usr/bin/env node
/**
 * Nexus Agent CLI
 *
 * Runs on local machines or HPC cluster login nodes to connect to the Nexus relay server
 * and execute tasks via Claude Agent SDK or Slurm.
 */

import { program } from 'commander'
import chalk from 'chalk'
import * as os from 'os'
import { AgentRunner } from './runner.js'
import { detectSlurm } from './slurm-detect.js'
import { loadConfig, saveConfig } from './config.js'

// ASCII art banner
const banner = `
╔═══════════════════════════════════════╗
║     ${chalk.cyan('N E X U S')}   ${chalk.gray('Agent Runner')}       ║
║     ${chalk.gray('Local & HPC Task Execution')}       ║
╚═══════════════════════════════════════╝
`

program
  .name('nexus-agent')
  .description('Nexus agent runner for HPC clusters')
  .version('0.1.0')

program
  .command('connect')
  .description('Connect to Nexus relay server')
  .option('-u, --url <url>', 'Relay server WebSocket URL')
  .option('-n, --name <name>', 'Machine name (defaults to hostname)')
  .option('-t, --token <token>', 'Authentication token')
  .option('-d, --dir <dir>', 'Working directory for task execution')
  .option('--no-worktree', 'Disable git worktree isolation for tasks')
  .option('--worktree-root <path>', 'Root directory for worktrees')
  .option('--config <path>', 'Path to config file')
  .action(async (options) => {
    console.log(banner)

    // Load config
    const config = await loadConfig(options.config)

    // Override with CLI options
    if (options.url) config.relayUrl = options.url
    if (options.name) config.machineName = options.name
    if (options.token) config.authToken = options.token

    // Validate required config
    if (!config.relayUrl) {
      console.error(chalk.red('Error: Relay server URL is required'))
      console.log(chalk.gray('Set via --url or NEXUS_RELAY_URL environment variable'))
      process.exit(1)
    }

    // Detect Slurm
    console.log(chalk.gray('Detecting Slurm...'))
    const slurmInfo = await detectSlurm()

    if (!slurmInfo.available) {
      console.log(chalk.gray('  Slurm not available (not an HPC environment)'))
    } else {
      console.log(chalk.green(`✓ Slurm ${slurmInfo.version} detected`))
      if (slurmInfo.clusterName) {
        console.log(chalk.gray(`  Cluster: ${slurmInfo.clusterName}`))
      }
      if (slurmInfo.partitions.length > 0) {
        console.log(chalk.gray(`  Partitions: ${slurmInfo.partitions.join(', ')}`))
      }
    }

    // Create and start agent runner (Claude SDK detection happens inside)
    console.log(chalk.gray('Initializing agent runner...'))
    const runner = await AgentRunner.create({
      relayUrl: config.relayUrl,
      machineName: config.machineName,
      authToken: config.authToken,
      slurmInfo,
      workingDirectory: options.dir || process.cwd(),
      useWorktree: options.worktree !== false,
      worktreeRoot: options.worktreeRoot,
    })

    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\nShutting down...'))
      await runner.disconnect()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      await runner.disconnect()
      process.exit(0)
    })

    // Connect
    console.log(chalk.gray(`\nConnecting to ${config.relayUrl}...`))
    await runner.connect()
  })

program
  .command('status')
  .description('Check provider status and system configuration')
  .action(async () => {
    console.log(banner)
    console.log(chalk.cyan('Checking system status...\n'))

    // Check Claude Agent SDK by attempting detection via runner
    console.log(chalk.bold('Claude Agent SDK Status:'))
    console.log(chalk.gray('  Use `nexus-agent connect` to detect SDK availability'))

    // Check Slurm
    const slurmInfo = await detectSlurm()

    console.log()
    console.log(chalk.bold('Slurm Status:'))
    if (slurmInfo.available) {
      console.log(chalk.green(`  ✓ Available (version ${slurmInfo.version})`))
      console.log(`  Cluster: ${slurmInfo.clusterName || 'unknown'}`)
      console.log(`  Partitions: ${slurmInfo.partitions.length > 0 ? slurmInfo.partitions.join(', ') : 'none'}`)
      if (slurmInfo.defaultPartition) {
        console.log(`  Default: ${slurmInfo.defaultPartition}`)
      }
      if (slurmInfo.accounts.length > 0) {
        console.log(`  Accounts: ${slurmInfo.accounts.join(', ')}`)
      }
    } else {
      console.log(chalk.gray('  ✗ Not available (not an HPC environment)'))
    }

    console.log()
    console.log(chalk.bold('System Info:'))
    console.log(`  Hostname: ${process.env.HOSTNAME || os.hostname()}`)
    console.log(`  Platform: ${process.platform}`)
    console.log(`  Node.js: ${process.version}`)
    console.log(`  CPU Cores: ${os.cpus().length}`)
    console.log(`  Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`)
  })

program
  .command('config')
  .description('Configure the agent')
  .option('--url <url>', 'Set relay server URL')
  .option('--name <name>', 'Set machine name')
  .option('--token <token>', 'Set authentication token')
  .option('--show', 'Show current configuration')
  .action(async (options) => {
    const config = await loadConfig()

    if (options.show) {
      console.log(chalk.cyan('Current configuration:'))
      console.log(JSON.stringify(config, null, 2))
      return
    }

    let changed = false

    if (options.url) {
      config.relayUrl = options.url
      changed = true
    }
    if (options.name) {
      config.machineName = options.name
      changed = true
    }
    if (options.token) {
      config.authToken = options.token
      changed = true
    }

    if (changed) {
      await saveConfig(config)
      console.log(chalk.green('Configuration saved'))
    } else {
      console.log(chalk.gray('No changes made'))
      console.log('Use --url, --name, or --token to update configuration')
    }
  })

program.parse()
