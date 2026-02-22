# Execution Strategies

## Architecture

Astro separates two orthogonal concerns:

- **Agent Models** (providers): Claude SDK, Claude Code, Codex — responsible for AI reasoning
- **Execution Strategies**: Direct, SLURM, Docker, K8s Exec, SkyPilot — responsible for HOW commands run

These are independent dimensions. Any agent model can use any execution strategy:

|                 | Direct   | SLURM    | Docker   | K8s Exec | SkyPilot |
|-----------------|----------|----------|----------|----------|----------|
| **Claude SDK**  | ✅       | ✅       | ✅       | ✅       | ✅ (exp) |
| **Claude Code** | ✅       | ✅       | ✅       | ✅       | ✅ (exp) |
| **Codex**       | ✅       | ✅       | ✅       | ✅       | ✅ (exp) |

### ExecutionStrategy Interface

Every strategy implements 5 capabilities:

1. **Detection** — Probe environment for availability and rich metadata
2. **Context Injection** — Generate a prompt prefix so the AI knows its execution environment
3. **Job Submission** — Execute a command with streaming stdout/stderr callbacks
4. **Job Monitoring** — Track job status (running, completed, failed)
5. **Job Lifecycle** — Cancel, query status, clean up

```typescript
interface ExecutionStrategy {
  readonly id: ExecutionStrategyType;
  readonly name: string;
  readonly isAsync: boolean;

  detect(): Promise<ExecutionStrategyDetection>;
  buildContext?(): Promise<string>;
  execute(spec: ExecutionSpec, callbacks: ExecutionCallbacks, signal: AbortSignal): Promise<ExecutionResult>;
  cancel(jobId: string): Promise<void>;
  getStatus(jobId: string): Promise<ExecutionJobStatus | null>;
}
```

---

## Direct Execution (Default)

Always available. Commands run as local child processes via `spawn()`.

- **Detection**: Always `available: true`, reports Node.js version
- **Context Injection**: Warns about Python package safety — never `pip install` globally, always use `conda`/`venv`/`uv`/`poetry`
- **Job Submission**: `spawn('sh', ['-c', command])` for strings; `spawn(cmd, args)` for arrays
- **Monitoring**: Process exit tracking
- **Lifecycle**: SIGTERM → 5s grace → SIGKILL

---

## SLURM Support (Existing)

For HPC clusters with Slurm workload manager. Wraps existing `lib/slurm-detect.ts`, `lib/slurm-executor.ts`, and `lib/hpc-context.ts`.

### Detection

Probes via `which sinfo`, then gathers:
- Cluster name (`scontrol show config`)
- Slurm version (`sinfo --version`)
- Partitions and default partition (`sinfo -h -o "%P"`)
- User accounts (`sacctmgr show assoc`)
- QOS levels (`sacctmgr show assoc format=QOS`)

### Context Injection

Generates a detailed HPC prompt prefix including:
- Login node rules (never run compute on login)
- Cluster info (name, version, partitions, accounts, QOS)
- Default resource flags
- `srun` quick patterns for CPU and GPU jobs
- `sbatch` template with standard directives
- Job tracking instructions

User overrides via `~/.astro/hpc/config.json`:
```json
{
  "defaultPartition": "compute",
  "defaultAccount": "mylab",
  "defaultTime": "04:00:00",
  "gpuPartition": "gpu",
  "defaultModules": ["python/3.11", "cuda/12.0"],
  "customRules": "Always use --constraint=avx2 for this cluster."
}
```

### Job Submission

Generates SBATCH scripts with:
- Partition, nodes, CPUs, memory, GPU, time, QOS, account
- Module loading
- Environment variable export (ASTRO_TASK_ID, ASTRO_PROJECT_ID)
- Commands extracted from task description (code blocks or command lines)

Submits via `sbatch`, returns Slurm job ID.

### Job Monitoring

Two systems:
1. **In-task polling** (5s): Watches `squeue`/`sacct` + streams growing output files
2. **Background SlurmJobMonitor**: Tracks jobs submitted by Claude via `sbatch` (30s polling)

### Job Lifecycle

- Cancel: `scancel <job_id>`
- Status: `squeue` (running) / `sacct` (completed)
- Output: Streams from `slurm-<jobid>.out` / `slurm-<jobid>.err` as files grow

---

## Docker Support

Runs commands inside Docker containers via `docker run`.

### Detection

```bash
docker info --format '{{.ServerVersion}}'
```

Returns Docker version and OS/architecture.

### Context Injection

Informs the AI that commands run in Docker containers with volume mounts.

### Job Submission

```bash
docker run --rm --name astro-<jobId> \
  -v <cwd>:<cwd> -w <cwd> \
  -e KEY=VALUE \
  <image> sh -c "<command>"
```

Options via `spec.options`:
- `image` (default: `node:22-slim`)
- `volumes` — additional volume mounts
- `network` — Docker network
- `user` — container user

### Monitoring

Container status via `docker inspect --format '{{.State.Status}}'`.

### Lifecycle

- Cancel: `docker stop <container>` → `docker rm -f <container>`

---

## Kubernetes Exec Support

Runs commands on existing K8s pods via `kubectl exec`.

### Detection

```bash
which kubectl
kubectl cluster-info --request-timeout=5s
kubectl get namespaces
kubectl config current-context
```

Returns cluster URL, server version, available namespaces, current context.

### Context Injection

Reports cluster info, current context, and available namespaces.

### Job Submission

```bash
kubectl exec [-n namespace] [-c container] <pod> -- sh -c "<command>"
```

Options via `spec.options`:
- `pod` (required) — target pod name
- `namespace` — K8s namespace
- `container` — specific container in multi-container pods

### Monitoring

Tracks the local `kubectl exec` process.

### Lifecycle

- Cancel: Kill the `kubectl` process (SIGTERM → SIGKILL)

---

## SkyPilot Support (Experimental)

Cloud VM provisioning via [SkyPilot](https://skypilot.readthedocs.io/). Provisions VMs on AWS, GCP, Azure, etc.

### Detection

```bash
which sky
sky check
```

Parses enabled clouds from `sky check` output.

### Context Injection

Reports available clouds and SkyPilot usage patterns.

### Job Submission

```bash
sky launch -c <cluster> -y [--cloud aws] [--gpus A100:1] -- <command>
# or
sky exec -c <cluster> -y -- <command>
```

Options via `spec.options`:
- `cluster` — cluster name (default: `astro-<jobId>`)
- `cloud` — preferred cloud (aws, gcp, azure)
- `instanceType` — VM instance type
- `gpus` — GPU specification
- `numNodes` — number of nodes
- `reuseCluster` — use `sky exec` on existing cluster

### Monitoring

Status via `sky queue <cluster>`.

### Lifecycle

- Cancel: `sky cancel <cluster> -a -y`
- Tear down: `sky down <cluster>`

---

## Capability Comparison

| Capability           | Direct                  | SLURM                         | Docker                | K8s Exec              | SkyPilot              |
|---------------------|-------------------------|-------------------------------|-----------------------|-----------------------|-----------------------|
| **Detection**       | Always available        | `sinfo`, `sacctmgr`          | `docker info`         | `kubectl cluster-info`| `sky check`           |
| **Context**         | Python venv safety      | HPC rules + templates         | Container info        | Namespace/pod info    | Cloud + instance info |
| **Submission**      | `spawn()`               | `sbatch`                      | `docker run`          | `kubectl exec`        | `sky launch`/`exec`   |
| **Monitoring**      | Process exit            | `squeue`/`sacct` + file poll  | `docker inspect`      | Process tracking      | `sky queue`           |
| **Lifecycle**       | SIGTERM/SIGKILL         | `scancel`                     | `docker stop`/`rm`    | Kill kubectl process  | `sky cancel`/`down`   |
| **Async?**          | No                      | Yes                           | No                    | No                    | Yes                   |

---

## Registry

The `ExecutionStrategyRegistry` manages all strategies:

```typescript
import { executionStrategyRegistry } from './execution/index.js';

// Detect all strategies in parallel
const strategies = await executionStrategyRegistry.detectAll();

// Get a specific strategy
const docker = executionStrategyRegistry.get('docker');

// Get the default (always Direct)
const direct = executionStrategyRegistry.getDefault();

// List available strategies
const available = executionStrategyRegistry.listAvailable();
```

The registry is initialized during `astro-agent start` and detected strategies are reported in the WebSocket registration payload alongside providers.

---

## How to Add a New Execution Strategy

1. Create `packages/agent-runner/src/execution/my-strategy.ts` implementing `ExecutionStrategy`
2. Add the strategy type to `ExecutionStrategyType` in `execution/types.ts`
3. Register it in `ExecutionStrategyRegistry.detectAll()` in `execution/registry.ts`
4. Export from `execution/index.ts`
5. Add tests in `execution/__tests__/execution-strategy.test.ts`
6. Update the type in `packages/agent-runner/src/types.ts` (`ExecutionStrategyType`)

### Interface Contract

Your strategy must implement:
- `detect()` — Return `{ available: boolean, version?, metadata? }`. Must not throw.
- `buildContext()` — Optional. Return a prompt prefix string for AI awareness.
- `execute()` — Accept `ExecutionSpec`, stream via `ExecutionCallbacks`, respect `AbortSignal`.
- `cancel()` — Best-effort cancellation by job ID.
- `getStatus()` — Return current job status or null if unknown.

### Testing

- Detection should work regardless of whether the tool is installed (return `available: false`)
- Execute tests should verify stdout/stderr streaming, exit codes, and abort handling
- Registry tests should verify your strategy appears in `detectAll()` results

---

## Configuration

### Environment Variables

Strategies detect tools from `PATH`. No special environment variables are required for detection.

### Strategy-Specific Config

- **SLURM**: `~/.astro/hpc/config.json` for default partition, account, modules, custom rules
- **Docker**: Image specified per-job via `spec.options.image`
- **K8s**: Context/namespace via `kubectl config` or `spec.options.namespace`
- **SkyPilot**: Cloud credentials configured via `sky check`
