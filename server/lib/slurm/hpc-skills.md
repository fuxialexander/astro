# HPC/Slurm Skills for Nexus Agents

This document provides guidance for AI agents executing tasks on HPC clusters via Slurm.

## Overview

When executing tasks on an HPC cluster, you MUST use Slurm to submit jobs. Direct long-running computations on the login node are prohibited and will be terminated.

## Key Principles

1. **Never run compute-intensive tasks directly on the login node**
2. **Always use `sbatch` to submit jobs**
3. **Request appropriate resources** - don't over-request, but ensure enough for the task
4. **Monitor job status** with `squeue` and `sacct`
5. **Stream output** using the job output files

## Resource Guidelines

### Partition Selection

Choose the appropriate partition based on your task:

| Task Type | Recommended Partition | Notes |
|-----------|----------------------|-------|
| Quick tests | `interactive`, `debug` | Short time limits, fast queue |
| CPU-only | `cpu`, `batch`, `serial` | Standard compute nodes |
| GPU tasks | `gpu`, `gpu-batch` | Nodes with GPUs |
| Large memory | `bigmem`, `himem` | High-memory nodes |
| Distributed | `parallel`, `mpi` | Multi-node capable |

### Time Limits

Estimate conservatively but don't over-request:

| Task Complexity | Recommended Time |
|-----------------|------------------|
| Quick test | 15-30 minutes |
| Simple analysis | 1-2 hours |
| Training (small) | 4-8 hours |
| Training (large) | 12-24 hours |
| Batch processing | 2-8 hours |

### Memory

Memory is typically per-node:

| Task Type | Memory Range |
|-----------|--------------|
| Light scripts | 4-8 GB |
| Data processing | 16-32 GB |
| ML training | 32-64 GB |
| Large models | 64-128+ GB |

### GPUs

Request only what you need:

| Task | GPU Count |
|------|-----------|
| Single model training | 1 GPU |
| Data parallel training | 2-4 GPUs |
| Distributed training | 4-8 GPUs per node |

## SBATCH Script Template

```bash
#!/bin/bash
#SBATCH --job-name=nexus_task
#SBATCH --output=nexus_%j.out
#SBATCH --error=nexus_%j.err
#SBATCH --partition=gpu
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --gres=gpu:1
#SBATCH --time=04:00:00

# Exit on error
set -e

# Print job info
echo "Job ID: $SLURM_JOB_ID"
echo "Node: $SLURMD_NODENAME"
echo "Start: $(date)"

# Load required modules
module load python/3.10
module load cuda/11.8

# Activate environment
source ~/venv/bin/activate

# Run task
python train.py

echo "End: $(date)"
```

## Common Patterns

### 1. Python Script Execution

```bash
#SBATCH --job-name=python_task
#SBATCH --partition=cpu
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=02:00:00

module load python/3.10
source ~/env/bin/activate
python script.py --arg1 value1
```

### 2. GPU Training

```bash
#SBATCH --job-name=train_model
#SBATCH --partition=gpu
#SBATCH --gres=gpu:a100:1
#SBATCH --cpus-per-task=8
#SBATCH --mem=64G
#SBATCH --time=08:00:00

module load cuda/11.8
module load pytorch/2.0

python train.py --epochs 100
```

### 3. Multi-GPU Training

```bash
#SBATCH --job-name=ddp_train
#SBATCH --partition=gpu
#SBATCH --gres=gpu:4
#SBATCH --cpus-per-task=32
#SBATCH --mem=128G
#SBATCH --time=24:00:00

module load cuda/11.8
module load pytorch/2.0

torchrun --nproc_per_node=4 train_ddp.py
```

### 4. Job Arrays (Batch Processing)

```bash
#SBATCH --job-name=batch_process
#SBATCH --partition=cpu
#SBATCH --array=0-99%10
#SBATCH --cpus-per-task=4
#SBATCH --mem=8G
#SBATCH --time=01:00:00

python process.py --index $SLURM_ARRAY_TASK_ID
```

### 5. R Analysis

```bash
#SBATCH --job-name=r_analysis
#SBATCH --partition=cpu
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=04:00:00

module load r/4.2

Rscript analysis.R
```

## Monitoring Commands

### Check Job Status

```bash
# Your jobs in queue
squeue -u $USER

# Specific job
squeue -j <jobid>

# Detailed job info
scontrol show job <jobid>
```

### Check Completed Jobs

```bash
# Job accounting
sacct -j <jobid>

# With more details
sacct -j <jobid> --format=JobID,JobName,State,ExitCode,Elapsed,MaxRSS
```

### Check Cluster Status

```bash
# Partition status
sinfo

# Node availability
sinfo -N -l

# GPU availability
sinfo -o "%P %G %D %t"
```

## Resource Hints in Task Descriptions

When describing tasks in Nexus, include resource hints:

**Good examples:**
- "Train the model using 2 GPUs for approximately 8 hours"
- "Process the dataset using 16 CPU cores and 64GB memory"
- "Run quick validation tests (15 minutes max)"
- "Submit to the gpu partition with A100 GPUs"

**Recognized keywords:**
- `GPU: N` or `N GPUs`
- `Memory: XGB` or `XG memory`
- `Time: X hours` or `duration: X hours`
- `CPUs: N` or `N cores`
- `Nodes: N`
- `Partition: name`

## Error Handling

### Common Issues

1. **Job pending too long**
   - Check queue status: `squeue -p <partition>`
   - Consider different partition or reduce resources

2. **Out of memory (OOM)**
   - Increase `--mem` or `--mem-per-cpu`
   - Check actual usage: `sacct -j <jobid> --format=MaxRSS`

3. **Time limit exceeded**
   - Job state: `TIMEOUT`
   - Increase `--time` or optimize code
   - Use checkpointing for long jobs

4. **Node failure**
   - Job state: `NODE_FAIL`
   - Job will be requeued automatically
   - Check cluster status: `sinfo`

### Debugging Failed Jobs

```bash
# Check exit code and state
sacct -j <jobid> --format=JobID,State,ExitCode

# Check error output
cat nexus_<jobid>.err

# Check resource usage
sacct -j <jobid> --format=JobID,MaxRSS,MaxVMSize,Elapsed,CPUTime
```

## Best Practices

1. **Start small, scale up** - Test with minimal resources first
2. **Use checkpointing** - Save progress for long jobs
3. **Clean up temporary files** - Use `$TMPDIR` for scratch space
4. **Log resource usage** - Helps with future requests
5. **Check partition limits** - `scontrol show partition <name>`
6. **Use array jobs** - For embarrassingly parallel tasks
7. **Specify account** - If you have multiple allocations

## Integration with Nexus

Nexus automatically:
- Generates SBATCH scripts from task descriptions
- Parses resource hints from task descriptions
- Monitors job status via squeue/sacct
- Streams job output back to the plan view
- Maps Slurm job states to Nexus task states

When writing task descriptions, be explicit about:
- Required computational resources
- Expected runtime
- Any special requirements (GPU type, large memory, etc.)
- Dependencies on other tasks

The agent runner on the login node will:
1. Generate an appropriate SBATCH script
2. Submit the job with `sbatch`
3. Monitor progress with `squeue`
4. Stream stdout/stderr back to Nexus
5. Report final status when job completes
