import { z } from 'zod'
import {
  S3Client,
  GetBucketEncryptionCommand,
  GetBucketAclCommand,
  type Grant,
} from '@aws-sdk/client-s3'
import { isHipaaMode } from './hipaa-mode.js'

export const storageMountSchema = z.object({
  provider: z.enum(['s3', 'gcs']),
  accountId: z.string().uuid().optional(),
  uri: z.string().max(2000),
  path: z.string().max(500).regex(/^[a-zA-Z0-9._/-]+$/),
  access: z.enum(['staged', 'streaming']).default('staged'),
  mode: z.enum(['read', 'readwrite']),
  sync: z.enum(['start', 'finish', 'both']).optional(),
  formatHint: z.enum(['zarr', 'parquet', 'delta', 'iceberg', 'custom']).optional(),
})

export type StorageMount = z.infer<typeof storageMountSchema>

export function validateStorageMount(mount: StorageMount): { ok: true } | { ok: false; error: string } {
  if (mount.provider === 's3' && !/^s3:\/\/[^/]+\/?.*/.test(mount.uri)) {
    return { ok: false, error: 'S3 mounts must use an s3://bucket[/prefix] URI' }
  }
  if (mount.provider === 'gcs' && !/^gs:\/\/[^/]+\/?.*/.test(mount.uri)) {
    return { ok: false, error: 'GCS mounts must use a gs://bucket[/prefix] URI' }
  }
  if (mount.path.startsWith('/') || mount.path.includes('..') || mount.path.startsWith('.')) {
    return { ok: false, error: 'Mount path must be a relative workspace path without dot segments' }
  }
  if ((mount.sync ?? 'start') === 'finish' && mount.mode === 'read') {
    return { ok: false, error: 'Read-only mounts cannot sync only at finish' }
  }
  if (mount.access === 'streaming' && !mount.uri.endsWith('/') && mount.formatHint === 'zarr') {
    return { ok: false, error: 'Streaming Zarr mounts should reference a prefix URI ending in /' }
  }
  // HIPAA: in HIPAA mode, only S3 is allowed at the schema layer. GCS is
  // outside the AWS BAA boundary and must be rejected before we reach the
  // provider. Bucket-level enforcement (SSE-KMS, no public ACL) happens in
  // `validateHipaaBucketCompliance` which requires AWS credentials.
  if (isHipaaMode() && mount.provider !== 's3') {
    return { ok: false, error: `HIPAA mode only supports provider='s3' storage mounts (got '${mount.provider}').` }
  }
  return { ok: true }
}

function parseS3Bucket(uri: string): string {
  // URI matches /^s3:\/\/[^/]+\/?.*/ by validateStorageMount.
  const withoutScheme = uri.replace(/^s3:\/\//, '')
  const slash = withoutScheme.indexOf('/')
  return slash === -1 ? withoutScheme : withoutScheme.slice(0, slash)
}

/**
 * HIPAA bucket-level compliance check. Must be called only in HIPAA mode,
 * after the schema validation has confirmed provider=s3. Performs two live
 * AWS calls against the target bucket:
 *
 *   1. GetBucketEncryption — the bucket must have default encryption set to
 *      `aws:kms` (SSE-KMS). `AES256` (SSE-S3) is rejected because HIPAA
 *      requires customer-managed KMS keys so we can audit key access.
 *   2. GetBucketAcl — no grantee may be `AllUsers` or `AuthenticatedUsers`.
 *      Public buckets cannot host PHI.
 *
 * Returns `{ ok: true }` on success; otherwise a descriptive error string
 * that can be surfaced verbatim to the client (400 response).
 */
export async function validateHipaaBucketCompliance(
  mount: StorageMount,
  creds: { accessKeyId: string; secretAccessKey: string; region?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (mount.provider !== 's3') {
    return { ok: false, error: 'HIPAA bucket compliance check is only defined for S3 mounts.' }
  }
  const bucket = parseS3Bucket(mount.uri)
  if (!bucket) return { ok: false, error: 'Could not parse S3 bucket name from URI' }

  const s3 = new S3Client({
    region: creds.region ?? 'us-east-1',
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
  })

  // 1. Encryption must be SSE-KMS.
  try {
    const enc = await s3.send(new GetBucketEncryptionCommand({ Bucket: bucket }))
    const rules = enc.ServerSideEncryptionConfiguration?.Rules ?? []
    const algorithm = rules[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm
    if (algorithm !== 'aws:kms' && algorithm !== 'aws:kms:dsse') {
      return {
        ok: false,
        error: `HIPAA requires SSE-KMS on bucket '${bucket}' (found '${algorithm ?? 'none'}'). Enable default encryption with a KMS CMK.`,
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: `HIPAA bucket encryption check failed for '${bucket}': ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // 2. ACL must not be public.
  try {
    const acl = await s3.send(new GetBucketAclCommand({ Bucket: bucket }))
    const grants: Grant[] = acl.Grants ?? []
    const publicUris = new Set([
      'http://acs.amazonaws.com/groups/global/AllUsers',
      'http://acs.amazonaws.com/groups/global/AuthenticatedUsers',
    ])
    const publicGrant = grants.find((g) => g.Grantee?.URI && publicUris.has(g.Grantee.URI))
    if (publicGrant) {
      return {
        ok: false,
        error: `HIPAA rejects bucket '${bucket}': ACL grants '${publicGrant.Permission}' to '${publicGrant.Grantee?.URI}'. Public buckets cannot host PHI.`,
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: `HIPAA bucket ACL check failed for '${bucket}': ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  return { ok: true }
}
