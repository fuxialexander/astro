/**
 * Backend Context String Builder
 *
 * Builds machine-specific context strings describing backend capabilities.
 * Used by /api/backends endpoints and shown in the backend detail dialog UI.
 *
 * This module provides ONLY machine-specific facts (versions, resources,
 * cluster topology). Generic command references (how to use kubectl, docker,
 * sbatch) live in the default compute backend skills under
 * skills/compute_backend_default/ and are injected separately.
 *
 * Detection has moved to agent runners (packages/agent-runner/src/execution/).
 * This module only provides the context string builder and the LocalBackendInfo type.
 */

export interface LocalBackendInfo {
  id: string
  name: string
  available: boolean
  version?: string
  metadata?: Record<string, unknown>
}

/**
 * Build a machine-specific context string describing a backend's resources.
 * Contains only facts about THIS machine — no generic command references
 * (those are in compute backend default skills).
 * If customContext is provided, it is appended as a "Custom Instructions" section.
 */
export function buildContextString(backend: LocalBackendInfo, customContext?: string): string {
  switch (backend.id) {
    case 'k8s-exec': {
      const meta = backend.metadata ?? {}
      const context = meta.context ?? meta.currentContext as string | undefined
      const nodes = meta.nodes as Array<Record<string, unknown>> | undefined
      const namespaces = meta.namespaces as string[] | undefined
      const totalNodes = nodes?.length ?? meta.totalNodes ?? 0
      const totalCPU = meta.totalCPU ?? 0
      const totalMemoryGi = meta.totalMemoryGi ?? 0
      const totalGPUs = meta.totalGPUs ?? 0
      const podCount = meta.podCount as number | undefined
      const podsByNamespace = meta.podsByNamespace as Record<string, number> | undefined

      let str = `Kubernetes cluster "${context || 'default'}".`
      if (totalNodes === 0 && podCount && podCount > 0) {
        const nsCount = podsByNamespace ? Object.keys(podsByNamespace).length : 0
        str += ` No nodes visible (autoscaling or RBAC restricted), ${podCount} pods across ${nsCount} namespaces.`
        if (podsByNamespace) {
          const nsList = Object.keys(podsByNamespace).slice(0, 20).join(', ')
          str += ` Namespaces: ${nsList}.`
        }
      } else {
        str += ` ${totalNodes} node(s), ${totalCPU} CPUs, ${totalMemoryGi}Gi RAM, ${totalGPUs} GPUs.`
        if (namespaces && namespaces.length > 0) {
          str += ` Namespaces: ${namespaces.join(', ')}.`
        }
      }
      return appendCustomContext(str, customContext)
    }

    case 'docker': {
      const meta = backend.metadata ?? {}
      const cpus = meta.cpus ?? '?'
      const memoryGb = meta.memoryGb ?? '?'
      const str = `Docker v${backend.version || '?'}. ${cpus} CPUs, ${memoryGb}GB memory.`
      return appendCustomContext(str, customContext)
    }

    case 'slurm': {
      const meta = backend.metadata ?? {}
      const clusterName = meta.clusterName as string | undefined
      const partitions = meta.partitions as Array<Record<string, unknown>> | undefined
      const accounts = meta.accounts as string[] | undefined

      let str = `HPC cluster`
      if (clusterName) str += ` "${clusterName}"`
      str += `, Slurm v${backend.version || '?'}.`
      if (partitions && partitions.length > 0) {
        const partList = partitions.map((p) => {
          let s = p.name as string
          const total = (p.nodes ?? p.totalNodes) as number | undefined
          const avail = p.availableNodes as number | undefined
          if (total) s += ` (${avail ?? 0}/${total} nodes)`
          if (p.features) s += ` [${p.features}]`
          return s
        }).join(', ')
        str += ` Partitions: ${partList}.`
      }
      if (accounts && accounts.length > 0) {
        str += ` Accounts: ${accounts.join(', ')}.`
      }
      const totalGpus = meta.totalGpus as number | undefined
      const gpuNodeCount = meta.gpuNodeCount as number | undefined
      if (totalGpus) {
        str += ` ${totalGpus} GPUs across ${gpuNodeCount ?? '?'} nodes.`
      }
      return appendCustomContext(str, customContext)
    }

    default: {
      // Handle ssh:<alias> individual hosts
      if (backend.id.startsWith('ssh:')) {
        const meta = backend.metadata ?? {}
        const alias = meta.alias as string
        const hostname = meta.hostname as string
        const user = meta.user as string | undefined
        const target = user ? `${user}@${hostname}` : hostname
        let str = `SSH host "${alias}" (${target}).`
        if (meta.reachable === false) {
          str += ` Unreachable at last check.`
        }
        return appendCustomContext(str, customContext)
      }
      return appendCustomContext(`${backend.name} backend available.`, customContext)
    }
  }

  function appendCustomContext(base: string, overlay?: string): string {
    if (!overlay?.trim()) return base
    return `${base}\n\n--- Custom Instructions ---\n${overlay.trim()}`
  }
}
