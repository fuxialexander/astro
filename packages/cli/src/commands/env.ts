import type { Command } from 'commander'
import chalk from 'chalk'
import { getClient } from '../client.js'
import type { Machine } from '../client.js'
import { print, formatRelativeTime, type ColumnDef } from '../output.js'
import { saveConfig } from '../config.js'

const envColumns: ColumnDef[] = [
  { key: 'id', label: 'ID', width: 10, format: (v) => String(v ?? '').slice(0, 8) },
  { key: 'name', label: 'NAME', width: 20 },
  { key: 'hostname', label: 'HOSTNAME', width: 24 },
  { key: 'platform', label: 'PLATFORM', width: 10 },
  { key: 'providers', label: 'PROVIDERS', width: 24, format: (v) => Array.isArray(v) ? (v as string[]).join(', ') : '\u2014' },
  { key: 'connected', label: 'CONNECTED', width: 10, format: (v) => v ? chalk.green('\u2713') : chalk.dim('\u2717') },
  { key: 'lastSeen', label: 'LAST_SEEN', width: 14, format: (v) => formatRelativeTime(v as string) },
]

export function registerEnvCommands(program: Command): void {
  const cmd = program.command('env').description('Manage environments and machines')

  cmd
    .command('list')
    .description('List registered machines')
    .action(async () => {
      const client = getClient(program.opts().serverUrl)
      const json = program.opts().json

      const machines: Machine[] = await client.listMachines()
      const active = machines.filter((m) => !m.isRevoked)

      const formatted = active.map((m) => ({
        id: m.id,
        name: m.name,
        hostname: m.hostname,
        platform: m.platform,
        providers: m.providers,
        connected: m.isConnected,
        lastSeen: m.lastSeenAt,
        environmentType: m.environmentType,
      }))

      print(formatted, { json, columns: envColumns })
    })

  cmd
    .command('show <id>')
    .description('Show machine details')
    .action(async (id: string) => {
      const client = getClient(program.opts().serverUrl)
      const json = program.opts().json

      let machine: Machine
      try {
        machine = await client.resolveMachine(id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (json) {
          print({ error: msg }, { json: true })
        } else {
          console.error(chalk.red(msg))
        }
        process.exitCode = 1
        return
      }

      if (json) {
        print(machine, { json: true })
        return
      }

      // Human-readable output
      console.log(chalk.bold(`Machine: ${machine.name}\n`))
      const fields: [string, string][] = [
        ['ID', machine.id],
        ['Name', machine.name],
        ['Hostname', machine.hostname],
        ['Platform', machine.platform],
        ['Environment', machine.environmentType],
        ['Providers', (machine.providers ?? []).join(', ') || '\u2014'],
        ['Connected', machine.isConnected ? chalk.green('Yes') : chalk.dim('No')],
        ['Revoked', machine.isRevoked ? chalk.red('Yes') : 'No'],
        ['Workspace ID', machine.workspaceId ?? '\u2014'],
        ['Registered', machine.registeredAt ?? '\u2014'],
        ['Last Seen', formatRelativeTime(machine.lastSeenAt)],
      ]

      for (const [label, value] of fields) {
        console.log(`  ${chalk.dim(label.padEnd(14))} ${value}`)
      }

      if (machine.metadata && Object.keys(machine.metadata).length > 0) {
        console.log(`\n  ${chalk.dim('Metadata:')}`)
        for (const [k, v] of Object.entries(machine.metadata)) {
          console.log(`    ${chalk.dim(k)}: ${v}`)
        }
      }

      if (machine.providerConfigs && Array.isArray(machine.providerConfigs) && machine.providerConfigs.length > 0) {
        console.log(`\n  ${chalk.dim('Provider Configs:')}`)
        for (const cfg of machine.providerConfigs) {
          const enabled = cfg.enabled ? chalk.green('enabled') : chalk.dim('disabled')
          console.log(`    ${cfg.provider}: ${enabled}${cfg.defaultModel ? ` (model: ${cfg.defaultModel})` : ''}`)
        }
      }
    })

  cmd
    .command('remove <id>')
    .description('Remove/revoke a registered machine')
    .action(async (id: string) => {
      const client = getClient(program.opts().serverUrl)
      const json = program.opts().json

      // Resolve partial ID
      let machine: Machine
      try {
        machine = await client.resolveMachine(id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (json) {
          print({ error: msg }, { json: true })
        } else {
          console.error(chalk.red(msg))
        }
        process.exitCode = 1
        return
      }

      // Revoke via API
      try {
        await client.revokeMachine(machine.id)

        if (json) {
          print({ ok: true, machineId: machine.id, name: machine.name }, { json: true })
        } else {
          console.log(chalk.green(`Revoked machine "${machine.name}" (${machine.id.slice(0, 8)})`))
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (json) {
          print({ error: errMsg }, { json: true })
        } else {
          console.error(chalk.red(`Failed to revoke machine: ${errMsg}`))
        }
        process.exitCode = 1
      }
    })

  cmd
    .command('set-default <id>')
    .description('Set default machine for task dispatch')
    .action(async (id: string) => {
      const client = getClient(program.opts().serverUrl)
      const json = program.opts().json

      // Resolve partial ID
      let machine: Machine
      try {
        machine = await client.resolveMachine(id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (json) {
          print({ error: msg }, { json: true })
        } else {
          console.error(chalk.red(msg))
        }
        process.exitCode = 1
        return
      }

      saveConfig({ defaultMachineId: machine.id })

      if (json) {
        print({ ok: true, defaultMachineId: machine.id, name: machine.name }, { json: true })
      } else {
        console.log(chalk.green(`Default machine set to "${machine.name}" (${machine.id.slice(0, 8)})`))
      }
    })

  // ── env status ────────────────────────────────────────────────────
  cmd
    .command('status')
    .description('Show relay server status and summary')
    .action(async () => {
      const client = getClient(program.opts().serverUrl)
      const json = program.opts().json

      try {
        const status = await client.getRelayStatus() as {
          server?: { running?: boolean; port?: number }
          machines?: { total?: number; connected?: number; available?: number }
          redis?: { connected?: boolean }
          timestamp?: string
        }

        if (json) {
          print(status, { json: true })
          return
        }

        console.log()
        console.log(chalk.bold('  Relay Server Status'))
        console.log(chalk.dim('  ' + '\u2500'.repeat(40)))

        const server = status.server
        if (server) {
          console.log(`  ${chalk.dim('Running:')}    ${server.running ? chalk.green('Yes') : chalk.red('No')}`)
          if (server.port) console.log(`  ${chalk.dim('Port:')}       ${server.port}`)
        }

        const machines = status.machines
        if (machines) {
          console.log()
          console.log(chalk.bold('  Machines'))
          console.log(`    ${chalk.dim('Total:')}       ${machines.total ?? 0}`)
          console.log(`    ${chalk.dim('Connected:')}   ${machines.connected ?? 0}`)
          console.log(`    ${chalk.dim('Available:')}   ${machines.available ?? 0}`)
        }

        const redis = status.redis
        if (redis) {
          console.log()
          console.log(`  ${chalk.dim('Redis:')}      ${redis.connected ? chalk.green('Connected') : chalk.dim('Not connected')}`)
        }

        if (status.timestamp) {
          console.log(`  ${chalk.dim('Timestamp:')}  ${status.timestamp}`)
        }
        console.log()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (json) {
          print({ error: msg }, { json: true })
        } else {
          console.error(chalk.red(`Failed to get relay status: ${msg}`))
        }
        process.exitCode = 1
      }
    })

  // ── env providers ─────────────────────────────────────────────────
  cmd
    .command('providers')
    .description('List all providers across machines')
    .action(async () => {
      const client = getClient(program.opts().serverUrl)
      const json = program.opts().json

      try {
        const machines = await client.listMachines()
        const active = machines.filter(m => !m.isRevoked)

        // Build provider list from machine provider configs
        const providers: Array<{
          machine: string
          machineId: string
          provider: string
          enabled: boolean
          model: string
          connected: boolean
        }> = []

        for (const m of active) {
          if (m.providerConfigs && Array.isArray(m.providerConfigs)) {
            for (const cfg of m.providerConfigs) {
              providers.push({
                machine: m.name,
                machineId: m.id.slice(0, 8),
                provider: cfg.provider,
                enabled: cfg.enabled,
                model: cfg.defaultModel ?? '\u2014',
                connected: m.isConnected,
              })
            }
          } else if (m.providers && Array.isArray(m.providers)) {
            for (const p of m.providers) {
              providers.push({
                machine: m.name,
                machineId: m.id.slice(0, 8),
                provider: p,
                enabled: true,
                model: '\u2014',
                connected: m.isConnected,
              })
            }
          }
        }

        if (json) {
          print(providers, { json: true })
          return
        }

        const columns: ColumnDef[] = [
          { key: 'machine', label: 'MACHINE', width: 16 },
          { key: 'provider', label: 'PROVIDER', width: 16 },
          { key: 'enabled', label: 'ENABLED', width: 8, format: (v) => v ? chalk.green('\u2713') : chalk.dim('\u2717') },
          { key: 'model', label: 'MODEL', width: 24 },
          { key: 'connected', label: 'CONNECTED', width: 10, format: (v) => v ? chalk.green('\u2713') : chalk.dim('\u2717') },
        ]

        print(providers, { columns })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (json) {
          print({ error: msg }, { json: true })
        } else {
          console.error(chalk.red(`Failed to list providers: ${msg}`))
        }
        process.exitCode = 1
      }
    })

  // ── env clusters ──────────────────────────────────────────────────
  cmd
    .command('clusters')
    .description('List HPC/SLURM clusters')
    .action(async () => {
      const client = getClient(program.opts().serverUrl)
      const json = program.opts().json

      try {
        const clusters = await client.getSlurmClusters() as Array<{
          name?: string
          hostname?: string
          gpus?: number
          activeJobs?: number
          status?: string
          [key: string]: unknown
        }>

        if (json) {
          print(clusters, { json: true })
          return
        }

        if (!Array.isArray(clusters) || clusters.length === 0) {
          console.log(chalk.dim('  No SLURM clusters registered.'))
          return
        }

        const columns: ColumnDef[] = [
          { key: 'name', label: 'NAME', width: 20 },
          { key: 'hostname', label: 'HOSTNAME', width: 24 },
          { key: 'gpus', label: 'GPUS', width: 8 },
          { key: 'activeJobs', label: 'ACTIVE JOBS', width: 12 },
          { key: 'status', label: 'STATUS', width: 12 },
        ]

        print(clusters, { columns })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (json) {
          print({ error: msg }, { json: true })
        } else {
          console.error(chalk.red(`Failed to list clusters: ${msg}`))
        }
        process.exitCode = 1
      }
    })
}
