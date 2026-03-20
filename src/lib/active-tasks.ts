export function getActiveTasksContentState(
  filteredCount: number,
  options: {
    executionsLoaded: boolean
    sessionsLoaded: boolean
  },
): "loading" | "empty" | "list" {
  if (filteredCount > 0) return "list"
  if (!options.executionsLoaded || !options.sessionsLoaded) return "loading"
  return "empty"
}
