# Nexus Agent Runner

A CLI tool for connecting HPC clusters to Nexus via WebSocket.

## Installation

On your HPC cluster login node:

```bash
# Clone or copy this directory
cd cli/nexus-agent

# Install dependencies
npm install

# Build
npm run build
```

## Usage

### Connect to Nexus

```bash
# Using environment variables
export NEXUS_RELAY_URL=wss://your-nexus-server.com:3002
nexus-agent connect

# Or with CLI options
nexus-agent connect --url wss://your-nexus-server.com:3002 --name "MyCluster"
```

### Check Status

```bash
nexus-agent status
```

### Configure

```bash
# Set configuration
nexus-agent config --url wss://your-nexus-server.com:3002
nexus-agent config --name "MyCluster"

# View configuration
nexus-agent config --show
```

## Configuration

Configuration can be set via:

1. **CLI options** (highest priority)
2. **Environment variables**
3. **Config file** at `~/.nexus/agent.json`

### Environment Variables

- `NEXUS_RELAY_URL` - WebSocket URL of the Nexus relay server
- `NEXUS_MACHINE_NAME` - Name to identify this machine (defaults to hostname)
- `NEXUS_AUTH_TOKEN` - Authentication token (if required)

### Config File

Create `~/.nexus/agent.json`:

```json
{
  "relayUrl": "wss://your-nexus-server.com:3002",
  "machineName": "MyCluster",
  "authToken": "your-token"
}
```

## How It Works

1. The agent connects to the Nexus relay server via WebSocket
2. It registers itself with machine information and Slurm capabilities
3. When a task is dispatched to this machine:
   - The agent generates a Slurm batch script
   - Submits the job using `sbatch`
   - Monitors job status using `squeue` and `sacct`
   - Streams output back to Nexus
   - Reports completion with exit code

## Slurm Integration

The agent automatically detects Slurm and gathers:

- Cluster name and Slurm version
- Available partitions
- User accounts and QOS levels
- GPU availability (if applicable)

Tasks dispatched to this agent can include Slurm-specific configuration:

```json
{
  "slurmConfig": {
    "partition": "gpu",
    "nodes": 1,
    "cpusPerTask": 8,
    "mem": "32G",
    "time": "04:00:00",
    "gpu": { "type": "a100", "count": 1 },
    "modules": ["cuda/11.8", "python/3.10"]
  }
}
```

## Development

```bash
# Run in development mode
npm run dev connect --url wss://localhost:3002

# Build for production
npm run build
```

## Troubleshooting

### Slurm not detected

Ensure Slurm commands are in your PATH:

```bash
which sinfo squeue sbatch sacct
```

### Connection issues

Check that:
1. The relay server URL is correct
2. Port 3002 (or custom) is accessible from the login node
3. Any authentication tokens are valid

### Job submission fails

Check:
1. You have a valid Slurm account
2. The requested resources are available
3. The partition exists and is accessible
