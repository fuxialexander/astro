export type CloudProvider = 'astro-cloud' | 'daytona' | 'runloop' | 'aws' | 'gcp'

export interface PoolLimits {
  maxActiveSandboxes?: number
  maxVcpu?: number
  maxMemoryGb?: number
  maxTtlMinutes?: number
  maxEstimatedHourlyCostUsd?: number
}

export interface ResourceProfile {
  cpu?: number
  memoryGb?: number
  gpu?: number
  ttlMinutes?: number
}

export interface CostMetadata {
  estimatedHourlyCostUsd?: number
  [key: string]: unknown
}

export interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
  region?: string
  iamInstanceProfileArn?: string
  subnetId?: string
  securityGroupIds?: string[]
}

/**
 * GCP credentials. `serviceAccountJson` is a stringified service-account key
 * file. When null/undefined the SDK falls back to Application Default
 * Credentials (e.g. `gcloud auth application-default login`,
 * GOOGLE_APPLICATION_CREDENTIALS, or workload identity).
 */
export interface GcpCredentials {
  serviceAccountJson?: string | null
  project: string
  zone?: string
  network?: string
  subnetwork?: string
  serviceAccountEmail?: string
}

/**
 * HIPAA enforcement values resolved by the caller from process env. Kept as a
 * plain object so this package never reads process.env.
 */
export interface HipaaConfig {
  kmsKeyArn: string
  customerId: string
  autoTerminateHours: number
}

export interface ProvisionRequest {
  poolId: string
  teamId: string
  desiredRunners: number
  resourceProfile: ResourceProfile
  serverUrl: string
  relayUrl: string
}

export interface ProvisionResult {
  instanceIds: string[]
  region: string
  instanceType: string
  amiId?: string
}

export interface ScaleResult {
  added: string[]
  removed: string[]
  instanceIds: string[]
}
