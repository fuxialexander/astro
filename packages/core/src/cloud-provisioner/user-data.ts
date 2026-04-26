export interface RunnerEnvOpts {
  serverUrl: string
  relayUrl: string
  autoTerminateHours?: number
}

const AGENT_BINARY_URL =
  'https://github.com/astro-anywhere/astro-agent/releases/latest/download/astro-agent-linux-x64'

/**
 * AWS EC2 user-data (cloud-init) bash script. Combined with
 * InstanceInitiatedShutdownBehavior=terminate, the optional autoTerminate
 * timer ensures HIPAA runners self-destruct after N hours.
 */
export function buildUserData(poolId: string, teamId: string, opts: RunnerEnvOpts): string {
  const autoTerminate = opts.autoTerminateHours && opts.autoTerminateHours > 0
    ? `# HIPAA auto-terminate: shutdown after ${opts.autoTerminateHours}h
(sleep ${Math.round(opts.autoTerminateHours * 3600)} && /sbin/shutdown -h now) &
disown
`
    : ''
  return `#!/usr/bin/env bash
set -euo pipefail
curl -fsSL ${AGENT_BINARY_URL} -o /usr/local/bin/astro-agent
chmod +x /usr/local/bin/astro-agent
mkdir -p /etc/astro
cat >/etc/astro/runner.env <<'EOF'
ASTRO_SERVER_URL=${opts.serverUrl}
ASTRO_RELAY_URL=${opts.relayUrl}
ASTRO_REMOTE_POOL_ID=${poolId}
ASTRO_TEAM_ID=${teamId}
EOF
cat >/etc/systemd/system/astro-agent.service <<'UNIT'
[Unit]
Description=Astro Agent Runner
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
EnvironmentFile=/etc/astro/runner.env
ExecStart=/usr/local/bin/astro-agent start --foreground --relay $ASTRO_RELAY_URL --max-tasks 2 --log-level info
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable astro-agent.service
systemctl start astro-agent.service
${autoTerminate}`
}

/**
 * GCE startup-script (attached as `startup-script` instance metadata). Same
 * shape as the AWS user-data: download the agent, write the runner env file,
 * register and start the systemd unit.
 */
export function buildStartupScript(poolId: string, teamId: string, opts: RunnerEnvOpts): string {
  return `#!/usr/bin/env bash
set -euo pipefail
curl -fsSL ${AGENT_BINARY_URL} -o /usr/local/bin/astro-agent
chmod +x /usr/local/bin/astro-agent
mkdir -p /etc/astro
cat >/etc/astro/runner.env <<'EOF'
ASTRO_SERVER_URL=${opts.serverUrl}
ASTRO_RELAY_URL=${opts.relayUrl}
ASTRO_REMOTE_POOL_ID=${poolId}
ASTRO_TEAM_ID=${teamId}
EOF
cat >/etc/systemd/system/astro-agent.service <<'UNIT'
[Unit]
Description=Astro Agent Runner
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
EnvironmentFile=/etc/astro/runner.env
ExecStart=/usr/local/bin/astro-agent start --foreground --relay $ASTRO_RELAY_URL --max-tasks 2 --log-level info
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable astro-agent.service
systemctl start astro-agent.service
`
}
