/**
 * Renderer-driven cloud pool operations.
 *
 * The renderer triggers AWS/GCP create/scale/terminate via IPC; the main
 * process loads local credentials (AWS shared config / GCP ADC), uses the
 * provisioner classes from @astro/core, and returns instance metadata. Raw
 * credentials never leave this process — the renderer only sees instance
 * ids, region, instance type, and cost metadata.
 *
 * Errors are returned as `{ ok: false, error }` rather than thrown so the
 * renderer can surface a user-visible message without an unhandled-rejection
 * pattern in every caller.
 */

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fromIni } from '@aws-sdk/credential-provider-ini'
import { fromEnv } from '@aws-sdk/credential-provider-env'
import {
  AwsCloudOps,
  GcpCloudOps,
  estimateHourlyCostUsd,
  type AwsCredentials,
  type GcpCredentials,
  type ProvisionRequest,
  type ResourceProfile,
} from '@astro/core/cloud-provisioner'
import { defineHandler } from '../registry.js'
import * as schema from '../schema/cloud-pool.js'

interface CloudConfig {
  profile?: string
  region?: string
  project?: string
  adcPath?: string
  zone?: string
}

// "(env)" is the marker emitted by cloud-creds:detect when credentials come
// from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY rather than a named profile.
const ENV_PROFILE_MARKER = '(env)'

async function loadAwsCredentials(config: CloudConfig): Promise<AwsCredentials> {
  const region = config.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1'

  const provider = config.profile && config.profile !== ENV_PROFILE_MARKER
    ? fromIni({ profile: config.profile })
    : fromEnv()

  const resolved = await provider()
  if (!resolved.accessKeyId || !resolved.secretAccessKey) {
    throw new Error('Resolved AWS credentials are missing accessKeyId or secretAccessKey')
  }
  return {
    accessKeyId: resolved.accessKeyId,
    secretAccessKey: resolved.secretAccessKey,
    region,
  }
}

function loadGcpCredentials(config: CloudConfig): GcpCredentials {
  if (!config.project) {
    throw new Error('GCP config missing required field: project')
  }

  const adcCandidate = config.adcPath
    ?? process.env.GOOGLE_APPLICATION_CREDENTIALS
    ?? join(homedir(), '.config', 'gcloud', 'application_default_credentials.json')

  if (!existsSync(adcCandidate)) {
    throw new Error(
      `No GCP credentials found at ${adcCandidate}. Run \`gcloud auth application-default login\` ` +
      `or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file.`,
    )
  }

  const contents = readFileSync(adcCandidate, 'utf8')
  let parsed: { type?: string }
  try {
    parsed = JSON.parse(contents) as { type?: string }
  } catch {
    throw new Error(`GCP credential file at ${adcCandidate} is not valid JSON.`)
  }

  if (parsed.type === 'service_account') {
    return {
      project: config.project,
      serviceAccountJson: contents,
      zone: config.zone ?? 'us-central1-a',
    }
  }

  // User-credential ADC files (gcloud auth application-default login) are OAuth
  // refresh tokens, not service-account keys. GcpCloudOps can't parse them, but
  // google-auth-library handles them natively if GOOGLE_APPLICATION_CREDENTIALS
  // points at the file. Electron's main process doesn't inherit the user's shell
  // env, so set it here. Single-user desktop — no race-condition risk.
  process.env.GOOGLE_APPLICATION_CREDENTIALS = adcCandidate

  return {
    project: config.project,
    serviceAccountJson: null,
    zone: config.zone ?? 'us-central1-a',
  }
}

function buildProvisionRequest(req: {
  poolId: string
  teamId: string
  desiredRunners: number
  resourceProfile: ResourceProfile
  serverUrl: string
  relayUrl: string
}): ProvisionRequest {
  return {
    poolId: req.poolId,
    teamId: req.teamId,
    desiredRunners: req.desiredRunners,
    resourceProfile: req.resourceProfile,
    serverUrl: req.serverUrl,
    relayUrl: req.relayUrl,
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function registerCloudPoolChannels(): void {
  defineHandler('cloud-pool:create', schema.create, async (req) => {
    try {
      const provisionReq = buildProvisionRequest(req)
      const estimatedHourlyCostUsd = estimateHourlyCostUsd({
        provider: req.provider,
        desiredRunners: req.desiredRunners,
        resourceProfile: req.resourceProfile,
      })

      if (req.provider === 'aws') {
        const creds = await loadAwsCredentials(req.config)
        const ops = new AwsCloudOps(creds)
        const result = await ops.createInstances(provisionReq)
        return {
          ok: true,
          instanceIds: result.instanceIds,
          region: result.region,
          instanceType: result.instanceType,
          amiId: result.amiId,
          costMetadata: { estimatedHourlyCostUsd },
        }
      }

      const creds = loadGcpCredentials(req.config)
      const ops = new GcpCloudOps(creds)
      const result = await ops.createInstances(provisionReq)
      return {
        ok: true,
        instanceIds: result.instanceIds,
        region: result.region,
        instanceType: result.instanceType,
        costMetadata: { estimatedHourlyCostUsd },
      }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  defineHandler('cloud-pool:scale', schema.scale, async (req) => {
    try {
      const provisionReq = buildProvisionRequest(req)

      if (req.provider === 'aws') {
        const creds = await loadAwsCredentials(req.config)
        const ops = new AwsCloudOps(creds)
        const result = await ops.scaleInstances(req.currentInstanceIds, req.desiredRunners, provisionReq)
        return {
          ok: true,
          instanceIds: result.instanceIds,
          added: result.added,
          removed: result.removed,
        }
      }

      const creds = loadGcpCredentials(req.config)
      const ops = new GcpCloudOps(creds)
      const result = await ops.scaleInstances(req.currentInstanceIds, req.desiredRunners, provisionReq)
      return {
        ok: true,
        instanceIds: result.instanceIds,
        added: result.added,
        removed: result.removed,
      }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  defineHandler('cloud-pool:terminate', schema.terminate, async (req) => {
    try {
      if (req.provider === 'aws') {
        const creds = await loadAwsCredentials(req.config)
        const ops = new AwsCloudOps(creds)
        await ops.terminateInstances(req.instanceIds)
        return { ok: true }
      }

      const creds = loadGcpCredentials(req.config)
      const ops = new GcpCloudOps(creds)
      await ops.terminateInstances(req.instanceIds)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })
}
