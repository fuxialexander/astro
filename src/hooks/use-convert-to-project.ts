import { useState, useCallback } from "react"
import { useNavigate } from "react-router"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useToastStore } from "@/stores/toast-store"
import { dataClient } from "@/lib/data-client"
import { closePr, ensureBranch } from "@/lib/api-client"
import { getShortId } from "@/lib/utils"
import type { PlanNode, Project, ProjectSource } from "@/types"

/**
 * Strip HTML tags from rich text content (TipTap HTML).
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

/**
 * Build an enriched description from a plan node and its context.
 */
function buildEnrichedDescription(
  node: PlanNode,
  comments: Array<{ authorName: string; content: string }>,
): string {
  const parts: string[] = []

  parts.push(`# ${node.title}`)

  if (node.description) {
    parts.push(`\n## Description\n${node.description}`)
  }

  if (node.content) {
    const plainContent = stripHtml(node.content)
    if (plainContent) {
      parts.push(`\n## Detailed Content\n${plainContent}`)
    }
  }

  if (node.acceptanceCriteria?.length) {
    const criteria = node.acceptanceCriteria
      .map((c) => `- [${c.type}] ${c.description}${c.command ? ` (command: ${c.command})` : ""}`)
      .join("\n")
    parts.push(`\n## Acceptance Criteria\n${criteria}`)
  }

  if (node.executionOutput) {
    parts.push(`\n## Previous Execution Output\n${node.executionOutput}`)
  }

  if (node.executionError) {
    parts.push(`\n## Previous Execution Error\n${node.executionError}`)
  }

  if (comments.length > 0) {
    const commentLines = comments
      .map((c) => `- **${c.authorName}**: ${c.content}`)
      .join("\n")
    parts.push(`\n## Comments\n${commentLines}`)
  }

  return parts.join("\n")
}

interface ConvertOptions {
  node: PlanNode
  projectName: string
}

export function useConvertToProject() {
  const [isConverting, setIsConverting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const addProject = useProjectStore((s) => s.addProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const removeNodes = usePlanStore((s) => s.removeNodes)
  const startPlanSessionForProject = useExecutionStore((s) => s.startPlanSessionForProject)
  const addToast = useToastStore((s) => s.add)

  const convert = useCallback(async ({ node, projectName }: ConvertOptions): Promise<boolean> => {
    setIsConverting(true)
    setError(null)

    try {
      // Re-check isolation at convert time
      const liveEdges = usePlanStore.getState().edges.filter(isLive)
      const hasEdge = liveEdges.some((e) => e.source === node.id || e.target === node.id)
      if (hasEdge) {
        throw new Error("Node is no longer isolated — it has dependencies or dependents.")
      }

      // 1. Gather context
      let comments: Array<{ authorName: string; content: string }> = []
      try {
        comments = await dataClient.getComments(node.id, node.projectId)
      } catch {
        // Non-critical — continue without comments
      }
      const enrichedDescription = buildEnrichedDescription(node, comments)

      // 2. Resolve source project
      const sourceProject = useProjectStore.getState().projects.find(
        (p) => p.id === node.projectId,
      )
      if (!sourceProject) {
        throw new Error("Source project not found")
      }

      const isGitRepo = sourceProject.source?.isGit || !!sourceProject.githubOwner
      const isGitHub = !!(sourceProject.githubOwner && sourceProject.githubRepo)

      // 3. Resolve branches (if git repo)
      let sourceProjectBranch = sourceProject.projectBranch
      if (isGitRepo && !sourceProjectBranch) {
        sourceProjectBranch = `astro/${getShortId(sourceProject.id)}`
        // Intentional: Set branch on source project before conversion succeeds.
        // This is idempotent (setting a missing branch) and prevents duplicate work
        // if conversion is retried. All other mutations happen after validation.
        updateProject(sourceProject.id, { projectBranch: sourceProjectBranch })
      }

      // 4. GitHub-only: ensure branch exists on remote (best-effort)
      if (isGitHub && sourceProjectBranch) {
        const branchResult = await ensureBranch(
          sourceProject.githubOwner!,
          sourceProject.githubRepo!,
          sourceProjectBranch,
          sourceProject.source?.baseBranch,
        )
        if (!branchResult.success) {
          addToast({
            type: "warning",
            title: "Could not ensure branch on remote",
            description: branchResult.error,
          })
        }
      }

      // 5. GitHub-only: close PR (best-effort)
      if (isGitHub && node.prNumber) {
        const prResult = await closePr(
          sourceProject.githubOwner!,
          sourceProject.githubRepo!,
          node.prNumber,
        )
        if (!prResult.success) {
          addToast({
            type: "warning",
            title: `Could not close PR #${node.prNumber}`,
            description: prResult.error,
          })
        }
      }

      // 6. Create new project
      const newProjectId = crypto.randomUUID()
      const now = new Date()

      // Only create source if we have a valid working directory for git repos
      const source: ProjectSource | undefined =
        isGitRepo && sourceProjectBranch && sourceProject.workingDirectory
          ? {
              localPath: sourceProject.workingDirectory,
              isGit: true,
              remoteType: sourceProject.source?.remoteType || "none",
              baseBranch: sourceProjectBranch,
            }
          : undefined

      const newProject: Project = {
        id: newProjectId,
        name: projectName,
        description: enrichedDescription,
        visionDoc: sourceProject.visionDoc || "",
        status: "active",
        workingDirectory: sourceProject.workingDirectory,
        repository: sourceProject.repository,
        githubOwner: sourceProject.githubOwner,
        githubRepo: sourceProject.githubRepo,
        deliveryMode: sourceProject.deliveryMode,
        defaultMachineId: sourceProject.defaultMachineId,
        projectType: "plan",
        createdAt: now,
        updatedAt: now,
        ...(source ? { source } : {}),
      }

      await addProject(newProject)

      // 7. Start plan generation (before deleting node — if this fails, node remains)
      await startPlanSessionForProject(newProjectId, enrichedDescription, {
        workingDirectory: sourceProject.workingDirectory,
        targetMachineId: sourceProject.defaultMachineId,
        visionDoc: sourceProject.visionDoc,
        baseBranch: isGitRepo ? sourceProjectBranch : undefined,
      })

      // 8. Delete source node (soft-delete) — only after plan session starts successfully
      removeNodes([node.id])

      // 9. Navigate to plan page
      navigate(`/plan?projectId=${newProjectId}`)

      addToast({
        type: "success",
        title: "Node converted to project",
        description: `"${projectName}" is now generating a plan`,
      })

      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addToast({
        type: "error",
        title: "Failed to convert node to project",
        description: message,
      })
      return false
    } finally {
      setIsConverting(false)
    }
  }, [navigate, addProject, updateProject, removeNodes, startPlanSessionForProject, addToast])

  return { convert, isConverting, error }
}
