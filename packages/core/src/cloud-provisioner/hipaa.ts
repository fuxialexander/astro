import type { AwsCredentials, HipaaConfig } from './types.js'

export interface HipaaRunProfile {
  kmsKeyArn: string
  blockDeviceMappings: Array<{
    DeviceName: string
    Ebs: { Encrypted: true; KmsKeyId: string; DeleteOnTermination: true }
  }>
  networkInterface: {
    DeviceIndex: 0
    SubnetId: string
    Groups: string[]
    AssociatePublicIpAddress: false
  }
  metadataOptions: {
    HttpTokens: 'required'
    HttpEndpoint: 'enabled'
    HttpPutResponseHopLimit: 2
  }
  extraTags: Array<{ Key: string; Value: string }>
  autoTerminateHours: number
}

/**
 * Builds the AWS RunInstances overrides required for a HIPAA-compliant runner:
 * KMS-CMK EBS encryption, private subnet (no public IP), IMDSv2-only, explicit
 * SGs, and inventory tags. Throws when prerequisites are missing — we fail
 * fast rather than silently fall back to a less-encrypted default.
 */
export function buildHipaaRunProfile(creds: AwsCredentials, config: HipaaConfig): HipaaRunProfile {
  if (!config.kmsKeyArn) {
    throw new Error('HIPAA mode requires kmsKeyArn (KMS CMK for EBS encryption).')
  }
  if (!creds.subnetId) {
    throw new Error('HIPAA mode requires the AWS connected account to specify a private subnetId.')
  }
  if (!creds.securityGroupIds || creds.securityGroupIds.length === 0) {
    throw new Error('HIPAA mode requires the AWS connected account to specify at least one securityGroupId.')
  }
  return {
    kmsKeyArn: config.kmsKeyArn,
    blockDeviceMappings: [{
      DeviceName: '/dev/xvda',
      Ebs: { Encrypted: true, KmsKeyId: config.kmsKeyArn, DeleteOnTermination: true },
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
      { Key: 'Customer', Value: config.customerId },
    ],
    autoTerminateHours: config.autoTerminateHours,
  }
}
