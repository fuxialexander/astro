/**
 * Built-in skill definition: skypilot-workflow
 *
 * Source: skills-lib/skills/tools/skypilot-workflow/SKILL.md
 */

import type { BuiltinSkillDefinition } from './types.js'

const instructions = `# SkyPilot Workflow

## Goal

Launch, monitor, and manage compute jobs on cloud or Kubernetes clusters using SkyPilot. SkyPilot abstracts away cloud-specific details and provides a unified YAML interface for resource specification, file mounting, setup, and execution.

## When to Use

- User wants to launch a GPU job on a cloud or Kubernetes cluster
- User needs multi-node distributed training
- User wants to check job logs or status
- User needs to manage SkyPilot clusters or managed jobs
- User asks about launching experiments with specific GPU types (H100, A100, etc.)
- User needs to submit batch jobs with automatic restarts

## Workflow

### Phase 0: Detect SkyPilot and Cluster Environment

\`\`\`bash
# Check if SkyPilot is installed
sky --version

# Check available clouds/clusters
sky check

# Check current cluster status
sky status

# Check managed job queue
sky jobs queue

# Check SkyPilot config
cat ~/.sky/config.yaml 2>/dev/null || echo "No SkyPilot config found"
\`\`\`

**Ask the user if not auto-detectable:**
- Target cloud (kubernetes, aws, gcp, azure)
- GPU type and count (e.g., H100:8)
- Container image to use
- Kueue queue name (for Kubernetes: \`kueue.x-k8s.io/queue-name\`)
- PVC name for persistent storage
- API keys to pass as secrets (WANDB_API_KEY, HF_TOKEN, etc.)

### Phase 1: Write a SkyPilot YAML Launcher

SkyPilot uses YAML files to define jobs. Create one for the user's task.

**Basic structure:**

\`\`\`yaml
name: my-job

resources:
  cloud: kubernetes          # or aws, gcp, azure
  accelerators: H100:8       # GPU type and count
  image_id: docker:python:3.10  # Container image
  disk_size: 100             # GB
  ports: 8265                # Expose ports (e.g., Ray dashboard)

# For Kubernetes with Kueue scheduling:
#  labels:
#    kueue.x-k8s.io/queue-name: skypilot-jobs-8-gpu

# For multi-node jobs:
# num_nodes: 4

# Mount local files into all nodes
file_mounts:
  /opt/scripts: ./scripts
  /opt/config: ./config

# Install dependencies (runs once on each node)
setup: |
  set -e
  pip install -r /opt/scripts/requirements.txt

# Main execution (runs on each node)
run: |
  set -eo pipefail
  cd /opt/scripts
  python train.py --config /opt/config/train.yaml
\`\`\`

**GPU training with Ray (multi-node):**

\`\`\`yaml
name: distributed-training

resources:
  cloud: kubernetes                  # ASK USER: aws, gcp, azure, kubernetes
  accelerators: H100:8              # ASK USER: GPU type and count
  image_id: docker:my-registry/training:latest  # ASK USER: container image
  labels:
    kueue.x-k8s.io/queue-name: skypilot-jobs-8-gpu  # ASK USER: queue name
  disk_size: 500
  job_recovery:
    max_restarts_on_errors: 100   # Auto-restart on crash
  ports: 8265

num_nodes: 4                        # ASK USER: depends on model size

envs:
  NUM_GPUS: "8"
  EXPERIMENT_NAME: "my-experiment"
  # Batch size auto-scales with number of nodes:
  BATCH_SIZE_PER_NODE: "64"         # ASK USER: depends on GPU memory and model size

file_mounts:
  /opt/training_scripts: ./training_scripts
  /opt/patches: ./patches

setup: |
  set -e
  pip install -e /opt/training_scripts
  # Apply any patches
  python /opt/patches/apply_patches.py

run: |
  set -eo pipefail

  # SkyPilot provides these environment variables automatically:
  HEAD_IP=$(echo "$SKYPILOT_NODE_IPS" | head -n1)
  NUM_NODES=\${SKYPILOT_NUM_NODES}
  NODE_RANK=\${SKYPILOT_NODE_RANK}

  # Set distributed training environment
  export MASTER_ADDR=\${HEAD_IP}
  export MASTER_PORT=29500

  # NCCL settings — critical for multi-node stability
  export NCCL_DEBUG="\${NCCL_DEBUG:-WARN}"
  export NCCL_TIMEOUT="\${NCCL_TIMEOUT:-600}"
  export TORCH_NCCL_HEARTBEAT_TIMEOUT_SEC="\${TORCH_NCCL_HEARTBEAT_TIMEOUT_SEC:-600}"

  # Auto-scale batch size with number of nodes
  export TRAIN_BATCH_SIZE=$((NUM_NODES * \${BATCH_SIZE_PER_NODE:-64}))

  if [ "$NODE_RANK" == "0" ]; then
    # Head node: start Ray and wait for all workers
    ray start --head --port=6379 --dashboard-host=0.0.0.0 --dashboard-port=8265
    echo "[HEAD] Waiting for \${NUM_NODES} nodes to join..."
    retry=0
    while [ $retry -lt 120 ]; do
      connected=$(ray status 2>/dev/null | grep -c "node_" || true)
      echo "[HEAD] Connected: $connected/$NUM_NODES"
      [ "$connected" -ge "$NUM_NODES" ] && break
      retry=$((retry+1))
      sleep 10
    done
    echo "[HEAD] All nodes connected. Starting training..."
    /opt/training_scripts/train.sh
  else
    # Worker nodes: connect to head and stay alive
    sleep 20
    ray start --address \${HEAD_IP}:6379 --disable-usage-stats
    echo "[WORKER \${NODE_RANK}] Connected to Ray head."
    while true; do
      sleep 60
      pgrep -f "ray" > /dev/null || { echo "[WORKER \${NODE_RANK}] Ray died, exiting."; exit 1; }
    done
  fi
\`\`\`

**Multi-node with PyTorch Distributed (without Ray):**

\`\`\`yaml
name: distributed-training-pytorch

resources:
  cloud: kubernetes
  accelerators: H100:8
  labels:
    kueue.x-k8s.io/queue-name: skypilot-jobs-8-gpu  # ASK USER

num_nodes: 4                        # ASK USER

run: |
  set -eo pipefail
  HEAD_IP=$(echo "$SKYPILOT_NODE_IPS" | head -n1)

  export NCCL_DEBUG=WARN
  export NCCL_TIMEOUT=600
  export TORCH_NCCL_HEARTBEAT_TIMEOUT_SEC=600

  python -m torch.distributed.run \\
    --nnodes=\${SKYPILOT_NUM_NODES} \\
    --nproc_per_node=8 \\
    --node_rank=\${SKYPILOT_NODE_RANK} \\
    --master_addr=\${HEAD_IP} \\
    --master_port=29500 \\
    train.py --config config.yaml
\`\`\`

**Inference server deployment:**

\`\`\`yaml
name: inference-server

resources:
  cloud: kubernetes
  accelerators: H100:8
  image_id: docker:vllm/vllm-openai:latest
  ports: 8000

run: |
  python -m vllm.entrypoints.openai.api_server \\
    --model /workspace/models/my-model \\
    --host 0.0.0.0 \\
    --port 8000 \\
    --tensor-parallel-size 8
\`\`\`

### Phase 2: Launch Jobs

\`\`\`bash
# Launch a managed job (recommended for long-running training)
sky jobs launch my-job.yaml -y

# Launch with secrets (passed securely, not in YAML)
sky jobs launch my-job.yaml -y \\
  --secret WANDB_API_KEY \\
  --secret HF_TOKEN

# Launch with environment variable overrides
sky jobs launch my-job.yaml -y \\
  --env EXPERIMENT_NAME=experiment-v2 \\
  --env NUM_EPOCHS=20

# Launch with different GPU count
sky jobs launch my-job.yaml -y \\
  --env NUM_GPUS=4

# Launch and name the job
sky jobs launch my-job.yaml -y --name "training-run-v3"

# Launch in detached mode (don't stream logs)
sky jobs launch my-job.yaml -y --detach-run

# Launch on a specific cluster (non-managed)
sky launch -c my-cluster my-job.yaml -y
\`\`\`

### Phase 3: Monitor Jobs

\`\`\`bash
# Check job queue (shows all managed jobs)
sky jobs queue

# View logs of a running or completed job
sky jobs logs <JOB_ID>

# Follow logs in real-time
sky jobs logs <JOB_ID> --follow

# View logs without following (good for completed jobs)
sky jobs logs <JOB_ID> --no-follow

# Download logs to local machine
sky jobs logs <JOB_ID> --no-follow --sync-down
# Logs saved to ~/sky_logs/managed_jobs/<JOB_ID>-*/

# Check status of non-managed clusters
sky status

# View cluster logs
sky logs <CLUSTER_NAME>

# SSH into a cluster node
sky exec <CLUSTER_NAME> -- <command>
\`\`\`

**Common log patterns to search for:**

\`\`\`bash
# Check for training progress
sky jobs logs <JOB_ID> 2>&1 | grep -E "epoch|step|loss|accuracy"

# Check for errors
sky jobs logs <JOB_ID> 2>&1 | grep -iE "error|exception|failed|OOM"

# Check for server readiness
sky jobs logs <JOB_ID> 2>&1 | grep -i "ready\\|started\\|listening"

# Get the head node IP (useful for connecting to services)
sky jobs logs <JOB_ID> 2>&1 | grep "Server IP\\|HEAD_IP"
\`\`\`

### Phase 4: Manage Jobs and Clusters

\`\`\`bash
# Cancel a managed job
sky jobs cancel <JOB_ID>

# Cancel all managed jobs
sky jobs cancel --all

# Stop a cluster (keeps data, can restart later)
sky stop <CLUSTER_NAME>

# Tear down a cluster completely
sky down <CLUSTER_NAME>

# Tear down all clusters
sky down --all
\`\`\`

### Phase 5: SkyPilot Configuration

For Kubernetes clusters, the user may need a \`~/.sky/config.yaml\`:

\`\`\`yaml
kubernetes:
  # Kueue integration for fair-share scheduling
  kueue:
    local_queue_name: skypilot-jobs-8-gpu

  # Pod customization
  pod_config:
    metadata:
      labels:
        kueue.x-k8s.io/priority-class: default-priority
    spec:
      containers:
        - volumeMounts:
            - mountPath: /workspace
              name: workspace
          securityContext:
            privileged: true
            capabilities:
              add: [SYS_RESOURCE, IPC_LOCK, SYS_PTRACE]
      volumes:
        - name: workspace
          persistentVolumeClaim:
            claimName: shared-pvc

  # Timeouts and autoscaling
  provision_timeout: 1209600
  autoscaler: generic
  remote_identity: sky-sa

# API server (for managed SkyPilot deployments)
# api_server:
#   endpoint: https://sky-api.example.com
\`\`\`

### Phase 6: Understand the Compute Backend

SkyPilot can target multiple backends. To understand what's available:

\`\`\`bash
# Show all configured clouds
sky check

# For Kubernetes backend:
kubectl get nodes -o custom-columns=NAME:.metadata.name,GPU:.status.capacity.'nvidia\\.com/gpu',CPU:.status.capacity.cpu,MEM:.status.capacity.memory

# Check Kueue queues (if available)
kubectl get localqueues -A 2>/dev/null
kubectl get clusterqueues 2>/dev/null

# Check available GPU types
kubectl get nodes -o json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for node in data.get('items', []):
    name = node['metadata']['name']
    gpu = node['status']['capacity'].get('nvidia.com/gpu', '0')
    labels = node['metadata'].get('labels', {})
    accel = labels.get('skypilot.co/accelerator', 'unknown')
    print(f'{name}: {gpu} GPUs ({accel})')
"
\`\`\`

### Phase 7: Download Results and Logs

\`\`\`bash
# Download job logs
sky jobs logs <JOB_ID> --no-follow --sync-down
LOG_DIR=$(ls -td ~/sky_logs/managed_jobs/\${JOB_ID}-* 2>/dev/null | head -1)
echo "Logs at: $LOG_DIR"

# Copy results from cluster
sky exec <CLUSTER_NAME> -- cat /workspace/results.json > results.json

# SCP from cluster
scp <CLUSTER_NAME>:/workspace/output.tar.gz ./output.tar.gz

# For Kubernetes pods, use kubectl cp directly
POD=$(kubectl get pods -l skypilot-cluster=<CLUSTER_NAME> -o name | head -1)
kubectl cp \${POD#pod/}:/workspace/results ./results
\`\`\`

### Phase 7: Multi-Part Job Pipelines

Complex workflows often involve multiple sequential jobs (data prep → training → evaluation → serving). Use SkyPilot's orchestrator pattern:

**Pattern: Sequential job pipeline**

\`\`\`bash
# Step 1: Data preparation (single node, CPU-heavy)
sky jobs launch data-prep.yaml -y --name "pipeline-data-prep"

# Wait for completion
while true; do
  STATUS=$(sky jobs queue 2>&1 | grep "pipeline-data-prep" | awk '{print $NF}')
  [ "$STATUS" = "SUCCEEDED" ] && break
  [ "$STATUS" = "FAILED" ] && { echo "Data prep failed!"; exit 1; }
  sleep 30
done

# Step 2: Training (multi-node, GPU)
sky jobs launch train.yaml -y --name "pipeline-training" \\
  --env DATA_PATH=/workspace/processed_data

# Step 3: Evaluation (single node, GPU)
sky jobs launch eval.yaml -y --name "pipeline-eval" \\
  --env MODEL_PATH=/workspace/checkpoints/latest

# Step 4: Deploy inference server
sky launch -c inference-server serve.yaml -y
\`\`\`

**Pattern: Orchestrator pod (K8s-native)**

For Kubernetes, use an orchestrator pod that submits sub-jobs:

\`\`\`yaml
name: pipeline-orchestrator

resources:
  cloud: kubernetes
  accelerators: null  # CPU only for orchestrator
  cpus: 4

setup: |
  pip install skypilot[kubernetes]
  # Use in-cluster kubectl auth
  export KUBECONFIG=/dev/null
  KUBE_TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
  kubectl config set-cluster k8s --server=https://kubernetes.default.svc --certificate-authority=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
  kubectl config set-credentials sa --token=$KUBE_TOKEN
  kubectl config set-context default --cluster=k8s --user=sa
  kubectl config use-context default

run: |
  # Submit multi-node training job from within the cluster
  sky jobs launch /opt/training.yaml -y --name "sub-training"
  # Wait and submit eval
  sky jobs launch /opt/eval.yaml -y --name "sub-eval"
\`\`\`

## User-Specific Configuration Guide

SkyPilot YAML files are general recipes, but **specific values differ per user, team, and cluster**. Always ask the user for these.

### Must Ask (Cannot Auto-Detect Reliably)

| Parameter | Why It Varies | Where in YAML | Example Values |
|-----------|---------------|---------------|----------------|
| **Cloud** | Users have different cloud accounts | \`resources.cloud\` | \`kubernetes\`, \`aws\`, \`gcp\`, \`azure\` |
| **GPU type + count** | Depends on model size, budget | \`resources.accelerators\` | \`H100:8\`, \`A100:4\`, \`H200:8\` |
| **Kueue queue** | Admin-configured per cluster | \`resources.labels\` | \`skypilot-jobs-1-gpu\`, \`skypilot-jobs-8-gpu\` |
| **Container image** | Team/project-specific | \`resources.image_id\` | \`docker:verlai/verl:latest\` |
| **PVC name** | Admin-provisioned, cluster-specific | \`~/.sky/config.yaml\` | \`csi-pvc-mounted\`, \`shared-pvc\` |
| **Number of nodes** | Model size, budget | \`num_nodes\` | 1, 2, 4, 8 |
| **Batch size** | GPU memory, model size | \`envs.BATCH_SIZE_PER_NODE\` | 8, 16, 32, 64 |
| **API secrets** | User's own tokens | \`--secret\` flag | \`WANDB_API_KEY\`, \`HF_TOKEN\` |

### Can Auto-Detect (But Verify)

| Parameter | How to Detect | Command |
|-----------|---------------|---------|
| SkyPilot version | \`sky --version\` | Auto |
| Configured clouds | \`sky check\` | Auto |
| Active clusters | \`sky status\` | Auto |
| Running jobs | \`sky jobs queue\` | Auto |
| K8s GPU types | \`kubectl get nodes\` with labels | Auto |
| Kueue queues | \`kubectl get localqueues -A\` | Auto |

### Scaling Guide

| Scale | Nodes × GPUs | Model Size | Key Differences |
|-------|-------------|------------|-----------------|
| Small | 1 × 1 | <7B, inference | No multi-node, no NCCL config |
| Medium | 1 × 8 | 7B-20B | Single-node, FSDP only |
| Large | 2-4 × 8 | 20B-120B | Ray cluster, NCCL timeouts, \`job_recovery\` |
| XL | 8+ × 8 | 100B+ | Megatron parallelism (TP+PP), careful batch sizing |

### NCCL Tuning for Multi-Node

These environment variables are **critical** for multi-node stability and vary by network:

\`\`\`yaml
envs:
  NCCL_DEBUG: "WARN"                       # INFO for debugging, WARN for production
  NCCL_TIMEOUT: "600"                      # Increase for large models (default: 300)
  TORCH_NCCL_HEARTBEAT_TIMEOUT_SEC: "600"  # Match NCCL_TIMEOUT
  # For MoE models with FSDP:
  SGLANG_ENABLE_TP_MEMORY_INBALANCE_CHECK: "0"  # FSDP shards unevenly
\`\`\`

### SkyPilot Config Differences Across Clusters

The \`~/.sky/config.yaml\` varies per user/cluster. Common differences:

| Setting | Cluster A (On-prem K8s) | Cluster B (Cloud K8s) | Cluster C (AWS) |
|---------|------------------------|----------------------|-----------------|
| Cloud | \`kubernetes\` | \`kubernetes\` | \`aws\` |
| Queue | \`skypilot-jobs-8-gpu\` | \`research-queue\` | N/A |
| PVC | \`csi-pvc-mounted\` | \`efs-shared\` | N/A (uses S3) |
| Autoscaler | \`generic\` | \`gke\` | \`aws\` |
| Provision timeout | 1209600 | 3600 | 600 |
| Remote identity | \`sky-sa\` | \`research-sa\` | \`~/.aws/config\` |

### Skill Config Overrides

When this skill is managed by Astro, users can set their cluster-specific defaults in the Astro Skills UI configuration tab or in \`~/.astro/skills.json\`:

\`\`\`json
{
  "skypilot-workflow": {
    "defaultCloud": "kubernetes",
    "defaultAccelerators": "H100:8",
    "kueueQueue": "skypilot-jobs-8-gpu",
    "pvcName": "csi-pvc-mounted",
    "containerImage": "my-registry/training:latest",
    "defaultNumNodes": 4,
    "skyApiEndpoint": "https://sky-api.example.com"
  }
}
\`\`\`

These overrides are injected into the skill context automatically, so the agent uses them as defaults instead of asking every time.

## Best Practices

1. **Use managed jobs** (\`sky jobs launch\`) for training — they auto-recover from preemption and failures
2. **Pass secrets via \`--secret\`**, never hardcode in YAML files
3. **Use \`file_mounts\`** instead of git clone in setup for faster iteration
4. **Set \`job_recovery.max_restarts_on_errors\`** for fault-tolerant training
5. **Check \`sky jobs queue\`** before launching to avoid resource contention
6. **Use \`--detach-run\`** for long jobs so your terminal is free
7. **Download logs with \`--sync-down\`** before clusters are torn down
8. **For multi-node**, always handle \`SKYPILOT_NODE_RANK\` to differentiate head vs workers
9. **Set NCCL timeouts** for multi-node GPU training to avoid silent hangs
10. **Auto-scale batch size** with \`NNODES × BATCH_SIZE_PER_NODE\` to utilize all GPUs
11. **Use the orchestrator pattern** for multi-part pipelines (data prep → train → eval)

## Limitations

- SkyPilot managed jobs don't support interactive SSH — use \`sky launch\` for interactive work
- \`file_mounts\` copies files at launch time; changes after launch require re-launch
- Multi-node jobs require all nodes to be on the same cloud/region
- Kueue queue names are cluster-specific — ask the user for the correct queue name
- SkyPilot creates its own pods — don't mix with manually created pods in the same namespace
- NCCL timeouts must be set explicitly for multi-node; defaults are often too short for large models
- Batch size doesn't auto-scale — the training script must calculate \`NNODES × per_node_batch\`
- MoE models need special handling (memory imbalance check disabled, on-policy ratio forced)

## Related Skills

- [kubernetes-workflow](../kubernetes-workflow/SKILL.md) — Direct Kubernetes operations without SkyPilot`

export const SKYPILOT_WORKFLOW: BuiltinSkillDefinition = {
  name: 'skypilot-workflow',
  version: '1.0.0',
  description:
    "This skill should be used when the user asks to 'launch a SkyPilot job', 'use sky to run', 'run on cloud with SkyPilot', 'sky jobs launch', 'check sky logs', 'sky status', mentions 'SkyPilot', 'sky', 'sky jobs', or needs to launch distributed training or inference jobs on cloud or Kubernetes clusters via SkyPilot.",
  instructions,
  category: 'tools',
  tags: ['skypilot', 'cloud', 'kubernetes', 'gpu', 'training', 'distributed', 'infrastructure'],
  allowedTools: ['Bash', 'Read', 'Write', 'Glob', 'Grep'],
}
