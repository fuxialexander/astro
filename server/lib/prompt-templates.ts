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
          startDate: { type: "string" as const, description: "Start date in YYYY-MM-DD format" },
          endDate: { type: "string" as const, description: "End date in YYYY-MM-DD format" },
        },
        required: ["id", "type", "title", "description", "status", "parentId", "dependencies", "verification", "position", "startDate", "endDate"],
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
- startDate / endDate: ISO "YYYY-MM-DD". Start from today (${new Date().toISOString().slice(0, 10)}). Each task 1–5 days. A node's startDate must be >= the endDate of every dependency. Milestones: startDate == endDate (zero duration).

## Edge rules
- type: "dependency" for sequential, "branch" for parallel paths from a common node.

## Constraints
- 6–15 nodes. Valid DAG (no cycles).
- Output MUST be a single JSON object with keys: projectName (string), nodes (array), edges (array).
- Do NOT include any text before or after the JSON. Do NOT wrap in markdown code fences.

Example structure:
{"projectName":"...","nodes":[{"id":"n1","type":"task","title":"...","description":"...","status":"planned","parentId":null,"dependencies":[],"environment":"local","verification":"auto","position":{"x":40,"y":40},"startDate":"2026-02-05","endDate":"2026-02-07"}],"edges":[{"id":"e1","source":"n1","target":"n2","type":"dependency"}]}`
}

export function buildChatSystemPrompt(visionDoc?: string): string {
  const visionSection = visionDoc
    ? `\n\n## Project Vision Document\n${visionDoc}\n`
    : ""

  return `You are a project planning assistant for Nexus. Help the user refine their project plan through conversation. You can suggest changes to tasks, dependencies, milestones, and overall project structure.

Be concise and actionable. When suggesting plan modifications, describe what should change clearly.
${visionSection}`
}
