# Astro Platform: Strategic Planning Overview

**Date:** 2026-03-01
**Scope:** Usecases branch analysis, server architecture review, commercialization roadmap

## Current State Summary

### Usecases Branch (astro/d0a0f1-d0a0f1)

The branch introduces a **Use Case Templates** system — a structured framework for reusable project patterns with 10 built-in templates. Key additions:

| Feature | Status | Key Commits |
|---------|--------|-------------|
| Template schema (TypeScript types) | Complete | 1f727ed |
| 10 built-in templates | Complete | d8e7bfa, fef3ef9, d9c3fa1 |
| Input parallelization (fan-out/fan-in) | Complete | 1e2327f |
| Template API (7 endpoints) | Complete | 0c8b8f8 |
| arXiv paper fetcher tool | Complete | 8166765 |
| Graph layout for parallel branches | Complete | 1e2327f |
| Template loader (YAML/MD + TS) | Complete | 347ad1f |
| Template validator | Complete | 347ad1f |
| Comprehensive tests (108+) | Complete | e512783, d9c3fa1 |

### Agent Runner (v0.1.32 on main)

Major updates since the branch diverged (44 commits):
- **Session resume** + proactive token refresh
- **SSH execution strategy** (auto-discovers ~/.ssh/config hosts)
- **Kubernetes exec strategy** (kubectl exec on pods)
- **Dispatch signature verification** (multi-key support)
- **Claude Code session discovery** (sessions_list_request)
- **HPC capability improvements** + task cleanup
- **PR delivery hard gate** + error propagation
- Docker strategy improvements

### Server Architecture

- **Dispatch engine**: Queue → provider selection → execution → result routing
- **Relay server**: WebSocket hub brokering platform ↔ agent runner communication
- **15 MCP tools** for agent self-modification of plans
- **Event hooks**: PR creation, merge queue, git pull, usage metrics, audit log, SSE, channel notifications
- **Skills system**: In-memory registry populated from relay messages + API

## Planning Documents Index

| Document | Focus Area |
|----------|------------|
| [01-GITHUB-WORKFLOWS-AND-CI.md](./01-GITHUB-WORKFLOWS-AND-CI.md) | GitHub Actions workflows, CI/CD improvements |
| [02-SKILLS-ARCHITECTURE.md](./02-SKILLS-ARCHITECTURE.md) | Skills system design, migration, creation |
| [03-COMPUTE-BACKENDS.md](./03-COMPUTE-BACKENDS.md) | Kubernetes, GCP, SkyPilot, cloud integration |
| [04-NEW-USE-CASES.md](./04-NEW-USE-CASES.md) | Petition letters, paper writing, paper reviews |
| [05-COMMERCIALIZATION-ROADMAP.md](./05-COMMERCIALIZATION-ROADMAP.md) | Enterprise readiness, smooth UX, customer acquisition |
| [06-PARALLEL-PROCESSING.md](./06-PARALLEL-PROCESSING.md) | Parallel execution analysis and improvements |
| [07-WORKFLOW-ENGINE.md](./07-WORKFLOW-ENGINE.md) | Internal workflow system design |
| [08-COMMUNITY-MARKETPLACE.md](./08-COMMUNITY-MARKETPLACE.md) | Plan sharing, starring, forking, comments, community |
| [09-TEMPLATE-UI-INTEGRATION.md](./09-TEMPLATE-UI-INTEGRATION.md) | Frontend template picker, parameter forms, plan-view button |
| [10-DEFAULT-SKILL-LOADING.md](./10-DEFAULT-SKILL-LOADING.md) | Builtin skills in agent-runner, auto-detection, context injection |
| [11-SKILLS-UI-AND-LIFECYCLE.md](./11-SKILLS-UI-AND-LIFECYCLE.md) | Skills UI, lifecycle, cross-machine sync, community sharing |
| [12-PROVIDER-ADOPTION-OPENCLAW-OPENCODE.md](./12-PROVIDER-ADOPTION-OPENCLAW-OPENCODE.md) | OpenClaw/OpenCode adoption, SDK integration, social media, observability, future providers |

## Skills Written

| Skill | Location | Status |
|-------|----------|--------|
| `kubernetes-workflow` | `skills-lib/skills/tools/kubernetes-workflow/SKILL.md` | Written |
| `skypilot-workflow` | `skills-lib/skills/tools/skypilot-workflow/SKILL.md` | Written |
| DSPy skills (3) | `skills-lib/skills/tools/dspy-*/SKILL.md` | Fixed attribution |

## Key Strategic Themes

1. **Skills as the Integration Layer** — Skills bridge the gap between generic AI agents and domain-specific workflows (K8s, GCP, SLURM, legal docs, research)
2. **Templates as the On-Ramp** — Use case templates lower the barrier for new users; each template is a self-contained "product"
3. **Compute Backend Abstraction** — The execution strategy pattern already supports Direct/SLURM/Docker/K8s; needs skills to teach agents HOW to use them
4. **Enterprise Readiness** — CI/CD, credential management, audit trails, reproducibility, and team features
5. **Community as the Flywheel** — Shared plans create network effects; a plan is a program in the LLM era; sharing plans is sharing intellectual property
