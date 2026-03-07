---
name: k8s-exec-default
version: "1.0.0"
description: "Default Kubernetes execution skills: kubectl exec, pod management, file copy, namespace awareness."
category: tools
tags: [kubernetes, k8s]
allowedTools: [Bash, Read, Write, Glob, Grep]
---

# Kubernetes Execution Essentials

## Pod Execution
- Use `kubectl exec -it <pod> -- <command>` to run commands in pods
- Use `kubectl exec -it <pod> -c <container> -- <command>` for multi-container pods
- Always specify namespace with `-n <namespace>` when not using default

## File Operations
- Copy to pod: `kubectl cp <local-path> <namespace>/<pod>:<remote-path>`
- Copy from pod: `kubectl cp <namespace>/<pod>:<remote-path> <local-path>`
- For large files, prefer `kubectl exec` with `tar` for better reliability

## Pod Management
- Create pod: `kubectl run <name> --image=<image> --restart=Never`
- List pods: `kubectl get pods -n <namespace>`
- Describe pod: `kubectl describe pod <name> -n <namespace>`
- Delete pod: `kubectl delete pod <name> -n <namespace>`
- Wait for ready: `kubectl wait --for=condition=ready pod/<name> -n <namespace> --timeout=300s`

## Resource Awareness
- Check GPU availability: `kubectl describe nodes | grep -A5 nvidia.com/gpu`
- Request GPUs: add `resources.limits.nvidia.com/gpu: N` to pod spec
- Check pod logs: `kubectl logs <pod> -n <namespace> --tail=100`
- Follow logs: `kubectl logs -f <pod> -n <namespace>`

## Batch Workloads
- Create Job: `kubectl create job <name> --image=<image> -- <command>`
- Create CronJob: `kubectl create cronjob <name> --image=<image> --schedule="0 */6 * * *" -- <command>`
- List jobs: `kubectl get jobs -n <namespace>`
- Check job status: `kubectl describe job <name> -n <namespace>`

## Debugging & Port Forwarding
- Port forward to pod: `kubectl port-forward <pod> <local-port>:<pod-port> -n <namespace>`
- Port forward to service: `kubectl port-forward svc/<service> <local-port>:<svc-port> -n <namespace>`
- Get events: `kubectl get events -n <namespace> --sort-by=.lastTimestamp`

## Namespace Best Practices
- List namespaces: `kubectl get namespaces`
- Set default namespace: `kubectl config set-context --current --namespace=<ns>`
- Always verify target namespace before destructive operations

## Session Liveness (IMPORTANT)

Your session has an activity timeout. If you stop producing tool calls, the system assumes you are dead and will kill your session. Follow these rules to stay alive:

1. **Poll every 60 seconds** — After creating a Job or starting a long-running pod, check its status with `kubectl get pod <name>` or `kubectl logs --tail=20 <pod>` at least once per minute.
2. **Never use `kubectl logs -f` as sole monitoring** — Blocking follow commands keep the process alive but may not reset the activity timer. Instead, use periodic `kubectl logs --tail=20 <pod>` calls.
3. **Never go silent** — Do NOT submit a Job and then wait without making tool calls. Keep polling to stay alive.
4. **Report progress** — Between polls, tell the user what the workload is doing (e.g., "Pod training-pod is Running, logs show epoch 5/20").
