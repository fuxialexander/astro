import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../lib/db/index.js'
import { connectedAccounts } from '../lib/db/schema.js'
import { storageMountSchema, validateStorageMount, validateHipaaBucketCompliance } from '../lib/storage-mounts.js'
import { readCredentials } from '../lib/encryption.js'
import { isHipaaMode } from '../lib/hipaa-mode.js'

export const storageMountsRoute = new Hono()

storageMountsRoute.use('/*', requireAuth)

const testSchema = z.object({
  mount: storageMountSchema,
})

storageMountsRoute.post('/test', async (c) => {
  const userId = c.get('user')!.id
  const parsed = testSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid input', details: parsed.error.issues }, 400)
  }

  const mount = parsed.data.mount
  const validation = validateStorageMount(mount)
  if (!validation.ok) {
    return c.json({ success: false, error: validation.error }, 400)
  }

  if (mount.accountId) {
    const expectedChannel = mount.provider === 's3' ? 'aws' : 'gcp'
    const [account] = await db.select().from(connectedAccounts).where(
      and(
        eq(connectedAccounts.id, mount.accountId),
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.channel, expectedChannel),
        eq(connectedAccounts.enabled, true),
      )
    ).limit(1)
    if (!account) {
      return c.json({ success: false, error: `No enabled ${expectedChannel} account found for this mount` }, 404)
    }
    const creds = readCredentials(account.credentials)
    if (expectedChannel === 'aws' && (!creds.accessKeyId || !creds.secretAccessKey)) {
      return c.json({ success: false, error: 'AWS account is missing accessKeyId or secretAccessKey' }, 400)
    }
    if (expectedChannel === 'gcp' && !creds.serviceAccountJson) {
      return c.json({ success: false, error: 'GCP account is missing serviceAccountJson' }, 400)
    }

    // HIPAA: verify SSE-KMS encryption and no public ACLs on the S3 bucket.
    // Requires an AWS connected account (schema validation already enforced s3-only).
    if (isHipaaMode() && expectedChannel === 'aws') {
      const hipaaCheck = await validateHipaaBucketCompliance(mount, {
        accessKeyId: String(creds.accessKeyId),
        secretAccessKey: String(creds.secretAccessKey),
        region: typeof creds.region === 'string' ? creds.region : undefined,
      })
      if (!hipaaCheck.ok) {
        return c.json({ success: false, error: hipaaCheck.error }, 400)
      }
    }
  } else if (isHipaaMode()) {
    // HIPAA requires an explicit connected account so we can run the bucket
    // compliance check. Mounts without an accountId are rejected.
    return c.json({
      success: false,
      error: 'HIPAA mode requires storage mounts to specify an accountId (for SSE-KMS + ACL verification).',
    }, 400)
  }

  return c.json({
    success: true,
    mount: {
      provider: mount.provider,
      uri: mount.uri,
      path: mount.path,
      access: mount.access,
      mode: mount.mode,
      sync: mount.sync,
      formatHint: mount.formatHint,
      accountId: mount.accountId,
    },
  })
})
