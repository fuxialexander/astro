import type { Command } from 'commander'
import chalk from 'chalk'
import { loadConfig, saveConfig } from '../config.js'
import { print } from '../output.js'

/** Map CLI key names (kebab-case) to config property names (camelCase) */
const KEY_MAP: Record<string, string> = {
  'server-url': 'serverUrl',
  'default-machine': 'defaultMachineId',
  'auth-token': 'authToken',
  'refresh-token': 'refreshToken',
}

const SUPPORTED_KEYS = Object.keys(KEY_MAP)

function resolveKey(key: string): string | null {
  if (KEY_MAP[key]) return KEY_MAP[key]
  // Allow camelCase keys directly too
  if (Object.values(KEY_MAP).includes(key)) return key
  return null
}

export function registerConfigCommands(program: Command): void {
  const cmd = program.command('config').description('Manage CLI configuration')

  cmd
    .command('show')
    .description('Show current configuration')
    .action(() => {
      const json = program.opts().json
      const config = loadConfig()

      if (json) {
        print(config, { json: true })
        return
      }

      // Human-readable key-value display
      const entries = Object.entries(config)
      if (entries.length === 0) {
        console.log(chalk.dim('  No configuration set.'))
        return
      }

      console.log(chalk.bold('Configuration:\n'))
      for (const [key, value] of entries) {
        const displayValue = (key === 'authToken' || key === 'refreshToken') && typeof value === 'string' && value.length > 8
          ? value.slice(0, 4) + '...' + value.slice(-4)
          : String(value ?? '—')
        console.log(`  ${chalk.dim(key.padEnd(20))} ${displayValue}`)
      }
    })

  cmd
    .command('set <key> <value>')
    .description(`Set a configuration value. Keys: ${SUPPORTED_KEYS.join(', ')}\n\n  Example: astro config set server-url http://localhost:3001`)
    .action((key: string, value: string) => {
      const json = program.opts().json
      const resolved = resolveKey(key)

      if (!resolved) {
        if (json) {
          print({ error: `Unknown config key "${key}". Supported: ${SUPPORTED_KEYS.join(', ')}` }, { json: true })
        } else {
          console.error(chalk.red(`Unknown config key "${key}"`))
          console.error(`Supported keys: ${SUPPORTED_KEYS.join(', ')}`)
        }
        process.exitCode = 1
        return
      }

      saveConfig({ [resolved]: value })

      if (json) {
        print({ ok: true, key: resolved, value }, { json: true })
      } else {
        console.log(chalk.green(`Set ${key} = ${value}`))
      }
    })

  cmd
    .command('get <key>')
    .description(`Get a configuration value. Keys: ${SUPPORTED_KEYS.join(', ')}`)
    .action((key: string) => {
      const json = program.opts().json
      const resolved = resolveKey(key)

      if (!resolved) {
        if (json) {
          print({ error: `Unknown config key "${key}". Supported: ${SUPPORTED_KEYS.join(', ')}` }, { json: true })
        } else {
          console.error(chalk.red(`Unknown config key "${key}"`))
          console.error(`Supported keys: ${SUPPORTED_KEYS.join(', ')}`)
        }
        process.exitCode = 1
        return
      }

      const config = loadConfig()
      const value = (config as unknown as Record<string, unknown>)[resolved]

      if (json) {
        print({ key: resolved, value: value ?? null }, { json: true })
      } else {
        if (value != null) {
          // Mask auth token in human output
          const displayValue = (resolved === 'authToken' || resolved === 'refreshToken') && typeof value === 'string' && value.length > 8
            ? value.slice(0, 4) + '...' + value.slice(-4)
            : String(value)
          console.log(displayValue)
        } else {
          console.log(chalk.dim('(not set)'))
        }
      }
    })
}
