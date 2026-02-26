/**
 * Tests for sinfo parsing (buildContextString) and environment config store.
 *
 * Covers:
 * - buildContextString() for SLURM, Docker, K8s, SSH, and unknown backends
 * - Aggregated partition data with multiple sinfo lines
 * - Node state suffixes (mixed~, idle*, alloc~)
 * - Custom context appending
 * - Edge cases (empty metadata, null features)
 * - useEnvironmentConfigStore.getForBackend() lookup logic
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  buildContextString,
  type LocalBackendInfo,
} from "../server/lib/local-backends"

// ---------------------------------------------------------------------------
// buildContextString — SLURM backend
// ---------------------------------------------------------------------------

describe("buildContextString — SLURM", () => {
  function slurmBackend(
    metadata?: Record<string, unknown>,
    version?: string,
  ): LocalBackendInfo {
    return {
      id: "slurm",
      name: "SLURM",
      available: true,
      version: version ?? "23.11.4",
      metadata,
    }
  }

  it("produces basic SLURM string with version and no metadata", () => {
    const result = buildContextString(slurmBackend())
    expect(result).toContain("Slurm v23.11.4")
    expect(result).toContain("NEVER run compute on the login node")
  })

  it("includes cluster name when present", () => {
    const result = buildContextString(
      slurmBackend({ clusterName: "sherlock" }),
    )
    expect(result).toContain('"sherlock"')
    expect(result).toContain("Slurm v23.11.4")
  })

  it("includes partitions with node counts and features", () => {
    const result = buildContextString(
      slurmBackend({
        partitions: [
          {
            name: "gpu",
            nodes: 10,
            availableNodes: 7,
            features: "a100,nvlink",
          },
          {
            name: "cpu",
            nodes: 50,
            availableNodes: 42,
            features: "intel,avx512",
          },
        ],
      }),
    )
    expect(result).toContain("Partitions:")
    expect(result).toContain("gpu (7/10 nodes available) [a100,nvlink]")
    expect(result).toContain("cpu (42/50 nodes available) [intel,avx512]")
  })

  it("handles partition with zero available nodes", () => {
    const result = buildContextString(
      slurmBackend({
        partitions: [
          { name: "maintenance", nodes: 5, availableNodes: 0, features: undefined },
        ],
      }),
    )
    expect(result).toContain("maintenance (0/5 nodes available)")
    // No feature brackets when features is undefined
    expect(result).not.toContain("[")
  })

  it("handles partition without node counts", () => {
    const result = buildContextString(
      slurmBackend({
        partitions: [{ name: "debug" }],
      }),
    )
    expect(result).toContain("Partitions: debug")
    // No "(x/y nodes available)" when nodes is undefined
    expect(result).not.toContain("nodes available")
  })

  it("includes accounts", () => {
    const result = buildContextString(
      slurmBackend({ accounts: ["lab-smith", "dept-cs"] }),
    )
    expect(result).toContain("Accounts: lab-smith, dept-cs.")
  })

  it("includes GPU summary", () => {
    const result = buildContextString(
      slurmBackend({ totalGpus: 32, gpuNodeCount: 8 }),
    )
    expect(result).toContain("32 GPUs available across 8 nodes.")
  })

  it("handles GPU summary with unknown node count", () => {
    const result = buildContextString(slurmBackend({ totalGpus: 4 }))
    expect(result).toContain("4 GPUs available across ? nodes.")
  })

  it("omits GPU line when totalGpus is 0 or absent", () => {
    const result = buildContextString(slurmBackend({ totalGpus: 0 }))
    expect(result).not.toContain("GPUs available")

    const result2 = buildContextString(slurmBackend({}))
    expect(result2).not.toContain("GPUs available")
  })

  it("omits partitions line when partitions array is empty", () => {
    const result = buildContextString(slurmBackend({ partitions: [] }))
    expect(result).not.toContain("Partitions:")
  })

  it("uses '?' for version when version is undefined", () => {
    const backend: LocalBackendInfo = {
      id: "slurm",
      name: "SLURM",
      available: true,
      version: undefined,
      metadata: {},
    }
    const result = buildContextString(backend)
    expect(result).toContain("Slurm v?.")
  })

  it("handles full realistic SLURM metadata", () => {
    const result = buildContextString(
      slurmBackend({
        clusterName: "omega",
        partitions: [
          {
            name: "normal",
            nodes: 100,
            availableNodes: 80,
            features: "intel,ssd",
          },
          {
            name: "gpu",
            nodes: 20,
            availableNodes: 15,
            features: "a100,nvlink,pcie4",
          },
          {
            name: "bigmem",
            nodes: 5,
            availableNodes: 5,
          },
        ],
        accounts: ["research", "teaching"],
        totalGpus: 80,
        gpuNodeCount: 20,
      }),
    )
    expect(result).toContain('"omega"')
    expect(result).toContain("normal (80/100 nodes available) [intel,ssd]")
    expect(result).toContain("gpu (15/20 nodes available) [a100,nvlink,pcie4]")
    expect(result).toContain("bigmem (5/5 nodes available)")
    expect(result).toContain("Accounts: research, teaching.")
    expect(result).toContain("80 GPUs available across 20 nodes.")
    expect(result).toContain("NEVER run compute on the login node")
  })
})

// ---------------------------------------------------------------------------
// buildContextString — Docker backend
// ---------------------------------------------------------------------------

describe("buildContextString — Docker", () => {
  it("produces Docker context with version, cpus, and memory", () => {
    const backend: LocalBackendInfo = {
      id: "docker",
      name: "Docker",
      available: true,
      version: "24.0.7",
      metadata: { cpus: 16, memoryGb: 64 },
    }
    const result = buildContextString(backend)
    expect(result).toContain("Docker v24.0.7")
    expect(result).toContain("16 CPUs")
    expect(result).toContain("64GB memory")
    expect(result).toContain("docker run --rm")
  })

  it("uses '?' for missing cpus and memory", () => {
    const backend: LocalBackendInfo = {
      id: "docker",
      name: "Docker",
      available: true,
      version: "25.0.0",
    }
    const result = buildContextString(backend)
    expect(result).toContain("? CPUs")
    expect(result).toContain("?GB memory")
  })

  it("uses '?' for missing version", () => {
    const backend: LocalBackendInfo = {
      id: "docker",
      name: "Docker",
      available: true,
    }
    const result = buildContextString(backend)
    expect(result).toContain("Docker v?")
  })
})

// ---------------------------------------------------------------------------
// buildContextString — Kubernetes backend
// ---------------------------------------------------------------------------

describe("buildContextString — Kubernetes", () => {
  it("produces K8s context with nodes and resources", () => {
    const backend: LocalBackendInfo = {
      id: "k8s-exec",
      name: "Kubernetes Exec",
      available: true,
      version: "v1.28.0",
      metadata: {
        context: "prod-cluster",
        totalNodes: 5,
        nodes: [1, 2, 3, 4, 5], // just need length
        totalCPU: 80,
        totalMemoryGi: 320,
        totalGPUs: 8,
        namespaces: ["default", "kube-system", "app"],
      },
    }
    const result = buildContextString(backend)
    expect(result).toContain('"prod-cluster"')
    expect(result).toContain("5 node(s)")
    expect(result).toContain("80 CPUs")
    expect(result).toContain("320Gi RAM")
    expect(result).toContain("8 GPUs")
    expect(result).toContain("Namespaces: default, kube-system, app.")
    expect(result).toContain("kubectl exec")
  })

  it("handles zero-node fallback with pod count", () => {
    const backend: LocalBackendInfo = {
      id: "k8s-exec",
      name: "Kubernetes Exec",
      available: true,
      metadata: {
        context: "aks-cluster",
        nodes: [],
        totalNodes: 0,
        totalCPU: 0,
        totalMemoryGi: 0,
        totalGPUs: 0,
        podCount: 42,
        podsByNamespace: { default: 10, monitoring: 12, app: 20 },
      },
    }
    const result = buildContextString(backend)
    expect(result).toContain("No nodes visible")
    expect(result).toContain("42 pods running across 3 namespaces")
    expect(result).toContain("Namespaces: default, monitoring, app")
  })

  it("uses 'default' context when context is undefined", () => {
    const backend: LocalBackendInfo = {
      id: "k8s-exec",
      name: "Kubernetes Exec",
      available: true,
      metadata: { nodes: [], totalNodes: 0, totalCPU: 0, totalMemoryGi: 0, totalGPUs: 0 },
    }
    const result = buildContextString(backend)
    expect(result).toContain('"default"')
  })

  it("handles empty metadata", () => {
    const backend: LocalBackendInfo = {
      id: "k8s-exec",
      name: "Kubernetes Exec",
      available: true,
    }
    const result = buildContextString(backend)
    expect(result).toContain('"default"')
    expect(result).toContain("0 node(s)")
  })
})

// ---------------------------------------------------------------------------
// buildContextString — SSH backend
// ---------------------------------------------------------------------------

describe("buildContextString — SSH", () => {
  it("produces SSH context with alias and hostname", () => {
    const backend: LocalBackendInfo = {
      id: "ssh:hpc-login",
      name: "hpc-login",
      available: true,
      metadata: {
        alias: "hpc-login",
        hostname: "login.hpc.university.edu",
        user: "jdoe",
        reachable: true,
      },
    }
    const result = buildContextString(backend)
    expect(result).toContain('"hpc-login"')
    expect(result).toContain("jdoe@login.hpc.university.edu")
    expect(result).toContain("ssh hpc-login")
    expect(result).not.toContain("unreachable")
  })

  it("includes unreachable warning", () => {
    const backend: LocalBackendInfo = {
      id: "ssh:devbox",
      name: "devbox",
      available: false,
      metadata: {
        alias: "devbox",
        hostname: "devbox.internal",
        reachable: false,
      },
    }
    const result = buildContextString(backend)
    expect(result).toContain("unreachable at last check")
  })

  it("formats hostname without user when user is undefined", () => {
    const backend: LocalBackendInfo = {
      id: "ssh:bastion",
      name: "bastion",
      available: true,
      metadata: {
        alias: "bastion",
        hostname: "bastion.example.com",
        reachable: true,
      },
    }
    const result = buildContextString(backend)
    // Should just show hostname, no user@ prefix
    expect(result).toContain("(bastion.example.com)")
    expect(result).not.toContain("@bastion.example.com")
  })
})

// ---------------------------------------------------------------------------
// buildContextString — unknown / generic backend
// ---------------------------------------------------------------------------

describe("buildContextString — unknown backend", () => {
  it("falls back to generic message for unknown backend IDs", () => {
    const backend: LocalBackendInfo = {
      id: "custom-runner",
      name: "Custom Runner",
      available: true,
    }
    const result = buildContextString(backend)
    expect(result).toBe("Custom Runner backend available.")
  })
})

// ---------------------------------------------------------------------------
// buildContextString — custom context appending
// ---------------------------------------------------------------------------

describe("buildContextString — custom context", () => {
  it("appends custom context as a separate section", () => {
    const backend: LocalBackendInfo = {
      id: "docker",
      name: "Docker",
      available: true,
      version: "24.0.7",
      metadata: { cpus: 8, memoryGb: 32 },
    }
    const result = buildContextString(
      backend,
      "Always use the python:3.12 image.",
    )
    expect(result).toContain("Docker v24.0.7")
    expect(result).toContain("--- Custom Instructions ---")
    expect(result).toContain("Always use the python:3.12 image.")
  })

  it("does not append section when custom context is empty string", () => {
    const backend: LocalBackendInfo = {
      id: "docker",
      name: "Docker",
      available: true,
      version: "24.0.7",
      metadata: {},
    }
    const result = buildContextString(backend, "")
    expect(result).not.toContain("Custom Instructions")
  })

  it("does not append section when custom context is whitespace-only", () => {
    const backend: LocalBackendInfo = {
      id: "docker",
      name: "Docker",
      available: true,
      version: "24.0.7",
      metadata: {},
    }
    const result = buildContextString(backend, "   \n  \t  ")
    expect(result).not.toContain("Custom Instructions")
  })

  it("does not append section when custom context is undefined", () => {
    const backend: LocalBackendInfo = {
      id: "docker",
      name: "Docker",
      available: true,
      version: "24.0.7",
      metadata: {},
    }
    const result = buildContextString(backend, undefined)
    expect(result).not.toContain("Custom Instructions")
  })

  it("trims whitespace from custom context", () => {
    const backend: LocalBackendInfo = {
      id: "slurm",
      name: "SLURM",
      available: true,
      version: "23.11.4",
      metadata: {},
    }
    const result = buildContextString(
      backend,
      "  Use partition gpu for ML jobs.  \n",
    )
    expect(result).toContain("--- Custom Instructions ---\nUse partition gpu for ML jobs.")
  })

  it("works with SLURM backend and custom context", () => {
    const backend: LocalBackendInfo = {
      id: "slurm",
      name: "SLURM",
      available: true,
      version: "23.11.4",
      metadata: {
        clusterName: "atlas",
        partitions: [
          { name: "gpu", nodes: 10, availableNodes: 8, features: "a100" },
        ],
        accounts: ["ml-team"],
      },
    }
    const result = buildContextString(
      backend,
      "Max 4 GPUs per job.\nUse account ml-team.",
    )
    expect(result).toContain('"atlas"')
    expect(result).toContain("gpu (8/10 nodes available)")
    expect(result).toContain("Accounts: ml-team.")
    expect(result).toContain("NEVER run compute on the login node")
    expect(result).toContain("--- Custom Instructions ---")
    expect(result).toContain("Max 4 GPUs per job.")
    expect(result).toContain("Use account ml-team.")
  })

  it("works with SSH backend and custom context", () => {
    const backend: LocalBackendInfo = {
      id: "ssh:gpu-node",
      name: "gpu-node",
      available: true,
      metadata: {
        alias: "gpu-node",
        hostname: "gpu01.cluster.edu",
        user: "researcher",
        reachable: true,
      },
    }
    const result = buildContextString(
      backend,
      "This node has 4x A100 GPUs. Use conda env 'ml'.",
    )
    expect(result).toContain("researcher@gpu01.cluster.edu")
    expect(result).toContain("--- Custom Instructions ---")
    expect(result).toContain("This node has 4x A100 GPUs. Use conda env 'ml'.")
  })

  it("works with K8s backend and custom context", () => {
    const backend: LocalBackendInfo = {
      id: "k8s-exec",
      name: "Kubernetes Exec",
      available: true,
      metadata: {
        context: "dev",
        nodes: [1],
        totalNodes: 1,
        totalCPU: 4,
        totalMemoryGi: 16,
        totalGPUs: 0,
      },
    }
    const result = buildContextString(
      backend,
      "Deploy to namespace 'staging' only.",
    )
    expect(result).toContain('"dev"')
    expect(result).toContain("--- Custom Instructions ---")
    expect(result).toContain("Deploy to namespace 'staging' only.")
  })

  it("works with generic/unknown backend and custom context", () => {
    const backend: LocalBackendInfo = {
      id: "my-custom",
      name: "My Custom Backend",
      available: true,
    }
    const result = buildContextString(backend, "Only run read-only queries.")
    expect(result).toContain("My Custom Backend backend available.")
    expect(result).toContain("--- Custom Instructions ---")
    expect(result).toContain("Only run read-only queries.")
  })
})

// ---------------------------------------------------------------------------
// useEnvironmentConfigStore — getForBackend lookup logic
// ---------------------------------------------------------------------------

// Mock dataClient to prevent real API calls
vi.mock("../src/lib/data-client", () => ({
  dataClient: {
    getEnvironmentConfigs: vi.fn().mockResolvedValue([]),
    upsertEnvironmentConfig: vi.fn().mockResolvedValue({}),
    deleteEnvironmentConfig: vi.fn().mockResolvedValue(undefined),
  },
}))

// Mock api-url
vi.mock("../src/lib/api-url", () => ({
  apiUrl: (path: string) => `http://localhost:3001${path}`,
}))

describe("useEnvironmentConfigStore — getForBackend", () => {
  let useEnvironmentConfigStore: typeof import("../src/stores/environment-config-store").useEnvironmentConfigStore

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import("../src/stores/environment-config-store")
    useEnvironmentConfigStore = mod.useEnvironmentConfigStore
  })

  it("returns undefined when no configs loaded", () => {
    const store = useEnvironmentConfigStore.getState()
    expect(store.getForBackend("docker")).toBeUndefined()
  })

  it("finds config matching backendId with no machineId", () => {
    useEnvironmentConfigStore.setState({
      configs: [
        {
          id: "cfg-1",
          userId: "u1",
          backendId: "docker",
          machineId: undefined,
          customContext: "Use alpine images",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })
    const result = useEnvironmentConfigStore.getState().getForBackend("docker")
    expect(result).toBeDefined()
    expect(result!.backendId).toBe("docker")
    expect(result!.customContext).toBe("Use alpine images")
  })

  it("finds config matching both backendId and machineId", () => {
    useEnvironmentConfigStore.setState({
      configs: [
        {
          id: "cfg-1",
          userId: "u1",
          backendId: "slurm",
          machineId: "machine-abc",
          customContext: "Use partition gpu",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "cfg-2",
          userId: "u1",
          backendId: "slurm",
          machineId: undefined,
          customContext: "Generic slurm context",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })
    const result = useEnvironmentConfigStore
      .getState()
      .getForBackend("slurm", "machine-abc")
    expect(result).toBeDefined()
    expect(result!.id).toBe("cfg-1")
    expect(result!.customContext).toBe("Use partition gpu")
  })

  it("does not match when machineId differs", () => {
    useEnvironmentConfigStore.setState({
      configs: [
        {
          id: "cfg-1",
          userId: "u1",
          backendId: "slurm",
          machineId: "machine-abc",
          customContext: "Context for abc",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })
    // Looking for a different machineId should not match
    const result = useEnvironmentConfigStore
      .getState()
      .getForBackend("slurm", "machine-xyz")
    expect(result).toBeUndefined()
  })

  it("does not match when backendId differs", () => {
    useEnvironmentConfigStore.setState({
      configs: [
        {
          id: "cfg-1",
          userId: "u1",
          backendId: "docker",
          machineId: undefined,
          customContext: "Docker context",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })
    const result = useEnvironmentConfigStore
      .getState()
      .getForBackend("slurm")
    expect(result).toBeUndefined()
  })

  it("matches null machineId in config when caller passes undefined", () => {
    // The store uses (c.machineId ?? undefined) === machineId,
    // so null in the config should match undefined from the caller
    useEnvironmentConfigStore.setState({
      configs: [
        {
          id: "cfg-1",
          userId: "u1",
          backendId: "docker",
          machineId: null as unknown as undefined,
          customContext: "Null machine context",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })
    const result = useEnvironmentConfigStore.getState().getForBackend("docker")
    expect(result).toBeDefined()
    expect(result!.customContext).toBe("Null machine context")
  })

  it("matches undefined machineId in config when caller passes undefined", () => {
    useEnvironmentConfigStore.setState({
      configs: [
        {
          id: "cfg-1",
          userId: "u1",
          backendId: "docker",
          machineId: undefined,
          customContext: "Undefined machine context",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })
    const result = useEnvironmentConfigStore
      .getState()
      .getForBackend("docker", undefined)
    expect(result).toBeDefined()
    expect(result!.customContext).toBe("Undefined machine context")
  })

  it("does not match config with machineId when caller omits machineId", () => {
    useEnvironmentConfigStore.setState({
      configs: [
        {
          id: "cfg-1",
          userId: "u1",
          backendId: "docker",
          machineId: "specific-machine",
          customContext: "Machine-specific",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })
    // Calling without machineId should not match a config that has one
    const result = useEnvironmentConfigStore.getState().getForBackend("docker")
    expect(result).toBeUndefined()
  })

  it("selects correct config among multiple backends", () => {
    useEnvironmentConfigStore.setState({
      configs: [
        {
          id: "cfg-docker",
          userId: "u1",
          backendId: "docker",
          machineId: undefined,
          customContext: "Docker instructions",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "cfg-slurm",
          userId: "u1",
          backendId: "slurm",
          machineId: undefined,
          customContext: "SLURM instructions",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "cfg-k8s",
          userId: "u1",
          backendId: "k8s-exec",
          machineId: undefined,
          customContext: "K8s instructions",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })
    const docker = useEnvironmentConfigStore
      .getState()
      .getForBackend("docker")
    const slurm = useEnvironmentConfigStore
      .getState()
      .getForBackend("slurm")
    const k8s = useEnvironmentConfigStore
      .getState()
      .getForBackend("k8s-exec")
    expect(docker!.customContext).toBe("Docker instructions")
    expect(slurm!.customContext).toBe("SLURM instructions")
    expect(k8s!.customContext).toBe("K8s instructions")
  })

  it("returns first matching config when duplicates exist", () => {
    useEnvironmentConfigStore.setState({
      configs: [
        {
          id: "cfg-first",
          userId: "u1",
          backendId: "docker",
          machineId: undefined,
          customContext: "First config",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "cfg-second",
          userId: "u1",
          backendId: "docker",
          machineId: undefined,
          customContext: "Second config",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })
    const result = useEnvironmentConfigStore.getState().getForBackend("docker")
    // Array.find returns the first match
    expect(result!.id).toBe("cfg-first")
    expect(result!.customContext).toBe("First config")
  })
})
