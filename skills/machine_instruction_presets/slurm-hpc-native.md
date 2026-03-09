# Slurm HPC — Agent on Login Node

You are running directly on an HPC login node. You have direct access to Slurm commands and the shared filesystem. NEVER run heavy computation on the login node — always submit via Slurm.

## Job Submission
- Batch job: `sbatch <script.sh>`
- Interactive GPU: `srun --pty --gres=gpu:1 --mem=16G -t 01:00:00 -p <gpu-partition> bash`
- Interactive CPU: `srun --pty -n1 --cpus-per-task=4 --mem=8G -t 02:00:00 bash`

## Job Monitoring
- Your jobs: `squeue -u $USER`
- Job detail: `scontrol show job <jobid>`
- Cancel: `scancel <jobid>`
- Output: `tail -n 20 <jobid>.out`

## Resource Requests
- GPU: `#SBATCH --gres=gpu:<N>` or `--gpus-per-node=<N>`
- Memory: `#SBATCH --mem=<N>G`
- Array: `#SBATCH --array=1-10`
- Dependency: `sbatch --dependency=afterok:<jobid> next.sh`

## Module System
`module avail`, `module load cuda python gcc`

## File System
Use `$SCRATCH` or `$WORK` for large data, not `$HOME`. Check quota with `quota -s`.

## Session Liveness
After submitting any job, poll with `squeue -j <jobid>` every 60 seconds. Never go silent.
