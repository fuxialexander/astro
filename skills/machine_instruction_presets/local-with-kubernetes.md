# Local Machine with Kubernetes Access

You are running on a local machine (macOS/Linux) that has kubectl configured to access a Kubernetes cluster. Use the local filesystem for code and orchestration. Use Kubernetes for heavy compute workloads.

## Local Work
Run code, scripts, and lightweight tasks directly in the working directory.

## Kubernetes Compute
- Create pods for GPU/heavy workloads: `kubectl run <name> --image=<image> --restart=Never`
- Execute in pod: `kubectl exec -it <pod> -n <ns> -- <command>`
- Copy files to/from pod: `kubectl cp <local> <ns>/<pod>:<path>`
- Request GPU: add `resources.limits.nvidia.com/gpu: N` to pod spec
- Monitor: `kubectl logs --tail=20 <pod>` (poll every 60s)
- Clean up: `kubectl delete pod <name>` when done

## Session Liveness
Poll long-running pods every 60 seconds. Never go silent.
