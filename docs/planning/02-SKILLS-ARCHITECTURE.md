# Skills Architecture: Design, Migration, and Cloud Integration

## Current Skills Infrastructure

### Three Skill Systems

**1. Claude Code Skills (SKILL.md files)**
- Location: `~/.claude/skills/` or `{project}/.claude/skills/`
- Format: YAML frontmatter + Markdown instructions
- Discovery: Auto-detected by Claude Code CLI
- Agent runner reports these via `slash_commands_response` WebSocket message

**2. Astro Server Skills (In-Memory Registry)**
- Location: `server/lib/skill-manager.ts`
- Format: `OpenClawSkill` interface (name, description, instructions, source, enabled)
- Registration: Via relay messages, API calls, or plugin contributions
- Injection: `server/lib/skill-injector.ts` builds XML prompt injection

**3. skills-lib (Curated Collection)**
- Location: `/Users/zhuoran_cisco/Documents/agent_tools/skills-lib`
- Format: SKILL.md with validation (format, security, syntax, links)
- Current skills: 4 (skill-onboarder, dspy-react-agent-builder, dspy-signature-designer, dspy-rag-pipeline)
- Categories: tools, prompts, daily, research

### How Skills Get to the Agent

```
skills-lib/skills/ → copy to → ~/.claude/skills/ or .claude/skills/
                                         ↓
                              Claude Code detects on startup
                                         ↓
                              Agent runner reports to relay
                                         ↓
                              Astro server registers in memory
                                         ↓
                              Skill injector adds to prompts
```

## Skill Migration: How to Import External Skills

### From Online Sources → skills-lib → Astro

The `skill-onboarder` skill in skills-lib handles the 8-phase import process:

1. **Acquire** — Download from GitHub or copy directory
2. **Validate** — Run format, security, syntax, link tests
3. **Fix Format** — Add/fix YAML frontmatter and required sections
4. **Triage Security** — Distinguish real threats from false positives
5. **Fix Links** — Resolve broken cross-references
6. **Write Cookbook** — Document usage with examples
7. **Final Validation** — Full test suite pass
8. **Document** — Update `marketplace.json` with source attribution

### From skills-lib → Agent Runner

```bash
# Option A: Copy individual skill
cp -r skills-lib/skills/tools/my-skill/ ~/.claude/skills/

# Option B: Symlink entire skills-lib
ln -s /path/to/skills-lib/skills/* ~/.claude/skills/

# Option C: Git submodule in project
git submodule add https://github.com/astro-anywhere/skills-lib .claude/skills-lib
```

### From SKILL.md → Use Case Template

Skills and templates serve different purposes but can reference each other:

| Aspect | SKILL.md | UseCaseTemplate |
|--------|----------|-----------------|
| Purpose | How to do X (instructions) | Create project for X (full workflow) |
| Scope | Single capability | Multi-step project plan |
| Format | Markdown with YAML frontmatter | TypeScript or TEMPLATE.md |
| Usage | Agent reads and follows | Server generates plan graph |
| Integration | `execution.skills` field in template references skills |

## Proposed Cloud Infrastructure Skills

### 1. Kubernetes Skills (Priority: High)

Based on patterns from `post-training-skypilot`, create skills that teach agents:

**kubernetes-pod-management/SKILL.md**
```yaml
---
name: kubernetes-pod-management
version: "1.0.0"
description: "Use when agent needs to create, manage, or execute commands on Kubernetes pods"
category: tools
allowed-tools: [Bash, Read, Write]
tags: [kubernetes, k8s, devops, cloud]
---
```

Key instructions to include:
- Pod creation from YAML specs
- `kubectl exec` for running commands
- `kubectl cp` for copying code to pods
- PVC mounting for persistent storage
- Kubernetes secrets for credentials
- Resource requests/limits (CPU, memory, GPU)
- Node selectors and label-based scheduling
- Kueue queue integration (`kueue.x-k8s.io/queue-name`)
- Health checks (readinessProbe, livenessProbe)

**kubernetes-service-deployment/SKILL.md**
- Service creation (ClusterIP, NodePort, LoadBalancer)
- Deployment management (replicas, rolling updates)
- DNS discovery (`{svc}.{ns}.svc.cluster.local`)
- ConfigMaps and environment injection

**kubernetes-gpu-training/SKILL.md**
- GPU resource requests (`nvidia.com/gpu`)
- Multi-node training coordination (Ray cluster pattern)
- Environment variables: `MASTER_ADDR`, `NODE_RANK`, `NNODES`
- NCCL configuration for GPU communication
- Privileged security context for IPC_LOCK

### 2. SkyPilot Skills (Priority: High)

**skypilot-launcher/SKILL.md**
Based on the launcher YAML patterns in post-training-skypilot:
- YAML resource specification (cloud, accelerators, image_id, labels)
- File mounts (local → container)
- Multi-node setup (SKYPILOT_NODE_IPS, SKYPILOT_NODE_RANK)
- Job recovery (max_restarts_on_errors)
- Secret passing (`--secret`, `--env`)
- Port exposure for dashboards

**skypilot-data-prep/SKILL.md**
- Launch CPU-only pods for data preparation
- kubectl cp for script deployment
- PVC-based data sharing between pods
- HuggingFace token management via K8s secrets

### 3. GCP Skills (Priority: Medium)

**gcp-compute/SKILL.md**
- GCE instance creation and management
- GPU VM provisioning
- Persistent disk management
- IAM and service account setup

**gcp-gke/SKILL.md**
- GKE cluster creation
- Node pool management (GPU node pools)
- Autopilot vs Standard mode
- Workload Identity for secure access

### 4. GitHub Workflow Skills (Priority: Medium)

**github-actions-authoring/SKILL.md**
- Workflow YAML structure and syntax
- Common action patterns (checkout, setup-node, cache)
- Matrix builds for multi-version testing
- Secret management
- Artifact upload/download
- Reusable workflows and composite actions

### 5. AWS Skills (Priority: Medium)

**aws-ec2-training/SKILL.md**
- EC2 instance management (P4d, P5 for GPU)
- EBS volume management
- S3 data staging
- SageMaker integration

## Implementation Plan

### Phase 1: Write Core Cloud Skills (Week 1-2)

Create 5 essential skills in skills-lib:

```
skills-lib/skills/tools/
├── kubernetes-pod-management/SKILL.md
├── kubernetes-gpu-training/SKILL.md
├── skypilot-launcher/SKILL.md
├── gcp-compute/SKILL.md
└── github-actions-authoring/SKILL.md
```

Each skill includes:
- Concrete code examples from post-training-skypilot
- Common pitfalls and solutions
- Security best practices
- Integration patterns with Astro

### Phase 2: Default Skill Loading (Week 2-3)

Modify agent runner to auto-load infrastructure skills:

```typescript
// src/lib/default-skills.ts
const DEFAULT_SKILLS = [
  'kubernetes-pod-management',
  'kubernetes-gpu-training',
  'skypilot-launcher',
  'github-actions-authoring',
];

// During task execution, if K8s is detected:
if (executionStrategy === 'k8s-exec') {
  skills.push('kubernetes-pod-management');
  skills.push('kubernetes-gpu-training');
}
```

### Phase 3: Skills Registry (Week 3-4)

Build a skills marketplace in the Astro UI:
- Browse skills by category
- One-click install to agent runner
- Version tracking and updates
- Community submissions

### Phase 4: Template-Skill Integration (Week 4-5)

Templates reference skills in their `execution.skills` field:

```typescript
{
  execution: {
    skills: ['kubernetes-pod-management', 'skypilot-launcher'],
    // Agent runner auto-loads these skills when running template tasks
  }
}
```

## Where to Put Skills

### Decision Matrix

| Audience | Location | Rationale |
|----------|----------|-----------|
| All Astro users | skills-lib (public repo) | Shared, validated, versioned |
| Project-specific | `.claude/skills/` in project repo | Scoped to project context |
| Organization | Astro server skill registry | Managed centrally, deployed to agents |
| Personal | `~/.claude/skills/` | User's machine only |

### Recommended Architecture

```
skills-lib/                     # Public curated collection
├── skills/tools/               # Cloud/infrastructure skills
├── skills/research/            # Research workflow skills
└── skills/daily/               # Productivity skills

astro (server)
├── server/lib/skill-manager.ts # Registry (already exists)
└── Built-in skill loading      # Auto-load based on detected backends

astro-agent (runner)
├── Default skill bundling      # Ship with essential skills
└── Skill discovery from relay  # Learn skills from server
```
