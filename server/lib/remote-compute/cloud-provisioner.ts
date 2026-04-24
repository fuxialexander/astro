import { EC2Client, RunInstancesCommand, TerminateInstancesCommand, DescribeImagesCommand, type InstanceType } from '@aws-sdk/client-ec2'
import { db } from '../db/index.js'
import { connectedAccounts, remoteComputePools } from '../db/schema.js'
import { and, eq } from 'drizzle-orm'
import { readCredentials } from '../encryption.js'
import { isHipaaMode } from '../hipaa-mode.js'

export type CloudProvider = 'astro-cloud' | 'daytona' | 'runloop' | 'aws' | 'gcp'

export interface RunnerPoolLimits {
  maxActiveSandboxes?: number
  maxVcpu?: number
  maxMemoryGb?: number
  maxTtlMinutes?: number
  maxEstimatedHourlyCostUsd?: number
}

export interface RunnerResourceProfile {
  cpu?: number
  memoryGb?: number
  gpu?: number
  ttlMinutes?: number
}

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

// t3 on-demand pricing, us-east-1, as of implementation date.
const AWS_T3_HOURLY: Record<string, number> = {
  'micro': 0.0104, 'small': 0.0208, 'medium': 0.0416,
  'large': 0.0832, 'xlarge': 0.1664, '2xlarge': 0.3328,
}

function pickAwsInstanceType(profile: RunnerResourceProfile): InstanceType {
  const cpu = profile.cpu ?? 1
  const mem = profile.memoryGb ?? 1
  if (cpu <= 1 && mem <= 1)  return 't3.micro'
  if (cpu <= 1 && mem <= 2)  return 't3.small'
  if (cpu <= 2 && mem <= 4)  return 't3.medium'
  if (cpu <= 2 && mem <= 8)  return 't3.large'
  if (cpu <= 4 && mem <= 16) return 't3.xlarge'
  return 't3.2xlarge'
}

function awsHourlyCost(profile: RunnerResourceProfile): number {
  const size = pickAwsInstanceType(profile).split('.')[1]
  return AWS_T3_HOURLY[size] ?? 0.0832
}

function estimateHourlyCostUsd(request: CreateRunnerPoolRequest): number {
  const cpu = request.resourceProfile.cpu ?? 1
  const memoryGb = request.resourceProfile.memoryGb ?? 1
  const runners = request.desiredRunners
  // Daytona public pricing model at time of implementation: vCPU + RAM per hour.
  if (request.provider === 'daytona') return runners * ((cpu * 0.0504) + (memoryGb * 0.0162))
  if (request.provider === 'aws') return runners * awsHourlyCost(request.resourceProfile)
  // Conservative placeholder for providers without a configured pricing adapter.
  return runners * ((cpu * 0.06) + (memoryGb * 0.02))
}

interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
  region?: string
  iamInstanceProfileArn?: string
  subnetId?: string
  securityGroupIds?: string[]
}

function buildUserData(poolId: string, teamId: string, opts?: { autoTerminateHours?: number }): string {
  const serverUrl = process.env.PUBLIC_API_URL ?? 'https://api.astroanywhere.com'
  const relayUrl = process.env.RELAY_WS_URL ?? 'wss://relay.astroanywhere.com:3002'
  const agentUrl = 'https://github.com/astro-anywhere/astro-agent/releases/latest/download/astro-agent-linux-x64'
  // HIPAA: schedule an instance-level shutdown timer. Combined with
  // InstanceInitiatedShutdownBehavior=terminate, this auto-terminates the
  // instance after N hours so no PHI-bearing runner lingers past its session.
  const autoTerminate = opts?.autoTerminateHours && opts.autoTerminateHours > 0
    ? `# HIPAA auto-terminate: shutdown after ${opts.autoTerminateHours}h
(sleep ${Math.round(opts.autoTerminateHours * 3600)} && /sbin/shutdown -h now) &
disown
`
    : ''
  return `#!/usr/bin/env bash
set -euo pipefail
curl -fsSL ${agentUrl} -o /usr/local/bin/astro-agent
chmod +x /usr/local/bin/astro-agent
mkdir -p /etc/astro
cat >/etc/astro/runner.env <<'EOF'
ASTRO_SERVER_URL=${serverUrl}
ASTRO_RELAY_URL=${relayUrl}
ASTRO_REMOTE_POOL_ID=${poolId}
ASTRO_TEAM_ID=${teamId}
EOF
cat >/etc/systemd/system/astro-agent.service <<'UNIT'
[Unit]
Description=Astro Agent Runner
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
EnvironmentFile=/etc/astro/runner.env
ExecStart=/usr/local/bin/astro-agent start --foreground --relay $ASTRO_RELAY_URL --max-tasks 2 --log-level info
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable astro-agent.service
systemctl start astro-agent.service
${autoTerminate}`
}

/** Default auto-terminate window for HIPAA instances, in hours. */
const HIPAA_AUTO_TERMINATE_HOURS_DEFAULT = 4

/**
 * HIPAA enforcement profile applied to AWS runner pools when isHipaaMode().
 *
 * Returns the set of RunInstancesCommand overrides and extra tags required for
 * a HIPAA-compliant runner:
 * - KMS-CMK EBS encryption on root volume (ASTRO_KMS_KEY_ARN required).
 * - Private subnet, no public IP.
 * - IMDSv2-only.
 * - Explicit security group(s) — no 0.0.0.0/0 ingress (enforced by ops config).
 * - Hard-enforced tags for compliance inventory.
 *
 * Throws if ASTRO_KMS_KEY_ARN, subnetId, or securityGroupIds are missing — we
 * fail fast rather than silently fall back to a less-encrypted default.
 */
function buildHipaaRunProfile(creds: AwsCredentials): {
  kmsKeyArn: string
  blockDeviceMappings: Array<{ DeviceName: string; Ebs: { Encrypted: true; KmsKeyId: string; DeleteOnTermination: true } }>
  networkInterface: { DeviceIndex: 0; SubnetId: string; Groups: string[]; AssociatePublicIpAddress: false }
  metadataOptions: { HttpTokens: 'required'; HttpEndpoint: 'enabled'; HttpPutResponseHopLimit: 2 }
  extraTags: Array<{ Key: string; Value: string }>
  autoTerminateHours: number
} {
  const kmsKeyArn = process.env.ASTRO_KMS_KEY_ARN
  if (!kmsKeyArn) {
    throw new Error('HIPAA mode requires ASTRO_KMS_KEY_ARN to be set (KMS CMK for EBS encryption).')
  }
  if (!creds.subnetId) {
    throw new Error('HIPAA mode requires the AWS connected account to specify a private subnetId.')
  }
  if (!creds.securityGroupIds || creds.securityGroupIds.length === 0) {
    throw new Error('HIPAA mode requires the AWS connected account to specify at least one securityGroupId.')
  }
  const autoTerminateHours = Number(process.env.ASTRO_HIPAA_AUTO_TERMINATE_HOURS ?? HIPAA_AUTO_TERMINATE_HOURS_DEFAULT)
  const customerId = process.env.ASTRO_CUSTOMER_ID ?? 'unknown'
  return {
    kmsKeyArn,
    blockDeviceMappings: [{
      DeviceName: '/dev/xvda',
      Ebs: { Encrypted: true, KmsKeyId: kmsKeyArn, DeleteOnTermination: true },
    }],
    networkInterface: {
      DeviceIndex: 0,
      SubnetId: creds.subnetId,
      Groups: creds.securityGroupIds,
      AssociatePublicIpAddress: false,
    },
    metadataOptions: {
      HttpTokens: 'required',
      HttpEndpoint: 'enabled',
      HttpPutResponseHopLimit: 2,
    },
    extraTags: [
      { Key: 'HipaaCompliance', Value: 'true' },
      { Key: 'Customer', Value: customerId },
    ],
    autoTerminateHours,
  }
}

async function getLatestAl2023Ami(ec2: EC2Client): Promise<string> {
  const result = await ec2.send(new DescribeImagesCommand({
    Owners: ['amazon'],
    Filters: [
      { Name: 'name', Values: ['al2023-ami-*-kernel-*-x86_64'] },
      { Name: 'architecture', Values: ['x86_64'] },
      { Name: 'state', Values: ['available'] },
    ],
  }))
  const images = (result.Images ?? []).sort((a, b) =>
    (b.CreationDate ?? '').localeCompare(a.CreationDate ?? ''),
  )
  const amiId = images[0]?.ImageId
  if (!amiId) throw new Error('No Amazon Linux 2023 AMI found in the specified region')
  return amiId
}

class AwsProvisioner implements CloudProvisioner {
  private async getEc2(userId: string, accountId: string | undefined): Promise<{ ec2: EC2Client; creds: AwsCredentials }> {
    const raw = await getAccountCredentials(userId, accountId, 'aws')
    const creds = raw as AwsCredentials
    if (!creds.accessKeyId || !creds.secretAccessKey) throw new Error('AWS connected account is missing accessKeyId or secretAccessKey')
    const ec2 = new EC2Client({
      region: creds.region ?? 'us-east-1',
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
    })
    return { ec2, creds }
  }

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
      projectId: request.projectId,
      status: 'provisioning',
      desiredRunners: request.desiredRunners,
      resourceProfile: request.resourceProfile,
      limits,
      costMetadata: { estimatedHourlyCostUsd },
      expiresAt: new Date(Date.now() + (request.resourceProfile.ttlMinutes ?? 60) * 60_000),
    }).returning()

    try {
      const { ec2, creds } = await this.getEc2(request.userId, request.accountId)
      const instanceType = pickAwsInstanceType(request.resourceProfile)
      const amiId = await getLatestAl2023Ami(ec2)
      const region = creds.region ?? 'us-east-1'
      const hipaa = isHipaaMode() ? buildHipaaRunProfile(creds) : null
      const userData = Buffer.from(buildUserData(pool.id, request.teamId, hipaa
        ? { autoTerminateHours: hipaa.autoTerminateHours }
        : undefined,
      )).toString('base64')

      const baseTags = [
        { Key: 'Name', Value: `astro-runner-${pool.id.slice(0, 8)}` },
        { Key: 'astroPoolId', Value: pool.id },
        { Key: 'astroTeamId', Value: request.teamId },
      ]

      const result = await ec2.send(new RunInstancesCommand({
        ImageId: amiId,
        InstanceType: instanceType,
        MinCount: request.desiredRunners,
        MaxCount: request.desiredRunners,
        UserData: userData,
        IamInstanceProfile: creds.iamInstanceProfileArn ? { Arn: creds.iamInstanceProfileArn } : undefined,
        // In HIPAA mode, subnet + security groups are provided via NetworkInterfaces
        // (so we can force AssociatePublicIpAddress=false). Outside HIPAA, we keep
        // the historical flat SubnetId/SecurityGroupIds so non-HIPAA behavior is unchanged.
        SubnetId: hipaa ? undefined : creds.subnetId,
        SecurityGroupIds: hipaa ? undefined : creds.securityGroupIds,
        NetworkInterfaces: hipaa ? [hipaa.networkInterface] : undefined,
        BlockDeviceMappings: hipaa ? hipaa.blockDeviceMappings : undefined,
        MetadataOptions: hipaa ? hipaa.metadataOptions : undefined,
        InstanceInitiatedShutdownBehavior: 'terminate',
        TagSpecifications: [{
          ResourceType: 'instance',
          Tags: hipaa ? [...baseTags, ...hipaa.extraTags] : baseTags,
        }],
      }))

      const instanceIds = (result.Instances ?? []).map((i) => i.InstanceId).filter((id): id is string => Boolean(id))
      const providerMetadata = { instanceIds, region, instanceType, amiId }

      await db.update(remoteComputePools).set({
        status: 'active',
        activeRunners: instanceIds.length,
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
    const current = existing.length

    const { ec2, creds } = await this.getEc2(pool.userId, undefined)
    const region = creds.region ?? meta.region ?? 'us-east-1'

    if (desiredRunners > current) {
      const toAdd = desiredRunners - current
      const instanceType = (meta.instanceType ?? pickAwsInstanceType(pool.resourceProfile as RunnerResourceProfile)) as InstanceType
      const amiId = meta.amiId ?? await getLatestAl2023Ami(ec2)
      const hipaa = isHipaaMode() ? buildHipaaRunProfile(creds) : null
      const userData = Buffer.from(buildUserData(poolId, pool.teamId, hipaa
        ? { autoTerminateHours: hipaa.autoTerminateHours }
        : undefined,
      )).toString('base64')

      const baseTags = [
        { Key: 'Name', Value: `astro-runner-${poolId.slice(0, 8)}` },
        { Key: 'astroPoolId', Value: poolId },
        { Key: 'astroTeamId', Value: pool.teamId },
      ]

      const result = await ec2.send(new RunInstancesCommand({
        ImageId: amiId,
        InstanceType: instanceType,
        MinCount: toAdd,
        MaxCount: toAdd,
        UserData: userData,
        IamInstanceProfile: creds.iamInstanceProfileArn ? { Arn: creds.iamInstanceProfileArn } : undefined,
        SubnetId: hipaa ? undefined : creds.subnetId,
        SecurityGroupIds: hipaa ? undefined : creds.securityGroupIds,
        NetworkInterfaces: hipaa ? [hipaa.networkInterface] : undefined,
        BlockDeviceMappings: hipaa ? hipaa.blockDeviceMappings : undefined,
        MetadataOptions: hipaa ? hipaa.metadataOptions : undefined,
        InstanceInitiatedShutdownBehavior: 'terminate',
        TagSpecifications: [{
          ResourceType: 'instance',
          Tags: hipaa ? [...baseTags, ...hipaa.extraTags] : baseTags,
        }],
      }))

      const newIds = (result.Instances ?? []).map((i) => i.InstanceId).filter((id): id is string => Boolean(id))
      const allIds = [...existing, ...newIds]
      await db.update(remoteComputePools).set({
        status: 'active',
        desiredRunners,
        activeRunners: allIds.length,
        providerMetadata: { ...meta, instanceIds: allIds, region },
        updatedAt: new Date(),
      }).where(eq(remoteComputePools.id, poolId))
    } else if (desiredRunners < current) {
      const toRemove = existing.slice(desiredRunners)
      const toKeep = existing.slice(0, desiredRunners)
      await ec2.send(new TerminateInstancesCommand({ InstanceIds: toRemove }))
      await db.update(remoteComputePools).set({
        desiredRunners,
        activeRunners: toKeep.length,
        providerMetadata: { ...meta, instanceIds: toKeep, region },
        updatedAt: new Date(),
      }).where(eq(remoteComputePools.id, poolId))
    }
  }

  async terminateRunnerPool(poolId: string): Promise<void> {
    const [pool] = await db.select().from(remoteComputePools).where(eq(remoteComputePools.id, poolId)).limit(1)
    if (!pool) return

    await db.update(remoteComputePools).set({ status: 'terminating', activeRunners: 0, updatedAt: new Date() }).where(eq(remoteComputePools.id, poolId))

    try {
      const meta = pool.providerMetadata as { instanceIds?: string[] }
      const instanceIds = meta.instanceIds ?? []
      if (instanceIds.length > 0) {
        const { ec2 } = await this.getEc2(pool.userId, undefined)
        await ec2.send(new TerminateInstancesCommand({ InstanceIds: instanceIds }))
      }
    } catch {
      // Best-effort: instances may already be terminated or credentials may be revoked.
    }

    await db.update(remoteComputePools).set({ status: 'terminated', updatedAt: new Date() }).where(eq(remoteComputePools.id, poolId))
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
    // Provider-side deletion is intentionally best-effort in v1 because
    // provider response shapes vary; TTL/auto-stop is still configured at create.
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
  return new UnsupportedProvisioner(provider)
}
