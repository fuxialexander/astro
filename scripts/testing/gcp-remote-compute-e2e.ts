import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type Command = 'check' | 'prepare' | 'wait' | 'cleanup'
type StartupMode = 'binary' | 'docker' | 'npm'

interface Config {
  projectId: string
  region: string
  zone: string
  bucket: string
  instance: string
  machineType: string
  astroServerUrl: string
  relayUrl: string
  outDir: string
  mode: StartupMode
  dockerImage: string
  agentBinaryUrl: string
  waitTimeoutSec: number
}

function parseArgs(argv: string[]): { command: Command; config: Config } {
  const defaults: Config = {
    projectId: '',
    region: 'us-central1',
    zone: 'us-central1-a',
    bucket: '',
    instance: 'astro-gcp-e2e-runner',
    machineType: 'e2-micro',
    astroServerUrl: 'https://api.astroanywhere.com',
    relayUrl: 'wss://relay.astroanywhere.com:3002',
    outDir: resolve(process.cwd(), '.tmp/gcp-remote-compute-e2e'),
    mode: 'binary',
    dockerImage: 'ghcr.io/astro-anywhere/agent:latest',
    agentBinaryUrl: 'https://github.com/astro-anywhere/astro-agent/releases/latest/download/astro-agent-linux-x64',
    waitTimeoutSec: 300,
  }

  let command: Command = 'prepare'
  const config = { ...defaults }
  for (const arg of argv) {
    if (arg === 'check' || arg === 'prepare' || arg === 'wait' || arg === 'cleanup') {
      command = arg as Command
      continue
    }
    const match = arg.match(/^--([^=]+)=(.*)$/)
    if (!match) continue
    const [, key, value] = match
    switch (key) {
      case 'project':       config.projectId = value; break
      case 'region':        config.region = value; break
      case 'zone':          config.zone = value; break
      case 'bucket':        config.bucket = value; break
      case 'instance':      config.instance = value; break
      case 'machine-type':  config.machineType = value; break
      case 'astro-server-url': config.astroServerUrl = value; break
      case 'relay-url':     config.relayUrl = value; break
      case 'out-dir':       config.outDir = resolve(value); break
      case 'mode':          config.mode = value as StartupMode; break
      case 'docker-image':      config.dockerImage = value; break
      case 'agent-binary-url':  config.agentBinaryUrl = value; break
      case 'timeout':       config.waitTimeoutSec = Number(value); break
      default: break
    }
  }

  return { command, config }
}

async function detectCommand(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('bash', ['-lc', `command -v ${cmd}`])
    return true
  } catch {
    return false
  }
}

async function detectGcloudProject(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('gcloud', ['config', 'get-value', 'project'], { timeout: 10_000 })
    const value = stdout.trim()
    return value === '(unset)' ? '' : value
  } catch {
    return ''
  }
}

async function detectGcloudAccount(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'], { timeout: 10_000 })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

function float32LE(values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 4)
  values.forEach((value, index) => out.writeFloatLE(value, index * 4))
  return out
}

async function writeTinyZarr(root: string): Promise<void> {
  const arrayDir = join(root, 'sample.zarr', 'x')
  await ensureDir(arrayDir)
  await writeFile(join(root, 'sample.zarr', '.zgroup'), `${JSON.stringify({ zarr_format: 2 })}\n`)
  await writeFile(join(root, 'sample.zarr', '.zattrs'), `${JSON.stringify({ title: 'Astro GCP E2E sample' })}\n`)
  await writeFile(join(arrayDir, '.zarray'), `${JSON.stringify({
    chunks: [4],
    compressor: null,
    dtype: '<f4',
    fill_value: null,
    filters: null,
    order: 'C',
    shape: [4],
    zarr_format: 2,
  })}\n`)
  await writeFile(join(arrayDir, '.zattrs'), `${JSON.stringify({ units: 'arbitrary' })}\n`)
  await writeFile(join(arrayDir, '0'), float32LE([1.5, 2.5, 3.5, 4.5]))
}

async function writeFixtures(fixturesRoot: string): Promise<void> {
  const stagedInputDir = join(fixturesRoot, 'staged-input')
  await ensureDir(stagedInputDir)
  await writeTinyZarr(fixturesRoot)
  await writeFile(join(stagedInputDir, 'numbers.txt'), '10\n20\n30\n')
  await writeFile(join(fixturesRoot, 'README.txt'), 'Fixtures for Astro remote compute GCP E2E.\n')
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// Binary startup: curl prebuilt binary from GitHub Releases (fastest, ~30-60s, no runtime needed)
function renderBinaryStartupScript(config: Config): string {
  return `#!/usr/bin/env bash
set -euo pipefail

curl -fsSL ${config.agentBinaryUrl} -o /usr/local/bin/astro-agent
chmod +x /usr/local/bin/astro-agent

mkdir -p /etc/astro
cat >/etc/astro/runner.env <<'EOF'
ASTRO_SERVER_URL=${config.astroServerUrl}
ASTRO_RELAY_URL=${config.relayUrl}
EOF

cat >/etc/systemd/system/astro-agent.service <<'EOF'
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
EOF

systemctl daemon-reload
systemctl enable astro-agent.service
systemctl start astro-agent.service
`
}

// NPM-based startup: installs Node + npm packages (slow, ~5-8 min)
function renderNpmStartupScript(config: Config): string {
  return `#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y curl git ca-certificates

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

npm install -g @astroanywhere/cli @astroanywhere/agent

mkdir -p /etc/astro
cat >/etc/astro/runner.env <<'EOF'
ASTRO_SERVER_URL=${config.astroServerUrl}
ASTRO_RELAY_URL=${config.relayUrl}
EOF

cat >/etc/systemd/system/astro-agent.service <<'EOF'
[Unit]
Description=Astro Agent Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/astro/runner.env
ExecStart=/usr/bin/env bash -lc 'ASTRO_SERVER_URL="$ASTRO_SERVER_URL" ASTRO_RELAY_URL="$ASTRO_RELAY_URL" astro-agent start --foreground --relay "$ASTRO_RELAY_URL" --max-tasks 2 --log-level info'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable astro-agent.service
systemctl restart astro-agent.service
`
}

// Docker-based startup: uses Container-Optimized OS (Docker pre-installed, ~2-3 min)
function renderDockerStartupScript(config: Config): string {
  return `#!/usr/bin/env bash
set -euo pipefail

# Container-Optimized OS: Docker is pre-installed, no apt-get needed.
docker pull ${config.dockerImage}

docker run -d \
  --name astro-agent \
  --restart=always \
  -e ASTRO_SERVER_URL=${config.astroServerUrl} \
  -e ASTRO_RELAY_URL=${config.relayUrl} \
  ${config.dockerImage} \
  start --foreground --relay ${config.relayUrl} --max-tasks 2 --log-level info
`
}

function renderDockerfile(): string {
  return `FROM node:22-alpine
RUN npm install -g @astroanywhere/cli@latest @astroanywhere/agent@latest
ENTRYPOINT ["astro-agent"]
`
}

function renderDockerBuildScript(image: string): string {
  return `#!/usr/bin/env bash
# Build and push the astro-agent Docker image.
# Run this once before creating VMs in docker mode.
set -euo pipefail
IMAGE=${shellEscape(image)}
docker build -t "$IMAGE" "$(dirname "$0")"
docker push "$IMAGE"
echo "Pushed $IMAGE"
`
}

function renderDispatchExamples(config: Config) {
  const streaming = {
    title: 'GCP streaming Zarr smoke test',
    description: 'Read the cloud-native Zarr dataset directly from GCS, compute the sum, and write the result to result.json in the working directory.',
    preferredProvider: 'codex',
    executionStrategy: 'direct',
    storageMounts: [
      {
        provider: 'gcs',
        uri: `gs://${config.bucket}/fixtures/sample.zarr/`,
        path: 'datasets/sample-zarr',
        access: 'streaming',
        mode: 'read',
        formatHint: 'zarr',
      },
    ],
  }

  const staged = {
    title: 'GCP staged mount smoke test',
    description: 'Read numbers.txt from the staged input directory, write doubled values to outputs/doubled.txt, and let Astro sync the output back to GCS.',
    preferredProvider: 'codex',
    executionStrategy: 'direct',
    storageMounts: [
      {
        provider: 'gcs',
        uri: `gs://${config.bucket}/fixtures/staged-input/`,
        path: 'inputs/staged',
        access: 'staged',
        mode: 'read',
        sync: 'start',
      },
      {
        provider: 'gcs',
        uri: `gs://${config.bucket}/outputs/`,
        path: 'outputs',
        access: 'staged',
        mode: 'readwrite',
        sync: 'both',
      },
    ],
  }

  return { streaming, staged }
}

function renderPlan(config: Config, startupScriptPath: string, fixturesRoot: string): string {
  const project = config.projectId || '<set-gcp-project>'
  const bucket = config.bucket || '<set-unique-bucket>'
  const lines = [
    'GCP Remote Compute E2E Plan',
    '',
    `Project:   ${project}`,
    `Region:    ${config.region}`,
    `Zone:      ${config.zone}`,
    `VM:        ${config.instance}`,
    `Bucket:    ${bucket}`,
    `Mode:      ${config.mode}`,
    '',
    '1. Enable required services:',
    `   gcloud services enable compute.googleapis.com storage.googleapis.com --project ${shellEscape(project)}`,
    '',
    '2. Create the bucket:',
    `   gcloud storage buckets create gs://${bucket} --project ${shellEscape(project)} --location ${shellEscape(config.region)} --uniform-bucket-level-access`,
    '',
    '3. Upload fixtures:',
    `   gcloud storage rsync --recursive ${shellEscape(fixturesRoot)} gs://${bucket}/fixtures`,
    '',
  ]

  if (config.mode === 'binary') {
    lines.push(
      '4. Create the VM (Debian 12, curls prebuilt binary — fastest cold start, ~30-60s):',
      `   gcloud compute instances create ${shellEscape(config.instance)} --project ${shellEscape(project)} --zone ${shellEscape(config.zone)} --machine-type ${shellEscape(config.machineType)} --image-family debian-12 --image-project debian-cloud --metadata-from-file startup-script=${shellEscape(startupScriptPath)} --scopes=https://www.googleapis.com/auth/devstorage.read_write,https://www.googleapis.com/auth/cloud-platform`,
      '',
    )
  } else if (config.mode === 'docker') {
    lines.push(
      '4. Build and push the Docker image (once, not per-VM):',
      `   bash ${shellEscape(join(resolve(startupScriptPath, '..'), 'docker-build-push.sh'))}`,
      '',
      '5. Create the VM (Container-Optimized OS, Docker pre-installed, ~2-3 min):',
      `   gcloud compute instances create ${shellEscape(config.instance)} --project ${shellEscape(project)} --zone ${shellEscape(config.zone)} --machine-type ${shellEscape(config.machineType)} --image-family cos-stable --image-project cos-cloud --metadata-from-file startup-script=${shellEscape(startupScriptPath)} --scopes=https://www.googleapis.com/auth/devstorage.read_write,https://www.googleapis.com/auth/cloud-platform`,
      '',
    )
  } else {
    lines.push(
      '4. Create the VM (Debian 12, installs Node + npm packages on first boot, ~5-8 min):',
      `   gcloud compute instances create ${shellEscape(config.instance)} --project ${shellEscape(project)} --zone ${shellEscape(config.zone)} --machine-type ${shellEscape(config.machineType)} --image-family debian-12 --image-project debian-cloud --metadata-from-file startup-script=${shellEscape(startupScriptPath)} --scopes=https://www.googleapis.com/auth/devstorage.read_write,https://www.googleapis.com/auth/cloud-platform`,
      '',
    )
  }

  lines.push(
    `6. Wait for runner to appear (polls astro-cli env list):`,
    `   tsx scripts/testing/gcp-remote-compute-e2e.ts wait --instance=${config.instance} --astro-server-url=${config.astroServerUrl}`,
    '',
    '7. Create two tasks using the generated dispatch payloads.',
    '',
    'Cleanup when done:',
    `   tsx scripts/testing/gcp-remote-compute-e2e.ts cleanup --project=${project} --zone=${config.zone} --instance=${config.instance} --bucket=${bucket}`,
  )

  return lines.join('\n')
}

async function writeText(path: string, value: string): Promise<void> {
  await ensureDir(dirname(path))
  await writeFile(path, value)
}

// Poll astro-cli env list until a machine matching the instance hostname appears.
async function waitForRunner(config: Config): Promise<void> {
  const { instance, astroServerUrl, waitTimeoutSec } = config
  const deadline = Date.now() + waitTimeoutSec * 1000
  const pollMs = 10_000

  process.stderr.write(`Waiting up to ${waitTimeoutSec}s for runner "${instance}" to appear in ${astroServerUrl} ...\n`)

  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync(
        'bash',
        ['-lc', `astro-cli --server-url ${shellEscape(astroServerUrl)} --json env list`],
        { timeout: 15_000 },
      )

      let machines: Array<{ hostname?: string; name?: string; connected?: boolean; isConnected?: boolean }> = []
      try {
        machines = JSON.parse(stdout.trim())
      } catch {
        // not valid JSON yet
      }

      const found = machines.find(
        (m) =>
          (m.connected === true || m.isConnected === true) &&
          ((m.hostname ?? '').includes(instance) || (m.name ?? '').includes(instance)),
      )

      if (found) {
        process.stdout.write(`Runner found and connected: ${JSON.stringify(found, null, 2)}\n`)
        return
      }

      process.stderr.write(`  Not connected yet (${machines.length} machine(s) visible). Retrying in ${pollMs / 1000}s...\n`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`  astro-cli error: ${msg}. Retrying in ${pollMs / 1000}s...\n`)
    }

    await new Promise((r) => setTimeout(r, pollMs))
  }

  throw new Error(`Timed out after ${waitTimeoutSec}s — runner "${instance}" did not appear.`)
}

// Print (and optionally run) cleanup commands.
async function runCleanup(config: Config, execute: boolean): Promise<void> {
  const { projectId, zone, instance, bucket } = config

  if (!projectId || !zone || !instance || !bucket) {
    throw new Error('cleanup requires --project, --zone, --instance, and --bucket')
  }

  // `storage rm --recursive` removes objects AND the bucket itself.
  const commands = [
    ['gcloud', 'compute', 'instances', 'delete', instance, '--zone', zone, '--project', projectId, '--quiet'],
    ['gcloud', 'storage', 'rm', '--recursive', `gs://${bucket}`],
  ]

  for (const cmd of commands) {
    const line = cmd.join(' ')
    if (execute) {
      process.stderr.write(`Running: ${line}\n`)
      await new Promise<void>((resolve, reject) => {
        const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' })
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}: ${line}`))))
      })
    } else {
      process.stdout.write(`${line}\n`)
    }
  }

  if (!execute) {
    process.stderr.write('\nRe-run with --execute to run the commands above.\n')
  }
}

async function run(): Promise<void> {
  const { command, config } = parseArgs(process.argv.slice(2))

  // Commands that don't need gcloud detection
  if (command === 'wait') {
    await waitForRunner(config)
    return
  }

  if (command === 'cleanup') {
    const execute = process.argv.includes('--execute')
    await runCleanup(config, execute)
    return
  }

  const gcloudInstalled = await detectCommand('gcloud')
  const gsutilInstalled = await detectCommand('gsutil')
  const activeProject = gcloudInstalled ? await detectGcloudProject() : ''
  const activeAccount = gcloudInstalled ? await detectGcloudAccount() : ''

  const resolved: Config = {
    ...config,
    projectId: config.projectId || activeProject,
  }

  if (command === 'check') {
    process.stdout.write(`${JSON.stringify({
      gcloudInstalled,
      gsutilInstalled,
      activeProject,
      activeAccount,
      recommendedRegion: 'us-central1',
      recommendedMachineType: 'e2-micro',
      recommendedMode: 'binary (fastest: curl prebuilt binary, ~30-60s, no runtime needed)',
    }, null, 2)}\n`)
    return
  }

  // prepare
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runRoot = join(resolved.outDir, stamp)
  const fixturesRoot = join(runRoot, 'fixtures')
  const startupScriptPath = join(runRoot, 'startup-script.sh')
  const dispatchDir = join(runRoot, 'dispatch')

  await writeFixtures(fixturesRoot)

  const startupScript =
    resolved.mode === 'binary' ? renderBinaryStartupScript(resolved) :
    resolved.mode === 'docker' ? renderDockerStartupScript(resolved) :
    renderNpmStartupScript(resolved)
  await writeText(startupScriptPath, startupScript)

  if (resolved.mode === 'docker') {
    await writeText(join(runRoot, 'Dockerfile'), renderDockerfile())
    await writeText(join(runRoot, 'docker-build-push.sh'), renderDockerBuildScript(resolved.dockerImage))
    await execFileAsync('chmod', ['+x', join(runRoot, 'docker-build-push.sh')])
  }

  const examples = renderDispatchExamples(resolved)
  await writeText(join(dispatchDir, 'streaming-zarr.json'), `${JSON.stringify(examples.streaming, null, 2)}\n`)
  await writeText(join(dispatchDir, 'staged-readwrite.json'), `${JSON.stringify(examples.staged, null, 2)}\n`)
  await writeText(join(runRoot, 'PLAN.txt'), `${renderPlan(resolved, startupScriptPath, fixturesRoot)}\n`)

  process.stdout.write(`${JSON.stringify({
    gcloudInstalled,
    activeProject,
    activeAccount,
    mode: resolved.mode,
    runRoot,
    fixturesRoot,
    startupScriptPath,
    dispatchDir,
    nextStep: gcloudInstalled ? 'Run the commands in PLAN.txt' : 'Install gcloud first, then run the commands in PLAN.txt',
  }, null, 2)}\n`)
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
