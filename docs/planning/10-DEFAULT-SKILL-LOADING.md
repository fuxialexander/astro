# Default Skill Loading in Agent Runner

## Problem

Currently, infrastructure skills (Kubernetes, SkyPilot, GitHub workflows) must be manually installed by users into `~/.claude/skills/`. This creates friction: the agent runner already detects K8s clusters and SLURM partitions, but the agent doesn't know HOW to use them effectively unless the skills are present.

## Current Skill Flow

```
~/.claude/skills/ + {workdir}/.claude/skills/
        ↓
scanSlashCommands() in start.ts (parses SKILL.md frontmatter)
        ↓
slash_commands_response → relay → server
        ↓
Skill injector builds XML prompt injection
        ↓
Agent receives skills in system prompt
```

## Current Context Injection Flow (HPC Pattern)

```
Startup: detectHpcCapability() → SlurmInfo
        ↓
Pass to ClaudeSdkAdapter as hpcCapability (pre-classified)
        ↓
First query: buildHpcContext(preclassifiedSlurm) → contextString
        ↓
Prepend to agent prompt: hpcContext.contextString + '\n\n---\n\n' + task.prompt
```

## Proposed Design: Builtin Skills as Context

### Option A: Embed Skills in Agent Runner (Recommended)

Bundle SKILL.md files directly into the agent-runner package, loaded alongside auto-detected infrastructure context.

**Directory structure:**

```
astro-agent/
├── src/
│   ├── builtin-skills/
│   │   ├── index.ts               # Registry of all builtin skills
│   │   ├── kubernetes-workflow.ts  # Embedded SKILL.md content
│   │   ├── skypilot-workflow.ts   # Embedded SKILL.md content
│   │   ├── github-workflow.ts     # Embedded SKILL.md content (already exists as doc)
│   │   └── slurm-workflow.ts      # Embedded SKILL.md content
│   └── lib/
│       └── skill-context.ts       # Builds skill context strings
```

**Implementation:**

```typescript
// src/builtin-skills/index.ts

export interface BuiltinSkill {
  id: string
  name: string
  description: string
  instructions: string          // Full SKILL.md content
  detectionStrategy: string     // Which execution strategy triggers this skill
  alwaysLoad?: boolean          // Load even without detection (e.g., github-workflow)
}

// Import from embedded strings (generated from SKILL.md at build time)
import { KUBERNETES_SKILL } from './kubernetes-workflow.js'
import { SKYPILOT_SKILL } from './skypilot-workflow.js'
import { GITHUB_SKILL } from './github-workflow.js'
import { SLURM_SKILL } from './slurm-workflow.js'

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    id: 'kubernetes-workflow',
    name: 'Kubernetes Workflow',
    description: 'Create pods, sync code, exec commands, manage deployments on K8s',
    instructions: KUBERNETES_SKILL,
    detectionStrategy: 'k8s-exec',    // Load when K8s is detected
  },
  {
    id: 'skypilot-workflow',
    name: 'SkyPilot Workflow',
    description: 'Launch and monitor SkyPilot jobs on cloud/K8s clusters',
    instructions: SKYPILOT_SKILL,
    detectionStrategy: 'skypilot',    // Load when sky CLI is detected
  },
  {
    id: 'github-workflow',
    name: 'GitHub Workflow',
    description: 'Git branching, PR creation, and GitHub Actions',
    instructions: GITHUB_SKILL,
    detectionStrategy: 'direct',       // Always load for direct execution
    alwaysLoad: true,
  },
  {
    id: 'slurm-workflow',
    name: 'SLURM HPC Workflow',
    description: 'Submit and manage SLURM batch jobs on HPC clusters',
    instructions: SLURM_SKILL,
    detectionStrategy: 'slurm',       // Load when SLURM is detected
  },
]
```

### Loading Logic

```typescript
// src/lib/skill-context.ts

import { BUILTIN_SKILLS, type BuiltinSkill } from '../builtin-skills/index.js'
import type { ExecutionStrategyInfo } from '../execution/types.js'

/**
 * Select builtin skills based on detected execution strategies.
 * Skills are loaded when their corresponding backend is detected.
 */
export function selectBuiltinSkills(
  detectedStrategies: ExecutionStrategyInfo[]
): BuiltinSkill[] {
  const detectedIds = new Set(detectedStrategies.filter(s => s.available).map(s => s.id))

  return BUILTIN_SKILLS.filter(skill => {
    if (skill.alwaysLoad) return true
    return detectedIds.has(skill.detectionStrategy)
  })
}

/**
 * Build context string from selected builtin skills.
 * Appends detected infrastructure details (cluster name, namespaces, etc.)
 */
export function buildSkillContext(
  skills: BuiltinSkill[],
  detectedStrategies: ExecutionStrategyInfo[]
): string {
  if (skills.length === 0) return ''

  const sections: string[] = []

  for (const skill of skills) {
    const strategy = detectedStrategies.find(s => s.id === skill.detectionStrategy)
    const metadata = strategy?.metadata ?? {}

    sections.push(`# ${skill.name}\n`)
    sections.push(skill.instructions)

    // Append auto-detected environment details
    if (skill.id === 'kubernetes-workflow' && metadata.currentContext) {
      sections.push(`\n## Your Cluster (Auto-Detected)\n`)
      sections.push(`- Context: \`${metadata.currentContext}\``)
      if (metadata.clusterUrl) sections.push(`- Cluster: \`${metadata.clusterUrl}\``)
      if (metadata.namespaces?.length) sections.push(`- Namespaces: ${metadata.namespaces.join(', ')}`)
      if (metadata.totalGPUs > 0) sections.push(`- Total GPUs: ${metadata.totalGPUs}`)
      if (metadata.totalNodes > 0) sections.push(`- Nodes: ${metadata.totalNodes}`)
    }

    if (skill.id === 'skypilot-workflow' && metadata.version) {
      sections.push(`\n## Your SkyPilot Environment (Auto-Detected)\n`)
      sections.push(`- SkyPilot version: ${metadata.version}`)
      if (metadata.clusters?.length) sections.push(`- Active clusters: ${metadata.clusters.join(', ')}`)
    }

    sections.push('\n---\n')
  }

  return sections.join('\n')
}
```

### Integration into Claude SDK Adapter

```typescript
// src/providers/claude-sdk-adapter.ts — additions

import { selectBuiltinSkills, buildSkillContext } from '../lib/skill-context.js'

class ClaudeSdkAdapter {
  private skillContext: string | undefined  // undefined = not built yet
  private detectedStrategies: ExecutionStrategyInfo[]

  constructor(options: {
    hpcCapability?: HpcCapability | null
    detectedStrategies?: ExecutionStrategyInfo[]
  }) {
    this.detectedStrategies = options.detectedStrategies ?? []
  }

  async query(task: TaskDispatch): Promise<void> {
    // Build skill context lazily on first query
    if (this.skillContext === undefined) {
      const skills = selectBuiltinSkills(this.detectedStrategies)
      this.skillContext = buildSkillContext(skills, this.detectedStrategies)
    }

    // Prepend skill context to prompt
    let effectivePrompt = task.prompt
    if (this.skillContext) {
      effectivePrompt = this.skillContext + '\n\n---\n\n' + effectivePrompt
    }
    if (this.hpcContext?.available) {
      effectivePrompt = this.hpcContext.contextString + '\n\n---\n\n' + effectivePrompt
    }

    // ... rest of query
  }
}
```

### Build-Time SKILL.md Embedding

To keep skills as readable SKILL.md files during development but embed them at build time:

```typescript
// scripts/embed-skills.ts (run before tsc)
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const SKILLS_DIR = join(__dirname, '../skills')
const OUTPUT_DIR = join(__dirname, '../src/builtin-skills')

for (const skillDir of readdirSync(SKILLS_DIR)) {
  const skillMd = readFileSync(join(SKILLS_DIR, skillDir, 'SKILL.md'), 'utf-8')
  // Strip YAML frontmatter, keep only body
  const body = skillMd.replace(/^---[\s\S]*?---\n/, '')
  writeFileSync(
    join(OUTPUT_DIR, `${skillDir}.ts`),
    `export const ${toConstName(skillDir)} = ${JSON.stringify(body)}\n`
  )
}
```

Or simpler: just import SKILL.md as a raw string using a TypeScript `declare module` for `.md` files.

### Reporting Builtin Skills to Relay

Extend `scanSlashCommands()` to include builtin skills:

```typescript
// src/commands/start.ts

function scanSlashCommands(workingDirectory?: string): SlashCommand[] {
  const userSkills = scanUserSkills(workingDirectory)  // existing logic
  const builtinSkills = selectBuiltinSkills(detectedStrategies).map(s => ({
    name: s.id,
    description: s.description,
    source: 'builtin' as const,
  }))

  // Merge: user skills override builtins with same name
  const merged = new Map<string, SlashCommand>()
  for (const skill of builtinSkills) merged.set(skill.name, skill)
  for (const skill of userSkills) merged.set(skill.name, skill)  // user wins

  return Array.from(merged.values())
}
```

## SkyPilot Detection

Currently there's no SkyPilot execution strategy. We need a lightweight detection:

```typescript
// src/lib/skypilot-detect.ts

export interface SkyPilotInfo {
  available: boolean
  version?: string
  activeClusters?: string[]
  activeJobs?: number
}

export async function detectSkyPilot(): Promise<SkyPilotInfo> {
  try {
    const { stdout } = await execAsync('sky --version', { timeout: 5000 })
    const version = stdout.trim()

    // Check for active clusters
    let activeClusters: string[] = []
    try {
      const { stdout: statusOut } = await execAsync('sky status --no-show-headers 2>/dev/null', { timeout: 10000 })
      activeClusters = statusOut.trim().split('\n').filter(Boolean).map(l => l.split(/\s+/)[0]).filter(Boolean)
    } catch { /* no clusters */ }

    return { available: true, version, activeClusters }
  } catch {
    return { available: false }
  }
}
```

Register in the execution strategy registry alongside existing strategies.

## What About User-Specific Details?

Infrastructure skills have a general recipe (how to create pods, launch jobs, etc.) but specific values differ across users, teams, and clusters. The skills themselves document what must be asked vs. what can be auto-detected.

### What Varies Per User/Cluster

| Parameter | Why It Varies | Skills That Need It |
|-----------|---------------|-------------------|
| **Namespace** | Teams have their own | K8s, SkyPilot |
| **PVC name** | Admin-provisioned, cluster-specific | K8s, SkyPilot |
| **Kueue queue** | Admin-configured per GPU tier | K8s, SkyPilot |
| **Container image** | Team/project-specific | K8s, SkyPilot |
| **Node selectors** | Hardware labels differ per cluster | K8s |
| **Number of nodes** | Model size, budget | K8s, SkyPilot |
| **GPU type + count** | Hardware availability, cost | K8s, SkyPilot |
| **API secrets** | User's own tokens | Both |
| **SkyPilot API endpoint** | Managed vs self-hosted | SkyPilot |

### What Can Be Auto-Detected

| Parameter | Detection Command | Reliability |
|-----------|-------------------|------------|
| K8s context | `kubectl config current-context` | High |
| Available namespaces | `kubectl get namespaces` | High |
| GPU types | `kubectl get nodes` + labels | High |
| Storage classes | `kubectl get storageclass` | High |
| Existing PVCs | `kubectl get pvc -A` | High |
| Kueue queues | `kubectl get localqueues -A` | Medium (Kueue may not be installed) |
| SkyPilot version | `sky --version` | High |
| Active clusters | `sky status` | High |

### Solution: Skill Config Overrides (Three Channels)

Users can provide cluster-specific defaults via three channels:

**1. `~/.astro/skills.json` (local file, agent-runner reads at startup)**

```json
{
  "kubernetes-workflow": {
    "defaultNamespace": "my-team",
    "pvcName": "csi-pvc-mounted",
    "kueueQueue": "skypilot-jobs-8-gpu",
    "containerImage": "my-registry/training:latest",
    "nodeSelector": {
      "skypilot.co/accelerator": "h100"
    },
    "defaultNumNodes": 4,
    "defaultNumGPUs": 8
  },
  "skypilot-workflow": {
    "defaultCloud": "kubernetes",
    "defaultAccelerators": "H100:8",
    "kueueQueue": "skypilot-jobs-8-gpu",
    "pvcName": "csi-pvc-mounted",
    "containerImage": "my-registry/training:latest",
    "skyApiEndpoint": "https://sky-api.example.com"
  }
}
```

**2. Astro Skills UI → Configuration tab (see doc 11)**

The Skills UI provides a JSON config editor per skill. When a user opens `kubernetes-workflow` in the Skills UI, the Configuration tab lets them set these overrides visually. Changes are persisted to the `skills.config` JSONB column in the database and synced to all machines via the `skills.sync` relay message.

**3. Chat-based editing (see doc 11)**

Users can edit skills via the chat interface: "Add information about my K8s cluster" → AI asks for namespace, PVC, queue → updates the skill instructions with cluster-specific values.

### Config Injection Flow

```typescript
function buildSkillContext(skills, strategies) {
  // ... existing logic ...

  // Load user config from ~/.astro/skills.json
  const userConfig = loadSkillConfig()

  for (const skill of skills) {
    const config = userConfig[skill.id]
    if (config) {
      sections.push(`\n## User Configuration (Auto-Applied)\n`)
      sections.push(`Use these as defaults instead of asking the user:\n`)
      for (const [key, value] of Object.entries(config)) {
        if (typeof value === 'object') {
          sections.push(`- ${key}: ${JSON.stringify(value)}`)
        } else {
          sections.push(`- ${key}: \`${value}\``)
        }
      }
    }
  }
}
```

### Multi-Node Job Considerations

Multi-node training is the most configuration-sensitive workflow. Key variables that differ per environment:

| Variable | Small Cluster | Large On-Prem | Cloud (AWS/GCP) |
|----------|--------------|---------------|-----------------|
| NCCL_TIMEOUT | 300 | 600 | 300 |
| Node selector | N/A | `nebius.com/resource-preset: 8gpu-128vcpu-1600gb` | `instance-type: p5.48xlarge` |
| PVC | `nfs-share` | `csi-pvc-mounted` | N/A (use S3/EBS) |
| Queue | `default` | `skypilot-jobs-8-gpu` | N/A |
| Shared memory | Required (`emptyDir: Memory`) | Required | Required |
| Security context | May not need privileged | `privileged: true` + capabilities | Varies |

The skills document these differences in their "User-Specific Configuration Guide" section.

## Priority and Effort

| Item | Priority | Effort |
|------|----------|--------|
| Embed K8s + SkyPilot skills in agent-runner | **Critical** | 2-3 days |
| Detection-based skill selection | **Critical** | 1 day |
| Context injection in ClaudeSdkAdapter | **High** | 1 day |
| SkyPilot detection | **High** | 1 day |
| User config overrides (~/.astro/skills.json) | **Medium** | 1 day |
| Report builtin skills to relay | **Medium** | 0.5 days |
| Build-time SKILL.md embedding | **Low** | 0.5 days |

**Total: ~1 week for full implementation**
