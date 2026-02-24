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
}
