import { create } from 'zustand'
import { apiUrl, API_BASE_URL } from '@/lib/api-url'
import { authHeaders } from '@/lib/auth-headers'
import { isDesktop } from '@/lib/desktop-detect'
import { desktopBridge } from '@/lib/desktop-bridge'
import { useTeamStore } from '@/stores/team-store'

export type RemoteComputeProvider = 'astro-cloud' | 'daytona' | 'aws' | 'gcp' | 'runloop'
export type RemoteComputeStatus = 'provisioning' | 'active' | 'scaling' | 'terminating' | 'terminated' | 'failed'

export type RemoteComputeProvisionerType = 'server' | 'local'

export interface RemoteComputePool {
  id: string
  provider: RemoteComputeProvider
  /** 'server' = backend created the cloud resources; 'local' = desktop app created them with on-device credentials. */
  provisionerType: RemoteComputeProvisionerType
  status: RemoteComputeStatus
  desiredRunners: number
  activeRunners: number
  resourceProfile: { cpu?: number; memoryGb?: number; gpu?: number; ttlMinutes?: number }
  costMetadata: { estimatedHourlyCostUsd?: number }
  providerMetadata: Record<string, unknown>
  error?: string
  expiresAt?: string
  createdAt: string
}

export interface ProviderDetection {
  detected: boolean | null
  source: 'connected-accounts' | 'local-credentials' | 'pool-history'
  /** True once the user has saved a local-cloud configuration (profile/region for AWS, project for GCP). */
  connectedLocally?: boolean
}

export interface DetectResult {
  isDesktop: boolean
  providers: {
    daytona: ProviderDetection
    aws: ProviderDetection
    gcp: ProviderDetection
  }
}

export interface LocalCloudCreds {
  aws?: { profiles: string[]; defaultRegion: string | null }
  gcp?: { project: string | null; account: string | null }
}

export interface AwsLocalConfig {
  profile: string
  region: string
}

export interface GcpLocalConfig {
  project: string
  adcPath?: string
}

export type LocalCloudConfig =
  | { provider: 'aws'; config: AwsLocalConfig }
  | { provider: 'gcp'; config: GcpLocalConfig }

export interface CreatePoolParams {
  provider: RemoteComputeProvider
  accountId?: string
  projectId?: string
  desiredRunners: number
  resourceProfile: { cpu?: number; memoryGb?: number; gpu?: number; ttlMinutes?: number }
  limits?: { maxEstimatedHourlyCostUsd?: number }
}

/**
 * Resolve the public URLs that an agent runner spawned on a user's local
 * cloud instance will use to reach Astro. The desktop IPC needs both so the
 * cloud-init / user-data script can tell the runner where to call home.
 *
 * `serverUrl` — falls back to the configured API base in prod, or
 * `window.location.origin` in dev (Vite proxies `/api`).
 *
 * `relayUrl` — explicit `VITE_RELAY_URL` wins; otherwise we derive it from
 * the API URL by swapping `https?://api.` → `wss://relay.` (matches the prod
 * convention `api.astroanywhere.com` ↔ `relay.astroanywhere.com:3002`).
 * Throws when neither can be resolved — we'd rather fail loudly than spawn a
 * runner that can never connect back.
 */
function resolveAstroUrls(): { serverUrl: string; relayUrl: string } {
  const serverUrl = (API_BASE_URL && API_BASE_URL.length > 0)
    ? API_BASE_URL
    : (typeof window !== 'undefined' ? window.location.origin : '')
  if (!serverUrl) {
    throw new Error('Cannot determine Astro server URL for runner provisioning')
  }

  const explicitRelay = import.meta.env.VITE_RELAY_URL as string | undefined
  let relayUrl = explicitRelay && explicitRelay.length > 0 ? explicitRelay : ''

  if (!relayUrl) {
    try {
      const u = new URL(serverUrl)
      const host = u.host.startsWith('api.')
        ? `relay.${u.host.slice(4)}:3002`
        : `${u.host}:3002`
      relayUrl = `wss://${host}`
    } catch {
      throw new Error(`Cannot derive relay URL from server URL "${serverUrl}". Set VITE_RELAY_URL.`)
    }
  }

  return { serverUrl, relayUrl }
}

/** Narrow either local-config shape into the IPC's union shape. */
function toCloudPoolConfig(cfg: AwsLocalConfig | GcpLocalConfig): {
  profile?: string; region?: string; project?: string; adcPath?: string; zone?: string
} {
  if ('profile' in cfg) {
    return { profile: cfg.profile, region: cfg.region }
  }
  return { project: cfg.project, adcPath: cfg.adcPath }
}

interface RemoteComputeState {
  pools: RemoteComputePool[]
  loading: boolean
  loaded: boolean
  error: string | null
  detection: DetectResult | null
  detectionLoaded: boolean
  /** Raw local-credential probe results (profiles, default region, project, account). Desktop only. */
  localCloudCreds: LocalCloudCreds | null
  load: () => Promise<void>
  detect: () => Promise<void>
  loadLocalConfig: () => Promise<void>
  saveLocalConfig: (provider: 'aws' | 'gcp', config: AwsLocalConfig | GcpLocalConfig) => Promise<void>
  createPool: (params: CreatePoolParams) => Promise<RemoteComputePool>
  scalePool: (id: string, desiredRunners: number) => Promise<void>
  terminatePool: (id: string) => Promise<void>
}

async function getHeaders(json = false): Promise<Record<string, string>> {
  const h = await authHeaders()
  if (json) h['Content-Type'] = 'application/json'
  return h
}

export const useRemoteComputeStore = create<RemoteComputeState>((set, get) => ({
  pools: [],
  loading: false,
  loaded: false,
  error: null,
  detection: null,
  detectionLoaded: false,
  localCloudCreds: null,

  detect: async () => {
    // Run backend + local probes in parallel. Backend handles Daytona/web fallback;
    // local probe (desktop only) overrides AWS/GCP rows when credentials are on this machine.
    const backendPromise = fetch(apiUrl('/api/remote-compute/detect'), { headers: await getHeaders() })
      .then(async (res) => res.ok ? await res.json() as DetectResult : null)
      .catch(() => null)

    const onDesktop = isDesktop()
    const localPromise: Promise<{
      aws: { detected: boolean; profiles?: string[]; defaultRegion?: string | null; source: string }
      gcp: { detected: boolean; project?: string | null; account?: string | null; source: string }
    } | null> = onDesktop
      ? desktopBridge.cloudCreds.detect().catch(() => null)
      : Promise.resolve(null)

    const [backend, local] = await Promise.all([backendPromise, localPromise])

    if (!backend && !local) {
      set({ detectionLoaded: true })
      return
    }

    const merged: DetectResult = backend ?? {
      isDesktop: onDesktop,
      providers: {
        daytona: { detected: null, source: 'connected-accounts' },
        aws: { detected: null, source: 'local-credentials' },
        gcp: { detected: null, source: 'local-credentials' },
      },
    }

    let localCreds: LocalCloudCreds | null = null
    if (local) {
      merged.isDesktop = true
      if (local.aws.detected) {
        merged.providers.aws = { detected: true, source: 'local-credentials' }
        localCreds = {
          ...(localCreds ?? {}),
          aws: {
            profiles: local.aws.profiles ?? [],
            defaultRegion: local.aws.defaultRegion ?? null,
          },
        }
      }
      if (local.gcp.detected) {
        merged.providers.gcp = { detected: true, source: 'local-credentials' }
        localCreds = {
          ...(localCreds ?? {}),
          gcp: {
            project: local.gcp.project ?? null,
            account: local.gcp.account ?? null,
          },
        }
      }
    }

    set({ detection: merged, detectionLoaded: true, localCloudCreds: localCreds })

    // Hydrate previously-saved local config so the UI knows which providers are
    // already "connected locally" (lock badge instead of Connect button).
    if (onDesktop) {
      await get().loadLocalConfig()
    }
  },

  loadLocalConfig: async () => {
    if (!isDesktop()) return
    try {
      const [awsRes, gcpRes] = await Promise.all([
        desktopBridge.layout.load({ key: 'cloud-creds.aws' }).catch(() => ({ value: null })),
        desktopBridge.layout.load({ key: 'cloud-creds.gcp' }).catch(() => ({ value: null })),
      ])
      const detection = get().detection
      if (!detection) return
      const next: DetectResult = {
        ...detection,
        providers: {
          ...detection.providers,
          aws: { ...detection.providers.aws, connectedLocally: awsRes.value != null ? true : detection.providers.aws.connectedLocally },
          gcp: { ...detection.providers.gcp, connectedLocally: gcpRes.value != null ? true : detection.providers.gcp.connectedLocally },
        },
      }
      set({ detection: next })
    } catch {
      // best-effort hydration; ignore
    }
  },

  saveLocalConfig: async (provider, config) => {
    if (!isDesktop()) throw new Error('Local cloud config requires the desktop app')
    await desktopBridge.layout.save({ key: `cloud-creds.${provider}`, value: config })
    const detection = get().detection
    if (!detection) return
    const next: DetectResult = {
      ...detection,
      providers: {
        ...detection.providers,
        [provider]: { ...detection.providers[provider], connectedLocally: true },
      },
    }
    set({ detection: next })
  },

  load: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const res = await fetch(apiUrl('/api/remote-compute/pools'), { headers: await getHeaders() })
      if (!res.ok) throw new Error('Failed to load compute pools')
      const { pools } = await res.json() as { pools: RemoteComputePool[] }
      set({ pools, loading: false, loaded: true })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error', loading: false, loaded: true })
    }
  },

  createPool: async (params: CreatePoolParams) => {
    const isLocalEligible = params.provider === 'aws' || params.provider === 'gcp'

    if (isLocalEligible && isDesktop()) {
      // Hydrate any saved local config before deciding the path. The detect()
      // call may not have run yet (or may have raced the open).
      const provider = params.provider as 'aws' | 'gcp'
      if (!get().localCloudCreds || get().detection?.providers[provider].connectedLocally !== true) {
        await get().loadLocalConfig()
      }
    }

    const provider = params.provider as 'aws' | 'gcp'
    const detection = get().detection
    const connectedLocally =
      isLocalEligible && detection?.providers[provider]?.connectedLocally === true
    const localConfigRaw = isLocalEligible
      ? await desktopBridge.layout.load({ key: `cloud-creds.${provider}` }).catch(() => ({ value: null }))
      : { value: null }
    const localConfig = localConfigRaw.value as
      | AwsLocalConfig
      | GcpLocalConfig
      | null

    if (isLocalEligible && isDesktop() && connectedLocally && localConfig) {
      const teamId = useTeamStore.getState().getDefaultTeamId()
      if (!teamId) throw new Error('No active team — cannot provision pool')

      const { serverUrl, relayUrl } = resolveAstroUrls()
      const poolId = crypto.randomUUID()

      const result = await desktopBridge.cloudPool.create({
        provider,
        config: toCloudPoolConfig(localConfig),
        poolId,
        teamId,
        desiredRunners: params.desiredRunners,
        resourceProfile: params.resourceProfile,
        serverUrl,
        relayUrl,
      })

      if (!result.ok || !result.instanceIds || result.instanceIds.length === 0) {
        throw new Error(result.error ?? 'Failed to provision instances on your cloud account')
      }

      try {
        const res = await fetch(apiUrl('/api/remote-compute/pools/external'), {
          method: 'POST',
          headers: await getHeaders(true),
          body: JSON.stringify({
            provider,
            region: result.region,
            instanceIds: result.instanceIds,
            instanceType: result.instanceType,
            amiId: result.amiId,
            resourceProfile: params.resourceProfile,
            limits: params.limits ?? {},
            projectId: params.projectId,
            desiredRunners: params.desiredRunners,
            costMetadata: result.costMetadata ?? {},
          }),
        })
        const data = await res.json() as { pool: RemoteComputePool; error?: string }
        if (!res.ok) throw new Error(data.error ?? 'Failed to register pool')
        set((s) => ({ pools: [data.pool, ...s.pools] }))
        return data.pool
      } catch (err) {
        // Best-effort rollback: instances are running on the user's account
        // but the DB row never landed. Tear them down so we don't strand
        // billable VMs.
        await desktopBridge.cloudPool.terminate({
          provider,
          config: toCloudPoolConfig(localConfig),
          instanceIds: result.instanceIds,
        }).catch(() => {})
        throw err
      }
    }

    // Server-provisioned path (Daytona, Runloop, or AWS/GCP via connected accounts).
    const res = await fetch(apiUrl('/api/remote-compute/pools'), {
      method: 'POST',
      headers: await getHeaders(true),
      body: JSON.stringify(params),
    })
    const data = await res.json() as { pool: RemoteComputePool; error?: string }
    if (!res.ok) throw new Error(data.error ?? 'Failed to create pool')
    set((s) => ({ pools: [data.pool, ...s.pools] }))
    return data.pool
  },

  scalePool: async (id: string, desiredRunners: number) => {
    const pool = get().pools.find((p) => p.id === id)
    if (!pool) throw new Error('Pool not found in local state')

    if (pool.provisionerType === 'local') {
      if (!isDesktop()) {
        throw new Error('Scale this pool from the desktop app that created it.')
      }
      const provider = pool.provider as 'aws' | 'gcp'
      const cfgRes = await desktopBridge.layout.load({ key: `cloud-creds.${provider}` }).catch(() => ({ value: null }))
      const localConfig = cfgRes.value as AwsLocalConfig | GcpLocalConfig | null
      if (!localConfig) {
        throw new Error('This pool was provisioned from this device. Reconnect your cloud profile to manage it.')
      }
      const teamId = useTeamStore.getState().getDefaultTeamId()
      if (!teamId) throw new Error('No active team')
      const { serverUrl, relayUrl } = resolveAstroUrls()

      const meta = pool.providerMetadata as { instanceIds?: string[] }
      const currentInstanceIds = Array.isArray(meta.instanceIds) ? meta.instanceIds : []

      const result = await desktopBridge.cloudPool.scale({
        provider,
        config: toCloudPoolConfig(localConfig),
        currentInstanceIds,
        desiredRunners,
        poolId: pool.id,
        teamId,
        resourceProfile: pool.resourceProfile,
        serverUrl,
        relayUrl,
      })
      if (!result.ok || !result.instanceIds) {
        throw new Error(result.error ?? 'Failed to scale pool on your cloud account')
      }

      const patchRes = await fetch(apiUrl(`/api/remote-compute/pools/external/${id}`), {
        method: 'PATCH',
        headers: await getHeaders(true),
        body: JSON.stringify({
          desiredRunners,
          activeRunners: result.instanceIds.length,
          providerMetadata: { ...pool.providerMetadata, instanceIds: result.instanceIds },
        }),
      })
      const patchData = await patchRes.json() as { pool: RemoteComputePool; error?: string }
      if (!patchRes.ok) throw new Error(patchData.error ?? 'Failed to update pool record')

      set((s) => ({ pools: s.pools.map((p) => p.id === id ? patchData.pool : p) }))
      return
    }

    // Server-provisioned pool — backend owns the lifecycle.
    const res = await fetch(apiUrl(`/api/remote-compute/pools/${id}/scale`), {
      method: 'PATCH',
      headers: await getHeaders(true),
      body: JSON.stringify({ desiredRunners }),
    })
    if (!res.ok) {
      const data = await res.json() as { error?: string }
      throw new Error(data.error ?? 'Failed to scale pool')
    }
    set((s) => ({
      pools: s.pools.map((p) => p.id === id ? { ...p, desiredRunners, status: 'scaling' } : p),
    }))
  },

  terminatePool: async (id: string) => {
    const pool = get().pools.find((p) => p.id === id)
    if (!pool) throw new Error('Pool not found in local state')

    if (pool.provisionerType === 'local') {
      if (!isDesktop()) {
        throw new Error('Terminate this pool from the desktop app that created it.')
      }
      const provider = pool.provider as 'aws' | 'gcp'
      const cfgRes = await desktopBridge.layout.load({ key: `cloud-creds.${provider}` }).catch(() => ({ value: null }))
      const localConfig = cfgRes.value as AwsLocalConfig | GcpLocalConfig | null
      if (!localConfig) {
        throw new Error('This pool was provisioned from this device. Reconnect your cloud profile to manage it.')
      }

      // Optimistic: surface "terminating" immediately so the user sees motion.
      set((s) => ({ pools: s.pools.map((p) => p.id === id ? { ...p, status: 'terminating' } : p) }))

      const meta = pool.providerMetadata as { instanceIds?: string[] }
      const instanceIds = Array.isArray(meta.instanceIds) ? meta.instanceIds : []

      const result = await desktopBridge.cloudPool.terminate({
        provider,
        config: toCloudPoolConfig(localConfig),
        instanceIds,
      }).catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))

      // Always clean up the DB row — the user wants the row gone even if some
      // instances were already terminated out-of-band.
      const dbRes = await fetch(apiUrl(`/api/remote-compute/pools/external/${id}`), {
        method: 'DELETE',
        headers: await getHeaders(),
      })

      if (!dbRes.ok) {
        const dbData = await dbRes.json().catch(() => ({})) as { error?: string }
        throw new Error(dbData.error ?? 'Failed to remove pool record')
      }

      set((s) => ({ pools: s.pools.map((p) => p.id === id ? { ...p, status: 'terminated' } : p) }))

      if (!result.ok) {
        // DB row is gone but some cloud instances may linger. Surface to the
        // user so they can verify in their AWS/GCP console.
        throw new Error(`Pool record removed, but cloud cleanup reported: ${result.error ?? 'unknown error'}. Check your cloud console.`)
      }
      return
    }

    // Server-provisioned pool — backend tears down the resources.
    const res = await fetch(apiUrl(`/api/remote-compute/pools/${id}`), {
      method: 'DELETE',
      headers: await getHeaders(),
    })
    if (!res.ok) {
      const data = await res.json() as { error?: string }
      throw new Error(data.error ?? 'Failed to terminate pool')
    }
    set((s) => ({
      pools: s.pools.map((p) => p.id === id ? { ...p, status: 'terminating' } : p),
    }))
  },
}))
