# Compute Backend Integration: Kubernetes, GCP, SkyPilot

## Current Compute Backend Support

### Execution Strategies (Agent Runner)

| Strategy | File | Status | Capabilities |
|----------|------|--------|-------------|
| **Direct** | `direct-strategy.ts` | Production | Local process, sync |
| **SLURM** | `slurm-strategy.ts` | Production | HPC batch jobs, async |
| **Docker** | `docker-strategy.ts` | Production | Container execution, sync |
| **K8s Exec** | `kubernetes-exec-strategy.ts` | Basic | kubectl exec on existing pods, sync |
| **SSH** | `ssh-strategy.ts` | New (v0.1.32) | Remote SSH execution, sync |

### What Kubernetes Can Do Today

The `K8sExecStrategy` currently:
- Detects kubectl availability
- Checks cluster reachability
- Lists namespaces, nodes, GPU resources
- Executes commands via `kubectl exec` on a **pre-existing pod**
- Supports namespace and container selection
- Handles abort signals and timeouts

### What's Missing

The K8s strategy **cannot**:
- Create new pods (only exec into existing ones)
- Copy code to pods (no `kubectl cp`)
- Create Services or Deployments
- Manage persistent volumes
- Handle GPU resource requests
- Support multi-node training
- Integrate with Kueue queues
- Work with SkyPilot

## Lessons from post-training-skypilot

The repository demonstrates these critical K8s patterns that Astro agents need to support:

### Pattern 1: Pod Lifecycle Management

```bash
# Create pod from YAML
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: astro-task-${taskId}
spec:
  restartPolicy: Never
  containers:
    - name: main
      image: python:3.10-slim
      command: ["sleep", "infinity"]
      resources:
        requests: { memory: "64Gi", cpu: "16" }
      volumeMounts:
        - name: workspace
          mountPath: /workspace
  volumes:
    - name: workspace
      persistentVolumeClaim:
        claimName: shared-pvc
EOF

# Copy code to pod
kubectl cp ./src astro-task-${taskId}:/workspace/src

# Execute task
kubectl exec astro-task-${taskId} -- bash -c "cd /workspace && python run.py"

# Cleanup
kubectl delete pod astro-task-${taskId}
```

### Pattern 2: GPU Training with SkyPilot

```yaml
# SkyPilot launcher
resources:
  cloud: kubernetes
  accelerators: H100:8
  image_id: docker:verlai/verl:latest
  labels:
    kueue.x-k8s.io/queue-name: skypilot-jobs-8-gpu
  disk_size: 500
  ports: 8265

num_nodes: 2

file_mounts:
  /opt/scripts: ./training_scripts

setup: |
  pip install -e .

run: |
  HEAD_IP=$(echo "$SKYPILOT_NODE_IPS" | head -n1)
  ray start --head --port=6379
  python train.py --master-addr $HEAD_IP
```

### Pattern 3: Service + Deployment for Long-Running Inference

```bash
# Service for stable DNS
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: inference-server
spec:
  selector: { app: inference }
  ports: [{ port: 8000, targetPort: 8000 }]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: inference-server
spec:
  replicas: 1
  selector: { matchLabels: { app: inference } }
  template:
    spec:
      containers:
        - name: server
          image: vllm/vllm-openai:latest
          resources:
            requests: { "nvidia.com/gpu": "8" }
          readinessProbe:
            httpGet: { path: /health, port: 8000 }
            initialDelaySeconds: 120
EOF
```

## Proposed Improvements

### Phase 1: Enhanced K8s Strategy (Week 1-3)

Extend `kubernetes-exec-strategy.ts` to support full pod lifecycle:

```typescript
// New methods for K8sExecStrategy
class K8sExecStrategy {
  // Existing
  detect(): Promise<ExecutionStrategyDetection>
  execute(spec, callbacks, signal): Promise<ExecutionResult>

  // New capabilities
  createPod(spec: K8sPodSpec): Promise<string>        // Create pod, return name
  copyToPod(pod: string, src: string, dst: string)     // kubectl cp
  deletePod(pod: string)                               // Cleanup
  createService(spec: K8sServiceSpec): Promise<string>  // Stable DNS
  waitForReady(pod: string, timeout: number)            // Poll readiness
}
```

### Phase 2: SkyPilot Strategy (Week 3-5)

Create new `skypilot-strategy.ts`:

```typescript
class SkyPilotStrategy implements ExecutionStrategy {
  readonly id = 'skypilot';
  readonly name = 'SkyPilot';
  readonly isAsync = true;  // Jobs are asynchronous

  detect(): Promise<ExecutionStrategyDetection> {
    // Check: sky --version
    // Check: sky status (any clusters available)
  }

  execute(spec: ExecutionSpec, callbacks, signal): Promise<ExecutionResult> {
    // 1. Generate SkyPilot YAML from spec
    // 2. sky jobs launch <yaml> -y
    // 3. Monitor job status
    // 4. Stream logs via sky logs
    // 5. Return result when complete
  }

  generateYaml(spec: SkyPilotSpec): string {
    // Convert ExecutionSpec → SkyPilot YAML
    // Include: resources, file_mounts, setup, run
  }
}
```

### Phase 3: GCP Direct Strategy (Week 5-7)

Create `gcp-strategy.ts` for direct GCE/GKE:

```typescript
class GCPStrategy implements ExecutionStrategy {
  readonly id = 'gcp';
  readonly name = 'Google Cloud';
  readonly isAsync = true;

  detect(): Promise<ExecutionStrategyDetection> {
    // Check: gcloud auth list
    // Check: gcloud config get project
    // List: available zones, GPU quotas
  }

  execute(spec: ExecutionSpec, callbacks, signal): Promise<ExecutionResult> {
    // Create VM → SSH → Execute → Cleanup
  }
}
```

### Phase 4: Strategy Composition (Week 7-9)

Support composite strategies where one strategy sets up infrastructure and another executes:

```
SkyPilot (creates cluster) → K8s Exec (runs on pods)
GCP (creates VM) → SSH (executes remotely)
Docker (creates container) → Direct (runs inside)
```

## Skill-Based Cloud Knowledge

Rather than hardcoding all cloud logic in execution strategies, skills provide domain knowledge:

### The Strategy-Skill Split

| Concern | Handled By | Example |
|---------|-----------|---------|
| **HOW to connect** | Execution Strategy | kubectl exec, ssh, gcloud compute ssh |
| **WHAT to run** | Skill | Training scripts, data prep, evaluation |
| **WHERE to put files** | Execution Strategy | kubectl cp, scp, gcloud compute scp |
| **HOW to configure** | Skill | Resource specs, NCCL settings, Ray cluster |

### Example: ML Training on Kubernetes

```
Agent receives task: "Train model on K8s cluster"
  ↓
Execution strategy detects: K8s available (H100x8)
  ↓
Agent loads skills: kubernetes-gpu-training, skypilot-launcher
  ↓
Skills instruct agent:
  1. Check GPU availability: kubectl get nodes -o json
  2. Create training pod with GPU requests
  3. Mount PVC for data
  4. Set NCCL environment variables
  5. Launch Ray cluster for distributed training
  6. Monitor with kubectl logs
  7. Save checkpoints to PVC
  ↓
Strategy handles: Pod creation, file copy, command execution
```

## Server-Side Changes

### Relay Protocol Extensions

Add new message types for cloud resource management:

```typescript
// New WebSocket message types
type CloudResourceMessage =
  | { type: 'cloud.resource.create'; spec: CloudResourceSpec }
  | { type: 'cloud.resource.status'; resourceId: string }
  | { type: 'cloud.resource.delete'; resourceId: string }
  | { type: 'cloud.resource.list'; filter: CloudResourceFilter }
```

### Machine Registry Enhancements

Track cloud resources alongside physical machines:

```typescript
interface MachineInfo {
  // Existing fields...
  cloudResources?: {
    provider: 'gcp' | 'aws' | 'k8s' | 'skypilot';
    resources: CloudResource[];
    quotas: ResourceQuota[];
  };
}
```

### Dispatch Engine Changes

Support strategy hints from templates and skills:

```typescript
interface TaskDispatch {
  // Existing fields...
  preferredStrategy?: string;         // 'k8s-exec' | 'skypilot' | 'gcp'
  resourceRequirements?: {
    gpuCount?: number;
    gpuType?: string;
    memory?: string;
    cpuCores?: number;
  };
}
```

## Priority

| Item | Priority | Effort | Impact |
|------|----------|--------|--------|
| K8s skills (teach agents) | **Critical** | 1 week | Immediate usability |
| SkyPilot skills | **Critical** | 1 week | ML/research users |
| Enhanced K8s strategy (pod lifecycle) | **High** | 2 weeks | Full K8s support |
| SkyPilot strategy | **High** | 2 weeks | Multi-cloud |
| GCP strategy | **Medium** | 2 weeks | Cloud expansion |
| Strategy composition | **Low** | 2 weeks | Advanced workflows |
