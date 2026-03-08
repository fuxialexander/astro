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

export interface RepoContextForPrompt {
  claudeMd?: string
  readmeMd?: string
  packageInfo?: string
  fileTreeSummary?: string
}


export interface GitStateForPrompt {
  currentBranch: string
  targetBranch: string
  isDirty: boolean
  dirtyDetails?: {
    staged: number
    unstaged: number
    untracked: number
  }
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
export function buildChatSystemPrompt(visionDoc?: string, planNodes?: ChatPlanNode[], planEdges?: ChatPlanEdge[], skillsInjection?: string): string {
  // SECURITY: Wrap user-provided content in delimiters
  const visionSection = visionDoc
    ? `\n\n## Project Vision Document\n<user_vision>\n${visionDoc}\n</user_vision>\n`
    : ""

  let planSection = ""
  if (planNodes && planNodes.length > 0) {
    // Build milestone lookup for display
    const milestoneMap = new Map<string, string>()
    for (const n of planNodes) {
      if (n.type === "milestone") milestoneMap.set(n.id, n.title)
    }
    // Build node title lookup
    const nodeNameMap = new Map<string, string>()
    for (const n of planNodes) nodeNameMap.set(n.id, n.title)

    const nodeList = planNodes.map((n) => {
      const milestoneName = n.milestoneId ? milestoneMap.get(n.milestoneId) : undefined
      const deps = (n.dependencies ?? []).map((d) => `${nodeNameMap.get(d) ?? d} [${d}]`).join(", ")
      const parts: string[] = [
        `${n.type}, ${n.status}`,
        n.priority ? `priority: ${n.priority}` : "",
        n.estimate ? `estimate: ${n.estimate}` : "",
        n.verification ? `verification: ${n.verification}` : "",
        n.dueDate ? `due: ${n.dueDate}` : "",
        milestoneName ? `milestone: ${milestoneName} [${n.milestoneId}]` : (n.type !== "milestone" ? "milestone: NONE" : ""),
        deps ? `depends on: ${deps}` : "",
      ].filter(Boolean)
      return `- **[${n.id}]** ${n.title} (${parts.join(", ")})\n  ${n.description}`
    }).join("\n")

    // List available milestones for easy reference
    const milestoneList = planNodes
      .filter((n) => n.type === "milestone")
      .map((n) => `  - **[${n.id}]** ${n.title}`)
      .join("\n")
    const milestoneSection = milestoneList
      ? `\n\n## Available Milestones\n${milestoneList}\n`
      : ""

    // Show current edges
    let edgeSection = ""
    if (planEdges && planEdges.length > 0) {
      const edgeList = planEdges.map((e) => {
        const srcName = nodeNameMap.get(e.source) ?? e.source
        const tgtName = nodeNameMap.get(e.target) ?? e.target
        return `  - ${srcName} [${e.source}] → ${tgtName} [${e.target}] (${e.type})`
      }).join("\n")
      edgeSection = `\n\n## Current Edges (Dependencies)\n${edgeList}\n`
    }

    planSection = `\n\n## Current Plan Nodes\n${nodeList}\n${milestoneSection}${edgeSection}`
  }

  return `You are a project planning assistant for Astro with full tool capability. Help the user refine their project plan through conversation. You can modify any task property, manage dependencies/edges between nodes, and restructure the plan graph.

You have access to all standard tools:
- File tools (Read, Grep, Glob, Edit, Write): Explore and modify the project codebase
- Shell (Bash): Run commands, install packages, execute scripts
- Web (WebSearch, WebFetch): Look up technologies, best practices, or documentation
- Notebook (NotebookEdit): Edit Jupyter notebooks

Use tools freely when the user's question needs information beyond the plan context, or when they ask you to make changes to the codebase. You are a planning assistant with execution capability — you can both plan and act.

Be smart and reason through the tasks. Infer dependencies, priorities, due dates, estimates, and other metadata yourself based on the project context — do NOT ask the user about these unless it is genuinely ambiguous and critical to get right. Most of the time they are not important enough to interrupt the user.

Be concise and actionable.
${visionSection}${planSection}${skillsInjection ? `\n\n## Available Skills & Tools\n\n${skillsInjection}\n` : ''}
## Modifying the Plan

When the user asks to update, modify, or change anything in the plan, you MUST:
1. Identify the relevant tasks/edges from the plan above.
2. Apply changes by including a single structured JSON block at the END of your response.
3. Explain what you changed conversationally BEFORE the JSON block.

### Mutation Format

Output a single \`\`\`json code block containing a JSON object with up to three optional arrays:

- **"updateNodes"** — Modify existing nodes. Each object needs **"nodeId"** (exact ID, preferred) OR **"nodeTitle"** (case-insensitive title match), plus fields to change:
  - "title", "description" (plain text), "content" (HTML — set BOTH when changing descriptions)
  - "type": "milestone" | "task" | "decision"
  - "status": "planned" | "completed" | "pruned" | "dispatched" | "in_progress" | "auto_verified" | "awaiting_judgment"
  - "priority": "urgent" | "high" | "medium" | "low" | "none"
  - "estimate": "XS" | "S" | "M" | "L" | "XL"
  - "milestoneId", "dueDate" (YYYY-MM-DD), "startDate", "endDate", "verification" ("auto"|"human")
  - "dependencies" (string[]) — replaces the full list; edges are auto-reconciled

- **"addNodes"** — Create new nodes. "title" and "description" are required:
  - "id" (optional temp ID for cross-referencing within the same block)
  - "type" (default "task"), "milestoneId", "dependencies" (string[]), "priority", "estimate", "verification"

- **"updateEdges"** — Add or remove edges:
  - "action": "add" | "remove", "source": node ID, "target": node ID, "type": "dependency" | "branch"

### Example

User: "Reprioritize the API tasks and add a caching layer before deployment"

\`\`\`json
{
  "updateNodes": [
    { "nodeId": "abc-123", "priority": "urgent", "estimate": "M" },
    { "nodeTitle": "Deploy to production", "type": "task", "priority": "low" }
  ],
  "addNodes": [
    {
      "id": "cache1",
      "title": "Add Redis caching layer",
      "description": "Set up Redis cache for API responses to reduce DB load",
      "milestoneId": "m1",
      "dependencies": ["abc-123"],
      "priority": "high",
      "estimate": "M"
    }
  ],
  "updateEdges": [
    { "action": "add", "source": "cache1", "target": "deploy-node-id", "type": "dependency" }
  ]
}
\`\`\`

### Decomposition

When breaking down a task into sub-tasks:
- Target each sub-task at ~20 min / <1000 LOC. Estimate "XS"/"S"/"M" — never larger than "M"
- Preserve the original task's milestone assignment
- Mark the original task as "completed" or "pruned" via updateNodes
- Wire dependencies so sub-tasks form a clear DAG; prefer parallel branches when independent

### Rules
- Only include fields that should change. Omit unchanged fields.
- Do NOT include the JSON block if no changes are needed (e.g. the user is just asking a question).
- Do NOT output any other \`\`\`json code blocks in your response — the only JSON block should be the mutation.
- **CRITICAL:** When the user asks to change, update, add, remove, or modify ANYTHING in the plan, you MUST include the JSON block. This is the ONLY way changes are applied to the graph — without it, nothing happens. Never just describe what to do; always emit the block.
- Do NOT output a full plan JSON object (with "projectName", "nodes", "edges" top-level keys). Only use the mutation format above ("updateNodes", "addNodes", "updateEdges").`
}

export interface TaskExecutionContext {
  taskTitle: string
  taskDescription: string
  visionDoc?: string
  dependencyOutputs?: string
  workingDirectory?: string
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

  // Add execution instructions
  parts.push(`## Instructions

Execute the task described above. Focus on completing the task thoroughly and correctly.
- Use appropriate tools to accomplish the task
- Report progress and any issues encountered
- Verify your work when possible
- Be thorough but efficient

**IMPORTANT: When you have finished the task, you MUST end your response with an executive summary in exactly this format:**

\`\`\`
## Executive Summary
**Status:** success | partial | failure
**What was done:** One sentence describing the overall outcome.
- Key finding or change 1
- Key finding or change 2
- Key finding or change 3
**Follow-ups:**
- Suggested follow-up action (if any)
\`\`\`

This summary is shown to the user for review. Keep each bullet concise (under 100 characters). Include 2-5 key findings. The summary must be the very last thing you output.`)

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
 * AskUserQuestion tool, share reasoning as it goes, and produce a final plan JSON
 * only after sufficient exploration and user alignment.
 */
export function buildInteractivePlanPrompt(
  description: string,
  options?: {
    visionDoc?: string
    repoContext?: RepoContextForPrompt
    gitState?: GitStateForPrompt
    skillsSummary?: string
    githubContext?: GitHubContextForPrompt
    replanContext?: import('./types.js').ReplanContext
    providerId?: string
  }
): string {
  const visionSection = options?.visionDoc
    ? `\n## Project Vision Document\n<user_vision>\n${options.visionDoc}\n</user_vision>\n`
    : ""

  let repoSection = ""
  if (options?.repoContext) {
    const parts: string[] = []
    if (options.repoContext.claudeMd) {
      parts.push(`## CLAUDE.md (Project Instructions)\n<user_content>\n${options.repoContext.claudeMd}\n</user_content>`)
    }
    if (options.repoContext.readmeMd) {
      parts.push(`## README.md\n<user_content>\n${options.repoContext.readmeMd}\n</user_content>`)
    }
    if (options.repoContext.packageInfo) {
      parts.push(`## Package Metadata\n<user_content>\n${options.repoContext.packageInfo}\n</user_content>`)
    }
    if (options.repoContext.fileTreeSummary) {
      parts.push(`## File Tree\n<user_content>\n${options.repoContext.fileTreeSummary}\n</user_content>`)
    }
    if (parts.length > 0) {
      repoSection = '\n' + parts.join('\n\n') + '\n'
    }
  }

  let gitStateSection = ""
  if (options?.gitState) {
    const gs = options.gitState
    const sanitizeBranch = (b: string) => b.replace(/[`\n\r]/g, '')
    const parts: string[] = [`## Git Repository State`]
    parts.push(`- Current branch: \`${sanitizeBranch(gs.currentBranch)}\``)
    parts.push(`- Target branch: \`${sanitizeBranch(gs.targetBranch)}\``)
    if (gs.isDirty) {
      const d = gs.dirtyDetails
      if (d) {
        const details = [
          d.staged > 0 ? `${d.staged} staged` : null,
          d.unstaged > 0 ? `${d.unstaged} modified` : null,
          d.untracked > 0 ? `${d.untracked} untracked` : null,
        ].filter(Boolean).join(', ')
        parts.push(`- Working directory has uncommitted changes: ${details} files`)
      } else {
        parts.push('- Working directory has uncommitted changes')
      }
    }
    gitStateSection = '\n' + parts.join('\n') + '\n'
  }

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
The final step must open a pull request that merges all completed work into the \`${target}\` branch.

You MUST include a final task node titled "Push to GitHub" that:
- Depends on ALL other task nodes (it is the very last step in the plan)
- type: "task" (not milestone — an agent will execute this)
- verification: "auto"
- estimate: "XS"
- labelIds: ["l4"] (Infrastructure)
- milestoneId: set to the last milestone in the plan (the one this final task contributes toward)
- description: "Open a pull request on ${ghOwner}/${ghRepo} that merges the project branch into \`${target}\`. Before creating the PR, ensure the project branch is rebased onto the latest \`${target}\`: run git fetch origin ${target} && git rebase origin/${target}. If the rebase has conflicts, resolve each conflicting file, then git add the resolved files and git rebase --continue. After resolving, force-push with git push --force-with-lease origin <project-branch>. The PR description should include a comprehensive summary of every completed task, link to per-task PRs where available, and list key changes. After creating the PR, if GitHub reports merge conflicts, rebase onto the latest \`${target}\`, resolve conflicts, and force-push with --force-with-lease. Then wait for CI checks (tests, lint, type checks, AI code review) to finish. If any check fails or a reviewer requests changes, read the feedback, fix the issues, push to the project branch, and re-check — up to 3 retry cycles. The task succeeds when all required checks pass."
- acceptanceCriteria: [{ id: "ci-pass", description: "All CI checks pass on the final PR", type: "command", command: "gh pr checks --required", autoVerifiable: true }]
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

  const hasCodebase = !!options?.repoContext

  let approachSection: string
  if (hasCodebase) {
    approachSection = `
1. **Quick survey of the codebase** — Get a high-level understanding first. Read READMEs, CLAUDE.md, package.json, and use Glob to see the directory/file tree structure. Do NOT dive into individual source files yet — just get the lay of the land.

2. **Ask clarifying questions** — If you have a tool to ask the user questions (e.g., AskUserQuestion or an MCP equivalent), use it to clarify:
   - Architectural decisions (e.g., which approach to take)
   - Scope choices (e.g., what to include/exclude)
   - Technology tradeoffs (e.g., library choices)
   **Ask only one question per call.** Calibrate how many you ask: short/vague descriptions deserve more questions; long/detailed descriptions need fewer — only critical clarifications.
   If no question-asking tool is available, make reasonable assumptions and list them after the plan.

3. **Deep-dive into relevant files** — Use Read, Glob, and Grep to examine the specific files and code sections that are relevant to the plan. Share what you find as you go.

4. **Share your reasoning** — Think out loud as you explore. Explain what you're finding, what patterns you see, and how they inform the plan.

5. **Produce the final plan** — Once you have enough information, output the complete plan as a JSON object in a \`\`\`json code fence. After the JSON, list any assumptions and open questions.`
  } else {
    approachSection = `
1. **Ask clarifying questions** — If you have a tool to ask the user questions (e.g., AskUserQuestion or an MCP equivalent), use it to clarify:
   - Architectural decisions, scope choices, technology tradeoffs, priority decisions
   **Ask only one question per call.** Short/vague descriptions deserve more questions; long/detailed ones need fewer.
   If no question-asking tool is available, make reasonable assumptions and list them after the plan.

2. **Use web search** — Use WebSearch and WebFetch to research relevant technologies, libraries, best practices, or documentation that would inform the plan.

3. **Share your reasoning** — Think out loud. Explain your thought process, what tradeoffs you see, and how they inform the plan.

4. **Produce the final plan** — Output the complete plan as a JSON object in a \`\`\`json code fence. After the JSON, list any assumptions and open questions.`
  }

  const importantSection = `## Important
- Do NOT write code, create files, or build anything. Your only job is to plan — the tasks you create will be executed later by agents.
- Your text output is visible to the user in real-time as a chat conversation.
- The JSON plan MUST be wrapped in a \`\`\`json code fence.
- After the JSON, you may list assumptions and open questions so the user can refine the plan.`

  return `You are an interactive project planning assistant. Your goal is to help the user create a detailed, actionable project plan through exploration and discussion.

## User's Goal
<user_goal>
${description}
</user_goal>
${visionSection}${replanSection}${repoSection}${gitStateSection}${skillsSection}${githubSection}
## Your Approach
${approachSection}

## Plan Output Format

When ready, output a single JSON object with this structure:
\`\`\`json
{
  "projectName": "Short Project Name",
  "nodes": [
    {
      "id": "n1",
      "type": "task",
      "title": "Task title",
      "description": "Concrete developer brief: what to build, which files to modify, constraints to follow, and what done looks like. This is the prompt sent to the AI agent.",
      "status": "planned",
      "parentId": null,
      "dependencies": [],
      "verification": "auto",
      "position": {"x": 40, "y": 40},
      "priority": "medium",
      "estimate": "M",
      "milestoneId": "n5",
      "labelIds": ["l2"]
    },
    {
      "id": "n5",
      "type": "milestone",
      "title": "MVP Complete",
      "description": "First milestone",
      "status": "planned",
      "parentId": null,
      "dependencies": ["n1"],
      "verification": "human",
      "position": {"x": 40, "y": 440},
      "startDate": "2026-03-01",
      "endDate": "2026-03-01"
    }
  ],
  "edges": [
    {"id": "e1", "source": "n1", "target": "n5", "type": "dependency"}
  ]
}
\`\`\`

## Task Description Quality

The description field is the primary prompt sent to the AI agent that executes the task. Write each description as a concrete brief: what to do, why, which files/modules, constraints, and what "done" looks like. Avoid vague descriptions like "implement the backend" — specify endpoints, data models, file paths, and patterns to follow.

## Parallel Task File Separation

Parallel tasks (no dependency edge between them) run as separate agents in isolated git worktrees, then merge into a shared project branch. To minimize merge conflicts:
- Split by file boundaries — each parallel task should touch distinct files
- If two tasks must modify the same file, add a dependency edge between them
- Put shared types/interfaces in an earlier task that parallel tasks depend on
- Group related changes (component + test + styles) into one task

## Node Rules
- type: "milestone" for checkpoints, "task" for work items, "decision" for human-judgment points
- All status: "planned"
- verification: "auto" if programmatically verifiable, "human" otherwise
- position: top-to-bottom layout starting at {x:40,y:40}, increment y by 100. Parallel branches offset x by 260
- Tasks do NOT have startDate/endDate. Milestones MUST have both (equal, YYYY-MM-DD)
- priority: "urgent" | "high" | "medium" | "low" | "none"
- estimate: "XS" | "S" | "M" | "L" | "XL". Target each task at ~20 min of expert work or <1000 lines changed
- milestoneId: REQUIRED for tasks — every task must reference a milestone
- labelIds: from {l1: Frontend/UI, l2: Backend/API, l3: Testing/QA, l4: Infrastructure/DevOps, l5: Research}
- acceptanceCriteria: optional array of verification checks with {id, description, type, command?, autoVerifiable}
- Aim for 6–15 nodes, but this is flexible — use more for complex projects, fewer for simple ones. Valid DAG (no cycles)
- projectName: at most 7 words, title case, no filler words

## Edge Rules
- type: "dependency" for sequential, "branch" for parallel paths

${importantSection}`
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
