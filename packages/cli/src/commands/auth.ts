import type { Command } from 'commander'
import chalk from 'chalk'
import { exec } from 'node:child_process'
import { hostname, platform } from 'node:os'
import { loadConfig, saveConfig, clearAuth, resetConfig, getServerUrl } from '../config.js'
import { print } from '../output.js'

interface DeviceAuthResponse {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

interface DeviceTokenResponse {
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  scopes: string[]
}

interface DeviceTokenError {
  error: string
  errorDescription?: string
}

function openUrl(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : 'xdg-open'
  exec(`${cmd} ${JSON.stringify(url)}`, () => {
    // Ignore errors (e.g., no browser available)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Authenticate with the Astro server via device code flow')
    .action(async () => {
      const json = program.opts().json
      // Reset config before login; use --server-url override or default
      resetConfig()
      const serverUrl = program.opts().serverUrl || getServerUrl()

      try {
        // Step 1: Request device code
        const authRes = await fetch(new URL('/api/device/authorize', serverUrl).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scopes: ['machine:connect', 'machine:execute', 'machine:read'],
            machineInfo: {
              hostname: hostname(),
              platform: platform(),
            },
          }),
        })

        if (!authRes.ok) {
          const text = await authRes.text()
          throw new Error(`Failed to request device code: ${text}`)
        }

        const authData = await authRes.json() as DeviceAuthResponse

        // Step 2: Display code and open browser
        if (!json) {
          console.log()
          console.log(chalk.bold('Device Authorization'))
          console.log()
          console.log(`  Code:  ${chalk.bold.cyan(authData.deviceCode)}`)
          console.log(`  URL:   ${chalk.underline(authData.verificationUri)}`)
          console.log()
          console.log(chalk.dim('Opening browser...'))
        }

        openUrl(authData.verificationUriComplete)

        // Step 3: Poll for authorization
        let interval = authData.interval * 1000
        const deadline = Date.now() + authData.expiresIn * 1000

        while (Date.now() < deadline) {
          await sleep(interval)

          const tokenRes = await fetch(new URL('/api/device/token', serverUrl).toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userCode: authData.userCode,
              grantType: 'urn:ietf:params:oauth:grant-type:device_code',
            }),
          })

          if (tokenRes.ok) {
            const tokenData = await tokenRes.json() as DeviceTokenResponse
            // Save tokens and server URL
            saveConfig({
              serverUrl,
              authToken: tokenData.accessToken,
              refreshToken: tokenData.refreshToken,
            })

            if (json) {
              print({ ok: true, expiresIn: tokenData.expiresIn }, { json: true })
            } else {
              console.log(chalk.green('\nAuthenticated successfully!'))
            }
            return
          }

          const errData = await tokenRes.json() as DeviceTokenError

          switch (errData.error) {
            case 'authorization_pending':
              // Keep polling
              if (!json) {
                process.stdout.write(chalk.dim('.'))
              }
              break
            case 'slow_down':
              interval += 5000
              break
            case 'access_denied':
              throw new Error('Authorization denied by user')
            case 'expired_token':
              throw new Error('Device code expired. Please try again.')
            default:
              throw new Error(errData.errorDescription || errData.error)
          }
        }

        throw new Error('Device code expired. Please try again.')
      } catch (err) {
        if (json) {
          print({ error: err instanceof Error ? err.message : String(err) }, { json: true })
        } else {
          console.error(chalk.red(`\nLogin failed: ${err instanceof Error ? err.message : err}`))
        }
        process.exitCode = 1
      }
    })

  program
    .command('logout')
    .description('Clear stored authentication tokens')
    .action(async () => {
      const json = program.opts().json
      const config = loadConfig()
      const serverUrl = getServerUrl(program.opts().serverUrl)

      // Best-effort revoke refresh token on server
      if (config.refreshToken) {
        try {
          await fetch(new URL('/api/device/revoke', serverUrl).toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: config.refreshToken }),
          })
        } catch {
          // Ignore revocation errors
        }
      }

      clearAuth()

      if (json) {
        print({ ok: true }, { json: true })
      } else {
        console.log(chalk.green('Logged out.'))
      }
    })

  program
    .command('whoami')
    .description('Show current authentication status')
    .action(async () => {
      const json = program.opts().json
      const config = loadConfig()

      if (!config.authToken) {
        if (json) {
          print({ authenticated: false }, { json: true })
        } else {
          console.log(chalk.yellow('Not logged in. Run `astro login` to authenticate.'))
        }
        return
      }

      const serverUrl = getServerUrl(program.opts().serverUrl)

      try {
        const res = await fetch(new URL('/api/health', serverUrl).toString(), {
          headers: { Authorization: `Bearer ${config.authToken}` },
        })

        if (res.ok) {
          const data = await res.json() as Record<string, unknown>
          if (json) {
            print({ authenticated: true, server: serverUrl, ...data }, { json: true })
          } else {
            console.log(chalk.green('Authenticated'))
            console.log(`  Server:  ${serverUrl}`)
            if (data.mode) console.log(`  Mode:    ${data.mode}`)
          }
        } else if (res.status === 401) {
          if (json) {
            print({ authenticated: false, expired: true }, { json: true })
          } else {
            console.log(chalk.yellow('Token expired. Run `astro login` to re-authenticate.'))
          }
        } else {
          throw new Error(`Server returned ${res.status}`)
        }
      } catch (err) {
        if (json) {
          print({ authenticated: false, error: err instanceof Error ? err.message : String(err) }, { json: true })
        } else {
          console.error(chalk.red(`Failed to reach server: ${err instanceof Error ? err.message : err}`))
        }
        process.exitCode = 1
      }
    })
}
