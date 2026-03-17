import { useState, useCallback } from "react"
import { useNavigate } from "react-router"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useExecutionStore } from "@/stores/execution-store"
import { useToastStore } from "@/stores/toast-store"
import { dataClient } from "@/lib/data-client"
import { closePr, ensureBranch } from "@/lib/api-client"
import { getShortId } from "@/lib/utils"
import { isNodeIsolated } from "@/lib/plan-utils"
import { getColorForName, getProjectIconForName } from "@/lib/color-icon-utils"
import { deriveDeliveryMode } from "@/lib/project-source"
import type { PlanNode, Project, ProjectSource } from "@/types"

/**
 * Strip HTML tags from rich text content (TipTap HTML) and decode HTML entities.
 */
function stripHtml(html: string): string {
  // Remove HTML tags
  let text = html.replace(/<[^>]*>/g, " ")

  // Decode common HTML entities
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
  }

  for (const [entity, char] of Object.entries(entities)) {
    text = text.replaceAll(entity, char)
  }

  // Decode numeric entities (&#123; and &#x1A;)
  text = text.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))

  // Normalize whitespace
  return text.replace(/\s+/g, " ").trim()
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
    // Truncate execution output to prevent token limit issues
    const truncated = node.executionOutput.length > 4000
      ? `${node.executionOutput.slice(0, 2000)}\n\n... [truncated ${node.executionOutput.length - 4000} characters] ...\n\n${node.executionOutput.slice(-2000)}`
      : node.executionOutput
    parts.push(`\n## Previous Execution Output\n${truncated}`)
  }

  if (node.executionError) {
    // Truncate execution error to prevent token limit issues
    const truncated = node.executionError.length > 4000
      ? `${node.executionError.slice(0, 2000)}\n\n... [truncated ${node.executionError.length - 4000} characters] ...\n\n${node.executionError.slice(-2000)}`
      : node.executionError
    parts.push(`\n## Previous Execution Error\n${truncated}`)
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
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const removeNodes = usePlanStore((s) => s.removeNodes)
  const startPlanGenerationForProject = useExecutionStore((s) => s.startPlanGenerationForProject)
  const addToast = useToastStore((s) => s.add)

  const convert = useCallback(async ({ node, projectName }: ConvertOptions): Promise<boolean> => {
    // Validate project name upfront
    if (!projectName.trim()) {
      addToast({ type: "error", title: "Project name required" })
      return false
    }

    setIsConverting(true)
    setError(null)

    // Track whether we created the project for cleanup on failure
    let createdProjectId: string | null = null

    try {
      // Re-check isolation at convert time (known race: edges could be added between
      // check and delete, but impact is low since delete is soft and UI hides button)
      const edges = usePlanStore.getState().edges
      if (!isNodeIsolated(node.id, edges, isLive)) {
        throw new Error(
          "This node now has dependencies and can't be converted. Another user may have added connections while you were confirming."
        )
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

      // 4. Create new project
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
        teamId: sourceProject.teamId,
        status: "active",
        color: getColorForName(projectName),
        icon: getProjectIconForName(projectName),
        workingDirectory: sourceProject.workingDirectory,
        repository: sourceProject.repository,
        githubOwner: sourceProject.githubOwner,
        githubRepo: sourceProject.githubRepo,
        deliveryMode: sourceProject.deliveryMode || (source ? deriveDeliveryMode(source) : undefined),
        defaultMachineId: sourceProject.defaultMachineId,
        projectType: "plan",
        createdAt: now,
        updatedAt: now,
        ...(source ? { source } : {}),
      }

      await addProject(newProject)
      createdProjectId = newProjectId

      // 5. Start plan generation (before deleting node — if this fails, node remains)
      await startPlanGenerationForProject(newProjectId, enrichedDescription, {
        workingDirectory: sourceProject.workingDirectory || undefined,
        targetMachineId: sourceProject.defaultMachineId || undefined,
        visionDoc: sourceProject.visionDoc || undefined,
        baseBranch: isGitRepo ? sourceProjectBranch : undefined,
      })

      // 6. GitHub-only: ensure branch exists on remote (best-effort, after plan generation)
      // Now that plan generation has started successfully, we can safely perform GitHub operations.
      // These are best-effort — if they fail, we warn but don't roll back the conversion.
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
            description: `${branchResult.error ?? "Unknown error"}. You may need to manually create the branch '${sourceProjectBranch}' before running tasks that push to remote.`,
          })
        }
      }

      // 7. GitHub-only: close PR (best-effort, after plan generation)
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
            description: prResult.error ?? undefined,
          })
        }
      }

      // 8. Delete source node (soft-delete) — only after plan session starts successfully
      // Note: "starts successfully" means the SSE stream was initiated, not that plan
      // generation completed. If the SSE stream fails immediately after, the node will
      // already be deleted, but the user can retry from the project page.
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

      // Cleanup: Remove orphaned project if we created it but later steps failed
      let cleanupFailed = false
      if (createdProjectId) {
        try {
          deleteProject(createdProjectId)
        } catch (cleanupErr) {
          cleanupFailed = true
          console.error("Failed to clean up orphaned project:", cleanupErr)
        }
      }

      addToast({
        type: "error",
        title: "Failed to convert node to project",
        description: cleanupFailed
          ? `${message}. An incomplete project may remain in your project list.`
          : message,
      })
      return false
    } finally {
      setIsConverting(false)
    }
  }, [navigate, addProject, updateProject, deleteProject, removeNodes, startPlanGenerationForProject, addToast])

  return { convert, isConverting, error }
}
