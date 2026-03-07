/**
 * Completion Messages
 *
 * Single source of truth for all project completion notification text.
 * Both execution-store (client-side) and realtime-store (server-side)
 * call these builders so toast + persistent notification always match.
 */

export interface CompletionMessage {
  type: 'success' | 'warning'
  title: string
  description: string
}

/**
 * Client-side completion message — shown immediately when all tasks reach
 * a terminal status. No PR/delivery info yet (that comes from the server).
 */
export function buildClientCompletionMessage(opts: {
  projectName?: string
  projectBranch?: string
  allSuccess: boolean
}): CompletionMessage {
  const { projectName, projectBranch, allSuccess } = opts
  let description: string
  if (projectName && allSuccess && projectBranch) {
    description = `All tasks in "${projectName}" completed. Changes on branch \`${projectBranch}\`. Use \`git checkout ${projectBranch}\` to review.`
  } else if (projectName && allSuccess) {
    description = `All tasks in "${projectName}" completed successfully.`
  } else if (projectName) {
    description = `All tasks in "${projectName}" have finished. Some were pruned.`
  } else {
    description = allSuccess ? 'All project tasks completed.' : 'All project tasks have finished.'
  }
  return {
    type: allSuccess ? 'success' : 'warning',
    title: allSuccess ? 'All tasks complete' : 'All tasks finished',
    description,
  }
}

/**
 * Server-side completion message — shown when the project:completed SSE
 * event arrives with delivery details (PR URL, branch, delivery mode).
 *
 * Returns `null` when the notification should be suppressed (already
 * notified by the client, and no new actionable info like a PR URL).
 */
export function buildServerCompletionMessage(opts: {
  projectName?: string
  projectBranch: string
  projectPrUrl?: string
  deliveryMode?: string
  baseBranch?: string
  alreadyNotified: boolean
}): (CompletionMessage & { prUrl?: string }) | null {
  const { projectName, projectBranch, projectPrUrl: prUrl, deliveryMode, baseBranch, alreadyNotified } = opts

  if (prUrl && alreadyNotified) {
    // Follow-up: PR was created after the initial completion toast
    return {
      type: 'success',
      title: 'PR ready for review',
      description: projectName
        ? `"${projectName}": PR created from \`${projectBranch}\` → \`${baseBranch || 'main'}\`.`
        : `PR created: ${projectBranch} → ${baseBranch || 'main'}.`,
      prUrl,
    }
  }

  if (!alreadyNotified) {
    // Server event arrived first (rare) — show full completion message
    let description: string
    if (prUrl) {
      description = projectName
        ? `All tasks in "${projectName}" completed. PR created from \`${projectBranch}\` → \`${baseBranch || 'main'}\`.`
        : `All tasks completed. PR created: ${projectBranch} → ${baseBranch || 'main'}.`
    } else if (deliveryMode === 'pr') {
      description = projectName
        ? `All tasks in "${projectName}" completed. Changes on branch \`${projectBranch}\`. PR creation was skipped.`
        : `All tasks completed on branch \`${projectBranch}\`.`
    } else {
      description = projectName
        ? `All tasks in "${projectName}" completed. Changes on branch \`${projectBranch}\`. Run \`git checkout ${projectBranch}\` or \`git diff ${baseBranch || 'main'}...${projectBranch}\` to review.`
        : `All tasks completed on branch \`${projectBranch}\`. Run \`git checkout ${projectBranch}\` to review.`
    }
    return {
      type: 'success',
      title: prUrl ? 'Project complete — PR ready' : 'Project complete',
      description,
      prUrl,
    }
  }

  // Already notified, no PR — suppress
  return null
}
