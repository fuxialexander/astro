# HPC & SSH Remote Environment Setup Guide

Connect remote machines (HPC clusters, SSH servers, local workstations) to Nexus for task execution — no Supabase auth required for local development.

## Architecture

```
Browser (localhost:5173)
    ↓ SSE
Hono API (localhost:3001)
    ↓ HTTP + Events
Relay Server (localhost:3002, WebSocket)
    ↕ WS messages
Agent Runner (on your HPC login node / remote machine / local terminal)
    ↓
Task execution (Claude Code, Slurm sbatch, etc.)
```

---

## 1. Start the Backend

```bash
cd /path/to/nexus

# Optional env vars (defaults work for local dev)
export RELAY_PORT=3002                          # WebSocket port (default: 3002)
export NEXUS_BASE_URL=http://localhost:5173      # Frontend URL for device auth page

npm run dev
```

This starts:
- **Vite** frontend on `http://localhost:5173`
- **Hono** API on `http://localhost:3001`
- **WebSocket relay** on `ws://localhost:3002`

Verify:
```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/relay/health
```

> In dev mode (no `RELAY_JWT_SECRET` set), the relay accepts connections without authentication.

---

## 2. Install the Agent Runner

On the machine that will execute tasks:

```bash
npm install -g @nexus/agent
# or use npx (no install needed)
npx @nexus/agent status
```

On HPC clusters, you may need to load Node.js first:
```bash
module load nodejs   # varies by cluster: node, nodejs, node/20, etc.
```

---

## 3. Connect a Machine

### Option A: Direct Connect (Dev Mode)

No auth needed — just point at the relay:

```bash
nexus-agent connect \
  --url ws://localhost:3002 \
  --name "My Laptop"
```

For an HPC login node (SSH in first):
```bash
ssh user@sherlock.stanford.edu

module load nodejs
nexus-agent connect \
  --url ws://your-local-ip:3002 \
  --name "Sherlock HPC" \
  --dir /home/user/projects/myproject
```

> **Important**: If connecting from a remote machine, use your local machine's LAN IP (not `localhost`). Make sure port 3002 is accessible (firewall, SSH tunnel, etc.).

### Option B: SSH Tunnel (Recommended for Remote HPC)

If the HPC can't reach your machine directly, use an SSH tunnel:

```bash
# Terminal 1: Create tunnel (run on your local machine)
ssh -R 3002:localhost:3002 user@sherlock.stanford.edu

# Terminal 2: On the HPC (through the tunnel)
nexus-agent connect \
  --url ws://localhost:3002 \
  --name "Sherlock HPC"
```

This reverse-tunnels port 3002 so the agent runner on HPC connects to your local relay.

### Option C: Device Auth Flow (Production-Like)

For a more formal registration:

```bash
# 1. Request a device code
nexus-agent setup --url ws://localhost:3002

# 2. It prints a code like: USER-XYZ789
#    Open http://localhost:5173/device in your browser
#    Enter the code and authorize

# 3. The agent runner automatically receives tokens and connects
```

---

## 4. CLI Reference

```bash
# Check system capabilities (Slurm, Claude SDK, hardware)
nexus-agent status

# Connect to relay
nexus-agent connect --url ws://localhost:3002 --name "My Machine"

# Connect with options
nexus-agent connect \
  --url ws://localhost:3002 \
  --name "Sherlock HPC" \
  --dir /scratch/user/project \       # Working directory for tasks
  --no-worktree                        # Disable git worktree isolation

# View/update config
nexus-agent config --show
nexus-agent config --url ws://new-host:3002
nexus-agent config --name "New Name"
```

### Environment Variables

These override config file values:

```bash
export NEXUS_RELAY_URL=ws://localhost:3002
export NEXUS_MACHINE_NAME="My HPC Cluster"
export NEXUS_AUTH_TOKEN=<optional_token>
```

Config file location: `~/.nexus/agent.json`

---

## 5. Slurm/HPC Setup

If the agent runner detects Slurm on the system (`sinfo` available), it automatically registers as an HPC provider.

### What Happens

1. Agent runner detects Slurm version, cluster name, partitions
2. Reports `slurm` provider to the relay alongside `claude-code`
3. When a task is dispatched with `environment: "hpc"`, Nexus generates an SBATCH script
4. The agent runner submits via `sbatch`, monitors via `squeue`/`sacct`
5. Output streams back to the dashboard in real-time

### Example SBATCH Script (Auto-Generated)

```bash
#!/bin/bash
#SBATCH --job-name=nexus-task-abc123
#SBATCH --partition=gpu
#SBATCH --nodes=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=01:00:00
#SBATCH --gres=gpu:a100:1
#SBATCH --output=nexus-task-abc123_%j.out
#SBATCH --error=nexus-task-abc123_%j.err

set -e
echo "Job ID: $SLURM_JOB_ID"
echo "Node: $SLURMD_NODENAME"

module load cuda/11.8
module load python/3.10

cd /home/user/project
python train.py --gpu
```

### Configuring Slurm Parameters

When creating a task in the Nexus UI, set HPC parameters in the task metadata:

| Parameter | Example | Description |
|-----------|---------|-------------|
| `partition` | `gpu` | Slurm partition |
| `nodes` | `1` | Number of nodes |
| `cpusPerTask` | `4` | CPUs per task |
| `mem` | `16G` | Memory per node |
| `time` | `1:00:00` | Wall time limit |
| `gpu.type` | `a100` | GPU type |
| `gpu.count` | `1` | Number of GPUs |
| `modules` | `["cuda/11.8"]` | Modules to load |
| `account` | `mylab` | Billing account |

### Verify Slurm Detection

```bash
nexus-agent status
```

Expected output:
```
Slurm Status:
  ✓ Available (version 22.05)
  Cluster: Sherlock
  Partitions: gpu, cpu, interactive
  Default: cpu
  Accounts: myaccount, shared
```

---

## 6. Dashboard Updates

Once machines are connected, the Nexus dashboard updates automatically:

- **Environments page** (`/environments`): Shows connected machines, providers, load
- **Dashboard** (`/`): System health reflects connected machine count and active tasks
- **Task execution**: Dispatch a task → select remote machine → stream output in real-time
- **Plan view**: Task nodes show live execution progress from remote machines

The data flow for dashboard updates:
```
Agent Runner → WebSocket → Relay Server → EventEmitter → SSE endpoint → Browser EventSource → Zustand store → React UI
```

All of this works in dev mode without Supabase — the `requireAuth` middleware passes through with a synthetic dev user.

---

## 7. Dispatching a Task to a Remote Machine

1. Open a project plan view (`/project/:id/plan`)
2. Click on a task node
3. Click **Execute** in the node detail panel
4. Select the target machine from the dropdown (shows connected machines)
5. Choose provider: `claude-code` (AI agent) or `slurm` (HPC job)
6. Click **Dispatch**
7. Monitor output in the task detail view (`/project/:id/task/:nodeId`)

---

## 8. Troubleshooting

### Machine Not Showing in UI

```bash
# Check relay is running
curl http://localhost:3001/api/relay/health

# List connected machines
curl http://localhost:3001/api/relay/machines

# Check WebSocket port is open
nc -zv localhost 3002
```

### Remote Machine Can't Reach Relay

Use an SSH tunnel:
```bash
# Forward relay port to remote machine
ssh -R 3002:localhost:3002 user@remote-host

# Or forward through a jump host
ssh -J jumphost -R 3002:localhost:3002 user@hpc-login
```

### Agent Runner Disconnects

The relay sends heartbeat pings every 30 seconds. If 3 pings are missed (90s), the connection is dropped.

Common causes:
- Network instability (use `tmux`/`screen` on HPC to persist sessions)
- High load causing the agent runner to freeze
- SSH connection dropped (use `autossh` or `ServerAliveInterval`)

Persistent connection on HPC:
```bash
# Use tmux to keep the session alive
ssh user@sherlock.stanford.edu
tmux new -s nexus-agent
nexus-agent connect --url ws://localhost:3002 --name "Sherlock HPC"
# Ctrl+B, D to detach — reconnect later with: tmux attach -t nexus-agent
```

### Slurm Jobs Not Submitting

```bash
# Verify Slurm works directly
sinfo
squeue -u $USER
sbatch --wrap="echo hello" --partition=normal

# Check agent runner output for Slurm errors
nexus-agent connect --url ws://localhost:3002 --name "HPC" 2>&1 | grep -i slurm
```

### Port Conflicts

```bash
# Check what's using port 3002
lsof -i :3002

# Use a different port
RELAY_PORT=3003 npm run dev:backend
nexus-agent connect --url ws://localhost:3003 --name "My Machine"
```

---

## 9. Production Notes

For production deployment, set these additional env vars:

```bash
# Required in production
RELAY_JWT_SECRET=<strong-random-secret>

# Use TLS WebSocket
RELAY_WS_URL=wss://your-domain.fly.dev:3002

# Frontend URL
NEXUS_BASE_URL=https://your-domain.pages.dev

# Optional: Redis for multi-instance relay
REDIS_URL=redis://redis-host:6379
```

In production, machines must go through the full device auth flow (Option C) to get a signed JWT token for the WebSocket connection.
