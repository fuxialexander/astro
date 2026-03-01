# Commercialization Roadmap: Enterprise Readiness

## Strategic Positioning

### Astro's Unique Value Proposition

1. **Planning Layer Above Execution** — No other tool provides AI-assisted decomposition of complex goals into actionable task graphs
2. **Distributed Execution** — Users keep their own API keys, credentials, and compute; Astro orchestrates
3. **Multi-Environment** — Same platform supports laptop, HPC, Kubernetes, cloud
4. **Agent-Agnostic** — Works with Claude, Codex, and others; not locked to one provider
5. **Human-in-the-Loop** — Approval gates, live steering, and strategic decisions kept with humans

### Target Enterprise Segments

| Segment | Pain Point | Astro Solution |
|---------|-----------|----------------|
| **AI/ML Teams** | Managing experiments across GPU clusters | Multi-env dispatch + K8s/SLURM support |
| **Platform Engineering** | Standardizing AI-assisted development workflows | Templates + skills + GitHub integration |
| **Immigration Law Firms** | Manual petition letter drafting | Immigration petition templates |
| **Research Labs** | Coordinating analyses across compute environments | Plan graph + multi-machine execution |
| **Enterprise Dev Teams** | Governing AI agent behavior | Approval system + audit trails + RLS |

## Smooth User Experience: Critical Path

### Current UX Gaps

1. **Onboarding friction**: Setup requires understanding relay, agent runner, API keys
2. **No template selector**: Users start with blank project, must describe everything
3. **Limited feedback**: Agent execution progress not granular enough
4. **No results dashboard**: Can't see aggregated outcomes across tasks
5. **Missing credential management**: Each machine configured separately

### UX Improvements for Commercialization

#### 1. Zero-to-Value in 5 Minutes (Priority: Critical)

```
1. npm install -g @astroanywhere/agent
2. astro-agent setup              # Auto-detects Claude API key
3. Open http://localhost:5173      # Local mode, no auth needed
4. Pick a template                 # "H-1B Petition Letter"
5. Fill parameters                 # Name, job title, company...
6. Click "Generate Plan"           # AI creates task graph
7. Click "Run All"                 # Agent executes tasks
8. Download results                # PDF/Markdown output
```

**Changes needed:**
- Template selector in New Project flow (frontend)
- "Run All" button for auto-dispatch of ready tasks
- Download/export results feature
- Guided onboarding tour

#### 2. Template Marketplace (Priority: High)

A first-class UI for browsing and launching templates:

```
/templates                     # Browse by category
/templates/:id                 # Template detail + launch form
/templates/:id/launch          # Parameter form → project creation
```

Features:
- Category filtering
- Search
- "Use this template" button
- Parameter form auto-generated from template schema
- Preview of what plan will look like
- Recently used templates

#### 3. Results Dashboard (Priority: High)

Address the "data gap" identified in FAI comparison:

```
/project/:id/results           # Aggregated task outputs
```

Features:
- Structured results from completed tasks
- Export to CSV/JSON
- Summary statistics
- Before/after comparisons
- Output preview per task

#### 4. Team Onboarding Flow (Priority: Medium)

For enterprise teams:

```
1. Admin creates team in Astro
2. Admin invites members (email)
3. Members install agent-runner on their machines
4. Machines auto-register via device auth flow
5. Team dashboard shows all machines + active tasks
```

### Enterprise Features Roadmap

#### Quarter 1: Foundation

| Feature | Description | Status |
|---------|-------------|--------|
| Template system | Use case templates with parameters | **Done** (this branch) |
| CI/CD workflows | GitHub Actions for lint, test, security | Disabled → re-enable |
| Team management | Multi-user with invitations | **Done** |
| RLS (Row-Level Security) | Data isolation between teams | **Done** |
| Audit logging | Event tracking for compliance | **Done** |
| Device auth | OAuth2 device code for machines | **Done** |

#### Quarter 2: Enterprise Polish

| Feature | Description | Priority |
|---------|-------------|----------|
| Template marketplace UI | Browse and launch templates | Critical |
| Results dashboard | Structured output viewing | High |
| Credential management | Centralized, encrypted key store | High |
| SSO integration | SAML/OIDC for enterprise auth | High |
| Usage analytics | Cost tracking per team/project | Medium |
| Rate limiting | Per-user/team quotas | Medium |

#### Quarter 3: Scale

| Feature | Description | Priority |
|---------|-------------|----------|
| Cloud marketplace listing | AWS/GCP/Azure marketplace | High |
| Managed offering | Hosted Astro for teams | High |
| Skill marketplace | Community skill contributions | Medium |
| Workflow versioning | Pin template + skill versions | Medium |
| Compliance reporting | SOC 2, GDPR, HIPAA dashboards | Medium |

#### Quarter 4: Advanced

| Feature | Description | Priority |
|---------|-------------|----------|
| Multi-tenant SaaS | Full SaaS with billing | High |
| Custom LLM integration | On-prem model support | Medium |
| Data pipeline integration | Connect to enterprise data sources | Medium |
| Advanced analytics | Model performance, cost optimization | Low |

## Competitive Differentiation vs FAI

### What to Adopt from FAI

1. **Structured results storage** — Add a `task_results` table with typed schemas
2. **Version pinning** — Templates specify model, prompts, temperature
3. **More CI/CD workflows** — 20 workflows vs our 1; need at minimum 8
4. **Observability** — Prometheus/Langfuse integration for enterprise monitoring
5. **AI-assisted PR reviews** — Claude Code reviewing PRs automatically

### What to Keep Uniquely Astro

1. **Dynamic plan generation** — FAI's fixed graphs can't adapt; Astro's can
2. **Agent autonomy** — Self-modifying plans via MCP tools
3. **Distributed execution** — Users own their compute and keys
4. **Multi-provider** — Not locked to one AI provider
5. **Human-in-the-loop** — Strategic decisions stay with humans

## Pricing Model Considerations

### Freemium (Recommended for Growth)

| Tier | Features | Price |
|------|----------|-------|
| **Free** | Local mode, 3 templates, 1 user | $0 |
| **Pro** | All templates, team (5 users), cloud backends | $49/user/month |
| **Enterprise** | SSO, audit, compliance, custom templates, unlimited | Custom |

### Revenue Streams

1. **SaaS subscriptions** — Hosted Astro with team features
2. **Template marketplace** — Premium templates (immigration, compliance, etc.)
3. **Enterprise licenses** — On-prem deployment with support
4. **Compute markup** — Managed cloud execution (optional)

## Demo Script for Enterprise Customers

### 5-Minute Demo: "H-1B Petition Letter in Astro"

1. **Open Astro** → Template selector → "Immigration Petition"
2. **Fill form** → Beneficiary name, job title, company profile
3. **Generate plan** → Show the AI creating 8 interconnected tasks
4. **Highlight features**:
   - Parallel branches for independent analyses
   - Dependency tracking (wage analysis depends on job classification)
   - Approval gates (lawyer reviews draft before finalization)
5. **Run a task** → Show agent drafting specialty occupation analysis
6. **Show results** → Structured output with legal citations
7. **Export** → Download complete petition package

### Key Talking Points

- "Every task has full audit trail — when it ran, what model, what cost"
- "Approval gates keep humans in control of strategic decisions"
- "Your API keys stay on your machines — we never see them"
- "Same platform works for one lawyer or a team of 50"
- "Templates are version-controlled and reproducible"
