import type { ResourceProfile, CloudProvider } from './types.js'

// AWS t3 on-demand pricing, us-east-1.
export const AWS_T3_HOURLY: Record<string, number> = {
  'micro': 0.0104, 'small': 0.0208, 'medium': 0.0416,
  'large': 0.0832, 'xlarge': 0.1664, '2xlarge': 0.3328,
}

export type AwsInstanceType =
  | 't3.micro' | 't3.small' | 't3.medium'
  | 't3.large' | 't3.xlarge' | 't3.2xlarge'

export function pickAwsInstanceType(profile: ResourceProfile): AwsInstanceType {
  const cpu = profile.cpu ?? 1
  const mem = profile.memoryGb ?? 1
  if (cpu <= 1 && mem <= 1)  return 't3.micro'
  if (cpu <= 1 && mem <= 2)  return 't3.small'
  if (cpu <= 2 && mem <= 4)  return 't3.medium'
  if (cpu <= 2 && mem <= 8)  return 't3.large'
  if (cpu <= 4 && mem <= 16) return 't3.xlarge'
  return 't3.2xlarge'
}

export function awsHourlyCost(profile: ResourceProfile): number {
  const size = pickAwsInstanceType(profile).split('.')[1]
  return AWS_T3_HOURLY[size] ?? 0.0832
}

// GCP e2 on-demand pricing, us-central1.
export const GCP_E2_HOURLY: Record<string, number> = {
  'e2-micro': 0.008,
  'e2-small': 0.017,
  'e2-medium': 0.034,
  'e2-standard-2': 0.067,
  'e2-standard-4': 0.134,
  'e2-standard-8': 0.268,
}

export type GcpMachineType =
  | 'e2-micro' | 'e2-small' | 'e2-medium'
  | 'e2-standard-2' | 'e2-standard-4' | 'e2-standard-8'

export function pickGcpMachineType(profile: ResourceProfile): GcpMachineType {
  const cpu = profile.cpu ?? 1
  const mem = profile.memoryGb ?? 1
  if (cpu <= 1 && mem <= 1)  return 'e2-micro'
  if (cpu <= 1 && mem <= 2)  return 'e2-small'
  if (cpu <= 2 && mem <= 4)  return 'e2-medium'
  if (cpu <= 2 && mem <= 8)  return 'e2-standard-2'
  if (cpu <= 4 && mem <= 16) return 'e2-standard-4'
  return 'e2-standard-8'
}

export function gcpHourlyCost(profile: ResourceProfile): number {
  return GCP_E2_HOURLY[pickGcpMachineType(profile)] ?? 0.067
}

export interface CostEstimateInput {
  provider: CloudProvider
  desiredRunners: number
  resourceProfile: ResourceProfile
}

export function estimateHourlyCostUsd(input: CostEstimateInput): number {
  const cpu = input.resourceProfile.cpu ?? 1
  const memoryGb = input.resourceProfile.memoryGb ?? 1
  const runners = input.desiredRunners
  if (input.provider === 'daytona') return runners * ((cpu * 0.0504) + (memoryGb * 0.0162))
  if (input.provider === 'aws') return runners * awsHourlyCost(input.resourceProfile)
  if (input.provider === 'gcp') return runners * gcpHourlyCost(input.resourceProfile)
  return runners * ((cpu * 0.06) + (memoryGb * 0.02))
}
