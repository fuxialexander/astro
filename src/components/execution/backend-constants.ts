export interface ComputeBackendInfo {
  id: string
  name: string
  icon?: string
  description?: string
}

export const AVAILABLE_BACKENDS: ComputeBackendInfo[] = [
  { id: "k8s-exec", name: "Kubernetes", description: "kubectl exec into pods" },
  { id: "slurm", name: "Slurm", description: "HPC job scheduler" },
  { id: "docker", name: "Docker", description: "Container execution" },
]
