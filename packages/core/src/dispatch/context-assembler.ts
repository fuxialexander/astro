/**
 * Context Assembler
 *
 * Assembles the full execution context for a task dispatch.
 * Gathers vision document, dependency outputs, and graph position.
 */

import type { PlanNode, PlanEdge, Project } from '../types.js'
import type {
  AssembledContext,
  DependencyOutput,
  GraphPosition,
  DependencyResolution,
  DispatchEngineConfig,
} from './types.js'

/**
 * Assembles execution context for a task
 */
export class ContextAssembler {
  config: Pick<DispatchEngineConfig, 'maxDependencyOutputSize'>
  constructor(config: Pick<DispatchEngineConfig, 'maxDependencyOutputSize'>) {
    this.config = config
  }

  /**
   * Assemble full context for a task
   */
  assembleContext(
    node: PlanNode,
    allNodes: PlanNode[],
    allEdges: PlanEdge[],
    project?: Project
  ): AssembledContext {
    const dependencyOutputs = this.gatherDependencyOutputs(node, allNodes)
    const graphPosition = this.calculateGraphPosition(node, allNodes, allEdges)

    const projectDir = project?.sourceDirectory ?? project?.workingDirectory

    return {
      node,
      projectId: node.projectId,
      visionDoc: project?.visionDoc,
      dependencyOutputs,
      graphPosition,
      workingDirectory: projectDir ?? project?.repository,
      originalProjectDirectory: projectDir,
      resourcePaths: project?.resourcePaths,
    }
  }

  /**
   * Gather outputs from completed dependencies
   */
  gatherDependencyOutputs(node: PlanNode, allNodes: PlanNode[]): DependencyOutput[] {
    const outputs: DependencyOutput[] = []

    for (const depId of node.dependencies) {
      const depNode = allNodes.find((n) => n.id === depId)
      if (!depNode) continue

      // Skip if no output
      if (!depNode.executionOutput) continue

      // Truncate if needed
      const maxSize = this.config.maxDependencyOutputSize
      const output = depNode.executionOutput
      const truncated = output.length > maxSize
      const truncatedOutput = truncated ? output.slice(0, maxSize) + '\n\n[Output truncated...]' : output

      outputs.push({
        nodeId: depNode.id,
        title: depNode.title,
        output: truncatedOutput,
        truncated,
        status: depNode.status,
      })
    }

    return outputs
  }

  /**
   * Calculate the position of a node in the plan graph
   */
  calculateGraphPosition(
    node: PlanNode,
    allNodes: PlanNode[],
    allEdges: PlanEdge[]
  ): GraphPosition {
    // Build adjacency maps
    const incomingEdges = new Map<string, PlanEdge[]>()
    const outgoingEdges = new Map<string, PlanEdge[]>()

    for (const edge of allEdges) {
      if (!incomingEdges.has(edge.target)) {
        incomingEdges.set(edge.target, [])
      }
      incomingEdges.get(edge.target)!.push(edge)

      if (!outgoingEdges.has(edge.source)) {
        outgoingEdges.set(edge.source, [])
      }
      outgoingEdges.get(edge.source)!.push(edge)
    }

    // Calculate depth (longest path from any root)
    const depth = this.calculateDepth(node.id, incomingEdges)

    // Count upstream (all ancestors)
    const upstreamCount = this.countAncestors(node.id, incomingEdges)

    // Count downstream (all descendants)
    const downstreamCount = this.countDescendants(node.id, outgoingEdges)

    // Check if on a branch
    const { isOnBranch, branchId } = this.detectBranch(node.id, incomingEdges)

    // Count parallel siblings (nodes with same set of parents)
    const parallelSiblings = this.countParallelSiblings(node, allNodes, incomingEdges)

    return {
      depth,
      upstreamCount,
      downstreamCount,
      isOnBranch,
      branchId,
      parallelSiblings,
    }
  }

  /**
   * Calculate depth of a node (longest path from root)
   */
  private calculateDepth(
    nodeId: string,
    incomingEdges: Map<string, PlanEdge[]>,
    visited = new Set<string>()
  ): number {
    if (visited.has(nodeId)) return 0
    visited.add(nodeId)

    const incoming = incomingEdges.get(nodeId) || []
    if (incoming.length === 0) return 0

    let maxDepth = 0
    for (const edge of incoming) {
      const parentDepth = this.calculateDepth(edge.source, incomingEdges, visited)
      maxDepth = Math.max(maxDepth, parentDepth + 1)
    }

    return maxDepth
  }

  /**
   * Count all ancestors of a node
   */
  private countAncestors(
    nodeId: string,
    incomingEdges: Map<string, PlanEdge[]>,
    visited = new Set<string>()
  ): number {
    if (visited.has(nodeId)) return 0
    visited.add(nodeId)

    const incoming = incomingEdges.get(nodeId) || []
    let count = incoming.length

    for (const edge of incoming) {
      count += this.countAncestors(edge.source, incomingEdges, visited)
    }

    return count
  }

  /**
   * Count all descendants of a node
   */
  private countDescendants(
    nodeId: string,
    outgoingEdges: Map<string, PlanEdge[]>,
    visited = new Set<string>()
  ): number {
    if (visited.has(nodeId)) return 0
    visited.add(nodeId)

    const outgoing = outgoingEdges.get(nodeId) || []
    let count = outgoing.length

    for (const edge of outgoing) {
      count += this.countDescendants(edge.target, outgoingEdges, visited)
    }

    return count
  }

  /**
   * Detect if a node is on a branch path
   */
  private detectBranch(
    nodeId: string,
    incomingEdges: Map<string, PlanEdge[]>
  ): { isOnBranch: boolean; branchId?: string } {
    // Walk up to find if any incoming edge is a branch type
    const visited = new Set<string>()
    const toVisit = [nodeId]

    while (toVisit.length > 0) {
      const currentId = toVisit.pop()!
      if (visited.has(currentId)) continue
      visited.add(currentId)

      const incoming = incomingEdges.get(currentId) || []
      for (const edge of incoming) {
        if (edge.type === 'branch') {
          return { isOnBranch: true, branchId: edge.source }
        }
        toVisit.push(edge.source)
      }
    }

    return { isOnBranch: false }
  }

  /**
   * Count nodes that share the same parents (parallel execution candidates)
   */
  private countParallelSiblings(
    node: PlanNode,
    allNodes: PlanNode[],
    incomingEdges: Map<string, PlanEdge[]>
  ): number {
    // Get parent IDs for this node
    const nodeParents = (incomingEdges.get(node.id) || []).map((e) => e.source).sort()
    if (nodeParents.length === 0) return 0

    const parentKey = nodeParents.join(',')

    // Count other nodes with same parents
    let siblings = 0
    for (const other of allNodes) {
      if (other.id === node.id) continue

      const otherParents = (incomingEdges.get(other.id) || []).map((e) => e.source).sort()
      if (otherParents.join(',') === parentKey) {
        siblings++
      }
    }

    return siblings
  }

  /**
   * Resolve dependencies for a node
   */
  resolveDependencies(
    node: PlanNode,
    allNodes: PlanNode[]
  ): DependencyResolution {
    const completed: string[] = []
    const pending: string[] = []
    const failed: string[] = []
    const pruned: string[] = []

    for (const depId of node.dependencies) {
      const depNode = allNodes.find((n) => n.id === depId)
      if (!depNode) {
        failed.push(depId) // Missing dependency counts as failed
        continue
      }

      switch (depNode.status) {
        case 'completed':
        case 'auto_verified':
          completed.push(depId)
          break
        case 'awaiting_judgment':
          // Awaiting judgment is still pending (needs human approval)
          pending.push(depId)
          break
        case 'pruned':
          pruned.push(depId)
          break
        case 'planned':
        case 'dispatched':
        case 'in_progress':
          pending.push(depId)
          break
        default:
          pending.push(depId)
      }
    }

    // All met if no pending and no failed
    // Pruned dependencies are treated as blocking by default
    const allMet = pending.length === 0 && failed.length === 0 && pruned.length === 0

    return {
      allMet,
      completed,
      pending,
      failed,
      pruned,
    }
  }

  /**
   * Build the execution prompt from assembled context
   *
   * @param skillPromptInjection - Optional XML block of skill instructions to inject
   */
  buildExecutionPrompt(context: AssembledContext, skillPromptInjection?: string): string {
    const parts: string[] = []

    // Vision doc
    if (context.visionDoc) {
      parts.push(`## Project Vision\n\n${context.visionDoc}`)
    }

    // Skill instructions (injected after vision, before task context)
    if (skillPromptInjection) {
      parts.push(`## Agent Skills\n\n${skillPromptInjection}`)
    }

    // Graph position context
    const positionContext = this.buildPositionContext(context.graphPosition)
    if (positionContext) {
      parts.push(`## Task Context\n\n${positionContext}`)
    }

    // Dependency outputs
    if (context.dependencyOutputs.length > 0) {
      const depsSection = context.dependencyOutputs
        .map((d) => `### ${d.title}\n\n${d.output}`)
        .join('\n\n---\n\n')
      parts.push(`## Previous Task Outputs\n\nThe following tasks have been completed. Use their outputs as context:\n\n${depsSection}`)
    }

    // Working directory
    if (context.workingDirectory) {
      parts.push(`## Working Directory\n\n${context.workingDirectory}`)
    }

    // Data access note for worktree-based execution
    if (context.originalProjectDirectory) {
      parts.push(`## Data Access\n\nYour working directory is a git worktree (isolated branch) in the project's agent directory.\nThe original project directory is: ${context.originalProjectDirectory}\nLarge untracked files (training data, model caches, datasets) remain in the original directory. Use absolute paths to reference them. Always use absolute paths when writing code that accesses data files.`)
    }

    // Resource paths
    if (context.resourcePaths && context.resourcePaths.length > 0) {
      const pathList = context.resourcePaths.map((p) => `- ${p}`).join('\n')
      parts.push(`## Additional Resource Folders\n\nThe following additional folders are available on this machine:\n${pathList}`)
    }

    // Current task
    parts.push(`## Current Task\n\n**${context.node.title}**\n\n${context.node.description}`)

    // Output directory guidance
    if (context.originalProjectDirectory) {
      parts.push(`## Output Directory

**CRITICAL:** Your working directory is a temporary git worktree that will be deleted after this task finishes. Any files not preserved will be permanently lost.

To preserve your work, you have two options:
1. **Git commit** — Code changes committed to git are preserved via the branch/PR.
2. **Copy to outputs/** — For anything that won't be committed (reports, charts, data files, generated documents, analysis results, scripts, notebooks, or any file the user should see after this task), copy them to:
   ${context.originalProjectDirectory}/outputs/

Create the directory if it doesn't exist. Use absolute paths. When in doubt, copy it — it is better to have a duplicate than to lose work.`)
    }

    // Instructions
    parts.push(`## Instructions

Execute the task described above. Focus on completing the task thoroughly and correctly.
- Use appropriate tools to accomplish the task
- Report progress and any issues encountered
- Verify your work when possible
- Be thorough but efficient
- When you make code changes, commit them with a descriptive commit message before finishing. Do not leave uncommitted changes.`)

    return parts.join('\n\n---\n\n')
  }

  /**
   * Build context description from graph position
   */
  private buildPositionContext(position: GraphPosition): string {
    const parts: string[] = []

    if (position.depth > 0) {
      parts.push(`This task is at depth ${position.depth} in the plan graph.`)
    }

    if (position.upstreamCount > 0) {
      parts.push(`It has ${position.upstreamCount} upstream dependencies.`)
    }

    if (position.downstreamCount > 0) {
      parts.push(`${position.downstreamCount} tasks depend on this one.`)
    }

    if (position.isOnBranch && position.branchId) {
      parts.push(`This task is on an exploration branch.`)
    }

    if (position.parallelSiblings > 0) {
      parts.push(`${position.parallelSiblings} other tasks are running in parallel.`)
    }

    return parts.join(' ')
  }
}

/**
 * Create a context assembler with default configuration
 */
export function createContextAssembler(
  config?: Partial<Pick<DispatchEngineConfig, 'maxDependencyOutputSize'>>
): ContextAssembler {
  return new ContextAssembler({
    maxDependencyOutputSize: config?.maxDependencyOutputSize ?? 10000,
  })
}
