# Compute Execution Guide

## Direct (local shell)
Run commands directly in the working directory using standard CLI tools.

## Docker (if available)
- Execute in container: `docker exec -it <container> <command>`
- Run with GPU: `docker run --gpus all -v $(pwd):/workspace <image>`
- Copy files: `docker cp <local> <container>:<path>`
- Monitor: `docker logs --tail=20 <container>` (poll every 60s for long jobs)

## Kubernetes (if available)
- Execute in pod: `kubectl exec -it <pod> -n <ns> -- <command>`
- Run pod: `kubectl run <name> --image=<image> --restart=Never`
- Copy files: `kubectl cp <local> <ns>/<pod>:<path>`
- Monitor: `kubectl logs --tail=20 <pod>` (poll every 60s for long jobs)

## Slurm/HPC (if available)
- Submit job: `sbatch <script.sh>` (NEVER run compute on the login node)
- Interactive: `srun --pty -n1 --cpus-per-task=4 --mem=8G bash`
- GPU job: `srun --pty --gres=gpu:1 --mem=16G bash`
- Monitor: `squeue -j <jobid>` (poll every 60s for long jobs)

## Session Liveness
Your session has an activity timeout. After starting any long-running job, poll its status every 60 seconds. Never go silent — keep producing tool calls to stay alive.
