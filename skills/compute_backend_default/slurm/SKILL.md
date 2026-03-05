---
name: slurm-default
version: "1.0.0"
description: "Default Slurm/HPC execution skills: sbatch, squeue, module system, job monitoring."
category: tools
tags: [slurm, hpc]
allowedTools: [Bash, Read, Write, Glob, Grep]
---

# Slurm HPC Execution Essentials

## Job Submission
- Submit batch job: `sbatch <script.sh>`
- Interactive session: `srun --pty bash`
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

## Module System
- List available: `module avail`
- Load module: `module load <name>`
- List loaded: `module list`
- Common modules: `cuda`, `python`, `gcc`, `openmpi`

## File Systems
- Use `$SCRATCH` or `$WORK` for large data (not `$HOME`)
- Check quota: `quota -s` or cluster-specific command
- Stage data before job starts, copy results after completion
