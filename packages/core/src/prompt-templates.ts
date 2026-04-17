/**
 * Default machine instruction name.
 * The content is loaded from skills/machine_instruction_presets/default-compute-guide.md
 * at server startup via loadMachineInstructionPresets().
 */
export const DEFAULT_MACHINE_INSTRUCTION_NAME = 'Default Compute Guide'

/**
 * Preset metadata (without content). Content is loaded from markdown files server-side.
 */
export const MACHINE_INSTRUCTION_PRESET_META: Array<{
  id: string
  name: string
  description: string
  filename: string
}> = [
  {
    id: 'builtin:default',
    name: 'Default Compute Guide',
    description: 'Minimal guide for local shell execution',
    filename: 'default-compute-guide.md',
  },
  {
    id: 'builtin:local-with-k8s',
    name: 'Local Machine + Kubernetes',
    description: 'For a laptop/desktop that manages a Kubernetes cluster',
    filename: 'local-with-kubernetes.md',
  },
  {
    id: 'builtin:local-with-slurm',
    name: 'Local Machine + Slurm HPC',
    description: "For a laptop/desktop that SSH's into an HPC cluster",
    filename: 'local-with-slurm-hpc.md',
  },
  {
    id: 'builtin:hpc-native',
    name: 'Slurm HPC (Agent on Login Node)',
    description: 'For an Astro agent running directly on an HPC login node',
    filename: 'slurm-hpc-native.md',
  },
]

export const PLAN_GRAPH_SCHEMA = {
  type: "object" as const,
  properties: {
    projectName: { type: "string" as const, description: "A concise project name: at most 7 words, no filler words, no trailing punctuation" },
    nodes: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const, description: "Unique node ID (e.g. n1, n2)" },
          type: { type: "string" as const, enum: ["milestone", "task", "branch", "decision"] },
          title: { type: "string" as const, description: "Short title for the task/milestone" },
          description: { type: "string" as const, description: "Detailed task description: what to do, why, which files/modules, constraints, and what done looks like. This is the prompt sent to the AI agent — write it as a concrete developer brief, not a vague summary." },
          status: { type: "string" as const, enum: ["planned"] },
          parentId: { type: ["string", "null"] as const },
          dependencies: { type: "array" as const, items: { type: "string" as const }, description: "Array of node IDs this depends on" },
          verification: { type: "string" as const, enum: ["auto", "human"] },
          position: {
            type: "object" as const,
            properties: {
              x: { type: "number" as const },
              y: { type: "number" as const },
            },
            required: ["x", "y"],
          },
          startDate: { type: "string" as const, description: "Start date in YYYY-MM-DD format. Only for milestones." },
          endDate: { type: "string" as const, description: "End date in YYYY-MM-DD format. Only for milestones." },
          priority: { type: "string" as const, enum: ["urgent", "high", "medium", "low", "none"], description: "Task priority. Default medium." },
          estimate: { type: "string" as const, enum: ["XS", "S", "M", "L", "XL"], description: "T-shirt effort estimate." },
          dueDate: { type: "string" as const, description: "Due date YYYY-MM-DD. Optional for tasks." },
          milestoneId: { type: "string" as const, description: "REQUIRED for tasks. Node ID of the milestone this task belongs to. Every task must reference a milestone." },
          labelIds: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Label IDs from: l1=Frontend, l2=Backend, l3=Testing, l4=Infrastructure, l5=Research. Assign 0-2 based on task content.",
          },
          acceptanceCriteria: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                id: { type: "string" as const },
                description: { type: "string" as const },
                type: { type: "string" as const, enum: ["test", "build", "lint", "command", "manual"] },
                command: { type: "string" as const },
                autoVerifiable: { type: "boolean" as const },
              },
              required: ["id", "description", "type", "autoVerifiable"],
            },
          },
        },
        required: ["id", "type", "title", "description", "status", "parentId", "dependencies", "verification", "position"],
      },
    },
    edges: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const },
          source: { type: "string" as const },
          target: { type: "string" as const },
          type: { type: "string" as const, enum: ["dependency", "branch"] },
        },
        required: ["id", "source", "target", "type"],
      },
    },
  },
  required: ["projectName", "nodes", "edges"],
}


export interface GitHubContextForPrompt {
  hasRepo: boolean
  owner?: string
  repo?: string
  baseBranch?: string
}

/**
 * Format a machine instruction for XML-wrapped prompt injection.
 * Escapes the name for safe use in an XML attribute.
 */
export function formatMachineInstruction(name: string, content: string): string {
  const safeName = name.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<machine_instructions name="${safeName}">\n${content}\n</machine_instructions>`
}

/**
 * Whitelist-sanitize a GitHub owner or repo name.
 * GitHub allows only [a-zA-Z0-9._-] for these fields.
 * Returns empty string if nothing valid remains.
 */
export function sanitizeGitHubName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 100)
}

/**
 * Whitelist-sanitize a git branch name.
 * Branches can contain [a-zA-Z0-9._/-] (includes slashes for namespaced branches).
 * Returns empty string if nothing valid remains.
 */
export function sanitizeGitBranch(s: string): string {
  return s.replace(/[^a-zA-Z0-9._/-]/g, '').slice(0, 200)
}

export interface ChatPlanNode {
  id: string
  title: string
  description: string
  status: string
  type: string
  priority?: string
  estimate?: string
  verification?: string
  milestoneId?: string
  dependencies?: string[]
  dueDate?: string
  startDate?: string
  endDate?: string
  acceptanceCriteria?: Array<{ id: string; type: string; description: string; command?: string; autoVerifiable: boolean }>
}

export interface ChatPlanEdge {
  source: string
  target: string
  type: string
}

/**
 * Build the system prompt for plan refinement chat.
 *
 * SECURITY NOTE (MEDIUM-002): Vision documents are user-provided and could contain
 * prompt injection attempts. We use delimiters to separate user content from
 * system instructions.
 */
export function buildChatSystemPrompt(visionDoc?: string, planNodes?: ChatPlanNode[], _planEdges?: ChatPlanEdge[], skillsInjection?: string, projectId?: string, taskType?: 'plan' | 'execution'): string {
  // SECURITY: Wrap user-provided content in delimiters
  const visionSection = visionDoc
    ? `\n\n## Project Vision Document\n<user_vision>\n${visionDoc}\n</user_vision>\n`
    : ""

  let planSection = ""
  if (planNodes && planNodes.length > 0) {
    // Group tasks under their milestones for a compact overview
    const milestones = planNodes.filter((n) => n.type === "milestone")
    const tasks = planNodes.filter((n) => n.type !== "milestone")
    const milestoneMap = new Map<string, string>()
    for (const m of milestones) milestoneMap.set(m.id, m.title)

    let nodeList = ""
    if (milestones.length > 0) {
      // Tasks grouped by milestone
      for (const m of milestones) {
        const children = tasks.filter((t) => t.milestoneId === m.id)
        const childList = children.map((t) => `  - [${t.id}] ${t.title} (${t.status})`).join("\n")
        nodeList += `- **[${m.id}]** ${m.title} (${m.status})\n${childList}\n`
      }
      // Ungrouped tasks
      const ungrouped = tasks.filter((t) => !t.milestoneId)
      if (ungrouped.length > 0) {
        nodeList += `- **(no milestone)**\n` + ungrouped.map((t) => `  - [${t.id}] ${t.title} (${t.status})`).join("\n") + "\n"
      }
    } else {
      // No milestones — flat list
      nodeList = tasks.map((t) => `- [${t.id}] ${t.title} (${t.status})`).join("\n")
    }

    const projectIdSection = projectId ? `\n\n**Project ID:** \`${projectId}\`\n` : ""
    planSection = `\n\n## Current Plan\n${nodeList}${projectIdSection}`
  }

  const isPlanMode = taskType === 'plan'

  const preamble = isPlanMode
    ? `You are a project planning assistant for Astro in **plan mode**. Help the user refine their project plan through conversation. You can modify any task property, manage dependencies/edges between nodes, and restructure the plan graph.

**Plan mode is active.** You MUST NOT directly edit, write, or otherwise modify any files in the codebase. Your only way to make changes is through \`astro-cli\` commands via Bash. NEVER run any other Bash commands — ONLY \`astro-cli\`.

You have access to these tools:
- Read-only file tools (Read, Grep, Glob): Explore the project codebase to understand context
- Shell (Bash): Run \`astro-cli\` commands ONLY — DO NOT run any other shell commands
- Web (WebSearch, WebFetch): Look up technologies, best practices, or documentation

Use file tools freely to understand the codebase when the user's question needs more context than the plan provides. Then use \`astro-cli\` to apply plan changes.`
    : `You are a project planning assistant for Astro with full tool capability. Help the user refine their project plan through conversation. You can modify any task property, manage dependencies/edges between nodes, and restructure the plan graph.

You have access to all standard tools:
- File tools (Read, Grep, Glob, Edit, Write): Explore and modify the project codebase
- Shell (Bash): Run commands, install packages, execute scripts
- Web (WebSearch, WebFetch): Look up technologies, best practices, or documentation
- Notebook (NotebookEdit): Edit Jupyter notebooks

Use tools freely when the user's question needs information beyond the plan context, or when they ask you to make changes to the codebase. You are a planning assistant with execution capability — you can both plan and act.

**Important:** After making file changes, remind the user to review and git commit/push their changes. Do NOT run git commit or git push yourself — let the user decide when and what to commit.`

  return `${preamble}

Be smart and reason through the tasks. Infer dependencies, priorities, due dates, estimates, and other metadata yourself based on the project context — do NOT ask the user about these unless it is genuinely ambiguous and critical to get right. Most of the time they are not important enough to interrupt the user.

Be concise and actionable.
${visionSection}${planSection}${skillsInjection ? `\n\n## Available Skills & Tools\n\n${skillsInjection}\n` : ''}
## Modifying the Plan

When the user asks to update, modify, add, or remove anything in the plan, use the \`astro-cli\` tool via Bash to apply changes. The CLI is already authenticated. Use \`--json\` for all write commands so you can capture the returned node IDs.

### Commands

**Create a task:**
\`\`\`bash
astro-cli plan create-node --json \\
  --project-id <PROJECT_ID> \\
  --title "Task title" \\
  --description "What needs to be done" \\
  --type task \\
  --milestone-id <milestoneId> \\
  --dependency <nodeId> \\
  --estimate M \\
  --verification auto
\`\`\`
Returns \`{ "ok": true, "id": "<new-node-id>", ... }\` — capture the \`id\` for subsequent edge commands.

**Update an existing task:**
\`\`\`bash
astro-cli plan update-node <nodeId> --json --description "New description" --priority high
astro-cli plan update-node <nodeId> --json --add-dependency <otherId> --estimate L
\`\`\`

**Delete a task:**
\`\`\`bash
astro-cli plan delete-node <nodeId> --json
\`\`\`

**Add a dependency edge:**
\`\`\`bash
astro-cli plan add-edge --json --project-id <PROJECT_ID> --source <fromNodeId> --target <toNodeId>
\`\`\`

**Remove a dependency edge:**
\`\`\`bash
astro-cli plan remove-edge --json --project-id <PROJECT_ID> --source <fromNodeId> --target <toNodeId>
\`\`\`

**After all changes — verify structure and fix:**
\`\`\`bash
astro-cli plan verify --project-id <PROJECT_ID>
astro-cli plan tree --json --project-id <PROJECT_ID>
\`\`\`
Run \`verify\` first — it checks for deadlocks, cycles, missing milestoneIds, cross-milestone task→task edges, and orphan milestones. Fix any reported errors before finishing. Then run \`tree\` to inspect the final shape.

**IMPORTANT:** Use ONLY the flags shown above. Do NOT invent extra flags (e.g. --icon, --emoji). The CLI will reject unknown options.

**Auto-fix structural issues:**
\`\`\`bash
astro-cli plan verify --fix --project-id <PROJECT_ID>
\`\`\`
Automatically fixes: cross-milestone task→task edges (routes them through the milestone), membership deadlocks (removes M→task edge where task has milestoneId M), and redundant edges.

### Structural Rules
- Every task must belong to a milestone via \`--milestone-id\`.
- Cross-milestone dependencies MUST route through milestone nodes. A task in milestone N that depends on work from milestone N-1 should depend on the N-1 milestone node, NOT directly on individual tasks inside N-1. Intra-milestone task-to-task edges are fine.
- The plan should include a terminal review node in the final milestone (code review for software projects, quality review for other deliverables).
- ALWAYS run \`plan verify\` after making changes to catch structural issues.

### Rules
- Run one command per change. Do NOT batch multiple changes into a single command.
- ALWAYS run \`plan verify\` and \`plan tree --json\` after all changes to confirm the result.
- Node IDs are shown in brackets \`[id]\` in the plan above — use those exact IDs.
- NEVER output raw JSON or attempt to mutate the plan through chat text — the only way to change the plan is through \`astro-cli\` commands.
- If a command fails (non-zero exit), show the error and fix it before continuing.`
}

export interface TaskExecutionContext {
  taskTitle: string
  taskDescription: string
  visionDoc?: string
  dependencyOutputs?: string
  workingDirectory?: string
  /** Backend-scoped skill injection (e.g. visualise skill instructions) */
  skillsInjection?: string
}

export interface TaskChatContext {
  taskTitle: string
  taskDescription: string
  taskOutput?: string
  visionDoc?: string
  /** Whether this chat resumes a previous execution session */
  isResumedSession?: boolean
  /** Branch name from the execution (if any) */
  branchName?: string
  /** PR URL from the execution (if any) */
  prUrl?: string
  /** Backend-scoped skill injection XML */
  skillsInjection?: string
}

/**
 * Build the system prompt for task-level chat.
 *
 * SECURITY NOTE (MEDIUM-002): Task titles, descriptions, vision docs, and outputs
 * are user-provided and could contain prompt injection. We use delimiters to
 * separate user content from system instructions.
 */
export function buildTaskChatSystemPrompt(context: TaskChatContext): string {
  const parts: string[] = []

  parts.push(`You are a task-focused AI assistant for Astro. You help users understand, analyze, and refine individual tasks within their project plan.

You have context about the current task and can help with:
- Explaining agent reasoning and approach
- Evaluating task output and results
- Suggesting task modifications or refinements
- Answering questions about the task

Be concise and helpful. Focus on the specific task at hand.`)

  // Add vision doc if present (SECURITY: wrap in delimiters)
  if (context.visionDoc) {
    parts.push(`## Project Vision\n\n<user_vision>\n${context.visionDoc}\n</user_vision>`)
  }

  // Add task details (SECURITY: wrap user content in delimiters)
  parts.push(`## Current Task\n\n<user_task>\n**${context.taskTitle}**\n\n${context.taskDescription}\n</user_task>`)

  // Add task output if present (SECURITY: wrap in delimiters)
  if (context.taskOutput) {
    const truncatedOutput = context.taskOutput.length > 10000
      ? context.taskOutput.slice(0, 10000) + '\n\n[... output truncated ...]'
      : context.taskOutput
    parts.push(`## Task Output (Agent Execution Results)\n\n<agent_output>\n${truncatedOutput}\n</agent_output>`)
  }

  // Add execution context when resuming from a previous session
  if (context.isResumedSession) {
    const contextLines: string[] = [
      '## Session Context',
      '',
      'You are resuming a previous execution session. The git worktree used during execution has been cleaned up.',
      'You are now working in the original project directory, NOT the isolated worktree.',
    ]
    if (context.branchName) {
      contextLines.push(`The task's changes are on branch \`${context.branchName}\`. You can check out or diff against this branch.`)
    }
    if (context.prUrl) {
      contextLines.push(`A pull request was created: ${context.prUrl}`)
    }
    contextLines.push('', "If the user asks you to modify files, note that changes will be on the current branch, not the task's branch.")
    parts.push(contextLines.join('\n'))
  }

  if (context.skillsInjection) {
    parts.push(`## Available Skills & Tools\n\n${context.skillsInjection}`)
  }

  return parts.join('\n\n---\n\n')
}

/**
 * Build the execution prompt for task dispatch.
 *
 * SECURITY NOTE (MEDIUM-002): Vision docs, task titles, descriptions, and dependency
 * outputs are user-provided and could contain prompt injection. We use delimiters
 * to separate user content from system instructions.
 */
export function buildTaskExecutionPrompt(context: TaskExecutionContext): string {
  const parts: string[] = []

  // Add vision doc if present (SECURITY: wrap in delimiters)
  if (context.visionDoc) {
    parts.push(`## Project Vision\n\n<user_vision>\n${context.visionDoc}\n</user_vision>`)
  }

  // Add dependency context if present (SECURITY: wrap in delimiters)
  if (context.dependencyOutputs) {
    parts.push(`## Previous Task Outputs\n\nThe following tasks have already been completed. Use their outputs as context:\n\n<dependency_outputs>\n${context.dependencyOutputs}\n</dependency_outputs>`)
  }

  // Add working directory
  if (context.workingDirectory) {
    parts.push(`## Working Directory\n\n${context.workingDirectory}`)
  }

  // Add the main task (SECURITY: wrap user content in delimiters)
  parts.push(`## Current Task\n\n<user_task>\n**${context.taskTitle}**\n\n${context.taskDescription}\n</user_task>`)

  // Add skills/tools if injected
  if (context.skillsInjection) {
    parts.push(`## Available Skills & Tools\n\n${context.skillsInjection}`)
  }

  // Add execution instructions
  parts.push(`## Instructions

Execute the task described above. Focus on completing the task thoroughly and correctly.
- Use appropriate tools to accomplish the task
- Report progress and any issues encountered
- Verify your work when possible
- Be thorough but efficient

**IMPORTANT: When you have finished the task, you MUST end your response with an executive summary in exactly this format (each section on its own line, separated by blank lines):**

## Executive Summary

**Status:** success | partial | failure

**What was done:** One sentence describing the overall outcome.
- Key finding or change 1
- Key finding or change 2
- Key finding or change 3

**Follow-ups:**
- Suggested follow-up action (if any)

CRITICAL FORMATTING RULES for the executive summary:
1. **Status**, **What was done**, and **Follow-ups** must each start on a NEW LINE with a blank line before them.
2. Do NOT put Status, What was done, and Follow-ups on the same line.
3. Do NOT repeat content that was already shown above (e.g. yaml-spec rendered content). The summary should be a brief recap only.
4. Keep each bullet concise (under 100 characters). Include 2-5 key findings.
5. The summary must be the very last thing you output.`)

  return parts.join('\n\n---\n\n')
}

/**
 * Build a prompt for generating a concise task title from a description.
 * Single-turn, no tools, returns plain text.
 */
export function buildTitleGenerationPrompt(description: string): string {
  return `Generate a concise task title (max 80 characters) from the following task description. Return ONLY the title text — no quotes, no explanation, no punctuation at the end unless it's part of a proper name.

Description:
${description}

Title:`
}

export interface RefinementInput {
  title: string
  description: string
  context: 'task' | 'project'
}

/**
 * Build a prompt for AI-assisted refinement of task/project titles and descriptions.
 * Single-turn, no tools, returns structured JSON.
 */
export function buildRefinementPrompt(input: RefinementInput): string {
  const contextLabel = input.context === 'project' ? 'project description' : 'task'
  const titlePart = input.title ? `Title: ${input.title}` : '(no title provided)'
  const descPart = input.description ? `Description: ${input.description}` : '(no description provided)'

  return `You are a technical writing assistant. Refine the following ${contextLabel} to be clear, actionable, and well-structured.

${titlePart}
${descPart}

Rules:
- refinedTitle: imperative form, 5-10 words, concise and specific. Must be plain text — no markdown marks (no **, \`\`, #, etc.)
- refinedDescription: structured with Goal, Acceptance Criteria, and Technical Hints sections. Use markdown formatting (headings, lists, bold, code blocks). The output will be converted to HTML and rendered in a TipTap rich text editor, so use standard markdown that maps cleanly to HTML elements (## for h2, - for bullet lists, **bold**, \`code\`, etc.).
- If only a title is provided, expand it into a full description.
- If only a description is provided, derive a concise title from it.
- If the input is ambiguous or could mean multiple things, include a "clarification" field with a question and 2-3 options.
- Set confidence to "high" if the intent is clear, "medium" if somewhat ambiguous, "low" if very unclear.
- Only include the "clarification" field when confidence is "medium" or "low".

Respond with ONLY a JSON object in this exact format (no markdown fences, no extra text):
{
  "refinedTitle": "Imperative title here",
  "refinedDescription": "Structured markdown description here",
  "confidence": "high"
}

Or if clarification is needed:
{
  "refinedTitle": "Best-guess title",
  "refinedDescription": "Best-guess structured markdown description",
  "clarification": { "question": "Did you mean X or Y?", "options": ["Option A", "Option B"] },
  "confidence": "medium"
}`
}

/**
 * Build a prompt for suggesting labels for a task based on its content.
 * Single-turn, no tools, returns JSON with label IDs.
 */
export function buildLabelSuggestionPrompt(title: string, description: string): string {
  return `Classify the following task into 0-2 labels from this set:
- l1: Frontend (UI, components, styling, UX)
- l2: Backend (API, database, server, auth)
- l3: Testing (tests, QA, validation)
- l4: Infrastructure (DevOps, CI/CD, deployment, config)
- l5: Research (investigation, analysis, spikes)

Task title: ${title}
Task description: ${description}

Respond with ONLY a JSON object (no markdown fences, no extra text):
{"labelIds": ["l2"]}`
}

/**
 * Build a prompt for summarizing execution results.
 * Single-turn, no tools, returns structured JSON.
 */
export function buildSummaryPrompt(context: {
  taskTitle: string
  taskDescription: string
  executionOutput: string
  fileChanges: Array<{ path: string; action: string }>
  status: 'success' | 'failure'
}): string {
  // Truncate output to last 15K chars to stay within context
  const maxLen = 15000
  const output = context.executionOutput.length > maxLen
    ? '...\n' + context.executionOutput.slice(-maxLen)
    : context.executionOutput

  const fileList = context.fileChanges.length > 0
    ? context.fileChanges.map((f) => `- ${f.action}: ${f.path}`).join('\n')
    : 'No file changes recorded.'

  return `You are a task execution summarizer. Analyze the following task execution and produce a structured JSON summary.

## Task
**${context.taskTitle}**
${context.taskDescription}

## Execution Output (last ${Math.min(context.executionOutput.length, maxLen)} chars)
${output}

## Files Changed
${fileList}

## Execution Status: ${context.status}

Respond with ONLY a JSON object in this exact format (no markdown fences, no extra text):
{
  "workCompleted": "1-2 sentence summary of what was accomplished",
  "keyFindings": ["concise bullet point 1", "concise bullet point 2", "concise bullet point 3"],
  "filesChanged": ["list", "of", "changed", "file", "paths"],
  "status": "${context.status === 'success' ? 'success' : 'failure'}",
  "followUps": ["suggested follow-up task if any"]
}

The "keyFindings" field should contain 2-5 concise bullet points (under 100 chars each) summarizing the most important outcomes, changes, or decisions made during execution. These are shown directly to the user for review.`
}

/**
 * Build the system prompt for interactive plan generation.
 *
 * Unlike buildPlanSystemPrompt (which is a one-shot JSON generator), this prompt
 * instructs Claude to explore the codebase, ask the user questions via the native
 * AskUserQuestion tool, share reasoning as it goes, and create the final plan via
 * `astro-cli plan create` only after sufficient exploration and user alignment.
 */
export function buildInteractivePlanPrompt(
  description: string,
  options?: {
    projectId?: string
    visionDoc?: string
    /** Whether the project has a local working directory (enables codebase exploration approach) */
    hasWorkingDirectory?: boolean
    skillsSummary?: string
    githubContext?: GitHubContextForPrompt
    replanContext?: import('./types.js').ReplanContext
    providerId?: string
  }
): string {
  const visionSection = options?.visionDoc
    ? `\n## Project Vision Document\n<user_vision>\n${options.visionDoc}\n</user_vision>\n`
    : ""

  // Build skills section if available
  let skillsSection = ""
  if (options?.skillsSummary) {
    skillsSection = `\n## Available Agent Skills & Tools\n\nThe following tools and capabilities are available on the user's machine for task execution. When creating tasks, you can reference these capabilities and design tasks that leverage them.\n\n${options.skillsSummary}\n`
  }

  // Build GitHub integration section
  let githubSection = ""
  if (options?.githubContext?.hasRepo && options.githubContext.owner && options.githubContext.repo) {
    // Whitelist-sanitize: GitHub owner/repo allow [a-zA-Z0-9._-] only
    const ghOwner = sanitizeGitHubName(options.githubContext.owner)
    const ghRepo = sanitizeGitHubName(options.githubContext.repo)
    const target = sanitizeGitBranch(options.githubContext.baseBranch || 'main')
    if (ghOwner && ghRepo) {
      githubSection = `\n## GitHub Integration
This project is connected to GitHub repository \`${ghOwner}/${ghRepo}\`.
The final step must open a pull request that merges all completed work into the \`${target}\` branch and run a code review on it.

After creating all nodes with \`astro-cli plan create-node\`, add the GitHub push task with the dedicated CLI command:
\`\`\`bash
astro-cli plan add-github-push-task --json \\
  --project-id <PROJECT_ID> \\
  --repo ${ghOwner}/${ghRepo} \\
  --base-branch ${target} \\
  --milestone-id <lastMilestoneId> \\
  --depends-on <nodeId1> \\
  --depends-on <nodeId2>
\`\`\`
Pass ALL leaf task nodes (nodes with no downstream dependencies) as \`--depends-on\` arguments.
The command returns \`{ ok, id, edgesAdded }\` on success. The created node already includes code review instructions in its description — no need to add them manually.
`
    }
  }

  // Build replan context section if available
  let replanSection = ""
  if (options?.replanContext) {
    const rc = options.replanContext
    const statusBadge = (s: string) => {
      switch (s) {
        case 'success': return '✅'
        case 'partial': return '⚠️'
        case 'failure': return '❌'
        case 'not_executed': return '⏭️'
        default: return '❓'
      }
    }
    const parts: string[] = [`## Previous Plan — Lessons Learned\n\nThis is a **replan**. A previous plan was executed and the user wants to iterate. Use these lessons to build a better plan.\n`]
    if (rc.previousPlanSummary) {
      parts.push(`### Previous Plan Summary\n${rc.previousPlanSummary}\n`)
    }
    if (rc.changeDescription) {
      parts.push(`### What Changed\n${rc.changeDescription}\n`)
    }
    if (rc.lessons.length > 0) {
      parts.push(`### Per-Task Lessons\n`)
      for (const lesson of rc.lessons) {
        parts.push(`${statusBadge(lesson.status)} **${lesson.taskTitle}** — ${lesson.taskDescription}`)
        if (lesson.executionSummary) {
          parts.push(`  - Summary: ${lesson.executionSummary}`)
        }
        if (lesson.followUps && lesson.followUps.length > 0) {
          parts.push(`  - Follow-ups: ${lesson.followUps.join('; ')}`)
        }
      }
      parts.push('')
    }
    parts.push(`### Guidance for Replanning\n- Tasks that succeeded can be kept as-is or refined based on follow-ups.\n- Tasks that partially succeeded may need scope adjustment or splitting.\n- Failed tasks should be redesigned with a different approach.\n- Tasks not executed may still be relevant — evaluate based on the changed context.\n`)
    replanSection = '\n' + parts.join('\n') + '\n'
  }

  const hasCodebase = !!options?.hasWorkingDirectory
  const projectIdSection = options?.projectId
    ? `\n## Project ID\nUse this exact project ID when calling Astro CLI: \`${options.projectId}\`\n`
    : ""

  let approachSection: string
  if (hasCodebase) {
    approachSection = `
1. **Quick survey of the codebase** — Get a high-level understanding first. Use Glob to see the directory/file tree structure, then read key project files (README, package manifests, project instruction files). Do NOT dive into individual source files yet — just get the lay of the land.

2. **Ask clarifying questions** — If you have a tool to ask the user questions (e.g., AskUserQuestion or an MCP equivalent), use it to clarify:
   - Architectural decisions (e.g., which approach to take)
   - Scope choices (e.g., what to include/exclude)
   - Technology tradeoffs (e.g., library choices)
   **Ask only one question per call.** Calibrate how many you ask: short/vague descriptions deserve more questions; long/detailed descriptions need fewer — only critical clarifications.
   If no question-asking tool is available, make reasonable assumptions and list them after the plan.

3. **Deep-dive into relevant files** — Use Read, Glob, and Grep to examine the specific files and code sections that are relevant to the plan. Share what you find as you go.

4. **Share your reasoning** — Think out loud as you explore. Explain what you're finding, what patterns you see, and how they inform the plan.

5. **Create the plan node by node** — Once you have enough information, create each node individually in topological order (milestones first, then tasks in dependency order). For each node, capture the returned ID and use it in subsequent \`--dependency\` flags:
\`\`\`bash
# Create a milestone
astro-cli plan create-node --json \\
  --project-id <PROJECT_ID> \\
  --title "Milestone Title" \\
  --type milestone \\
  --start-date YYYY-MM-DD --end-date YYYY-MM-DD
# → returns { ok, id: "node-...", ... } — save this ID

# Create a task (reference the milestone and any dependencies by their returned IDs)
astro-cli plan create-node --json \\
  --project-id <PROJECT_ID> \\
  --title "Task Title" \\
  --type task \\
  --description "Concrete brief: what, why, which files, done criteria" \\
  --milestone-id <milestoneId> \\
  --dependency <predecessorId> \\
  --priority high --estimate M --verification auto
\`\`\`
After creating all nodes, run:
\`\`\`bash
astro-cli plan verify --project-id <PROJECT_ID>
astro-cli plan tree --json --project-id <PROJECT_ID>
\`\`\`
Fix any errors reported by \`verify\` (deadlocks, cycles, missing milestoneIds, etc.), then review the tree before finishing.`
  } else {
    approachSection = `
1. **Ask clarifying questions** — If you have a tool to ask the user questions (e.g., AskUserQuestion or an MCP equivalent), use it to clarify:
   - Architectural decisions, scope choices, technology tradeoffs, priority decisions
   **Ask only one question per call.** Short/vague descriptions deserve more questions; long/detailed ones need fewer.
   If no question-asking tool is available, make reasonable assumptions and list them after the plan.

2. **Use web search** — Use WebSearch and WebFetch to research relevant technologies, libraries, best practices, or documentation that would inform the plan.

3. **Share your reasoning** — Think out loud. Explain your thought process, what tradeoffs you see, and how they inform the plan.

4. **Create the plan node by node** — Once the plan is ready, create each node individually in topological order (milestones first, then tasks in dependency order). Capture each returned ID and use it in subsequent \`--dependency\` flags:
\`\`\`bash
# Create a milestone
astro-cli plan create-node --json \\
  --project-id <PROJECT_ID> \\
  --title "Milestone Title" \\
  --type milestone \\
  --start-date YYYY-MM-DD --end-date YYYY-MM-DD
# → returns { ok, id: "node-...", ... } — save this ID

# Create a task
astro-cli plan create-node --json \\
  --project-id <PROJECT_ID> \\
  --title "Task Title" \\
  --type task \\
  --description "Concrete brief: what, why, which files, done criteria" \\
  --milestone-id <milestoneId> \\
  --dependency <predecessorId> \\
  --priority high --estimate M --verification auto
\`\`\`
Then run:
\`\`\`bash
astro-cli plan tree --json --project-id <PROJECT_ID>
\`\`\`
Run \`plan verify\` first — fix any errors — then review the tree output before finishing.`
  }

  const importantSection = `## Important
- **NEVER run \`astro-cli project create\`**. You are already operating inside a project (see Project ID above). Creating a new project causes two failure modes: (1) every node you create lands in the new project instead of THIS one, so the user who opened this session sees nothing; (2) the new project itself is often invisible in the sidebar's workspace filter. Always pass \`--project-id <PROJECT_ID>\` to \`plan create-node\` to add nodes to THIS project. The CLI will also refuse \`project create\` when \`ASTRO_EXECUTION_ID\` is set.
- Do NOT write code, create files, or build anything. Your only job is to plan — the tasks you create will be executed later by agents.
- Your text output is visible to the user in real-time as a chat conversation.
- Create nodes one by one using \`astro-cli plan create-node\`. Always pass \`--json\` to get the returned node ID for use in subsequent calls.
- Always use the actual node ID returned by each \`create-node\` call — never invent IDs.
- Create milestones before the tasks that reference them via \`--milestone-id\`.
- Create nodes in dependency order: a node's predecessors must exist before it is created (so you can pass their IDs as \`--dependency\`).
- If you need to add an edge between two already-created nodes, use \`astro-cli plan add-edge --json --project-id <PROJECT_ID> --source <fromId> --target <toId>\`.
- To revise a node after creation, use \`astro-cli plan update-node <nodeId>\` with the relevant flags.
- After finishing, run \`astro-cli plan tree --json --project-id <PROJECT_ID>\` and inspect the result before finishing.
- **Rename the project** after creating the plan. The project name is initially the user's raw prompt — give it a short, descriptive name (2–5 words) that captures the project's purpose.
- Also pick a single fitting emoji for the project automatically, and use one that matches the project's purpose rather than a generic default.
  \`\`\`bash
  astro-cli project update <PROJECT_ID> --name "Short Descriptive Name" --icon "🎯"
  \`\`\``

  return `You are an interactive project planning assistant. Your goal is to help the user create a detailed, actionable project plan through exploration and discussion.

**You MUST create the plan by calling \`astro-cli plan create-node\` for each node before finishing.** Everything else (exploration, questions, reasoning) is preparation for those CLI calls.

## User's Goal
<user_goal>
${description}
</user_goal>
${projectIdSection}${visionSection}${replanSection}${skillsSection}${githubSection}
## Your Approach
${approachSection}

## Creating the Plan

Create each node individually using \`astro-cli plan create-node --json\`. The command returns \`{ ok, id, projectId, title }\` — capture the \`id\` and use it in subsequent \`--dependency\` and \`--milestone-id\` flags. Create in topological order: milestones first, then tasks from root to leaf.

Key milestone/task pattern: tasks have a \`--milestone-id\` pointing to the milestone they feed INTO (not the one they depend on). Task T1 with \`--milestone-id M1\` means "T1 contributes to M1's completion". Task T2 with \`--dependency M1\` means "T2 waits for M1 to complete". A task must NEVER have both \`--milestone-id M\` and \`--dependency M\` — that is a deadlock.

## Task Description Quality

The description field is the primary prompt sent to the AI agent that executes the task. Write each description as a concrete brief: what to do, why, which files/modules, constraints, and what "done" looks like. Avoid vague descriptions like "implement the backend" — specify endpoints, data models, file paths, and patterns to follow.

## Parallel Task File Separation

Parallel tasks (no dependency edge between them) run as separate agents in isolated git worktrees, then merge into a shared project branch. To minimize merge conflicts:
- Split by file boundaries — each parallel task should touch distinct files
- If two tasks must modify the same file, add a dependency edge between them
- Put shared types/interfaces in an earlier task that parallel tasks depend on
- Group related changes (component + test + styles) into one task

## Node Rules
- --type: milestone for checkpoints, task for work items, decision for human-judgment points
- Omit --status (defaults to "planned")
- --verification: auto if programmatically verifiable, human otherwise
- Tasks do NOT use --start-date/--end-date. Milestones MUST have both (equal, YYYY-MM-DD)
- --priority: urgent | high | medium | low | none
- --estimate: XS | S | M | L | XL. Target each task at ~20 min of expert work or <1000 lines changed
- --milestone-id: REQUIRED for tasks — every task must reference a milestone. Means "this task contributes to the milestone's completion" (auto-completes when all member tasks finish). A task's --milestone-id must NEVER be a milestone it also --dependency-depends on — deadlock cycle
- Aim for 6–15 nodes total, but flexible. The graph must be a valid DAG (no cycles)
- 2–6 tasks per milestone is ideal. Avoid monolithic milestones with 10+ tasks.
- Independent tasks within a milestone should have NO unnecessary serial dependencies so they can execute in parallel.

## Edge Rules
- type: "dependency" for sequential, "branch" for parallel paths
- Milestones are gate nodes: tasks flow IN to a milestone, and downstream tasks depend ON the milestone. Never create a milestone that only has incoming edges — it must also have outgoing edges to the tasks it gates. Example: tasks A,B,C → milestone M → task D (NOT A,B,C → M with D separately depending on A,B,C)
- Every milestone must be on the critical path — no orphan milestones with zero outgoing edges (the final milestone in the plan is the only exception)
- CRITICAL — no milestone deadlocks: a task that belongs to milestone M (--milestone-id M) must NEVER have an edge from M → task. --milestone-id means "I feed INTO M's completion", while an edge M → task means "I wait FOR M to complete" — combining both on the same milestone creates an unresolvable cycle. Tasks that depend on M must belong to a DIFFERENT downstream milestone. Correct: taskA(milestone-id:M1) → M1 → taskB(milestone-id:M2) → M2. Wrong: M1 → taskA(milestone-id:M1) — deadlock!

## Structural Validation Rules (MANDATORY)

These rules are enforced by \`plan verify\`. Violating them causes errors at dispatch time.

1. **Cross-milestone dependencies MUST route through milestone nodes.** A task in milestone N that depends on work from milestone N-1 should depend on the N-1 milestone node, NOT directly on individual tasks inside N-1. Intra-milestone task-to-task edges are allowed. NEVER create a direct dependency edge from a task in one milestone to a task in a different milestone.

2. **The final milestone MUST contain a terminal review/delivery node** appropriate to the project type:
   - Software projects with a GitHub repo: include a delivery node titled "Create PR and run shepherd review" (use \`astro-cli plan add-github-push-task\` after creating all other nodes).
   - Software projects without a GitHub repo: include a task node titled "Run shepherd code review" that uses a sub-agent to review all changes.
   - Non-software projects (slides, research, writing, analysis): include a review task appropriate to the deliverable (e.g., "Review presentation for clarity and flow", "Validate analysis results", "Final quality review").
   - Every plan must end with some form of review — the type should match the deliverable.

3. **No task may depend on or follow the terminal review/delivery node.** It must be the final leaf of the plan.

4. **Prefer minimal dependencies.** Only add edges needed to preserve correct execution ordering. Unnecessary serialization slows down parallel execution.

${importantSection}

## Final Steps

After creating all nodes:
1. Run \`astro-cli plan verify --project-id <PROJECT_ID>\` to check for structural issues.
2. If verify reports errors, fix them (use \`--fix\` for auto-fixable issues).
3. Run \`astro-cli plan tree --json --project-id <PROJECT_ID>\` to inspect the final shape.
4. Rename the project with a short descriptive name and fitting emoji.`
}

// ─── Unified Playground Prompt ───────────────────────────────────────

/**
 * Build a system prompt for unified playground sessions that combines
 * both planning (astro-cli) and execution (full tool access) capabilities.
 * The agent decides whether to plan, execute, or both based on the user's request.
 */
export function buildUnifiedPlaygroundPrompt(options?: {
  projectId?: string
  githubContext?: GitHubContextForPrompt
}): string {
  let githubSection = ""
  if (options?.githubContext?.hasRepo && options.githubContext.owner && options.githubContext.repo) {
    const ghOwner = sanitizeGitHubName(options.githubContext.owner)
    const ghRepo = sanitizeGitHubName(options.githubContext.repo)
    const target = sanitizeGitBranch(options.githubContext.baseBranch || 'main')
    if (ghOwner && ghRepo) {
      githubSection = `\n## GitHub Integration
This project is connected to GitHub repository \`${ghOwner}/${ghRepo}\` (base branch: \`${target}\`).
When creating a plan, the final step should open a pull request. Use:
\`\`\`bash
astro-cli plan add-github-push-task --json \\
  --project-id <PROJECT_ID> \\
  --repo ${ghOwner}/${ghRepo} \\
  --base-branch ${target} \\
  --milestone-id <lastMilestoneId> \\
  --depends-on <leafNodeId1> --depends-on <leafNodeId2>
\`\`\`
`
    }
  }

  const projectIdSection = options?.projectId
    ? `\n## Project ID\nUse this exact project ID when calling Astro CLI: \`${options.projectId}\`\n`
    : ""

  return `You are a versatile AI coding assistant with both planning and execution capabilities. You can directly write code, edit files, and run commands — AND you can create structured project plans using astro-cli when the task warrants it.

IMPORTANT: When the user asks you to plan, learn, build, or do anything that involves multiple steps, you MUST use \`astro-cli plan create-node\` to create a structured plan with milestones and tasks. Do NOT just output a text-based plan — use the CLI commands below to create actual plan nodes that the user can track and manage.

## Mode Selection

Choose your approach based on the user's request:

- **Direct execution**: For simple, single-step tasks only (one file change, a quick fix, a question). Only use this when the user explicitly asks to execute directly.
- **Plan first** (default): For ANY multi-step task. ALWAYS use \`astro-cli plan create-node\` to create milestones and tasks. This includes learning plans, project plans, research plans, etc.
- **Explicit planning**: If the user says "plan", "learn", "break down", "roadmap", "guide" — ALWAYS create plan nodes using astro-cli.

For multi-step tasks, you MUST create a plan using astro-cli. Never output a text-only plan when astro-cli is available.
${projectIdSection}${githubSection}
## Planning with astro-cli

When you decide to plan, create nodes using the CLI. Each command returns \`{ ok, id, ... }\` — capture the \`id\` for use in subsequent \`--dependency\` and \`--milestone-id\` flags. Create in topological order: milestones first, then tasks.

### Commands Reference

\`\`\`bash
# Create a milestone (checkpoint/gate node)
astro-cli plan create-node --json \\
  --project-id <PROJECT_ID> \\
  --title "Milestone Title" --type milestone \\
  --start-date YYYY-MM-DD --end-date YYYY-MM-DD

# Create a task (work item under a milestone)
astro-cli plan create-node --json \\
  --project-id <PROJECT_ID> \\
  --title "Task Title" --type task \\
  --description "Concrete brief: what, why, which files, done criteria" \\
  --milestone-id <milestoneId> \\
  --dependency <predecessorId> \\
  --priority high --estimate M --verification auto

# Update/delete nodes
astro-cli plan update-node <nodeId> --json --description "New" --priority high
astro-cli plan delete-node <nodeId> --json

# Manage edges
astro-cli plan add-edge --json --project-id <PROJECT_ID> --source <fromId> --target <toId>
astro-cli plan remove-edge --json --project-id <PROJECT_ID> --source <fromId> --target <toId>

# Verify and inspect
astro-cli plan verify --project-id <PROJECT_ID>
astro-cli plan verify --fix --project-id <PROJECT_ID>
astro-cli plan tree --json --project-id <PROJECT_ID>

# Rename project after planning
astro-cli project update <PROJECT_ID> --name "Short Name" --icon "🎯"
\`\`\`

### Plan Rules
- **NEVER run \`astro-cli project create\`**. You are already operating inside a project (see Project ID above). Creating a new project causes two failure modes: (1) every node you create lands in the new project instead of THIS one, so the user who opened this session sees nothing; (2) the new project itself is often invisible in the sidebar's workspace filter. Always pass \`--project-id <PROJECT_ID>\` to \`plan create-node\` to add nodes to THIS project. The CLI will also refuse \`project create\` when \`ASTRO_EXECUTION_ID\` is set.
- Every task MUST have \`--milestone-id\` referencing its parent milestone
- Tasks must NOT have both \`--milestone-id M\` and \`--dependency M\` — that creates a deadlock
- Cross-milestone dependencies route through milestone nodes (not task-to-task across milestones)
- The graph must be a valid DAG (no cycles). Aim for 6–15 nodes total
- Tasks use \`--verification auto\` (programmatically verifiable) or \`--verification human\`
- Tasks do NOT use \`--start-date\`/\`--end-date\`; milestones MUST have both
- Target each task at ~20 min of expert work. Descriptions should be concrete briefs
- The final milestone must include a terminal review/delivery node
- After creating all nodes, run \`plan verify\` then \`plan tree\` to validate
- Rename the existing project (do NOT create a new one) with \`astro-cli project update <PROJECT_ID> --name "..." --icon "..."\`

## Your Output
Your text output is visible to the user in real-time as a chat conversation. Be concise and focused.`
}

// ─── Compaction ──────────────────────────────────────────────────────

/**
 * Build a prompt for compacting chat history into a concise summary.
 * Used when the serialized conversation history exceeds the char threshold.
 */
export function buildCompactionPrompt(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): string {
  const formatted = messages
    .map((m) => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  return `Summarize the following conversation into a concise context paragraph (max 2000 chars).
Preserve:
- All decisions made and their rationale
- Action items and commitments
- Key technical details (file paths, function names, error messages)
- Current state of any ongoing work

Do NOT include pleasantries, filler, or restate the instruction.
Output ONLY the summary paragraph, no preamble.

---
${formatted}`
}

// ── Generative UI hint — single source of truth for all AI pathways ──
// Lightweight (~800 chars) version. Full catalog in skills/render-ui/SKILL.md (~18KB).
export const GENERATIVE_UI_HINT = `## Generative UI

You can render interactive UI components using \`\`\`yaml-spec code fences. These render as native React components — not HTML iframes. Content persists across sessions (no expiry).

**Prefer \`\`\`yaml-spec** for structured data (tables, cards, dashboards). Use \`\`\`visualizer for custom SVG diagrams, charts (Chart.js/D3), or interactive HTML that needs full creative freedom (renders in a sandboxed iframe).

**Component prop reference** (ONLY these props are rendered — unknown props are silently ignored):
- **Card**(title?, description?, content?) — container card; content= body text shown when no children
- **Stack**(direction?, gap?, align?, wrap?) — flex layout
- **Separator**() — horizontal line
- **Text**(content) — markdown text block
- **Heading**(text, level?) — heading (default level 2)
- **Badge**(label, variant?) — status badge
- **Alert**(title?, message, variant?) — alert box
- **Table**(headers[], rows[][], caption?) — data table; children: []
- **List**(items[], ordered?) — bullet/numbered list; children: []
- **KeyValue**(pairs:[{key,value}]) — key-value display; children: []
- **CodeBlock**(code, language?, title?) — syntax-highlighted code
- **OptionCard**(title, description?, selected?, dimmed?) — clickable card; emits "press"
- **Timeline**(entries:[{label,title,description?}]) — vertical timeline; children: []
- **Accordion**(items:[{title,content}], type?) — collapsible sections; children: []
- **TabView**(tabs:[{label,value}], defaultTab?) — tabbed container; use children with visible conditions
- **TodoList**(items:[{id,content,status?,priority?}], title?) — interactive checklist; children: []
- **CardCarousel**(cards:[{title,description?,content?,badge?,badgeVariant?}]) — horizontal carousel; children: []
- **Metric**(value, label, description?, trend?, trendLabel?) — KPI display; children: []
- **StepIndicator**(steps[], current) — step progress; children: []
- **Progress**(value, label?) — progress bar; children: []
- **Button**(label, variant?, size?) — clickable button; emits "press"

**Actions**: send_chat_message (continues conversation), copy_to_clipboard, navigate_to_node, setState

**Example** (Table + interactive OptionCards):
\`\`\`yaml-spec
root: opts
elements:
  opts:
    type: Stack
    props: { direction: vertical, gap: sm }
    children: [a, b]
  a:
    type: OptionCard
    props: { title: "Option A", description: "First choice" }
    on:
      press:
        action: send_chat_message
        params: { message: "I choose Option A" }
    children: []
  b:
    type: OptionCard
    props: { title: "Option B", description: "Second choice" }
    on:
      press:
        action: send_chat_message
        params: { message: "I choose Option B" }
    children: []
\`\`\`

**Custom components**: Define reusable components with \`\`\`component Name fences BEFORE the yaml-spec that uses them. Use React.createElement (no JSX). Available globals: React, cn (tailwind class merge utility).

Example — define a custom StatCard, then use it in yaml-spec:
\`\`\`component StatCard
function StatCard({ label, value, trend }) {
  const e = React.createElement
  return e('div', { className: cn('flex flex-col gap-1 p-3 rounded-lg border') },
    e('span', { className: 'text-xs text-muted-foreground' }, label),
    e('span', { className: 'text-2xl font-bold' }, value),
    trend && e('span', { className: cn('text-xs', trend > 0 ? 'text-green-500' : 'text-red-500') }, (trend > 0 ? '+' : '') + trend + '%')
  )
}
\`\`\`
\`\`\`yaml-spec
root: dashboard
elements:
  dashboard:
    type: Stack
    props: { direction: horizontal, gap: 4 }
    children: [s1, s2]
  s1:
    type: StatCard
    props: { label: "Users", value: "1,234", trend: 12 }
    children: []
  s2:
    type: StatCard
    props: { label: "Errors", value: "3", trend: -8 }
    children: []
\`\`\`

Use custom components when the predefined catalog doesn't cover your layout needs — e.g., specialized cards, custom meters, domain-specific widgets. You can use ALL Tailwind CSS classes and any React hooks.

### \`\`\`visualizer — Custom HTML/SVG/JS

For diagrams, charts, interactive widgets — anything beyond the yaml-spec component catalog. Content renders in a sandboxed iframe.

**Rules:**
- Output HTML/SVG inside a \`\`\`visualizer code fence (fragments only, no DOCTYPE)
- **IMPORTANT: TRANSPARENT BACKGROUND ONLY** — NEVER set background-color on html, body, or root containers. The host app provides the surface color and handles light/dark mode. Setting ANY background color (black, white, dark gray, etc.) will clash with the user's current theme. Let the page background show through.
- **Theming**: ALL colors must work in both light AND dark mode. Use CSS variables — \`var(--color-text-primary)\`, \`var(--color-text-secondary)\`, \`var(--color-background-secondary)\`, \`var(--color-border-primary)\`, etc. NEVER hardcode colors like \`#333\`, \`white\`, \`black\`, \`#1a1a2e\`, \`#0d1117\`, or any dark/light literal.
- **SVG**: viewBox 680px width, 14px labels, 0.5px strokes, \`dominant-baseline="central"\`
- **Streaming order**: \`<style>\` first → visible content → \`<script>\` last
- **No** \`localStorage\`, \`position: fixed\`, or external API fetches
- **Allowed CDNs**: cdnjs.cloudflare.com, esm.sh, cdn.jsdelivr.net, unpkg.com
- **Charts**: Chart.js 4 via CDN, wrap canvas in \`position:relative\` container with explicit height, read CSS vars for colors
- \`sendPrompt(text)\` triggers a follow-up chat message from the visual

**When to use**: "diagram of X", "visualize Y", interactive explorers with sliders/controls, Chart.js/D3 charts, SVG mechanism drawings, mockup presentations.

**BE CREATIVE AND PROACTIVE WITH VISUALIZATION** — Don't wait for the user to ask for visuals. Whenever your response contains structured data (lists, comparisons, metrics, status reports, analysis results, architecture overviews, workflows), render it as yaml-spec or visualizer instead of plain markdown. A well-designed visual communicates faster than a wall of text. Think like a designer: use CardCarousel for options, Table for comparisons, Timeline for sequences, Metric for KPIs, custom components for domain-specific data, and visualizer for diagrams and charts. This hint contains everything you need — do NOT load the render-ui or visualise skills unless the user explicitly requests advanced rendering features.`

/**
 * Instructions injected into agent prompts for
 * scientific discovery projects using directory-scoped isolation.
 */
export const DISCOVERY_MODE_INSTRUCTIONS = `
## Discovery Mode — Directory-Scoped Project

This project uses **discovery mode**: each task runs in its own directory under \`analysis/\`.
Scripts AND outputs live together in the task directory — self-contained and isolated.

### Directory Structure
\`\`\`
project-root/
├── data/                              # Shared input data (read-only, do NOT modify)
├── src/                               # Shared utility scripts (optional, git-tracked)
├── analysis/
│   ├── {milestone}/{task}/            # Each task's workspace
│   │   ├── *.py / *.R / *.sh         # Scripts (git-tracked)
│   │   ├── *.bed / *.tsv / *.png     # Outputs (may be gitignored)
│   │   └── _manifest.json            # Output registry (auto-generated)
│   └── .archived/                     # Pruned milestones (DO NOT read)
└── .gitignore
\`\`\`

### Rules
1. **Work in your assigned directory.** Your task prompt specifies the output directory — write ALL scripts and outputs there.
2. **Do NOT read from \`.archived/\` or \`deprecated/\`.** These contain invalidated analysis.
3. **Reference upstream outputs by path.** Your task prompt lists input directories from dependency tasks — read from those paths.
4. **Commit scripts, not large outputs.** Use \`git add\` selectively for \`.py\`, \`.R\`, \`.sh\`, \`.md\` files. Large binary outputs (\`.bed\`, \`.bam\`, \`.h5\`, \`.png\`) should stay untracked.
5. **Write a \`_manifest.json\`** at the end listing your output files with brief descriptions.

### Commit Conventions
- Use structured messages: \`[{milestone}/{task}] description\`
- Commit at logical checkpoints (after each analysis step)
- Only stage files from your task directory

### Output Manifest
At the end of your task, write \`_manifest.json\` in your output directory:
\`\`\`json
{
  "outputs": [
    {"file": "result.tsv", "description": "Gene-level summary table", "rows": 19509},
    {"file": "enrichment_barplot.png", "description": "GO enrichment bar chart"}
  ],
  "summary": "Brief 1-2 sentence summary of findings"
}
\`\`\`
`

// ============================================================================
// Import-from-history bootstrap prompt
// ============================================================================

/** Manifest entry shape as seen by the planning agent. Structural subset of
 *  `ProjectImportManifestEntry` from the db schema; redeclared here so this
 *  module has no dependency on `@astro/core/db`. */
export interface ImportedSessionEntry {
  provider: 'claude' | 'codex' | 'pi'
  sessionId: string
  /** Path of the copied transcript, relative to `.astro/imports/`. */
  localPath: string
  /** Planned path for the per-session memory summary, relative to `.astro/imports/`. */
  memoryPath: string
  title: string
  cwd?: string
  gitBranch?: string
  lastModified?: number
}

/**
 * System prompt for a project bootstrapped from external-agent transcripts.
 *
 * Run order this prompt assumes:
 *   1. `<workingDir>/.astro/imports/raw/<provider>-<sessionId>.jsonl` already
 *      exists (copied by the agent-runner's `import_sessions_request` handler
 *      *before* this prompt runs).
 *   2. `<workingDir>/.astro/imports/memory/` exists but is empty.
 *   3. `<workingDir>/.astro/imports/manifest.json` records what was copied.
 *
 * The agent is instructed to spawn one Task subagent per session so raw
 * JSONLs are never Read into the main context. Each subagent writes a
 * Markdown summary to `memory/<provider>-<sessionId>.md`; the main agent
 * then reads the memory files and either produces an Astro plan or opens a
 * playground chat, depending on `mode`.
 */
export function buildImportFromHistoryPrompt(options: {
  mode: 'plan' | 'playground'
  workingDirectory: string
  manifest: ImportedSessionEntry[]
  /** Optional user goal text to focus the synthesis. */
  userGoal?: string
  projectId?: string
  visionDoc?: string
  githubContext?: GitHubContextForPrompt
}): string {
  const { mode, workingDirectory, manifest, userGoal, projectId, visionDoc, githubContext } = options

  const visionSection = visionDoc
    ? `\n## Project Vision Document\n<user_vision>\n${visionDoc}\n</user_vision>\n`
    : ''

  const projectIdSection = projectId
    ? `\n## Project ID\nUse this exact project ID when calling Astro CLI: \`${projectId}\`\n`
    : ''

  let githubSection = ''
  if (githubContext?.hasRepo && githubContext.owner && githubContext.repo) {
    const ghOwner = sanitizeGitHubName(githubContext.owner)
    const ghRepo = sanitizeGitHubName(githubContext.repo)
    const target = sanitizeGitBranch(githubContext.baseBranch || 'main')
    if (ghOwner && ghRepo) {
      githubSection = `\n## GitHub Integration
This project is connected to \`${ghOwner}/${ghRepo}\` (base branch: \`${target}\`). If you produce a plan, the final step should open a pull request once tasks complete.
`
    }
  }

  const userGoalSection = userGoal?.trim()
    ? `\n## User Goal\n<user_goal>\n${userGoal.trim()}\n</user_goal>\n`
    : "\n## User Goal\nNo explicit goal was provided — infer direction from the imported transcripts.\n"

  // Manifest values — title / cwd / gitBranch — originate from external
  // agent transcripts on the user's machine, so they're effectively
  // user-controlled. Strip characters that could close our code fence or
  // inject prompt structure. Keeps titles human-readable but neutered.
  const sanitizeForPrompt = (s: string): string =>
    s
      .replace(/`/g, "'")
      .replace(/[\r\n]+/g, ' ')
      // eslint-disable-next-line no-control-regex -- intentionally strip control chars from agent-authored titles
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 300)

  const manifestLines = manifest
    .map((m, i) => {
      const parts = [
        `${i + 1}. [${m.provider}] "${sanitizeForPrompt(m.title)}"`,
        `   raw:    ${sanitizeForPrompt(m.localPath)}`,
        `   memory: ${sanitizeForPrompt(m.memoryPath)}`,
      ]
      if (m.cwd) parts.push(`   cwd:    ${sanitizeForPrompt(m.cwd)}`)
      if (m.gitBranch) parts.push(`   branch: ${sanitizeForPrompt(m.gitBranch)}`)
      if (m.lastModified) parts.push(`   last:   ${new Date(m.lastModified).toISOString()}`)
      return parts.join('\n')
    })
    .join('\n')

  const modeInstructions = mode === 'plan'
    ? `### Phase 3 — Produce an Astro plan

Using \`astro-cli plan create-node\`, turn the synthesis into a structured plan
for the user's project. Each distinct outstanding thread from Phase 2 should
become a milestone or task. Preserve dependencies you observed across sessions
(e.g., if the Codex session built a schema that the Claude session then
consumed, the tasks should reflect that order). Include a short \`description\`
on each task that cites the relevant memory file (e.g.,
\`"See memory/codex-019d0972.md — refactor auth module"\`).`
    : `### Phase 3 — Engage the user

Summarize what you found across the imported sessions in 4–8 bullets: current
state of the project, outstanding problems, and where the previous agents
stopped. Then ask the user what they want to pick up next. Only call
\`astro-cli plan create-node\` if the user's reply clearly warrants a
structured plan; otherwise keep the conversation free-form.`

  return `You are bootstrapping an Astro project from transcripts of prior coding-agent sessions.
All the work in this project so far happened in external tools (Claude Code, Codex, Pi);
your job is to read what happened, understand where the project stands, and produce
${mode === 'plan' ? 'a plan' : 'a conversational summary and next-step proposal'} so the user can continue with Astro managing it.
${projectIdSection}${githubSection}${visionSection}${userGoalSection}
## Import Source

This project was bootstrapped from ${manifest.length} prior session${manifest.length === 1 ? '' : 's'}.
Their transcripts live under \`${workingDirectory}/.astro/imports/\`:

- \`raw/<provider>-<sessionId>.jsonl\` — original transcript (copied on import)
- \`memory/<provider>-<sessionId>.md\` — your per-session summary (empty now)
- \`manifest.json\` — authoritative list (also inlined below)

### Manifest

\`\`\`
${manifestLines}
\`\`\`

## Phases

### Phase 1 — Per-session summarization (parallel via Task)

For EACH entry in the manifest, spawn a Task subagent with these instructions:

> Read only \`raw/<provider>-<sessionId>.jsonl\` with the Read and Grep tools.
> The file may be many megabytes — do NOT Read the whole file at once. Use
> Grep to locate user prompts (\`"role":"user"\`), tool calls, and file-change
> events; Read targeted line ranges only. Produce a Markdown summary with
> these sections: **Goal**, **Key Decisions**, **Artifacts** (file paths
> touched), **Dead Ends**, **Open Questions**. Keep under 4,000 characters.
> Write the result to \`memory/<provider>-<sessionId>.md\` using Write.

Give each subagent access to \`Read\`, \`Grep\`, and \`Write\` (restricted to
the \`memory/\` path). Forbid Bash and any network tool — summarization is
pure text analysis.

**IMPORTANT**: Use the \`Task\` tool to run summaries in parallel. Do NOT Read
the raw JSONL files yourself — they are too large for the main context.

**Fallback (only if \`Task\` is unavailable in your runtime)**: process each
session sequentially in the main loop. For each JSONL, use Grep with
narrow patterns (\`"role":"user"\`, \`"type":"tool_use"\`, \`"type":"file_change"\`)
to locate key lines, then Read only those line-number ranges — never the
whole file. Write each summary to \`memory/<provider>-<sessionId>.md\` before
moving on. Loading a whole megabyte-scale transcript into main context will
OOM the session; favor many small reads over one large one.

### Phase 2 — Synthesis

Once every \`memory/*.md\` exists, read them all. Identify overlaps and
dedupe. Determine:

- The current state of the project (what's built, what works, what's broken).
- Outstanding problems and unresolved questions.
- The direction of intent the prior sessions were heading in.

${modeInstructions}

## Ground rules

- Never modify files under \`.astro/imports/raw/\` — they are append-only
  historical artifacts.
- If a subagent fails (unreadable JSONL, malformed entries), note the
  failure in your Phase 2 synthesis but do not retry indefinitely.
- Honor the user goal above as the primary lens when prioritizing threads;
  fall back to the transcripts' own direction if the goal is absent.
`
}

