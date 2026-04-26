/**
 * Local cloud credential detection.
 *
 * Pure filesystem + env reads — no child_process, no SDK calls. Lets the
 * renderer show "AWS detected" / "GCP detected" badges without requiring
 * the backend to set ASTRO_DESKTOP=1.
 */

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/cloud-creds.js'

type Source = 'env' | 'credentials-file' | 'config-file' | 'adc-file' | 'none'

interface AwsResult {
  detected: boolean
  profiles?: string[]
  defaultRegion?: string | null
  source: Source
}

interface GcpResult {
  detected: boolean
  project?: string | null
  account?: string | null
  source: Source
}

function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  let section: string | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      let name = line.slice(1, -1).trim()
      // AWS config uses "[profile foo]" — normalize to "foo"
      if (name.startsWith('profile ')) name = name.slice('profile '.length).trim()
      section = name
      if (!out[section]) out[section] = {}
      continue
    }
    if (!section) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    out[section][key] = value
  }
  return out
}

function safeRead(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function detectAws(): AwsResult {
  try {
    const envKey = process.env.AWS_ACCESS_KEY_ID
    const envProfile = process.env.AWS_PROFILE
    const home = homedir()
    const credsText = safeRead(join(home, '.aws', 'credentials'))
    const configText = safeRead(join(home, '.aws', 'config'))

    const credsIni = credsText ? parseIni(credsText) : {}
    const configIni = configText ? parseIni(configText) : {}

    const profileSet = new Set<string>([
      ...Object.keys(credsIni),
      ...Object.keys(configIni),
    ])

    const defaultRegion =
      configIni['default']?.region ??
      credsIni['default']?.region ??
      null

    if (envKey) {
      const envRegion =
        process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? null
      const profiles = profileSet.size > 0 ? Array.from(profileSet) : ['(env)']
      return {
        detected: true,
        profiles,
        defaultRegion: envRegion ?? defaultRegion,
        source: 'env',
      }
    }

    if (envProfile) {
      const profiles = profileSet.size > 0 ? Array.from(profileSet) : [envProfile]
      return {
        detected: true,
        profiles,
        defaultRegion,
        source: 'env',
      }
    }

    if (credsText) {
      return {
        detected: true,
        profiles: Array.from(profileSet),
        defaultRegion,
        source: 'credentials-file',
      }
    }
    if (configText) {
      return {
        detected: true,
        profiles: Array.from(profileSet),
        defaultRegion,
        source: 'config-file',
      }
    }

    return { detected: false, source: 'none' }
  } catch {
    return { detected: false, source: 'none' }
  }
}

function detectGcp(): GcpResult {
  try {
    const home = homedir()
    const gcloudDir = join(home, '.config', 'gcloud')

    let detected = false
    let source: Source = 'none'
    let project: string | null = null
    let account: string | null = null

    const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS
    if (gac && existsSync(gac)) {
      detected = true
      source = 'env'
    }

    const envProject = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null
    if (envProject) {
      detected = true
      if (source === 'none') source = 'env'
      project = envProject
    }

    if (!detected) {
      const adcPath = join(gcloudDir, 'application_default_credentials.json')
      if (existsSync(adcPath)) {
        detected = true
        source = 'adc-file'
      }
    }

    // Enrich with active config (project/account), regardless of detection source.
    const activeText = safeRead(join(gcloudDir, 'active_config'))
    const activeName = activeText ? activeText.trim() : null
    if (activeName) {
      const cfgText = safeRead(join(gcloudDir, 'configurations', `config_${activeName}`))
      if (cfgText) {
        const ini = parseIni(cfgText)
        const core = ini['core'] ?? {}
        if (!project && core.project) project = core.project
        if (core.account) account = core.account
        if (!detected && (core.project || core.account)) {
          detected = true
          source = 'config-file'
        }
      }
    }

    if (!detected) return { detected: false, source: 'none' }
    return { detected, project, account, source }
  } catch {
    return { detected: false, source: 'none' }
  }
}

export function registerCloudCredsChannels(): void {
  defineHandler('cloud-creds:detect', schema.detect, async () => {
    return {
      aws: detectAws(),
      gcp: detectGcp(),
    }
  })
}
