/**
 * HIPAA Auto-Terminate Watchdog
 * ============================================================================
 *
 * Server-side safety net for the AWS UserData auto-terminate timer in
 * `cloud-provisioner.ts`. The UserData approach is fragile: `set -euo pipefail`
 * causes the script to exit early if anything before the `(sleep ... && shutdown)`
 * line fails (e.g. the `curl` for the agent binary), in which case the timer
 * is never scheduled and the instance lingers past its session.
 *
 * This watchdog reads HIPAA pool instances from the DB, calls EC2
 * DescribeInstances to fetch each instance's LaunchTime, and terminates any
 * instance whose age exceeds `autoTerminateHours`. It is intentionally
 * idempotent and safe to run on a cron — no scheduler is wired up here.
 *
 * Usage:
 *   - Operator runs `tsx scripts/hipaa-reap.ts` from cron every ~5 minutes.
 *   - Process exits 0 on success, 1 if any pool failed to reap (so cron emails).
 */

import {
  EC2Client,
  DescribeInstancesCommand,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { connectedAccounts, remoteComputePools } from '../db/schema.js'
import { isHipaaMode } from '../hipaa-mode.js'

/** Default auto-terminate window — must match cloud-provisioner.ts. */
const HIPAA_AUTO_TERMINATE_HOURS_DEFAULT = 4

interface AwsCreds {
  accessKeyId: string
  secretAccessKey: string
  region?: string
}

export interface ReapResult {
  poolId: string
  region: string
  inspected: number
  terminated: string[]
  errors: string[]
}

function autoTerminateHours(): number {
  const fromEnv = Number(process.env.ASTRO_HIPAA_AUTO_TERMINATE_HOURS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return HIPAA_AUTO_TERMINATE_HOURS_DEFAULT
}

async function getAwsCreds(userId: string): Promise<AwsCreds | null> {
  const rows = await db.select().from(connectedAccounts).where(and(
    eq(connectedAccounts.userId, userId),
    eq(connectedAccounts.channel, 'aws'),
    eq(connectedAccounts.enabled, true),
  ))
  const row = rows[0]
  if (!row) return null
  const c = row.credentials as Record<string, unknown>
  if (!c.accessKeyId || !c.secretAccessKey) return null
  return {
    accessKeyId: String(c.accessKeyId),
    secretAccessKey: String(c.secretAccessKey),
    region: typeof c.region === 'string' ? c.region : undefined,
  }
}

/**
 * Reap a single pool: terminate every instance whose LaunchTime is older than
 * `autoTerminateHours`. Updates `providerMetadata.instanceIds` to drop the
 * terminated IDs and decrements `activeRunners` accordingly.
 */
async function reapPool(pool: {
  id: string
  userId: string
  teamId: string
  providerMetadata: Record<string, unknown>
}, ttlHours: number): Promise<ReapResult> {
  const meta = pool.providerMetadata as { instanceIds?: string[]; region?: string }
  const instanceIds = (meta.instanceIds ?? []).filter((id) => typeof id === 'string')
  const region = meta.region ?? 'us-east-1'
  const result: ReapResult = { poolId: pool.id, region, inspected: instanceIds.length, terminated: [], errors: [] }

  if (instanceIds.length === 0) return result

  const creds = await getAwsCreds(pool.userId)
  if (!creds) {
    result.errors.push(`Pool ${pool.id}: no enabled AWS connected account for owner user ${pool.userId}`)
    return result
  }

  const ec2 = new EC2Client({
    region: creds.region ?? region,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
  })

  let described
  try {
    described = await ec2.send(new DescribeInstancesCommand({ InstanceIds: instanceIds }))
  } catch (err) {
    result.errors.push(`Pool ${pool.id}: DescribeInstances failed: ${err instanceof Error ? err.message : String(err)}`)
    return result
  }

  const cutoffMs = ttlHours * 3_600_000
  const now = Date.now()
  const toTerminate: string[] = []
  const stillRunning: string[] = []

  for (const reservation of described.Reservations ?? []) {
    for (const inst of reservation.Instances ?? []) {
      const id = inst.InstanceId
      if (!id) continue
      const launch = inst.LaunchTime ? new Date(inst.LaunchTime).getTime() : null
      const state = inst.State?.Name
      if (state === 'terminated' || state === 'shutting-down') continue
      if (launch !== null && now - launch > cutoffMs) {
        toTerminate.push(id)
      } else if (state === 'running' || state === 'pending') {
        stillRunning.push(id)
      }
    }
  }

  if (toTerminate.length > 0) {
    try {
      await ec2.send(new TerminateInstancesCommand({ InstanceIds: toTerminate }))
      result.terminated = toTerminate
    } catch (err) {
      result.errors.push(`Pool ${pool.id}: TerminateInstances failed: ${err instanceof Error ? err.message : String(err)}`)
      return result
    }

    // Update the pool record so the runner pool reflects reality.
    const remaining = stillRunning
    await db.update(remoteComputePools).set({
      activeRunners: remaining.length,
      providerMetadata: { ...meta, instanceIds: remaining, region },
      updatedAt: new Date(),
    }).where(eq(remoteComputePools.id, pool.id))
  }

  return result
}

/**
 * Reap every HIPAA-eligible pool. Returns one ReapResult per pool. Caller
 * decides what to do with errors (cron should exit non-zero so the failure
 * is surfaced).
 *
 * No-op (returns []) when ASTRO_HIPAA_MODE is not set — there is no business
 * reason to enforce auto-terminate outside HIPAA, and we don't want to
 * surprise non-HIPAA operators.
 */
export async function reapExpiredInstances(): Promise<ReapResult[]> {
  if (!isHipaaMode()) {
    return []
  }
  const ttlHours = autoTerminateHours()

  // Only consider pools that could plausibly still be running. We reap
  // 'active' and 'scaling' pools; 'terminated' / 'failed' / 'terminating'
  // are skipped.
  const pools = await db.select().from(remoteComputePools).where(inArray(
    remoteComputePools.status,
    ['active', 'scaling', 'provisioning'],
  ))

  // Only AWS-backed providers — non-AWS shouldn't even exist in HIPAA, but
  // be defensive.
  const eligible = pools.filter((p) => p.provider === 'aws' || p.provider === 'astro-cloud')

  const results: ReapResult[] = []
  for (const pool of eligible) {
    results.push(await reapPool({
      id: pool.id,
      userId: pool.userId,
      teamId: pool.teamId,
      providerMetadata: pool.providerMetadata as Record<string, unknown>,
    }, ttlHours))
  }
  return results
}
