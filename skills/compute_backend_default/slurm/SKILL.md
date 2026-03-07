---
name: slurm-default
version: "1.0.0"
description: "Default Slurm/HPC execution skills: sbatch, squeue, module system, job monitoring."
category: tools
tags: [slurm, hpc]
allowedTools: [Bash, Read, Write, Glob, Grep]
---

# Slurm HPC Execution Essentials

**NEVER run compute directly on the login node.** Always use `sbatch`, `srun`, or `salloc` to submit work to compute nodes.

## Cluster Status
- View partitions and node states: `sinfo`
- Summarized view: `sinfo -s`
- Check specific partition: `sinfo -p <partition>`
- Node details: `scontrol show node <nodename>`

## Job Submission
- Submit batch job: `sbatch <script.sh>`
- Interactive session: `srun --pty bash`
- Request an interactive compute node: `srun --pty -n 1 --cpus-per-task=4 --mem=8G -t 02:00:00 -p <partition> bash`
- Request a GPU node: `srun --pty --gres=gpu:1 --mem=16G -t 01:00:00 -p <gpu-partition> bash`
- Allocate resources: `salloc -N <nodes> -n <tasks> -t <time>`
- Common sbatch headers: `#SBATCH --job-name=`, `--output=`, `--error=`, `--time=`, `--partition=`

## Job Monitoring
- List your jobs: `squeue -u $USER`
- Job details: `scontrol show job <jobid>`
- Cancel job: `scancel <jobid>`
- Cancel all your jobs: `scancel -u $USER`
- Job history: `sacct -j <jobid> --format=JobID,State,ExitCode,Elapsed`

## Resource Requests
- CPUs: `#SBATCH --cpus-per-task=<N>`
- Memory: `#SBATCH --mem=<N>G`
- GPUs: `#SBATCH --gres=gpu:<N>` or `--gpus-per-node=<N>`
- Time: `#SBATCH --time=HH:MM:SS`
- Partition: `#SBATCH --partition=<name>`

## Array Jobs & Dependencies
- Array job: `#SBATCH --array=1-10` (runs 10 instances, `$SLURM_ARRAY_TASK_ID` = 1..10)
- Array with step: `#SBATCH --array=0-100:10` (0, 10, 20, ..., 100)
- Dependency on job: `sbatch --dependency=afterok:<jobid> next_step.sh`
- Dependency on array: `sbatch --dependency=afterok:<array_jobid> summary.sh`

## Module System
- List available: `module avail`
- Load module: `module load <name>`
- List loaded: `module list`
- Common modules: `cuda`, `python`, `gcc`, `openmpi`

## File Systems
- Use `$SCRATCH` or `$WORK` for large data (not `$HOME`)
- Check quota: `quota -s` or cluster-specific command
- Stage data before job starts, copy results after completion

## Session Liveness (IMPORTANT)

Your session has an activity timeout. If you stop producing tool calls, the system assumes you are dead and will kill your session. Follow these rules to stay alive:

1. **Poll every 60 seconds** — After submitting a job with `sbatch`, poll its status with `squeue -j <jobid>` at least once per minute using discrete `Bash` tool calls.
2. **Tail output between polls** — Run `tail -n 20 <output_file>` between status checks to surface progress.
3. **Never go silent** — Do NOT submit a job and then wait without making tool calls. Even a simple `squeue -u $USER` keeps the session alive.
4. **Avoid long-blocking commands** — Do NOT use `srun` to block until a batch job completes. Instead, use `sbatch` + polling.
5. **Report progress** — Between polls, tell the user what the job is doing (e.g., "Job 12345 has been running for 5 minutes, output shows epoch 3/10").
