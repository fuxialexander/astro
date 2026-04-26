import { db } from '../db/index.js'
import { connectedAccounts, remoteComputePools } from '../db/schema.js'
import { and, eq } from 'drizzle-orm'
import { readCredentials } from '../encryption.js'
import { isHipaaMode } from '../hipaa-mode.js'
import {
  AwsCloudOps,
  GcpCloudOps,
  estimateHourlyCostUsd,
  type AwsCredentials,
  type CloudProvider,
  type GcpCredentials,
  type HipaaConfig,
  type PoolLimits,
  type ProvisionRequest,
  type ResourceProfile,
} from '@astro/core/cloud-provisioner'

export type { CloudProvider } from '@astro/core/cloud-provisioner'
export type RunnerPoolLimits = PoolLimits
export type RunnerResourceProfile = ResourceProfile

export interface CreateRunnerPoolRequest {
  teamId: string
  userId: string
  provider: CloudProvider
  accountId?: string
  projectId?: string
  desiredRunners: number
  resourceProfile: RunnerResourceProfile
  limits: RunnerPoolLimits
}

export interface ProvisionedRunnerPool {
  id: string
  status: 'provisioning' | 'active' | 'failed'
  providerMetadata: Record<string, unknown>
  costMetadata: Record<string, unknown>
  error?: string
}

export interface CloudProvisioner {
  createRunnerPool(request: CreateRunnerPoolRequest): Promise<ProvisionedRunnerPool>
  scaleRunnerPool(poolId: string, desiredRunners: number): Promise<void>
  terminateRunnerPool(poolId: string): Promise<void>
}

const DEFAULT_LIMITS: Required<RunnerPoolLimits> = {
  maxActiveSandboxes: 4,
  maxVcpu: 16,
  maxMemoryGb: 32,
  maxTtlMinutes: 240,
  maxEstimatedHourlyCostUsd: 2,
}

function applyLimits(request: CreateRunnerPoolRequest): Required<RunnerPoolLimits> {
  const limits = { ...DEFAULT_LIMITS, ...request.limits }
  const cpu = request.resourceProfile.cpu ?? 1
  const memoryGb = request.resourceProfile.memoryGb ?? 1
  const ttlMinutes = request.resourceProfile.ttlMinutes ?? 60
  const totalVcpu = cpu * request.desiredRunners
  const totalMemory = memoryGb * request.desiredRunners

  if (request.desiredRunners < 1 || request.desiredRunners > limits.maxActiveSandboxes) {
    throw new Error(`desiredRunners must be between 1 and ${limits.maxActiveSandboxes}`)
  }
  if (totalVcpu > limits.maxVcpu) {
    throw new Error(`Requested vCPU (${totalVcpu}) exceeds limit (${limits.maxVcpu})`)
  }
  if (totalMemory > limits.maxMemoryGb) {
    throw new Error(`Requested memory (${totalMemory}GB) exceeds limit (${limits.maxMemoryGb}GB)`)
  }
  if (ttlMinutes > limits.maxTtlMinutes) {
    throw new Error(`TTL (${ttlMinutes} minutes) exceeds limit (${limits.maxTtlMinutes} minutes)`)
  }
  return limits
}

const HIPAA_AUTO_TERMINATE_HOURS_DEFAULT = 4

function resolveHipaaConfig(): HipaaConfig {
  const kmsKeyArn = process.env.ASTRO_KMS_KEY_ARN
  if (!kmsKeyArn) {
    throw new Error('HIPAA mode requires ASTRO_KMS_KEY_ARN to be set (KMS CMK for EBS encryption).')
  }
  return {
    kmsKeyArn,
    customerId: process.env.ASTRO_CUSTOMER_ID ?? 'unknown',
    autoTerminateHours: Number(process.env.ASTRO_HIPAA_AUTO_TERMINATE_HOURS ?? HIPAA_AUTO_TERMINATE_HOURS_DEFAULT),
  }
}

function relayEnv(): { serverUrl: string; relayUrl: string } {
  return {
    serverUrl: process.env.PUBLIC_API_URL ?? 'https://api.astroanywhere.com',
    relayUrl: process.env.RELAY_WS_URL ?? 'wss://relay.astroanywhere.com:3002',
  }
}

async function getAccountCredentials(userId: string, accountId: string | undefined, channel: CloudProvider) {
  const rows = await db.select().from(connectedAccounts).where(
    and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.channel, channel), eq(connectedAccounts.enabled, true))
  )
  const row = accountId ? rows.find((r) => r.id === accountId) : rows[0]
  if (!row) throw new Error(`No enabled ${channel} connected account found`)
  return readCredentials(row.credentials)
}

class AwsProvisioner implements CloudProvisioner {
  async createRunnerPool(request: CreateRunnerPoolRequest): Promise<ProvisionedRunnerPool> {
    const limits = applyLimits(request)
    const estimatedHourlyCostUsd = estimateHourlyCostUsd(request)
    if (estimatedHourlyCostUsd > limits.maxEstimatedHourlyCostUsd) {
      throw new Error(`Estimated hourly cost $${estimatedHourlyCostUsd.toFixed(2)} exceeds limit $${limits.maxEstimatedHourlyCostUsd.toFixed(2)}`)
    }

    const [pool] = await db.insert(remoteComputePools).values({
      teamId: request.teamId,
      userId: request.userId,
      provider: request.provider,
      provisionerType: 'server',
      projectId: request.projectId,
      status: 'provisioning',
      desiredRunners: request.desiredRunners,
      resourceProfile: request.resourceProfile,
      limits,
      costMetadata: { estimatedHourlyCostUsd },
      expiresAt: new Date(Date.now() + (request.resourceProfile.ttlMinutes ?? 60) * 60_000),
    }).returning()

    try {
      const creds = (await getAccountCredentials(request.userId, request.accountId, 'aws')) as AwsCredentials
      const ops = new AwsCloudOps(creds, isHipaaMode() ? resolveHipaaConfig() : undefined)
      const env = relayEnv()
      const result = await ops.createInstances({
        poolId: pool.id,
        teamId: request.teamId,
        desiredRunners: request.desiredRunners,
        resourceProfile: request.resourceProfile,
        serverUrl: env.serverUrl,
        relayUrl: env.relayUrl,
      })

      const providerMetadata = { ...result }
      await db.update(remoteComputePools).set({
        status: 'active',
        activeRunners: result.instanceIds.length,
        providerMetadata,
        updatedAt: new Date(),
      }).where(eq(remoteComputePools.id, pool.id))

      return { id: pool.id, status: 'active', providerMetadata, costMetadata: { estimatedHourlyCostUsd } }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      await db.update(remoteComputePools).set({ status: 'failed', error, updatedAt: new Date() }).where(eq(remoteComputePools.id, pool.id))
      return { id: pool.id, status: 'failed', providerMetadata: {}, costMetadata: { estimatedHourlyCostUsd }, error }
    }
  }

  async scaleRunnerPool(poolId: string, desiredRunners: number): Promise<void> {
    const [pool] = await db.select().from(remoteComputePools).where(eq(remoteComputePools.id, poolId)).limit(1)
    if (!pool) throw new Error(`Pool ${poolId} not found`)
    const meta = pool.providerMetadata as { instanceIds?: string[]; instanceType?: string; amiId?: string; region?: string }
    const existing = meta.instanceIds ?? []

    const creds = (await getAccountCredentials(pool.userId, undefined, 'aws')) as AwsCredentials
    const ops = new AwsCloudOps(creds, isHipaaMode() ? resolveHipaaConfig() : undefined)
    const env = relayEnv()
    const req: ProvisionRequest = {
      poolId,
      teamId: pool.teamId,
      desiredRunners,
      resourceProfile: pool.resourceProfile as ResourceProfile,
      serverUrl: env.serverUrl,
      relayUrl: env.relayUrl,
    }
    const scale = await ops.scaleInstances(existing, desiredRunners, req)
    const region = creds.region ?? meta.region ?? 'us-east-1'

    await db.update(remoteComputePools).set({
      status: 'active',
      desiredRunners,
      activeRunners: scale.instanceIds.length,
      providerMetadata: { ...meta, instanceIds: scale.instanceIds, region },
      updatedAt: new Date(),
    }).where(eq(remoteComputePools.id, poolId))
  }

  async terminateRunnerPool(poolId: string): Promise<void> {
    const [pool] = await db.select().from(remoteComputePools).where(eq(remoteComputePools.id, poolId)).limit(1)
    if (!pool) return

    await db.update(remoteComputePools).set({ status: 'terminating', activeRunners: 0, updatedAt: new Date() }).where(eq(remoteComputePools.id, poolId))

    try {
      const meta = pool.providerMetadata as { instanceIds?: string[] }
      const instanceIds = meta.instanceIds ?? []
      if (instanceIds.length > 0) {
        const creds = (await getAccountCredentials(pool.userId, undefined, 'aws')) as AwsCredentials
        const ops = new AwsCloudOps(creds, isHipaaMode() ? resolveHipaaConfig() : undefined)
        await ops.terminateInstances(instanceIds)
      }
    } catch {
      // Best-effort: instances may already be terminated or credentials may be revoked.
    }

    await db.update(remoteComputePools).set({ status: 'terminated', updatedAt: new Date() }).where(eq(remoteComputePools.id, poolId))
  }
}

class GcpProvisioner implements CloudProvisioner {
  async createRunnerPool(request: CreateRunnerPoolRequest): Promise<ProvisionedRunnerPool> {
    const limits = applyLimits(request)
    const estimatedHourlyCostUsd = estimateHourlyCostUsd(request)
    if (estimatedHourlyCostUsd > limits.maxEstimatedHourlyCostUsd) {
      throw new Error(`Estimated hourly cost $${estimatedHourlyCostUsd.toFixed(2)} exceeds limit $${limits.maxEstimatedHourlyCostUsd.toFixed(2)}`)
    }

    const [pool] = await db.insert(remoteComputePools).values({
      teamId: request.teamId,
      userId: request.userId,
      provider: request.provider,
      provisionerType: 'server',
      projectId: request.projectId,
      status: 'provisioning',
      desiredRunners: request.desiredRunners,
      resourceProfile: request.resourceProfile,
      limits,
      costMetadata: { estimatedHourlyCostUsd },
      expiresAt: new Date(Date.now() + (request.resourceProfile.ttlMinutes ?? 60) * 60_000),
    }).returning()

    try {
      const creds = (await getAccountCredentials(request.userId, request.accountId, 'gcp')) as GcpCredentials
      const ops = new GcpCloudOps(creds)
      const env = relayEnv()
      const result = await ops.createInstances({
        poolId: pool.id,
        teamId: request.teamId,
        desiredRunners: request.desiredRunners,
        resourceProfile: request.resourceProfile,
        serverUrl: env.serverUrl,
        relayUrl: env.relayUrl,
      })

      const providerMetadata = { ...result }
      await db.update(remoteComputePools).set({
        status: 'active',
        activeRunners: result.instanceIds.length,
        providerMetadata,
        updatedAt: new Date(),
      }).where(eq(remoteComputePools.id, pool.id))

      return { id: pool.id, status: 'active', providerMetadata, costMetadata: { estimatedHourlyCostUsd } }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      await db.update(remoteComputePools).set({ status: 'failed', error, updatedAt: new Date() }).where(eq(remoteComputePools.id, pool.id))
      return { id: pool.id, status: 'failed', providerMetadata: {}, costMetadata: { estimatedHourlyCostUsd }, error }
    }
  }

  async scaleRunnerPool(poolId: string, desiredRunners: number): Promise<void> {
    const [pool] = await db.select().from(remoteComputePools).where(eq(remoteComputePools.id, poolId)).limit(1)
    if (!pool) throw new Error(`Pool ${poolId} not found`)
    const meta = pool.providerMetadata as { instanceIds?: string[]; instanceType?: string; region?: string }
    const existing = meta.instanceIds ?? []

    const creds = (await getAccountCredentials(pool.userId, undefined, 'gcp')) as GcpCredentials
    const ops = new GcpCloudOps(creds)
    const env = relayEnv()
    const scale = await ops.scaleInstances(existing, desiredRunners, {
      poolId,
      teamId: pool.teamId,
      desiredRunners,
      resourceProfile: pool.resourceProfile as ResourceProfile,
      serverUrl: env.serverUrl,
      relayUrl: env.relayUrl,
    })

    await db.update(remoteComputePools).set({
      status: 'active',
      desiredRunners,
      activeRunners: scale.instanceIds.length,
      providerMetadata: { ...meta, instanceIds: scale.instanceIds },
      updatedAt: new Date(),
    }).where(eq(remoteComputePools.id, poolId))
  }

  async terminateRunnerPool(poolId: string): Promise<void> {
    const [pool] = await db.select().from(remoteComputePools).where(eq(remoteComputePools.id, poolId)).limit(1)
    if (!pool) return

    await db.update(remoteComputePools).set({ status: 'terminating', activeRunners: 0, updatedAt: new Date() }).where(eq(remoteComputePools.id, poolId))

    try {
      const meta = pool.providerMetadata as { instanceIds?: string[] }
      const instanceIds = meta.instanceIds ?? []
      if (instanceIds.length > 0) {
        const creds = (await getAccountCredentials(pool.userId, undefined, 'gcp')) as GcpCredentials
        const ops = new GcpCloudOps(creds)
        await ops.terminateInstances(instanceIds)
      }
    } catch {
      // Best-effort.
    }

    await db.update(remoteComputePools).set({ status: 'terminated', updatedAt: new Date() }).where(eq(remoteComputePools.id, poolId))
  }
}

class DaytonaProvisioner implements CloudProvisioner {
  async createRunnerPool(request: CreateRunnerPoolRequest): Promise<ProvisionedRunnerPool> {
    const limits = applyLimits(request)
    const estimatedHourlyCostUsd = estimateHourlyCostUsd(request)
    if (estimatedHourlyCostUsd > limits.maxEstimatedHourlyCostUsd) {
      throw new Error(`Estimated hourly cost $${estimatedHourlyCostUsd.toFixed(2)} exceeds limit $${limits.maxEstimatedHourlyCostUsd.toFixed(2)}`)
    }

    const [pool] = await db.insert(remoteComputePools).values({
      teamId: request.teamId,
      userId: request.userId,
      provider: request.provider,
      provisionerType: 'server',
      projectId: request.projectId,
      status: 'provisioning',
      desiredRunners: request.desiredRunners,
      resourceProfile: request.resourceProfile,
      limits,
      costMetadata: { estimatedHourlyCostUsd },
      expiresAt: new Date(Date.now() + (request.resourceProfile.ttlMinutes ?? 60) * 60_000),
    }).returning()

    try {
      const credentials = await getAccountCredentials(request.userId, request.accountId, 'daytona')
      const apiKey = String(credentials.apiKey ?? '')
      if (!apiKey) throw new Error('Daytona API key is missing')

      const sandboxes = []
      for (let i = 0; i < request.desiredRunners; i++) {
        const res = await fetch('https://app.daytona.io/api/sandbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            labels: {
              astroPoolId: pool.id,
              astroTeamId: request.teamId,
              astroProjectId: request.projectId ?? '',
            },
            envVars: {
              ASTRO_REMOTE_POOL_ID: pool.id,
              ASTRO_TEAM_ID: request.teamId,
            },
            resources: {
              cpu: request.resourceProfile.cpu ?? 1,
              memory: request.resourceProfile.memoryGb ?? 1,
            },
            autoStopInterval: request.resourceProfile.ttlMinutes ?? 60,
          }),
        })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(`Daytona sandbox create failed (${res.status}): ${text}`)
        }
        sandboxes.push(await res.json() as Record<string, unknown>)
      }

      const providerMetadata = { sandboxes }
      await db.update(remoteComputePools).set({
        status: 'active',
        activeRunners: sandboxes.length,
        providerMetadata,
        updatedAt: new Date(),
      }).where(eq(remoteComputePools.id, pool.id))

      return { id: pool.id, status: 'active', providerMetadata, costMetadata: { estimatedHourlyCostUsd } }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      await db.update(remoteComputePools).set({ status: 'failed', error, updatedAt: new Date() }).where(eq(remoteComputePools.id, pool.id))
      return { id: pool.id, status: 'failed', providerMetadata: {}, costMetadata: { estimatedHourlyCostUsd }, error }
    }
  }

  async scaleRunnerPool(): Promise<void> {
    throw new Error('Daytona pool scaling is not implemented yet; create a new pool with the desired size')
  }

  async terminateRunnerPool(poolId: string): Promise<void> {
    await db.update(remoteComputePools).set({
      status: 'terminating',
      activeRunners: 0,
      updatedAt: new Date(),
    }).where(eq(remoteComputePools.id, poolId))
    await db.update(remoteComputePools).set({
      status: 'terminated',
      updatedAt: new Date(),
    }).where(eq(remoteComputePools.id, poolId))
  }
}

class UnsupportedProvisioner implements CloudProvisioner {
  constructor(private provider: CloudProvider) {}
  async createRunnerPool(): Promise<ProvisionedRunnerPool> {
    throw new Error(`${this.provider} runner provisioning is not implemented in v1`)
  }
  async scaleRunnerPool(): Promise<void> {
    throw new Error(`${this.provider} runner scaling is not implemented in v1`)
  }
  async terminateRunnerPool(poolId: string): Promise<void> {
    await db.update(remoteComputePools).set({ status: 'terminated', activeRunners: 0, updatedAt: new Date() }).where(eq(remoteComputePools.id, poolId))
  }
}

export function getCloudProvisioner(provider: CloudProvider): CloudProvisioner {
  // HIPAA mode: only AWS is allowed. Reject every other provider at the
  // factory boundary so we fail before touching a non-AWS API.
  if (isHipaaMode() && provider !== 'aws' && provider !== 'astro-cloud') {
    throw new Error(`HIPAA mode only supports the 'aws' provider (got '${provider}').`)
  }
  if (provider === 'daytona') return new DaytonaProvisioner()
  if (provider === 'aws' || provider === 'astro-cloud') return new AwsProvisioner()
  if (provider === 'gcp') return new GcpProvisioner()
  return new UnsupportedProvisioner(provider)
}
