import { MarkdownRenderer } from "@/components/ui/markdown-renderer"

const workflowGuideContent = `# Workflow Guide

Welcome to Astro! This guide explains how to use Astro effectively across different working modes and use cases.

## Working Modes

Astro supports two primary working modes, each optimized for different scenarios:

### 1. Sandbox Mode (Isolated Experimentation)

**What it is:** Sandbox mode creates an isolated copy of your working directory in \`~/.astro/sandbox/<taskId>/\`. The AI agent works on this copy, leaving your original files completely untouched.

**When to use:**
- 🧪 **Experimentation**: Testing risky changes or exploring different approaches
- 📚 **Learning**: Trying out new patterns or technologies without risk
- 🎯 **Uncertain tasks**: When you're not sure if the agent's approach will work
- 📦 **Non-git directories**: Safe way to work without version control

**How it works:**
\`\`\`
Original Directory → Copy to Sandbox → Agent Executes → Review Changes → Apply or Discard
\`\`\`

**To enable:**
\`\`\`bash
# In agent runner CLI:
npx @astro/agent start --sandbox

# Or: Select "Use sandbox mode" when prompted for risky operations
\`\`\`

**Benefits:**
- ✅ Zero risk to original files
- ✅ Full review before applying changes
- ✅ Safe for non-git directories
- ✅ Experiment freely

**Limitations:**
- ⏱️ Slower (requires copying files)
- 💾 Limited by \`--max-sandbox-size\` (default: 100MB)
- 🚫 Excluded directories: \`node_modules\`, \`.git\`, \`venv\`, \`build\`, \`dist\`, etc.

---

### 2. Direct Execution Mode (Version-Controlled Workflow)

**What it is:** The agent executes directly in your working directory (or in a git worktree for parallel tasks).

**When to use:**
- 🚀 **Production work**: Building real features on version-controlled code
- ⚡ **Speed**: No copying overhead, immediate execution
- 🔄 **Git workflows**: Automatic branch creation, PR integration
- 🤝 **Collaboration**: Direct integration with team workflows

**How it works:**

**With Git:**
\`\`\`
Working Directory → Create Worktree/Branch → Execute → Review → Merge/PR
\`\`\`

**Without Git:**
\`\`\`
Working Directory → Execute Directly → No Rollback (⚠️ RISKY)
\`\`\`

**Safety Tiers:**

| Tier | Condition | Behavior |
|------|-----------|----------|
| **SAFE** ✅ | Git repo, clean state | Execute immediately |
| **GUARDED** ⚠️ | Git repo, uncommitted changes | Warn, then execute |
| **RISKY** ⚠️⚠️ | Non-git directory, single task | Prompt user for decision |
| **UNSAFE** 🛑 | Non-git directory, parallel tasks | Block execution |

---

## Git Workflow vs Non-Git Workflow

### Git Workflow (Recommended)

**Advantages:**
- ✅ Version control: All changes tracked and revertible
- ✅ Parallel execution: Multiple tasks via worktrees/branches
- ✅ Code review: Automatic PR creation
- ✅ Collaboration: Team integration via GitHub/GitLab
- ✅ Safety: Easy rollback with \`git reset\`

**Setup:**
\`\`\`bash
# Initialize git in your project:
git init
git add .
git commit -m "Initial commit"

# Now all tasks run in SAFE tier
\`\`\`

**Best practices:**
1. **Commit before running tasks** - keeps working tree clean (SAFE tier)
2. **Review diffs after completion** - \`git diff\` or \`git log -p\`
3. **Use branches strategically** - Astro creates branches automatically per task
4. **Create PRs for review** - leverage team code review processes

---

### Non-Git Workflow

**When to use:**
- 📝 Scratch work or temporary files
- 🎨 Creative projects (art, music, documents)
- 📊 Data analysis on non-code files
- 🧹 One-off tasks that don't need version control

**Safety requirements:**
- ⚠️ **Single task only** - parallel execution blocked to prevent conflicts
- 💡 **Consider sandbox mode** - protects original files
- 🔧 **Or initialize git** - converts to SAFE workflow

**User prompt (RISKY tier):**

When running tasks in a non-git directory, you'll see:
\`\`\`
⚠️  NO GIT REPOSITORY DETECTED

AI agents may modify or delete files without version control.

Options:
1. Continue anyway (risky) - Execute directly, no rollback
2. Initialize git first (safe) - Run git init, then execute
3. Use sandbox mode (isolated) - Work on a copy
4. Cancel task
\`\`\`

---

## Use Cases & Examples

### Use Case 1: Paper Writing with Overleaf Integration

**Scenario:** You're writing a research paper in LaTeX, collaborating via Overleaf, and need AI assistance with content, formatting, and citations.

**Recommended mode:** Git workflow + direct execution

**Setup:**
\`\`\`bash
# Clone your Overleaf project (via GitHub integration):
git clone https://github.com/your-org/paper-project.git
cd paper-project

# Commit before making changes:
git add . && git commit -m "Draft before AI edits"
\`\`\`

**Workflow:**
1. Create Astro project linked to your LaTeX directory
2. Describe tasks: "Expand the methods section with more detail on the statistical analysis"
3. Agent creates branch, makes edits, commits changes
4. Review diff: \`git diff main\`
5. If satisfied: \`git merge <branch>\` and \`git push\` → syncs to Overleaf
6. If not: \`git checkout main\` → discard changes

**Why this works:**
- ✅ Overleaf syncs via GitHub automatically
- ✅ Full version control for collaborative writing
- ✅ Easy rollback if AI makes mistakes
- ✅ Track writing progress over time

---

### Use Case 2: Data Analysis Workflow

**Scenario:** Analyzing datasets, generating visualizations, running statistical tests across multiple compute environments (laptop, HPC cluster, cloud).

**Recommended mode:** Git workflow for code + results, direct execution

**Setup:**
\`\`\`bash
# Initialize git for your analysis scripts:
mkdir analysis-project && cd analysis-project
git init

# Add data to .gitignore (large files):
echo "data/raw/*.csv" >> .gitignore
echo "data/processed/*.parquet" >> .gitignore

# Track scripts and results:
git add scripts/ notebooks/ results/
git commit -m "Initial analysis setup"
\`\`\`

**Workflow:**
1. Create Astro project: "Analyze customer churn dataset"
2. Define tasks:
   - "Load and clean data" (local machine)
   - "Run regression models" (HPC cluster via SLURM)
   - "Generate visualizations" (local machine)
   - "Write summary report" (local machine)
3. Astro dispatches tasks to appropriate environments
4. Each task creates a branch, commits results
5. Review outputs, merge successful analyses

**Multi-environment dispatch:**
\`\`\`
Task A (data cleaning)     → Local machine (fast, small data)
Task B (heavy computation)  → HPC cluster (SLURM job)
Task C (visualization)      → Local machine (needs GUI)
Task D (cloud API calls)    → AWS/GCP instance
\`\`\`

**Why this works:**
- ✅ Reproducible analysis (scripts version-controlled)
- ✅ Parallel execution across machines
- ✅ Track analysis decisions and iterations
- ✅ Share results with collaborators via git

---

### Use Case 3: Version-Controlled Collaborative Projects

**Scenario:** Building a web application with a team, using GitHub for collaboration, CI/CD for testing.

**Recommended mode:** Git workflow + PR integration

**Setup:**
\`\`\`bash
# Clone your team repo:
git clone https://github.com/team/webapp.git
cd webapp

# Keep main branch clean:
git checkout -b astro-development
\`\`\`

**Workflow:**
1. Create Astro project linked to repo
2. Break down features into tasks (AI-generated plan)
3. Each task → separate branch + PR
4. Agent creates code, runs tests, opens PR
5. Team reviews PR, CI runs checks
6. Merge approved PRs to main

**Example plan structure:**
\`\`\`
Project: Add user authentication
├─ Task 1: Set up auth database schema (branch: auth/db-schema)
├─ Task 2: Create login/signup UI (branch: auth/ui, depends on Task 1)
├─ Task 3: Implement JWT tokens (branch: auth/jwt, depends on Task 1)
└─ Task 4: Add password reset flow (branch: auth/reset, depends on Task 2,3)
\`\`\`

**Why this works:**
- ✅ Automated PR creation
- ✅ CI/CD integration (tests run on each PR)
- ✅ Code review by team before merge
- ✅ Dependency tracking ensures correct order

---

## Architecture Diagram: Dispatch-Workspace System

Below is how Astro routes tasks to different execution environments:

\`\`\`
┌─────────────────────────────────────────────────────────────┐
│                      Astro Platform                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          Plan Graph (Directed Graph)                 │   │
│  │                                                       │   │
│  │  ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐      │   │
│  │  │Task 1│───▶│Task 2│───▶│Task 3│───▶│Task 5│      │   │
│  │  └──────┘    └──────┘    └──┬───┘    └──────┘      │   │
│  │                              │                        │   │
│  │                              ▼                        │   │
│  │                           ┌──────┐                   │   │
│  │                           │Task 4│                   │   │
│  │                           └──────┘                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          Dispatch Engine                             │   │
│  │  • Dependency resolution                             │   │
│  │  • Environment selection                             │   │
│  │  • Safety checks (git, sandbox, parallel)           │   │
│  │  • Context assembly (vision doc + dependencies)     │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────┐    │
│  │          Relay Server (WebSocket Hub)               │    │
│  │  • Machine registry                                 │    │
│  │  • Task routing                                     │    │
│  │  • Real-time events                                 │    │
│  └────────────────────────────────────────────────────┘    │
└──────────────────────┬───────────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┬────────────────┐
       │               │               │                │
       ▼               ▼               ▼                ▼
┌─────────────┐ ┌─────────────┐ ┌──────────────┐ ┌──────────┐
│   Local     │ │ HPC Cluster │ │  AWS/GCP     │ │  Cloud   │
│   Machine   │ │   (SLURM)   │ │  Instance    │ │  Runner  │
├─────────────┤ ├─────────────┤ ├──────────────┤ ├──────────┤
│ Agent       │ │ Agent       │ │ Agent        │ │ Agent    │
│ Runner      │ │ Runner      │ │ Runner       │ │ Runner   │
│             │ │             │ │              │ │          │
│ Working Dir │ │ Working Dir │ │ Working Dir  │ │ Sandbox  │
│ (Git/Raw)   │ │ (Git/Raw)   │ │ (Git/Raw)    │ │ Mode     │
└─────────────┘ └─────────────┘ └──────────────┘ └──────────┘
      │                │                │               │
      ▼                ▼                ▼               ▼
 ┌─────────┐      ┌─────────┐     ┌─────────┐    ┌─────────┐
 │ Results │      │ Results │     │ Results │    │ Results │
 │ (Git    │      │ (Git    │     │ (Git    │    │ (Review │
 │  Commit)│      │  Commit)│     │  Commit)│    │  Needed)│
 └─────────┘      └─────────┘     └─────────┘    └─────────┘
       │                │                │               │
       └────────────────┴────────────────┴───────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │   Astro Platform       │
              │   (Results Routing)    │
              │                        │
              │  • Update plan status  │
              │  • Unblock dependents  │
              │  • Trigger approvals   │
              │  • Notify user         │
              └────────────────────────┘
\`\`\`

**Key components:**

1. **Plan Graph**: Directed acyclic graph (DAG) of tasks with explicit dependencies
2. **Dispatch Engine**: Routes tasks to appropriate environments based on:
   - Task requirements (CPU, GPU, memory)
   - Machine availability
   - Cost optimization
3. **Relay Server**: WebSocket hub connecting platform to agent runners
4. **Agent Runners**: Lightweight processes on each machine (local, HPC, cloud)
5. **Working Directories**: Where agents execute (git repo, sandbox, or raw directory)
6. **Results Routing**: Outputs flow back to platform, update plan, unblock next tasks

---

## Best Practices

### ✅ Do's

1. **Always use git for production work** - version control prevents data loss
2. **Commit before running tasks** - keeps working tree clean (SAFE tier)
3. **Use sandbox for experiments** - test risky changes without risk
4. **Review outputs before merging** - \`git diff\` or PR review
5. **Break down complex goals** - smaller tasks = easier review
6. **Set clear vision docs** - project context improves AI planning

### ❌ Don'ts

1. **Don't run parallel tasks in non-git dirs** - file conflicts guaranteed
2. **Don't skip safety prompts in automation** - use \`--allow-non-git\` carefully
3. **Don't ignore uncommitted changes** - commit or stash before tasks
4. **Don't assume AI is always right** - review, test, validate
5. **Don't forget to set .gitignore** - exclude large data files, build artifacts

---

## Troubleshooting

### "Directory too large for sandbox"

**Problem:** Directory size exceeds sandbox limit (default: 100MB)

**Solution:**
\`\`\`bash
npx @astro/agent start --sandbox --max-sandbox-size 500
\`\`\`

Or: Use git workflow instead (no size limit)

---

### "Parallel execution blocked"

**Problem:** Trying to run multiple tasks in same non-git directory

**Solutions:**
1. **Wait** - let first task finish
2. **Initialize git** - \`git init && git add . && git commit -m "Initial"\`
3. **Use different directories** - separate working dirs per task
4. **Enable sandbox mode** - each task gets isolated copy

---

### "Git not available"

**Problem:** Git not installed on machine

**Solution:**
\`\`\`bash
# macOS:
brew install git

# Ubuntu/Debian:
sudo apt install git

# Windows:
# Download from https://git-scm.com/
\`\`\`

---

## Quick Decision Guide

**"Which mode should I use?"**

\`\`\`
Is this production work?
├─ Yes → Use Git Workflow
│  ├─ Have git repo? → ✅ Direct execution
│  └─ No git repo? → Initialize git first
│
└─ No → Is this an experiment or risky change?
   ├─ Yes → 📦 Use Sandbox Mode
   └─ No → Use Git Workflow (safest)
\`\`\`

**"Is my directory safe?"**

\`\`\`
Is it a git repo?
├─ Yes → Clean state?
│  ├─ Yes → ✅ SAFE (execute immediately)
│  └─ No → ⚠️ GUARDED (commit first recommended)
│
└─ No → Other tasks running here?
   ├─ Yes → 🛑 UNSAFE (blocked)
   └─ No → ⚠️⚠️ RISKY (user prompt)
      ├─ Initialize git → becomes SAFE
      ├─ Use sandbox → becomes SAFE
      └─ Continue anyway → at your own risk
\`\`\`

---

## Summary

Astro gives you flexibility to work however you need:

- **Sandbox mode** for safe experimentation
- **Git workflow** for production and collaboration
- **Multi-environment dispatch** for complex projects
- **Safety guardrails** to prevent data loss

Start with git + direct execution for most work. Use sandbox when experimenting. Scale across environments as needed.

**Ready to get started?** Create your first project and let AI help you plan! 🚀
`

export function Workflows() {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6">
          <h1 className="font-primary text-[28px] font-semibold mb-2">Workflow Guide</h1>
          <p className="text-sm text-muted-foreground">
            Learn how to use Astro effectively across different working modes
          </p>
        </div>
        <MarkdownRenderer content={workflowGuideContent} />
      </div>
    </div>
  )
}
