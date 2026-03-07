---
name: kubernetes-workflow
version: "1.0.0"
description: "This skill should be used when the user asks to 'run on Kubernetes', 'create a pod', 'deploy to k8s', 'kubectl exec', 'copy code to pod', 'run training on cluster', 'create a deployment', mentions 'Kubernetes', 'k8s', 'kubectl', 'pod', 'namespace', or needs to execute code on a Kubernetes cluster."
category: workflows
tags: [kubernetes, k8s, cloud, devops, infrastructure, gpu, training]
allowedTools: [Bash, Read, Write, Glob, Grep]
---

# Kubernetes Workflow

## Goal

Execute tasks on Kubernetes clusters: create pods, sync code, run commands, manage deployments and services, and handle GPU workloads.

## When to Use

- User wants to run code on a Kubernetes cluster
- User needs to create, manage, or exec into pods
- User needs to copy files to/from a Kubernetes pod
- User wants to deploy a service (inference server, API, etc.)
- User needs GPU resources for training or inference
- User asks about namespaces, PVCs, or cluster resources

## Workflow

### Phase 0: Detect Cluster and Gather Context

Before performing any Kubernetes operation, detect the cluster environment. Ask the user for any information you cannot auto-detect.

```bash
# Check kubectl is available
which kubectl

# Get current context and cluster info
kubectl config current-context
kubectl cluster-info --request-timeout=5s

# List available namespaces
kubectl get namespaces

# Check node capacity (CPU, memory, GPU)
kubectl get nodes -o custom-columns=NAME:.metadata.name,STATUS:.status.conditions[-1:].type,CPU:.status.capacity.cpu,MEM:.status.capacity.memory,GPU:.status.capacity.'nvidia\.com/gpu'

# Check available storage classes
kubectl get storageclass

# Check existing PVCs
kubectl get pvc --all-namespaces
```

**Ask the user if not auto-detectable:**
- Target namespace (default: `default`)
- PVC name for persistent storage (if needed)
- Kueue queue name (if using Kueue scheduling: `kueue.x-k8s.io/queue-name`)
- Node selector labels (e.g., `skypilot.co/accelerator: h100`)
- Container image to use

### Phase 1: Create a Pod for Task Execution

Use this pattern when you need a short-lived pod to run commands or prepare data.

```bash
# Set variables (ask user or detect from context)
POD_NAME="astro-task-$(date +%s)"
NAMESPACE="default"
IMAGE="python:3.10-slim"
PVC_NAME="shared-workspace"  # Ask user for their PVC name

# Check if pod already exists
kubectl get pod "$POD_NAME" -n "$NAMESPACE" 2>/dev/null && \
  kubectl delete pod "$POD_NAME" -n "$NAMESPACE" --wait=true

# Create pod with persistent storage
kubectl apply -n "$NAMESPACE" -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${POD_NAME}
  labels:
    app: astro-task
spec:
  restartPolicy: Never
  containers:
    - name: main
      image: ${IMAGE}
      command: ["sleep", "infinity"]
      resources:
        requests:
          memory: "8Gi"
          cpu: "4"
        limits:
          memory: "16Gi"
          cpu: "8"
      volumeMounts:
        - name: workspace
          mountPath: /workspace
  volumes:
    - name: workspace
      persistentVolumeClaim:
        claimName: ${PVC_NAME}
EOF

# Wait for pod to be ready
kubectl wait --for=condition=Ready pod/"$POD_NAME" -n "$NAMESPACE" --timeout=300s
```

**For GPU pods**, add to the container spec:

```yaml
resources:
  requests:
    nvidia.com/gpu: "8"
    cpu: "32"
    memory: "128Gi"
  limits:
    nvidia.com/gpu: "8"
    cpu: "128"
    memory: "1400Gi"
securityContext:
  privileged: true
  capabilities:
    add: [SYS_RESOURCE, IPC_LOCK, SYS_PTRACE]
```

### Phase 2: Copy Code to Pod

Sync local files to the pod before executing. Always create the target directory first and remove stale files.

```bash
# Create target directory in pod
kubectl exec "$POD_NAME" -n "$NAMESPACE" -- mkdir -p /workspace/project

# Remove old files to avoid stale state
kubectl exec "$POD_NAME" -n "$NAMESPACE" -- rm -rf /workspace/project/src 2>/dev/null || true

# Copy code to pod
kubectl cp ./src "$POD_NAME":/workspace/project/src -n "$NAMESPACE"
kubectl cp ./requirements.txt "$POD_NAME":/workspace/project/requirements.txt -n "$NAMESPACE"
kubectl cp ./run.sh "$POD_NAME":/workspace/project/run.sh -n "$NAMESPACE"

# Verify the copy
kubectl exec "$POD_NAME" -n "$NAMESPACE" -- ls -la /workspace/project/

# Copy results back from pod when done
kubectl cp "$POD_NAME":/workspace/project/output ./output -n "$NAMESPACE"
```

### Phase 3: Execute Commands on Pod

Run commands interactively or as scripts.

```bash
# Run a single command
kubectl exec "$POD_NAME" -n "$NAMESPACE" -- bash -c "cd /workspace/project && python run.py"

# Run with environment variables
kubectl exec "$POD_NAME" -n "$NAMESPACE" -- bash -c "
  export WANDB_API_KEY=\$WANDB_API_KEY
  cd /workspace/project
  pip install -r requirements.txt
  python train.py --epochs 10
"

# Stream logs from a running command
kubectl exec "$POD_NAME" -n "$NAMESPACE" -- tail -f /workspace/project/logs/train.log

# Check pod logs (for pods with entrypoint commands)
kubectl logs "$POD_NAME" -n "$NAMESPACE" --tail=100
kubectl logs "$POD_NAME" -n "$NAMESPACE" -f  # Follow logs
```

### Phase 4: Create a Deployment and Service

For long-running services (inference servers, APIs), use Deployments with Services for stable DNS.

```bash
NAME="my-service"
NAMESPACE="default"
IMAGE="vllm/vllm-openai:latest"
PORT=8000

kubectl apply -n "$NAMESPACE" -f - <<EOF
---
apiVersion: v1
kind: Service
metadata:
  name: ${NAME}
spec:
  type: ClusterIP
  selector:
    app: ${NAME}
  ports:
    - name: http
      port: ${PORT}
      targetPort: ${PORT}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${NAME}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${NAME}
  template:
    metadata:
      labels:
        app: ${NAME}
    spec:
      containers:
        - name: server
          image: ${IMAGE}
          ports:
            - containerPort: ${PORT}
          readinessProbe:
            httpGet:
              path: /health
              port: ${PORT}
            initialDelaySeconds: 120
            periodSeconds: 10
            failureThreshold: 30
          livenessProbe:
            httpGet:
              path: /health
              port: ${PORT}
            initialDelaySeconds: 600
            periodSeconds: 30
          resources:
            requests:
              nvidia.com/gpu: "8"
              cpu: "32"
              memory: "128Gi"
            limits:
              nvidia.com/gpu: "8"
              cpu: "128"
              memory: "1400Gi"
          volumeMounts:
            - name: workspace
              mountPath: /workspace
      volumes:
        - name: workspace
          persistentVolumeClaim:
            claimName: ${PVC_NAME}
EOF

# Wait for rollout
kubectl rollout status deployment/"${NAME}" -n "${NAMESPACE}" --timeout=900s

# Get service DNS (accessible from within cluster)
echo "Service DNS: ${NAME}.${NAMESPACE}.svc.cluster.local:${PORT}"

# Get service cluster IP
kubectl get svc "${NAME}" -n "${NAMESPACE}" -o jsonpath='{.spec.clusterIP}'

# Test from another pod
kubectl exec -it any-other-pod -- curl http://${NAME}.${NAMESPACE}.svc.cluster.local:${PORT}/health
```

### Phase 5: Manage Kubernetes Jobs

For batch processing with automatic cleanup:

```bash
JOB_NAME="data-processing-job"

kubectl apply -n "$NAMESPACE" -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
spec:
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      containers:
        - name: worker
          image: python:3.10
          command: ["python", "/workspace/process.py"]
          resources:
            requests:
              memory: "32Gi"
              cpu: "8"
          volumeMounts:
            - name: workspace
              mountPath: /workspace
      volumes:
        - name: workspace
          persistentVolumeClaim:
            claimName: ${PVC_NAME}
      restartPolicy: Never
EOF

# Monitor job
kubectl get jobs -n "$NAMESPACE"
kubectl logs -f job/${JOB_NAME} -n "$NAMESPACE"

# Cleanup
kubectl delete job ${JOB_NAME} -n "$NAMESPACE" --ignore-not-found
```

### Phase 6: Multi-Node Distributed Training

For multi-node GPU training (e.g., large language model training across 2-8+ nodes), use a headless Service for DNS-based pod discovery plus a head/worker pod pattern.

**Ask the user for multi-node specifics:**
- Number of nodes (e.g., 4 nodes x 8 GPUs = 32 GPUs total)
- Training framework (Ray, PyTorch distributed, DeepSpeed, NeMo)
- Model size (determines parallelism strategy: TP, PP, FSDP, EP)
- Batch size per node (auto-scales: `NNODES x batch_size_per_node`)
- Node selector labels for GPU type (varies by cluster, e.g., `skypilot.co/accelerator: h100`, `nebius.com/resource-preset: 8gpu-128vcpu-1600gb`)

#### Option A: Ray Cluster (Head + Workers)

```bash
TRAINING_NAME="my-training"
NAMESPACE="default"
NUM_NODES=4
IMAGE="my-registry/training:latest"
PVC_NAME="shared-workspace"  # ASK USER

# Step 1: Create headless service for pod-to-pod DNS
kubectl apply -n "$NAMESPACE" -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${TRAINING_NAME}-headless
  labels:
    app: ${TRAINING_NAME}
spec:
  clusterIP: None
  selector:
    app: ${TRAINING_NAME}
  ports:
    - name: ray-client
      port: 6379
      targetPort: 6379
    - name: ray-dashboard
      port: 8265
      targetPort: 8265
EOF

# Step 2: Create head pod (NODE_RANK=0)
kubectl apply -n "$NAMESPACE" -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${TRAINING_NAME}-head
  labels:
    app: ${TRAINING_NAME}
    role: head
spec:
  restartPolicy: Never
  containers:
    - name: main
      image: ${IMAGE}
      env:
        - name: NODE_RANK
          value: "0"
        - name: NNODES
          value: "${NUM_NODES}"
        - name: MASTER_ADDR
          value: "${TRAINING_NAME}-head.${NAMESPACE}.svc.cluster.local"
        - name: MASTER_PORT
          value: "29500"
        - name: NCCL_DEBUG
          value: "WARN"
        - name: NCCL_TIMEOUT
          value: "600"
        - name: TORCH_NCCL_HEARTBEAT_TIMEOUT_SEC
          value: "600"
      command: ["/bin/bash", "-c"]
      args:
        - |
          ray start --head --port=6379 --dashboard-host=0.0.0.0 --dashboard-port=8265
          echo "Waiting for ${NNODES} nodes..."
          retry=0
          while [ \$retry -lt 120 ]; do
            connected=\$(ray status 2>/dev/null | grep -c "node_" || true)
            echo "Connected: \$connected/${NNODES}"
            [ "\$connected" -ge "${NNODES}" ] && break
            retry=\$((retry+1))
            sleep 10
          done
          # Run training
          cd /workspace && python train.py
      resources:
        requests:
          nvidia.com/gpu: "8"
          cpu: "32"
          memory: "128Gi"
        limits:
          nvidia.com/gpu: "8"
          cpu: "128"
          memory: "1400Gi"
      securityContext:
        privileged: true
        capabilities:
          add: [SYS_RESOURCE, IPC_LOCK, SYS_PTRACE]
      volumeMounts:
        - name: workspace
          mountPath: /workspace
        - name: dshm
          mountPath: /dev/shm
  volumes:
    - name: workspace
      persistentVolumeClaim:
        claimName: ${PVC_NAME}
    - name: dshm
      emptyDir:
        medium: Memory
EOF

# Step 3: Create worker pods (NODE_RANK=1..N-1)
for RANK in $(seq 1 $((NUM_NODES-1))); do
kubectl apply -n "$NAMESPACE" -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${TRAINING_NAME}-worker-${RANK}
  labels:
    app: ${TRAINING_NAME}
    role: worker
spec:
  restartPolicy: Never
  containers:
    - name: main
      image: ${IMAGE}
      env:
        - name: NODE_RANK
          value: "${RANK}"
        - name: MASTER_ADDR
          value: "${TRAINING_NAME}-head.${NAMESPACE}.svc.cluster.local"
      command: ["/bin/bash", "-c"]
      args:
        - |
          sleep 30
          ray start --address=\${MASTER_ADDR}:6379 --disable-usage-stats
          while true; do sleep 60; pgrep -f ray > /dev/null || exit 1; done
      resources:
        requests:
          nvidia.com/gpu: "8"
          cpu: "32"
          memory: "128Gi"
        limits:
          nvidia.com/gpu: "8"
          cpu: "128"
          memory: "1400Gi"
      securityContext:
        privileged: true
        capabilities:
          add: [SYS_RESOURCE, IPC_LOCK, SYS_PTRACE]
      volumeMounts:
        - name: workspace
          mountPath: /workspace
        - name: dshm
          mountPath: /dev/shm
  volumes:
    - name: workspace
      persistentVolumeClaim:
        claimName: ${PVC_NAME}
    - name: dshm
      emptyDir:
        medium: Memory
EOF
done

# Monitor: wait for all pods to be ready
kubectl wait --for=condition=Ready pod -l app=${TRAINING_NAME} -n "$NAMESPACE" --timeout=600s

# Check Ray dashboard (port-forward from head)
kubectl port-forward pod/${TRAINING_NAME}-head 8265:8265 -n "$NAMESPACE" &
```

#### Option B: PyTorch Distributed (Without Ray)

For simpler multi-node setups using `torch.distributed.run`:

```bash
# In the head pod command:
python -m torch.distributed.run \
  --nnodes=${NNODES} \
  --nproc_per_node=8 \
  --node_rank=${NODE_RANK} \
  --master_addr=${MASTER_ADDR} \
  --master_port=${MASTER_PORT} \
  train.py --config config.yaml

# Worker pods run the same command with their own NODE_RANK
```

#### Shared Memory (/dev/shm)

**Critical for GPU training.** Always mount an emptyDir with `medium: Memory`:

```yaml
volumeMounts:
  - name: dshm
    mountPath: /dev/shm
volumes:
  - name: dshm
    emptyDir:
      medium: Memory  # RAM-backed, required for NCCL/GPU IPC
```

Without this, NCCL falls back to slow shared memory and training may hang or crash.

#### Batch Size Auto-Scaling

Batch size typically scales linearly with nodes. The training script should handle this:

```bash
BATCH_SIZE_PER_NODE="${BATCH_SIZE_PER_NODE:-64}"
TRAIN_BATCH_SIZE="${TRAIN_BATCH_SIZE:-$((NNODES * BATCH_SIZE_PER_NODE))}"
```

### Phase 7: Manage Secrets

```bash
# Create secret from literal values
kubectl create secret generic api-tokens \
  --from-literal=HF_TOKEN="hf_xxxxx" \
  --from-literal=WANDB_API_KEY="xxxxx" \
  -n "$NAMESPACE"

# Reference in pod spec:
# env:
#   - name: HF_TOKEN
#     valueFrom:
#       secretKeyRef:
#         name: api-tokens
#         key: HF_TOKEN
```

### Phase 8: Monitor and Debug

```bash
# Get all pods with status
kubectl get pods -n "$NAMESPACE" -o wide

# Describe pod (events, conditions, scheduling)
kubectl describe pod "$POD_NAME" -n "$NAMESPACE"

# Check resource usage
kubectl top pods -n "$NAMESPACE"
kubectl top nodes

# Get pod events (for debugging scheduling failures)
kubectl get events -n "$NAMESPACE" --sort-by='.lastTimestamp' | tail -20

# Check GPU availability across nodes
kubectl get nodes -o custom-columns=NAME:.metadata.name,GPU:.status.capacity.'nvidia\.com/gpu',ALLOC:.status.allocatable.'nvidia\.com/gpu'
```

### Phase 9: Cleanup

```bash
# Delete pod
kubectl delete pod "$POD_NAME" -n "$NAMESPACE" --ignore-not-found

# Delete deployment + service
kubectl delete deployment "$NAME" -n "$NAMESPACE" --ignore-not-found
kubectl delete service "$NAME" -n "$NAMESPACE" --ignore-not-found

# Delete all resources with a label
kubectl delete all -l app=astro-task -n "$NAMESPACE"
```

## Best Practices

1. **Always set resource requests and limits** to avoid node overcommitment
2. **Use PVCs for shared data** between pods and across restarts
3. **Use Jobs (not bare Pods)** for batch work so Kubernetes handles retries
4. **Set `ttlSecondsAfterFinished`** on Jobs to auto-cleanup completed pods
5. **Use readiness/liveness probes** for Deployments so traffic only goes to healthy pods
6. **Name resources descriptively** with task IDs for traceability
7. **Check `kubectl describe pod`** when pods are stuck in Pending (usually resource or scheduling issues)
8. **Use `--request-timeout`** on detection commands to avoid hanging on unreachable clusters

## User-Specific Configuration Guide

The general workflow above is a recipe that works across clusters, but **specific values differ per user, team, and cluster**. Always ask the user for these before proceeding:

### Must Ask (Cannot Auto-Detect Reliably)

| Parameter | Why It Varies | Example Values |
|-----------|---------------|----------------|
| **Namespace** | Teams have their own namespaces | `default`, `training`, `my-team` |
| **PVC name** | Admin-provisioned, cluster-specific | `csi-pvc-mounted`, `shared-workspace`, `nfs-data` |
| **Kueue queue name** | Admin-configured per GPU tier | `skypilot-jobs-1-gpu`, `skypilot-jobs-8-gpu`, `skypilot-jobs-cpu` |
| **Container image** | Team/project-specific | `my-registry/training:latest`, `verlai/verl:sgl056.latest` |
| **Node selector** | Cluster hardware labels differ | `skypilot.co/accelerator: h100`, `nebius.com/resource-preset: 8gpu-128vcpu-1600gb` |
| **Number of nodes** | Depends on model size and budget | 1 (7B model), 4 (20B-120B), 8+ (100B+) |
| **API secrets** | User's own tokens | `WANDB_API_KEY`, `HF_TOKEN` |

### Can Auto-Detect (But Verify With User)

| Parameter | How to Detect | Command |
|-----------|---------------|---------|
| Current context | `kubectl config current-context` | Auto |
| Available namespaces | `kubectl get namespaces` | Auto |
| GPU types on cluster | `kubectl get nodes` with GPU labels | Auto |
| Total GPU count | `kubectl get nodes -o custom-columns` | Auto |
| Storage classes | `kubectl get storageclass` | Auto |
| Existing PVCs | `kubectl get pvc --all-namespaces` | Auto |
| Kueue queues | `kubectl get localqueues -A` | Auto (if Kueue installed) |

### Configuration for Different Scales

| Scale | Nodes | GPUs | Typical Use | Key Differences |
|-------|-------|------|-------------|-----------------|
| Small | 1 | 1 | Debugging, small inference | No distributed setup needed |
| Medium | 1 | 8 | 7B-20B models, single-node training | No headless service, no NCCL config |
| Large | 2-4 | 16-32 | 20B-120B models | Need headless service, NCCL timeouts, shared memory |
| XL | 8+ | 64+ | 100B+ models | Need careful parallelism (TP+PP+FSDP), Kueue priority |

### Parallelism Strategy by Model Size

Different model sizes require different parallelism combinations. Ask the user about their model and adapt:

| Model Size | Tensor Parallel | Pipeline Parallel | FSDP/Data Parallel | Expert Parallel |
|------------|----------------|-------------------|---------------------|-----------------|
| 7B | 1 | 1 | 8 GPUs | N/A |
| 20B | 2 | 1 | 4 nodes x 4 | 2 (if MoE) |
| 70B | 4-8 | 1-2 | 2-4 nodes | 4 (if MoE) |
| 120B+ | 8 | 2-4 | 4-8 nodes | 8 (if MoE) |

### Skill Config Overrides

When this skill is managed by Astro, users can set their cluster-specific defaults in the Astro Skills UI configuration tab or in `~/.astro/skills.json`:

```json
{
  "kubernetes-workflow": {
    "defaultNamespace": "my-team",
    "pvcName": "csi-pvc-mounted",
    "kueueQueue": "skypilot-jobs-8-gpu",
    "containerImage": "my-registry/training:latest",
    "nodeSelector": {
      "skypilot.co/accelerator": "h100"
    },
    "defaultNumNodes": 4,
    "defaultNumGPUs": 8
  }
}
```

These overrides are injected into the skill context automatically, so the agent uses them as defaults instead of asking every time.

## Limitations

- `kubectl cp` does not preserve file permissions by default; use `tar` for complex file trees
- Pod-to-pod networking requires Services or direct pod IP addressing
- GPU scheduling depends on the cluster's device plugin and may have queue delays
- PVC access modes (ReadWriteOnce vs ReadWriteMany) affect multi-pod data sharing
- Some clusters require Kueue labels for GPU scheduling: `kueue.x-k8s.io/queue-name: <queue>`
- Multi-node training requires `/dev/shm` (shared memory) mounted as emptyDir with `medium: Memory`
- NCCL timeouts must be tuned for multi-node; defaults are often too short for large models
- Different clusters have different node labels for GPU types - always detect first
