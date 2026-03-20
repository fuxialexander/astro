export function tryAutoExecuteCompletedPlanProject<TOptions>(
  projectId: string,
  deps: {
    hasAutoExecute: boolean
    planExecutionStatus?: string
    options?: TOptions
    executeAllProject: (projectId: string, options?: TOptions) => boolean
    clearAutoExecute: (projectId: string) => void
  },
): boolean {
  if (!deps.hasAutoExecute) return false
  if (deps.planExecutionStatus !== 'success') return false

  const started = deps.executeAllProject(projectId, deps.options)
  if (started) {
    deps.clearAutoExecute(projectId)
  }
  return started
}
