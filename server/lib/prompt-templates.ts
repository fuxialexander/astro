export const PLAN_GRAPH_SCHEMA = {
  type: "object" as const,
  properties: {
    projectName: { type: "string" as const, description: "A concise name for the project" },
    nodes: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const, description: "Unique node ID (e.g. n1, n2)" },
          type: { type: "string" as const, enum: ["milestone", "task", "branch", "decision"] },
          title: { type: "string" as const, description: "Short title for the task/milestone" },
          description: { type: "string" as const, description: "Detailed description of what needs to be done" },
          status: { type: "string" as const, enum: ["planned"] },
          parentId: { type: ["string", "null"] as const },
          dependencies: { type: "array" as const, items: { type: "string" as const }, description: "Array of node IDs this depends on" },
          environment: { type: "string" as const, enum: ["local", "hpc", "cloud"] },
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

export function buildPlanSystemPrompt(visionDoc?: string): string {
  const visionSection = visionDoc
    ? `\n\n## Project Vision Document\n${visionDoc}\n`
    : ""

  return `You are a JSON-only project planning API. You receive a project description and output ONLY a JSON object — no prose, no explanation, no markdown fences.

You decompose the project into a directed acyclic graph of tasks and milestones.
${visionSection}
## Node rules
- Each node has a unique id: "n1", "n2", etc.
- type: "milestone" for checkpoints, "task" for work items, "decision" for human-judgment points.
- All status: "planned".
- verification: "auto" if programmatically verifiable, "human" otherwise.
- environment: "local" | "hpc" | "cloud".
- position: top-to-bottom layout starting at {x:40,y:40}, increment y by 100. Parallel branches offset x by 260.
- parentId: null for all nodes.
- dependencies: array of prerequisite node ids.
- Tasks do NOT have startDate or endDate — they are agent-solvable work items without time estimates.
- Milestones MUST have startDate and endDate (both equal, zero duration). Use ISO "YYYY-MM-DD" format. A milestone's date should be after all its dependencies.

## Edge rules
- type: "dependency" for sequential, "branch" for parallel paths from a common node.

## Constraints
- 6–15 nodes. Valid DAG (no cycles).
- Output MUST be a single JSON object with keys: projectName (string), nodes (array), edges (array).
- Do NOT include any text before or after the JSON. Do NOT wrap in markdown code fences.

Example structure:
{"projectName":"...","nodes":[{"id":"n1","type":"task","title":"...","description":"...","status":"planned","parentId":null,"dependencies":[],"environment":"local","verification":"auto","position":{"x":40,"y":40}},{"id":"n2","type":"milestone","title":"MVP Complete","description":"...","status":"planned","parentId":null,"dependencies":["n1"],"verification":"human","position":{"x":40,"y":140},"startDate":"2026-02-10","endDate":"2026-02-10"}],"edges":[{"id":"e1","source":"n1","target":"n2","type":"dependency"}]}`
}

export function buildChatSystemPrompt(visionDoc?: string): string {
  const visionSection = visionDoc
    ? `\n\n## Project Vision Document\n${visionDoc}\n`
    : ""

  return `You are a project planning assistant for Nexus. Help the user refine their project plan through conversation. You can suggest changes to tasks, dependencies, milestones, and overall project structure.

Be concise and actionable. When suggesting plan modifications, describe what should change clearly.
${visionSection}`
}

export interface TaskExecutionContext {
  taskTitle: string
  taskDescription: string
  visionDoc?: string
  dependencyOutputs?: string
  workingDirectory?: string
}

export function buildTaskExecutionPrompt(context: TaskExecutionContext): string {
  const parts: string[] = []

  // Add vision doc if present
  if (context.visionDoc) {
    parts.push(`## Project Vision\n\n${context.visionDoc}`)
  }

  // Add dependency context if present
  if (context.dependencyOutputs) {
    parts.push(`## Previous Task Outputs\n\nThe following tasks have already been completed. Use their outputs as context:\n\n${context.dependencyOutputs}`)
  }

  // Add working directory
  if (context.workingDirectory) {
    parts.push(`## Working Directory\n\n${context.workingDirectory}`)
  }

  // Add the main task
  parts.push(`## Current Task\n\n**${context.taskTitle}**\n\n${context.taskDescription}`)

  // Add execution instructions
  parts.push(`## Instructions

Execute the task described above. Focus on completing the task thoroughly and correctly.
- Use appropriate tools to accomplish the task
- Report progress and any issues encountered
- Verify your work when possible
- Be thorough but efficient`)

  return parts.join('\n\n---\n\n')
}
