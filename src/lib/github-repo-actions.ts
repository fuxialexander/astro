import { useExecutionStore } from "@/stores/execution-store"
import { usePlanStore } from "@/stores/plan-store"
import type { GitHubCachedIssue, GitHubCachedPr, PlanNode, Project } from "@/types"

type IssueAction = "add_to_plan" | "quick_fix"
type PrAction = "address_review" | "fix_ci"

function truncate(text: string | null | undefined, max = 6000): string {
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated]` : text
}

export function buildIssueTaskNode(
  project: Project,
  issue: GitHubCachedIssue,
  action: IssueAction,
): PlanNode {
  const intent = action === "quick_fix"
    ? "Fix the linked GitHub issue and prepare the code change."
    : "Investigate and implement the linked GitHub issue."

  return {
    id: crypto.randomUUID(),
    projectId: project.id,
    type: "task",
    title: `#${issue.issueNumber} ${issue.title}`,
    description: `${intent}\n\nGitHub issue: ${issue.url}\n\n${truncate(issue.body)}`.trim(),
    status: "planned",
    parentId: null,
    dependencies: [],
    verification: "auto",
    position: { x: 0, y: 0 },
    githubIssueNumber: issue.issueNumber,
    githubIssueUrl: issue.url,
    links: [
      {
        id: `gh-${issue.issueNumber}`,
        type: "github_issue",
        url: issue.url,
        title: issue.title,
        state: issue.state,
        number: issue.issueNumber,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function buildPrTaskNode(
  project: Project,
  pr: GitHubCachedPr,
  action: PrAction,
): PlanNode {
  const intent = action === "fix_ci"
    ? "Investigate the failing CI checks on the linked pull request and make the minimum code changes required to recover it."
    : "Address the outstanding GitHub review feedback on the linked pull request."

  return {
    id: crypto.randomUUID(),
    projectId: project.id,
    type: "task",
    title: `PR #${pr.prNumber} ${action === "fix_ci" ? "Fix CI" : "Address Review"}: ${pr.title}`,
    description: `${intent}\n\nPull request: ${pr.url}\nBranch: ${pr.headBranch ?? "unknown"} -> ${pr.baseBranch ?? "unknown"}\nCI: ${pr.ciStatus ?? "unknown"}\nReview: ${pr.reviewDecision ?? "unknown"}\n\n${truncate(pr.body)}`.trim(),
    status: "planned",
    parentId: null,
    dependencies: [],
    verification: "auto",
    position: { x: 0, y: 0 },
    prNumber: pr.prNumber,
    prUrl: pr.url,
    branchName: pr.headBranch ?? undefined,
    links: [
      {
        id: `pr-${pr.prNumber}`,
        type: "github_pr",
        url: pr.url,
        title: pr.title,
        state: pr.state,
        number: pr.prNumber,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function addIssueToPlan(project: Project, issue: GitHubCachedIssue): string {
  const node = buildIssueTaskNode(project, issue, "add_to_plan")
  usePlanStore.getState().addNode(node)
  return node.id
}

export async function quickFixIssue(project: Project, issue: GitHubCachedIssue): Promise<string> {
  const node = buildIssueTaskNode(project, issue, "quick_fix")
  usePlanStore.getState().addNode(node)
  await useExecutionStore.getState().startExecution(node.id, project.id)
  return node.id
}

export async function launchPrAction(project: Project, pr: GitHubCachedPr, action: PrAction): Promise<string> {
  const node = buildPrTaskNode(project, pr, action)
  usePlanStore.getState().addNode(node)
  await useExecutionStore.getState().startExecution(node.id, project.id)
  return node.id
}
