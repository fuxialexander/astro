import { InstancesClient } from '@google-cloud/compute'
import type {
  GcpCredentials,
  HipaaConfig,
  ProvisionRequest,
  ProvisionResult,
  ScaleResult,
} from './types.js'
import { pickGcpMachineType } from './pricing.js'
import { buildStartupScript } from './user-data.js'

const DEFAULT_ZONE = 'us-central1-a'
const DEFAULT_DISK_SIZE_GB = 20
const SOURCE_IMAGE = 'projects/debian-cloud/global/images/family/debian-12'

export class GcpCloudOps {
  private readonly client: InstancesClient
  private readonly project: string
  private readonly zone: string
  private readonly network: string
  private readonly subnetwork?: string
  private readonly serviceAccountEmail?: string

  constructor(private readonly creds: GcpCredentials, hipaaConfig?: HipaaConfig) {
    if (hipaaConfig) {
      throw new Error('HIPAA mode is not supported on GCP yet; use AWS for HIPAA workloads.')
    }
    if (!creds.project) {
      throw new Error('GCP credentials missing required field: project')
    }
    this.project = creds.project
    this.zone = creds.zone ?? DEFAULT_ZONE
    this.network = creds.network ?? 'global/networks/default'
    this.subnetwork = creds.subnetwork
    this.serviceAccountEmail = creds.serviceAccountEmail

    if (creds.serviceAccountJson) {
      const parsed = JSON.parse(creds.serviceAccountJson) as {
        client_email: string
        private_key: string
      }
      this.client = new InstancesClient({
        projectId: creds.project,
        credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
      })
    } else {
      // Application Default Credentials (gcloud login / GOOGLE_APPLICATION_CREDENTIALS / workload identity).
      this.client = new InstancesClient({ projectId: creds.project })
    }
  }

  async createInstances(req: ProvisionRequest): Promise<ProvisionResult> {
    const machineType = pickGcpMachineType(req.resourceProfile)
    const ids: string[] = []
    for (let i = 0; i < req.desiredRunners; i++) {
      const name = this.instanceName(req.poolId, i)
      await this.insertInstance(name, machineType, req)
      ids.push(name)
    }
    return { instanceIds: ids, region: this.zone, instanceType: machineType }
  }

  async scaleInstances(currentInstanceIds: string[], desiredCount: number, req: ProvisionRequest): Promise<ScaleResult> {
    const current = currentInstanceIds.length
    if (desiredCount === current) {
      return { added: [], removed: [], instanceIds: currentInstanceIds }
    }
    if (desiredCount > current) {
      const machineType = pickGcpMachineType(req.resourceProfile)
      const added: string[] = []
      for (let i = current; i < desiredCount; i++) {
        const name = this.instanceName(req.poolId, i)
        await this.insertInstance(name, machineType, req)
        added.push(name)
      }
      return { added, removed: [], instanceIds: [...currentInstanceIds, ...added] }
    }
    const removed = currentInstanceIds.slice(desiredCount)
    const kept = currentInstanceIds.slice(0, desiredCount)
    await this.terminateInstances(removed)
    return { added: [], removed, instanceIds: kept }
  }

  async terminateInstances(instanceIds: string[]): Promise<void> {
    for (const id of instanceIds) {
      try {
        await this.client.delete({ project: this.project, zone: this.zone, instance: id })
      } catch {
        // Best-effort: instance may already be gone.
      }
    }
  }

  private instanceName(poolId: string, index: number): string {
    // GCE instance names: lowercase letters, digits, hyphens; must start with a
    // letter, max 63 chars. UUID slice gives us collision-resistant uniqueness.
    return `astro-runner-${poolId.slice(0, 8)}-${index}-${Date.now().toString(36)}`.toLowerCase()
  }

  private async insertInstance(
    name: string,
    machineType: string,
    req: ProvisionRequest,
  ): Promise<void> {
    const startupScript = buildStartupScript(req.poolId, req.teamId, {
      serverUrl: req.serverUrl,
      relayUrl: req.relayUrl,
    })
    await this.client.insert({
      project: this.project,
      zone: this.zone,
      instanceResource: {
        name,
        machineType: `zones/${this.zone}/machineTypes/${machineType}`,
        disks: [{
          boot: true,
          autoDelete: true,
          initializeParams: {
            sourceImage: SOURCE_IMAGE,
            diskSizeGb: String(DEFAULT_DISK_SIZE_GB),
          },
        }],
        networkInterfaces: [{
          network: this.network,
          subnetwork: this.subnetwork,
          accessConfigs: [{ name: 'External NAT', type: 'ONE_TO_ONE_NAT' }],
        }],
        metadata: {
          items: [{ key: 'startup-script', value: startupScript }],
        },
        serviceAccounts: this.serviceAccountEmail
          ? [{ email: this.serviceAccountEmail, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }]
          : undefined,
        labels: {
          'astro-pool-id': req.poolId.slice(0, 63),
          'astro-team-id': req.teamId.slice(0, 63),
        },
        tags: { items: ['astro-runner'] },
      },
    })
  }
}
