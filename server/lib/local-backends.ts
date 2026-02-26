/**
 * Backend Context String Builder
 *
 * Builds AI-ready context strings describing backend capabilities.
 * Used by /api/backends endpoints to generate prompts for agent sessions.
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
 * Build an AI-ready context string describing a backend's capabilities.
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

      let str = `You have kubectl access to cluster "${context || 'default'}".`
      if (totalNodes === 0 && podCount && podCount > 0) {
        const nsCount = podsByNamespace ? Object.keys(podsByNamespace).length : 0
        str += ` No nodes visible (cluster may use autoscaling or node listing is restricted), but ${podCount} pods running across ${nsCount} namespaces.`
        if (podsByNamespace) {
          const nsList = Object.keys(podsByNamespace).slice(0, 20).join(', ')
          str += ` Namespaces: ${nsList}.`
        }
      } else {
        str += ` ${totalNodes} node(s) (${totalCPU} CPUs, ${totalMemoryGi}Gi RAM, ${totalGPUs} GPUs).`
        if (namespaces && namespaces.length > 0) {
          str += ` Namespaces: ${namespaces.join(', ')}.`
        }
      }
      str += ` Use \`kubectl exec -n <ns> <pod> -- <cmd>\` to run commands on pods.`
      return appendCustomContext(str, customContext)
    }

    case 'docker': {
      const meta = backend.metadata ?? {}
      const cpus = meta.cpus ?? '?'
      const memoryGb = meta.memoryGb ?? '?'
      let str = `Docker v${backend.version || '?'} available. ${cpus} CPUs, ${memoryGb}GB memory.`
      str += ` Use \`docker run --rm -v $PWD:/work -w /work <image> <cmd>\` for containerized execution.`
      return appendCustomContext(str, customContext)
    }

    case 'slurm': {
      const meta = backend.metadata ?? {}
      const clusterName = meta.clusterName as string | undefined
      const partitions = meta.partitions as Array<Record<string, unknown>> | undefined
      const accounts = meta.accounts as string[] | undefined

      let str = `You are on an HPC cluster`
      if (clusterName) str += ` "${clusterName}"`
      str += ` with Slurm v${backend.version || '?'}.`
      if (partitions && partitions.length > 0) {
        const partList = partitions.map((p) => {
          let s = p.name as string
          const total = (p.nodes ?? p.totalNodes) as number | undefined
          const avail = p.availableNodes as number | undefined
          if (total) s += ` (${avail ?? 0}/${total} nodes available)`
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
        str += ` ${totalGpus} GPUs available across ${gpuNodeCount ?? '?'} nodes.`
      }
      str += ` NEVER run compute on the login node -- use srun/sbatch.`
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
        let str = `SSH access to remote host "${alias}" (${target}).`
        str += ` Use \`ssh ${alias} '<command>'\` to run commands remotely.`
        if (meta.reachable === false) {
          str += ` Note: this host was unreachable at last check.`
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
