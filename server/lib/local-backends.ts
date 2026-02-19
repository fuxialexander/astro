/**
 * Local Execution Backend Detection
 *
 * Lightweight detection of execution backends (Docker, Kubernetes, SLURM, SSH)
 * available on the server machine. Used to populate the Environments page
 * even when no agent runner is connected via WebSocket.
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createConnection } from 'node:net'

const execAsync = promisify(exec)

export interface LocalBackendInfo {
  id: string
  name: string
  available: boolean
  version?: string
  metadata?: Record<string, unknown>
}

interface DetectionResult {
  backends: LocalBackendInfo[]
  detectedAt: string
}

let cachedResult: DetectionResult | null = null
let detecting = false

/**
 * Detect available execution backends on the local machine.
 * Results are cached for 60 seconds.
 */
export async function detectLocalBackends(): Promise<DetectionResult> {
  if (cachedResult) {
    const age = Date.now() - new Date(cachedResult.detectedAt).getTime()
    if (age < 60_000) return cachedResult
  }

  if (detecting) {
    // Return cached or empty while another detection is in progress
    return cachedResult ?? { backends: [], detectedAt: new Date().toISOString() }
  }

  detecting = true
  try {
    const [docker, k8s, slurm, sshHosts] = await Promise.all([
      detectDocker(),
      detectKubernetes(),
      detectSlurm(),
      detectSSHHosts(),
    ])

    const backends = [docker, k8s, slurm, ...sshHosts].filter((b) => b !== null)
    cachedResult = { backends, detectedAt: new Date().toISOString() }
    return cachedResult
  } finally {
    detecting = false
  }
}

/**
 * Detect a single backend by ID, bypassing cache.
 */
export async function detectSingleBackend(id: string): Promise<LocalBackendInfo | null> {
  switch (id) {
    case 'docker':
      return detectDocker()
    case 'k8s-exec':
      return detectKubernetes()
    case 'slurm':
      return detectSlurm()
    default:
      // Handle ssh:<alias> IDs
      if (id.startsWith('ssh:')) {
        const alias = id.slice(4)
        const hosts = await detectSSHHosts()
        return hosts.find((h) => h.id === id || (h.metadata as Record<string, unknown>)?.alias === alias) ?? null
      }
      return null
  }
}

/**
 * Build an AI-ready context string describing a backend's capabilities.
 */
export function buildContextString(backend: LocalBackendInfo): string {
  switch (backend.id) {
    case 'k8s-exec': {
      const meta = backend.metadata ?? {}
      const context = meta.context as string | undefined
      const nodes = meta.nodes as Array<Record<string, unknown>> | undefined
      const namespaces = meta.namespaces as string[] | undefined
      const totalNodes = nodes?.length ?? meta.totalNodes ?? 0
      const totalCPU = meta.totalCPU ?? 0
      const totalMemoryGi = meta.totalMemoryGi ?? 0
      const totalGPUs = meta.totalGPUs ?? 0

      let str = `You have kubectl access to cluster "${context || 'default'}".`
      str += ` ${totalNodes} node(s) (${totalCPU} CPUs, ${totalMemoryGi}Gi RAM, ${totalGPUs} GPUs).`
      if (namespaces && namespaces.length > 0) {
        str += ` Namespaces: ${namespaces.join(', ')}.`
      }
      str += ` Use \`kubectl exec -n <ns> <pod> -- <cmd>\` to run commands on pods.`
      return str
    }

    case 'docker': {
      const meta = backend.metadata ?? {}
      const cpus = meta.cpus ?? '?'
      const memoryGb = meta.memoryGb ?? '?'
      let str = `Docker v${backend.version || '?'} available. ${cpus} CPUs, ${memoryGb}GB memory.`
      str += ` Use \`docker run --rm -v $PWD:/work -w /work <image> <cmd>\` for containerized execution.`
      return str
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
          if (p.nodes) s += ` (${p.nodes} nodes)`
          return s
        }).join(', ')
        str += ` Partitions: ${partList}.`
      }
      if (accounts && accounts.length > 0) {
        str += ` Accounts: ${accounts.join(', ')}.`
      }
      str += ` NEVER run compute on the login node -- use srun/sbatch.`
      return str
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
        if (!meta.reachable) {
          str += ` Note: this host was unreachable at last check.`
        }
        return str
      }
      return `${backend.name} backend available.`
    }
  }
}

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

async function detectDocker(): Promise<LocalBackendInfo | null> {
  try {
    const { stdout } = await execAsync("docker info --format '{{.ServerVersion}}'", {
      timeout: 10_000,
    })
    const version = stdout.trim().replace(/'/g, '')
    if (!version) return null

    const metadata: Record<string, unknown> = {}

    // OS/Architecture
    try {
      const { stdout: infoOut } = await execAsync(
        "docker info --format '{{.OSType}}/{{.Architecture}}'",
        { timeout: 5_000 },
      )
      metadata.osArch = infoOut.trim().replace(/'/g, '')
    } catch {
      // Ignore
    }

    // CPUs and Memory
    try {
      const { stdout: cpuOut } = await execAsync(
        "docker info --format '{{.NCPU}}'",
        { timeout: 5_000 },
      )
      const cpus = parseInt(cpuOut.trim().replace(/'/g, ''), 10)
      if (!isNaN(cpus)) metadata.cpus = cpus
    } catch {
      // Ignore
    }

    try {
      const { stdout: memOut } = await execAsync(
        "docker info --format '{{.MemTotal}}'",
        { timeout: 5_000 },
      )
      const memBytes = parseInt(memOut.trim().replace(/'/g, ''), 10)
      if (!isNaN(memBytes)) {
        metadata.memoryGb = Math.round(memBytes / (1024 * 1024 * 1024) * 10) / 10
      }
    } catch {
      // Ignore
    }

    // Running container count
    try {
      const { stdout: countOut } = await execAsync(
        "docker ps -q 2>/dev/null | wc -l",
        { timeout: 5_000 },
      )
      const count = parseInt(countOut.trim(), 10)
      if (!isNaN(count)) metadata.runningContainers = count
    } catch {
      // Ignore
    }

    // Top images
    try {
      const { stdout: imgOut } = await execAsync(
        "docker images --format '{{.Repository}}\\t{{.Tag}}\\t{{.Size}}' 2>/dev/null | head -10",
        { timeout: 5_000 },
      )
      const images = imgOut.trim().split('\n').filter(Boolean).map((line) => {
        const [repository, tag, size] = line.split('\t')
        return { repository, tag, size }
      })
      if (images.length > 0) metadata.images = images
    } catch {
      // Ignore
    }

    return {
      id: 'docker',
      name: 'Docker',
      available: true,
      version,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Kubernetes
// ---------------------------------------------------------------------------

async function detectKubernetes(): Promise<LocalBackendInfo | null> {
  try {
    await execAsync('which kubectl', { timeout: 5_000 })
  } catch {
    return null
  }

  try {
    const { stdout } = await execAsync('kubectl cluster-info --request-timeout=5s 2>/dev/null', {
      timeout: 10_000,
    })

    const urlMatch = stdout.match(/https?:\/\/[\w.:/-]+/)

    let serverVersion: string | undefined
    try {
      const { stdout: versionOut } = await execAsync(
        'kubectl version --output=json --request-timeout=5s 2>/dev/null',
        { timeout: 10_000 },
      )
      const versionData = JSON.parse(versionOut) as {
        serverVersion?: { gitVersion?: string }
      }
      serverVersion = versionData.serverVersion?.gitVersion
    } catch {
      // Ignore
    }

    let namespaces: string[] = []
    try {
      const { stdout: nsOut } = await execAsync(
        'kubectl get namespaces -o jsonpath=\'{.items[*].metadata.name}\' --request-timeout=5s 2>/dev/null',
        { timeout: 10_000 },
      )
      namespaces = nsOut.trim().replace(/'/g, '').split(/\s+/).filter(Boolean)
    } catch {
      // Ignore
    }

    // Current context
    let context: string | undefined
    try {
      const { stdout: ctxOut } = await execAsync(
        'kubectl config current-context 2>/dev/null',
        { timeout: 5_000 },
      )
      context = ctxOut.trim() || undefined
    } catch {
      // Ignore
    }

    // Node details
    interface K8sNode {
      name: string
      status: string
      cpu: string
      memory: string
      gpus: number
      labels: Record<string, string>
    }
    let nodes: K8sNode[] = []
    let totalCPU = 0
    let totalMemoryGi = 0
    let totalGPUs = 0

    try {
      const { stdout: nodesOut } = await execAsync(
        'kubectl get nodes -o json --request-timeout=10s 2>/dev/null',
        { timeout: 15_000 },
      )
      const nodesData = JSON.parse(nodesOut) as {
        items?: Array<{
          metadata?: { name?: string; labels?: Record<string, string> }
          status?: {
            conditions?: Array<{ type?: string; status?: string }>
            capacity?: Record<string, string>
          }
        }>
      }
      if (nodesData.items) {
        nodes = nodesData.items.map((item) => {
          const name = item.metadata?.name ?? 'unknown'
          const readyCond = item.status?.conditions?.find((c) => c.type === 'Ready')
          const status = readyCond?.status === 'True' ? 'Ready' : 'NotReady'
          const capacity = item.status?.capacity ?? {}
          const cpu = capacity.cpu ?? '0'
          const memory = capacity.memory ?? '0'
          const gpuStr = capacity['nvidia.com/gpu'] ?? '0'
          const gpus = parseInt(gpuStr, 10) || 0

          // Parse CPU
          const cpuNum = cpu.endsWith('m') ? parseInt(cpu, 10) / 1000 : parseInt(cpu, 10) || 0
          totalCPU += cpuNum

          // Parse memory (Ki -> Gi)
          const memMatch = memory.match(/^(\d+)(Ki|Mi|Gi)?$/)
          if (memMatch) {
            const val = parseInt(memMatch[1]!, 10)
            const unit = memMatch[2]
            if (unit === 'Ki') totalMemoryGi += val / (1024 * 1024)
            else if (unit === 'Mi') totalMemoryGi += val / 1024
            else if (unit === 'Gi') totalMemoryGi += val
            else totalMemoryGi += val / (1024 * 1024 * 1024) // bytes
          }

          totalGPUs += gpus

          const labels = item.metadata?.labels ?? {}

          return { name, status, cpu, memory, gpus, labels }
        })
      }
    } catch {
      // Ignore — node details are optional enrichment
    }

    totalMemoryGi = Math.round(totalMemoryGi * 10) / 10

    return {
      id: 'k8s-exec',
      name: 'Kubernetes Exec',
      available: true,
      version: serverVersion,
      metadata: {
        ...(urlMatch?.[0] ? { clusterUrl: urlMatch[0] } : {}),
        ...(namespaces.length > 0 ? { namespaces } : {}),
        ...(context ? { context } : {}),
        ...(nodes.length > 0 ? { nodes, totalNodes: nodes.length, totalCPU, totalMemoryGi, totalGPUs } : {}),
      },
    }
  } catch {
    // kubectl exists but cluster not reachable
    return {
      id: 'k8s-exec',
      name: 'Kubernetes Exec',
      available: false,
      metadata: { reason: 'Cluster not reachable' },
    }
  }
}

// ---------------------------------------------------------------------------
// SLURM
// ---------------------------------------------------------------------------

async function detectSlurm(): Promise<LocalBackendInfo | null> {
  try {
    const { stdout } = await execAsync('sinfo --version', { timeout: 5_000 })
    const version = stdout.trim().replace(/^slurm\s+/, '')

    const metadata: Record<string, unknown> = {}

    // Cluster name
    try {
      const { stdout: clusterOut } = await execAsync(
        'scontrol show config 2>/dev/null | grep ClusterName',
        { timeout: 5_000 },
      )
      const match = clusterOut.match(/ClusterName\s*=\s*(\S+)/)
      if (match?.[1]) metadata.clusterName = match[1]
    } catch {
      // Ignore
    }

    // Partition details
    try {
      const { stdout: sinfoOut } = await execAsync(
        'sinfo -h -o "%P|%a|%l|%D|%T|%f" 2>/dev/null',
        { timeout: 5_000 },
      )
      const seen = new Set<string>()
      const partitions: Array<Record<string, unknown>> = []
      for (const line of sinfoOut.trim().split('\n')) {
        if (!line.trim()) continue
        const [partRaw, avail, maxTime, nodeCount, , features] = line.split('|')
        const name = partRaw?.replace('*', '') ?? ''
        const isDefault = partRaw?.endsWith('*') ?? false
        if (seen.has(name)) continue
        seen.add(name)
        partitions.push({
          name,
          isDefault,
          available: avail === 'up',
          maxTime: maxTime?.trim(),
          nodes: parseInt(nodeCount ?? '0', 10) || 0,
          features: features?.trim() || undefined,
        })
      }
      if (partitions.length > 0) metadata.partitions = partitions
    } catch {
      // Ignore
    }

    // Accounts
    try {
      const { stdout: acctOut } = await execAsync(
        'sacctmgr -n -p show assoc user=$USER format=Account 2>/dev/null',
        { timeout: 5_000 },
      )
      const accounts = [...new Set(
        acctOut.trim().split('\n')
          .map((l) => l.replace(/\|/g, '').trim())
          .filter(Boolean)
      )]
      if (accounts.length > 0) metadata.accounts = accounts
    } catch {
      // Ignore
    }

    // QOS levels
    try {
      const { stdout: qosOut } = await execAsync(
        'sacctmgr -n -p show assoc user=$USER format=QOS 2>/dev/null',
        { timeout: 5_000 },
      )
      const qosSet = new Set<string>()
      for (const line of qosOut.trim().split('\n')) {
        for (const q of line.replace(/\|/g, '').trim().split(',')) {
          if (q.trim()) qosSet.add(q.trim())
        }
      }
      const qos = [...qosSet]
      if (qos.length > 0) metadata.qos = qos
    } catch {
      // Ignore
    }

    return {
      id: 'slurm',
      name: 'SLURM',
      available: true,
      version,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// SSH — each host becomes its own backend
// ---------------------------------------------------------------------------

interface SSHHostEntry {
  name: string
  hostname: string
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
  source: 'ssh-config' | 'known-hosts'
}

// Hosts that are git forges / services, not compute targets
const NON_COMPUTE_HOSTS = new Set([
  'github.com', 'gitlab.com', 'bitbucket.org', 'ssh.dev.azure.com',
  'vs-ssh.visualstudio.com', 'git-codecommit', 'source.developers.google.com',
  'aur.archlinux.org', 'git.sr.ht', 'codeberg.org', 'gitea.com',
])

function isNonComputeHost(entry: SSHHostEntry): boolean {
  const name = entry.name.toLowerCase()
  const hostname = entry.hostname.toLowerCase()
  // Exact match on known services
  if (NON_COMPUTE_HOSTS.has(name) || NON_COMPUTE_HOSTS.has(hostname)) return true
  // Subdomain match (e.g., gitlab.mycompany.com is fine, but github.com isn't)
  for (const svc of NON_COMPUTE_HOSTS) {
    if (hostname === svc || name === svc) return true
  }
  return false
}

/**
 * Quick TCP port check to determine if a host is reachable.
 * Returns true if a TCP connection to port 22 (or custom port) succeeds
 * within the timeout. Does not authenticate.
 */
function checkTCPReachable(hostname: string, port: number = 22, timeoutMs: number = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: hostname, port, timeout: timeoutMs }, () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)
    socket.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

/**
 * Detect SSH hosts from ~/.ssh/config. Each host becomes its own backend.
 * Non-compute hosts (github.com, etc.) are filtered out.
 * A quick TCP reachability check determines availability.
 */
async function detectSSHHosts(): Promise<LocalBackendInfo[]> {
  const entries: SSHHostEntry[] = []
  const seenHosts = new Set<string>()

  // Parse ~/.ssh/config (primary source — has user, port, proxy info)
  try {
    const sshConfigPath = join(homedir(), '.ssh', 'config')
    const content = await readFile(sshConfigPath, 'utf-8')
    let current: Partial<SSHHostEntry> | null = null

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const match = trimmed.match(/^(\S+)\s+(.+)$/)
      if (!match) continue

      const [, key, value] = match
      const keyLower = key?.toLowerCase()

      if (keyLower === 'host') {
        if (current?.name) {
          entries.push({
            name: current.name,
            hostname: current.hostname ?? current.name,
            user: current.user,
            port: current.port,
            identityFile: current.identityFile,
            proxyJump: current.proxyJump,
            source: 'ssh-config',
          })
          seenHosts.add(current.name)
        }

        const hostPattern = value?.trim() ?? ''
        if (hostPattern.includes('*') || hostPattern === 'localhost' || hostPattern === '127.0.0.1') {
          current = null
          continue
        }
        current = { name: hostPattern, hostname: hostPattern }
      } else if (current && value) {
        switch (keyLower) {
          case 'hostname': current.hostname = value.trim(); break
          case 'user': current.user = value.trim(); break
          case 'port': current.port = parseInt(value.trim(), 10); break
          case 'identityfile': current.identityFile = value.trim(); break
          case 'proxyjump': current.proxyJump = value.trim(); break
        }
      }
    }
    // Last entry
    if (current?.name) {
      entries.push({
        name: current.name,
        hostname: current.hostname ?? current.name,
        user: current.user,
        port: current.port,
        identityFile: current.identityFile,
        proxyJump: current.proxyJump,
        source: 'ssh-config',
      })
      seenHosts.add(current.name)
    }
  } catch {
    // No SSH config
  }

  // Filter out non-compute hosts
  const computeEntries = entries.filter((e) => !isNonComputeHost(e))

  if (computeEntries.length === 0) return []

  // Check reachability in parallel (with concurrency limit)
  const reachabilityResults = await Promise.all(
    computeEntries.map(async (entry) => {
      // Skip reachability check for hosts behind a ProxyJump (TCP check won't work directly)
      const reachable = entry.proxyJump
        ? null // unknown — can't check without proxy
        : await checkTCPReachable(entry.hostname, entry.port ?? 22, 3000)
      return { entry, reachable }
    })
  )

  return reachabilityResults.map(({ entry, reachable }) => ({
    id: `ssh:${entry.name}`,
    name: entry.name,
    available: reachable !== false, // true or null (unknown) counts as available
    version: undefined,
    metadata: {
      alias: entry.name,
      hostname: entry.hostname,
      user: entry.user,
      port: entry.port,
      identityFile: entry.identityFile,
      proxyJump: entry.proxyJump,
      source: entry.source,
      reachable, // true, false, or null (behind proxy)
    },
  }))
}
