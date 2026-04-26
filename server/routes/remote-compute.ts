import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { requireAuth, type AuthUser } from '../middleware/auth.js'
import { db } from '../lib/db/index.js'
import { connectedAccounts, remoteComputePools, teams } from '../lib/db/schema.js'
import { hasFeature } from '../lib/feature-flags.js'
import { getCloudProvisioner, type CloudProvider } from '../lib/remote-compute/cloud-provisioner.js'
import { isHipaaMode } from '../lib/hipaa-mode.js'

const isDesktop = process.env.ASTRO_DESKTOP === '1'

function detectAwsLocally(): boolean {
  if (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE) return true
  return existsSync(join(homedir(), '.aws', 'credentials')) ||
         existsSync(join(homedir(), '.aws', 'config'))
}

function detectGcpLocally(): boolean {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT) return true
  return existsSync(join(homedir(), '.config', 'gcloud', 'application_default_credentials.json'))
}

export const remoteComputeRoute = new Hono()

remoteComputeRoute.use('/*', requireAuth)

async function requireFeature(user: AuthUser) {
  const [team] = await db.select({ featureFlags: teams.featureFlags }).from(teams).where(eq(teams.id, user.teamId)).limit(1)
  return hasFeature(team?.featureFlags, 'remote-compute-sandboxes')
}

/**
 * Providers that are allowed inside a HIPAA deployment. `astro-cloud` maps to
 * the AwsProvisioner factory (so it goes through `buildHipaaRunProfile` just
 * like a raw `aws` provider) and is therefore inside the BAA boundary.
 */
const HIPAA_ALLOWED_PROVIDERS = new Set<string>(['aws', 'astro-cloud'])

function isHipaaAllowedProvider(provider: string): boolean {
  return HIPAA_ALLOWED_PROVIDERS.has(provider)
}

const createPoolSchema = z.object({
  provider: z.enum(['daytona', 'runloop', 'aws', 'gcp']),
  accountId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  desiredRunners: z.number().int().min(1).max(32).default(1),
  resourceProfile: z.object({
    cpu: z.number().int().min(1).max(64).optional(),
    memoryGb: z.number().min(0.5).max(512).optional(),
    gpu: z.number().int().min(0).max(16).optional(),
    ttlMinutes: z.number().int().min(1).max(1440).optional(),
  }).default({}),
  limits: z.object({
    maxActiveSandboxes: z.number().int().min(1).max(256).optional(),
    maxVcpu: z.number().int().min(1).max(4096).optional(),
    maxMemoryGb: z.number().min(1).max(16384).optional(),
    maxTtlMinutes: z.number().int().min(1).max(10080).optional(),
    maxEstimatedHourlyCostUsd: z.number().min(0.01).max(10_000).optional(),
  }).default({}),
})

remoteComputeRoute.get('/detect', async (c) => {
  const user = c.get('user') as AuthUser

  // Daytona: always checkable (stored in DB, scoped to user)
  const daytonaAccounts = await db.select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.userId, user.id), eq(connectedAccounts.channel, 'daytona')))
    .limit(1)
  const hasDaytona = daytonaAccounts.length > 0

  // AWS / GCP: only detectable in Electron (server runs on user's machine)
  // In web/production mode, infer from past successful pools instead
  let awsDetected: boolean | null = null
  let gcpDetected: boolean | null = null

  if (isDesktop) {
    awsDetected = detectAwsLocally()
    gcpDetected = detectGcpLocally()
  } else {
    // Infer from past pools that provisioned successfully
    const pastProviders = await db.select({ provider: remoteComputePools.provider })
      .from(remoteComputePools)
      .where(and(
        inArray(remoteComputePools.teamId, user.teamIds),
        inArray(remoteComputePools.provider, ['aws', 'gcp']),
        sql`${remoteComputePools.status} != 'failed'`,
      ))
      .limit(10)
    const pastSet = new Set(pastProviders.map((r) => r.provider))
    if (pastSet.has('aws')) awsDetected = true
    if (pastSet.has('gcp')) gcpDetected = true
  }

  return c.json({
    isDesktop,
    providers: {
      daytona: { detected: hasDaytona, source: 'connected-accounts' as const },
      aws: { detected: awsDetected, source: isDesktop ? 'local-credentials' as const : 'pool-history' as const },
      gcp: { detected: gcpDetected, source: isDesktop ? 'local-credentials' as const : 'pool-history' as const },
    },
  })
})

remoteComputeRoute.get('/pools', async (c) => {
  const user = c.get('user') as AuthUser
  if (!(await requireFeature(user))) return c.json({ error: 'Not available' }, 404)

  const rows = await db.select().from(remoteComputePools)
    .where(inArray(remoteComputePools.teamId, user.teamIds))
    .orderBy(desc(remoteComputePools.createdAt))
    .limit(100)

  return c.json({ pools: rows })
})

remoteComputeRoute.post('/pools', async (c) => {
  const user = c.get('user') as AuthUser
  if (!(await requireFeature(user))) return c.json({ error: 'Not available' }, 404)

  const parsed = createPoolSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)
  }

  const body = parsed.data
  if (isHipaaMode() && !isHipaaAllowedProvider(body.provider)) {
    return c.json({
      error: `HIPAA mode only supports provider='aws' (got '${body.provider}'). Non-AWS vendors are outside the BAA boundary.`,
    }, 400)
  }
  const provisioner = getCloudProvisioner(body.provider as CloudProvider)
  try {
    const pool = await provisioner.createRunnerPool({
      teamId: user.teamId,
      userId: user.id,
      provider: body.provider as CloudProvider,
      accountId: body.accountId,
      projectId: body.projectId,
      desiredRunners: body.desiredRunners,
      resourceProfile: body.resourceProfile,
      limits: body.limits,
    })
    return c.json({ pool }, pool.status === 'failed' ? 502 : 201)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

remoteComputeRoute.patch('/pools/:id/scale', async (c) => {
  const user = c.get('user') as AuthUser
  if (!(await requireFeature(user))) return c.json({ error: 'Not available' }, 404)

  const id = c.req.param('id')
  const [pool] = await db.select().from(remoteComputePools)
    .where(and(eq(remoteComputePools.id, id), inArray(remoteComputePools.teamId, user.teamIds)))
    .limit(1)
  if (!pool) return c.json({ error: 'Pool not found' }, 404)

  if (pool.provisionerType === 'local') {
    return c.json({ error: 'This pool was provisioned from your local desktop app. Use the desktop app to scale or terminate it.' }, 409)
  }

  const body = await c.req.json<{ desiredRunners: number }>()
  if (typeof body.desiredRunners !== 'number' || body.desiredRunners < 0) {
    return c.json({ error: 'desiredRunners must be a non-negative integer' }, 400)
  }

  // HIPAA: re-check the provider on the existing pool. A pool created before
  // HIPAA mode was enabled (or via a different code path) must not be scaled
  // up if its provider is outside the BAA boundary.
  if (isHipaaMode() && !isHipaaAllowedProvider(pool.provider)) {
    return c.json({
      error: `HIPAA mode only supports provider='aws' pools (pool '${id}' is '${pool.provider}'). Refusing to scale.`,
    }, 400)
  }

  const provisioner = getCloudProvisioner(pool.provider as CloudProvider)
  try {
    await provisioner.scaleRunnerPool(id, body.desiredRunners)
    return c.json({ success: true })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

remoteComputeRoute.delete('/pools/:id', async (c) => {
  const user = c.get('user') as AuthUser
  if (!(await requireFeature(user))) return c.json({ error: 'Not available' }, 404)

  const id = c.req.param('id')
  const [pool] = await db.select().from(remoteComputePools)
    .where(and(eq(remoteComputePools.id, id), inArray(remoteComputePools.teamId, user.teamIds)))
    .limit(1)
  if (!pool) return c.json({ error: 'Pool not found' }, 404)

  if (pool.provisionerType === 'local') {
    return c.json({ error: 'This pool was provisioned from your local desktop app. Use the desktop app to scale or terminate it.' }, 409)
  }

  const provisioner = getCloudProvisioner(pool.provider as CloudProvider)
  await provisioner.terminateRunnerPool(id)
  return c.json({ success: true })
})

// ── Desktop-provisioned pools ───────────────────────────────────
// The Electron renderer uses the user's on-device cloud credentials to call
// AWS/GCP directly (creds never leave the desktop). These endpoints only
// mirror lifecycle metadata so the cloud UI and other devices can see the
// pool. The server never touches the cloud provider for `provisionerType: 'local'`.

const externalCreatePoolSchema = z.object({
  provider: z.enum(['aws', 'gcp']),
  region: z.string().min(1),
  instanceIds: z.array(z.string().min(1)).min(1),
  instanceType: z.string().min(1),
  amiId: z.string().min(1).optional(),
  resourceProfile: z.object({
    cpu: z.number().int().min(1).max(64).optional(),
    memoryGb: z.number().min(0.5).max(512).optional(),
    gpu: z.number().int().min(0).max(16).optional(),
    ttlMinutes: z.number().int().min(1).max(1440).optional(),
  }).default({}),
  limits: z.object({
    maxActiveSandboxes: z.number().int().min(1).max(256).optional(),
    maxVcpu: z.number().int().min(1).max(4096).optional(),
    maxMemoryGb: z.number().min(1).max(16384).optional(),
    maxTtlMinutes: z.number().int().min(1).max(10080).optional(),
    maxEstimatedHourlyCostUsd: z.number().min(0.01).max(10_000).optional(),
  }).default({}),
  projectId: z.string().uuid().optional(),
  desiredRunners: z.number().int().min(1).max(32),
  costMetadata: z.record(z.string(), z.unknown()).optional(),
})

remoteComputeRoute.post('/pools/external', async (c) => {
  const user = c.get('user') as AuthUser
  if (!(await requireFeature(user))) return c.json({ error: 'Not available' }, 404)

  const parsed = externalCreatePoolSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)
  }
  const body = parsed.data

  if (isHipaaMode() && !isHipaaAllowedProvider(body.provider)) {
    return c.json({
      error: `HIPAA mode only supports provider='aws' (got '${body.provider}'). Non-AWS vendors are outside the BAA boundary.`,
    }, 400)
  }

  const [pool] = await db.insert(remoteComputePools).values({
    teamId: user.teamId,
    userId: user.id,
    provider: body.provider,
    provisionerType: 'local',
    projectId: body.projectId,
    status: 'active',
    desiredRunners: body.desiredRunners,
    activeRunners: body.instanceIds.length,
    resourceProfile: body.resourceProfile,
    limits: body.limits,
    costMetadata: body.costMetadata ?? {},
    providerMetadata: {
      instanceIds: body.instanceIds,
      region: body.region,
      instanceType: body.instanceType,
      amiId: body.amiId,
      provisionedFrom: 'desktop',
    },
  }).returning()

  return c.json({ pool }, 201)
})

const externalUpdatePoolSchema = z.object({
  status: z.enum(['provisioning', 'active', 'scaling', 'terminating', 'terminated', 'failed']).optional(),
  activeRunners: z.number().int().min(0).max(256).optional(),
  desiredRunners: z.number().int().min(0).max(256).optional(),
  providerMetadata: z.record(z.string(), z.unknown()).optional(),
  error: z.string().nullable().optional(),
})

remoteComputeRoute.patch('/pools/external/:id', async (c) => {
  const user = c.get('user') as AuthUser
  if (!(await requireFeature(user))) return c.json({ error: 'Not available' }, 404)

  const id = c.req.param('id')
  const [pool] = await db.select().from(remoteComputePools)
    .where(and(eq(remoteComputePools.id, id), inArray(remoteComputePools.teamId, user.teamIds)))
    .limit(1)
  if (!pool) return c.json({ error: 'Pool not found' }, 404)

  if (pool.provisionerType !== 'local') {
    return c.json({ error: 'This endpoint only manages locally-provisioned pools.' }, 409)
  }

  const parsed = externalUpdatePoolSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body.status !== undefined) updates.status = body.status
  if (body.activeRunners !== undefined) updates.activeRunners = body.activeRunners
  if (body.desiredRunners !== undefined) updates.desiredRunners = body.desiredRunners
  if (body.providerMetadata !== undefined) updates.providerMetadata = body.providerMetadata
  if (body.error !== undefined) updates.error = body.error

  const [updated] = await db.update(remoteComputePools)
    .set(updates)
    .where(eq(remoteComputePools.id, id))
    .returning()

  return c.json({ pool: updated })
})

remoteComputeRoute.delete('/pools/external/:id', async (c) => {
  const user = c.get('user') as AuthUser
  if (!(await requireFeature(user))) return c.json({ error: 'Not available' }, 404)

  const id = c.req.param('id')
  const [pool] = await db.select().from(remoteComputePools)
    .where(and(eq(remoteComputePools.id, id), inArray(remoteComputePools.teamId, user.teamIds)))
    .limit(1)
  if (!pool) return c.json({ error: 'Pool not found' }, 404)

  if (pool.provisionerType !== 'local') {
    return c.json({ error: 'This endpoint only manages locally-provisioned pools.' }, 409)
  }

  // The renderer's IPC handler already terminated the EC2/GCE instances using
  // the user's on-device credentials. We only mark lifecycle state here.
  await db.update(remoteComputePools)
    .set({ status: 'terminated', updatedAt: new Date() })
    .where(eq(remoteComputePools.id, id))

  return c.json({ success: true })
})
