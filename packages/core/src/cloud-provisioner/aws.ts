import {
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
  DescribeImagesCommand,
  type _InstanceType as InstanceType,
  type RunInstancesCommandInput,
} from '@aws-sdk/client-ec2'
import type {
  AwsCredentials,
  HipaaConfig,
  ProvisionRequest,
  ProvisionResult,
  ScaleResult,
} from './types.js'
import { pickAwsInstanceType } from './pricing.js'
import { buildUserData } from './user-data.js'
import { buildHipaaRunProfile, type HipaaRunProfile } from './hipaa.js'

export class AwsCloudOps {
  private readonly ec2: EC2Client
  private readonly region: string

  constructor(private readonly creds: AwsCredentials, private readonly hipaaConfig?: HipaaConfig) {
    if (!creds.accessKeyId || !creds.secretAccessKey) {
      throw new Error('AWS credentials are missing accessKeyId or secretAccessKey')
    }
    this.region = creds.region ?? 'us-east-1'
    this.ec2 = new EC2Client({
      region: this.region,
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
    })
  }

  async createInstances(req: ProvisionRequest): Promise<ProvisionResult> {
    const instanceType = pickAwsInstanceType(req.resourceProfile)
    const amiId = await this.getLatestAl2023Ami()
    const hipaa = this.hipaaConfig ? buildHipaaRunProfile(this.creds, this.hipaaConfig) : null
    const result = await this.ec2.send(new RunInstancesCommand(this.runInput(req, instanceType, amiId, req.desiredRunners, hipaa)))
    const instanceIds = (result.Instances ?? [])
      .map((i) => i.InstanceId)
      .filter((id): id is string => Boolean(id))
    return { instanceIds, region: this.region, instanceType, amiId }
  }

  async scaleInstances(currentInstanceIds: string[], desiredCount: number, req: ProvisionRequest): Promise<ScaleResult> {
    const current = currentInstanceIds.length
    if (desiredCount === current) {
      return { added: [], removed: [], instanceIds: currentInstanceIds }
    }
    if (desiredCount > current) {
      const toAdd = desiredCount - current
      const instanceType = pickAwsInstanceType(req.resourceProfile)
      const amiId = await this.getLatestAl2023Ami()
      const hipaa = this.hipaaConfig ? buildHipaaRunProfile(this.creds, this.hipaaConfig) : null
      const result = await this.ec2.send(new RunInstancesCommand(this.runInput(req, instanceType, amiId, toAdd, hipaa)))
      const added = (result.Instances ?? [])
        .map((i) => i.InstanceId)
        .filter((id): id is string => Boolean(id))
      return { added, removed: [], instanceIds: [...currentInstanceIds, ...added] }
    }
    const removed = currentInstanceIds.slice(desiredCount)
    const kept = currentInstanceIds.slice(0, desiredCount)
    if (removed.length > 0) {
      await this.ec2.send(new TerminateInstancesCommand({ InstanceIds: removed }))
    }
    return { added: [], removed, instanceIds: kept }
  }

  async terminateInstances(instanceIds: string[]): Promise<void> {
    if (instanceIds.length === 0) return
    try {
      await this.ec2.send(new TerminateInstancesCommand({ InstanceIds: instanceIds }))
    } catch {
      // Best-effort: instances may already be terminated.
    }
  }

  private runInput(
    req: ProvisionRequest,
    instanceType: InstanceType,
    amiId: string,
    count: number,
    hipaa: HipaaRunProfile | null,
  ): RunInstancesCommandInput {
    const userData = Buffer.from(
      buildUserData(req.poolId, req.teamId, {
        serverUrl: req.serverUrl,
        relayUrl: req.relayUrl,
        autoTerminateHours: hipaa?.autoTerminateHours,
      }),
    ).toString('base64')
    const baseTags = [
      { Key: 'Name', Value: `astro-runner-${req.poolId.slice(0, 8)}` },
      { Key: 'astroPoolId', Value: req.poolId },
      { Key: 'astroTeamId', Value: req.teamId },
    ]
    return {
      ImageId: amiId,
      InstanceType: instanceType,
      MinCount: count,
      MaxCount: count,
      UserData: userData,
      IamInstanceProfile: this.creds.iamInstanceProfileArn ? { Arn: this.creds.iamInstanceProfileArn } : undefined,
      // Outside HIPAA, keep the historical flat SubnetId/SecurityGroupIds.
      // In HIPAA, NetworkInterfaces forces AssociatePublicIpAddress=false.
      SubnetId: hipaa ? undefined : this.creds.subnetId,
      SecurityGroupIds: hipaa ? undefined : this.creds.securityGroupIds,
      NetworkInterfaces: hipaa ? [hipaa.networkInterface] : undefined,
      BlockDeviceMappings: hipaa ? hipaa.blockDeviceMappings : undefined,
      MetadataOptions: hipaa ? hipaa.metadataOptions : undefined,
      InstanceInitiatedShutdownBehavior: 'terminate',
      TagSpecifications: [{
        ResourceType: 'instance',
        Tags: hipaa ? [...baseTags, ...hipaa.extraTags] : baseTags,
      }],
    }
  }

  private async getLatestAl2023Ami(): Promise<string> {
    const result = await this.ec2.send(new DescribeImagesCommand({
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
}
