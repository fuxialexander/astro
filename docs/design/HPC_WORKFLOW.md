# HPC Workflow Design

How AI agents interact with HPC clusters via Slurm, and a plan to extend this beyond Claude SDK to support Codex and other providers.

**Last updated:** 2026-03-05

---

## 1. Current Architecture (Claude SDK Only)

### How It Works Today

The AI agent does NOT run on the HPC cluster. It runs on a **gateway machine** that has:
- An AI provider installed (currently Claude SDK only)
- Slurm CLI tools (`sbatch`, `squeue`, `sacct`, `scancel`, `sinfo`)
- Network access to the Slurm scheduler
- Shared filesystem access (to read job output)

```
                  Agent Runner Machine (gateway)
                  ┌────────────────────────────────┐
                  │                                  │
User ──► Astro ──►│  Claude SDK Adapter               │
  Server          │  ┌──────────────────────────┐    │
                  │  │  Agent Session             │    │
                  │  │                            │    │
                  │  │  1. Write job script        │    │     Slurm Scheduler
                  │  │     (.sbatch file)          │───────►  ┌──────────────┐
                  │  │  2. sbatch submit.sbatch    │    │     │  Queue jobs   │
                  │  │  3. squeue -j <jobid>       │◄───────  │  Allocate GPU │
                  │  │  4. Read output files       │    │     │  Run on nodes │
                  │  │  5. Report results          │    │     └──────────────┘
                  │  └──────────────────────────┘    │
                  │                                  │
                  │  hpcCapability detected:          │
                  │  - clusterName                    │
                  │  - partitions: [gpu, cpu, debug]  │
                  │  - defaultPartition: gpu           │
                  │  - accounts: [mylab]               │
                  └────────────────────────────────┘
```

### HPC Capability Detection

When the agent runner starts, it probes for Slurm tools:

```typescript
// agent-runner/src/lib/providers.ts (simplified)
async function detectHpcCapability(): Promise<HpcCapability | null> {
  // Check if sinfo command exists
  const sinfo = await exec('sinfo --version').catch(() => null)
  if (!sinfo) return null

  // Get partitions
  const partitions = await exec('sinfo -h -o "%P"')
  // Get accounts
  const accounts = await exec('sacctmgr show accounts -n -P')

  return {
    clusterName: hostname,
    partitions: parsePartitions(partitions),
    defaultPartition: partitions.find(p => p.endsWith('*')),
    accounts: parseAccounts(accounts),
  }
}
```

This information is sent to the Astro server during WebSocket registration and stored in `machineRegistry`.

### Dispatch Flow

```
POST /api/relay/slurm/dispatch
  body: {
    task: TaskDispatch,       // Standard task fields
    targetClusterId?: string, // Specific machine, or auto-select
    slurmConfig: {            // User-specified resources
      partition: "gpu",
      nodes: 1,
      cpusPerTask: 4,
      mem: "32G",
      time: "4:00:00",
      gpu: { type: "a100", count: 2 },
      modules: ["cuda/12.0", "python/3.11"],
    }
  }

Server:
  1. Forces preferredProvider: 'claude-sdk'
  2. Finds machine with hpcCapability
  3. Passes slurmConfig in task.metadata
  4. Dispatches via relay

Agent Runner:
  1. Claude SDK adapter receives task
  2. slurmConfig available in task.metadata
  3. Agent generates sbatch script using Slurm config
  4. Agent submits job, monitors, reports results
```

### What the Agent Does (Example)

For a task like "Train a ResNet model on CIFAR-10 using 2 A100 GPUs":

```bash
# Agent generates this sbatch script:
cat > train.sbatch << 'EOF'
#!/bin/bash
#SBATCH --partition=gpu
#SBATCH --nodes=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=32G
#SBATCH --time=4:00:00
#SBATCH --gres=gpu:a100:2

module load cuda/12.0
module load python/3.11

python train.py --model resnet50 --dataset cifar10 --gpus 2
EOF

# Agent submits:
sbatch train.sbatch
# Output: Submitted batch job 12345

# Agent monitors:
squeue -j 12345
# JOBID  PARTITION  NAME  USER  ST  TIME  NODES
# 12345  gpu        train  user  R   0:05  1

# Agent checks output when done:
cat slurm-12345.out
```

---

## 2. Gap: Only Claude SDK Supported

### Current Constraint

```typescript
// server/routes/relay.ts:745
const hpcTask: TaskDispatch = {
  ...task,
  preferredProvider: 'claude-sdk',  // <-- hardcoded
}
```

This means:
- Users who only have Codex installed cannot use HPC dispatch
- Users who prefer OpenClaw or OpenCode for cost reasons cannot use HPC
- The constraint exists because HPC workflow was only tested with Claude SDK

### Why It's Not Trivial to Fix

The constraint isn't just about running commands. The agent needs to:

1. **Understand Slurm semantics** -- partition selection, resource requests, GPU types, module systems
2. **Generate correct sbatch scripts** -- syntax must be exact or jobs fail silently
3. **Monitor jobs** -- parse `squeue` output, handle job states (PD, R, CG, F)
4. **Handle failures** -- read `slurm-*.out` for errors, retry with adjusted resources
5. **Navigate shared filesystems** -- know where to look for output, handle permissions

Claude SDK was tested with these workflows. Codex, OpenClaw, and OpenCode haven't been.

---

## 3. Design: Codex HPC Support

### Approach: Skill-Based Parity

Instead of hardcoding provider-specific logic, encode HPC knowledge as **skills** that any provider can load:

```
~/.codex/skills/hpc-slurm/SKILL.md      (for Codex)
~/.claude/skills/hpc-slurm/SKILL.md     (for Claude SDK / OpenCode)
~/.openclaw/skills/hpc-slurm/SKILL.md   (for OpenClaw, if supported)
```

Plus a **compute backend default skill** that ships with Astro:
```
skills/compute_backend_default/slurm/SKILL.md
```

### Skill Content (Reference)

The HPC skill should teach the agent:

```markdown
# HPC / Slurm Workflow

## Submitting Jobs

Use `sbatch` to submit batch jobs. Always include:
- `#SBATCH --partition=<partition>` (check `sinfo` for available)
- `#SBATCH --time=HH:MM:SS` (required, be generous)
- `#SBATCH --mem=<amount>` (required)

For GPU jobs:
- `#SBATCH --gres=gpu:<type>:<count>` (e.g., `gpu:a100:2`)
- Load CUDA module before running: `module load cuda/12.0`

## Monitoring Jobs

- `squeue -j <jobid>` -- check status (PD=pending, R=running, CG=completing)
- `sacct -j <jobid> --format=JobID,State,ExitCode,Elapsed` -- after completion
- `scancel <jobid>` -- cancel a running job

## Reading Output

- Default output: `slurm-<jobid>.out` in submission directory
- Custom: `#SBATCH --output=logs/%j.out --error=logs/%j.err`
- Always check exit code: non-zero means failure

## Common Pitfalls

- Jobs that exceed `--time` are killed (TIMEOUT state)
- Jobs that exceed `--mem` are killed (OOM state)
- Module loads must happen INSIDE the sbatch script, not interactively
- Use `sinfo -N -l` to check node availability before submitting
```

### Implementation Steps

#### Step 1: Remove provider constraint

```typescript
// server/routes/relay.ts:745
// BEFORE:
const hpcTask: TaskDispatch = {
  ...task,
  preferredProvider: 'claude-sdk',
}

// AFTER:
const hpcTask: TaskDispatch = {
  ...task,
  // Use user's preferred provider if specified, otherwise let agent runner auto-select
  preferredProvider: task.preferredProvider || undefined,
}
```

#### Step 2: Create default Slurm skill

Already planned in the compute-backend-scoped-skills feature:
```
skills/compute_backend_default/slurm/SKILL.md
```

This skill is automatically injected when the project's `computeBackends` includes `'slurm'`.

#### Step 3: Ensure CLI providers can detect HPC capability

Currently `hpcCapability` is detected in `agent-runner/src/lib/providers.ts` and attached to provider info. This detection is provider-agnostic -- it checks for Slurm CLI tools on the machine, not which AI provider is installed.

The detection already works for any provider. The issue is only the server-side constraint that forces `claude-sdk`.

#### Step 4: Test with Codex

The key risk is that Codex handles shell commands differently from Claude SDK. Specific things to test:

1. **sbatch script generation** -- Does Codex produce valid sbatch syntax?
2. **Multi-step monitoring** -- Does Codex poll `squeue` and wait, or give up?
3. **Module system** -- Does Codex know to use `module load` inside sbatch?
4. **Error recovery** -- When a job fails, does Codex read slurm output and adjust?

If Codex struggles with any of these, the Slurm skill can be enriched with more specific instructions and examples.

#### Step 5: Test with OpenClaw and OpenCode

Same testing matrix as Codex. These providers should work since they all execute shell commands the same way -- the quality depends on the underlying model's knowledge of Slurm.

---

## 4. HPC Capability on Provider vs Machine

### Current Model (Machine-Level)

```
Machine "hpc-gateway-1":
  providers: [
    { type: 'claude-sdk', available: true, hpcCapability: { ... } },
  ]
```

`hpcCapability` is attached to the **provider** info, but it's really a **machine** characteristic. The machine has Slurm tools installed; the provider just happens to be on the same machine.

### After Multi-Provider Support

```
Machine "hpc-gateway-1":
  providers: [
    { type: 'claude-sdk', available: true, hpcCapability: { ... } },
    { type: 'codex', available: true, hpcCapability: { ... } },
  ]
```

Both providers on the same machine share the same HPC capability. The capability detection runs once during `astro-agent start` and is propagated to all providers.

---

## 5. Future: Direct Cluster Execution

A more advanced architecture would run the AI agent **on the cluster node itself** (inside the Slurm allocation), not just submit jobs to it. This would enable:

- Interactive debugging of running jobs
- Real-time output monitoring from within the allocation
- Direct filesystem access on compute nodes
- GPU-aware code execution (the agent can test CUDA code immediately)

This is a larger architectural change and is out of scope for the current gap fix. The immediate goal is to remove the `claude-sdk` constraint and ensure any provider can submit Slurm jobs from the gateway machine.
