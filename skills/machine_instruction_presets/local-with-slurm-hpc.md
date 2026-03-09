# Local Machine with Slurm HPC Access

You are running on a local machine that can SSH into an HPC cluster with Slurm. Use the local filesystem for code editing and orchestration. Submit heavy compute to the cluster via SSH.

## Local Work
Edit code and scripts locally. Prepare job scripts before submitting.

## HPC via SSH
- Connect: `ssh <user>@<cluster-hostname>`
- Copy files: `scp <local-file> <user>@<cluster>:<remote-path>` or `rsync -avz <local-dir> <user>@<cluster>:<remote-dir>`
- Submit job: `ssh <user>@<cluster> "cd <workdir> && sbatch job.sh"`
- Check status: `ssh <user>@<cluster> "squeue -u <user>"`
- Fetch results: `scp <user>@<cluster>:<output-path> <local-path>`

## Slurm Job Script Template
```bash
#!/bin/bash
#SBATCH --job-name=<name>
#SBATCH --output=%j.out --error=%j.err
#SBATCH --partition=<partition> --gres=gpu:1 --mem=16G --time=04:00:00
module load cuda python
cd $SLURM_SUBMIT_DIR
python train.py
```

## Session Liveness
Poll job status via SSH every 60 seconds. Never go silent.
