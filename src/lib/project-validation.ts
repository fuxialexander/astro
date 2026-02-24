/**
 * Validates a project name for rename operations.
 * Returns an error message string, or null if valid.
 */
export function validateProjectName(
  name: string,
  currentProjectId: string,
  allProjects: Array<{ id: string; name: string }>
): string | null {
  if (!name.trim()) {
    return "Project name cannot be empty"
  }
  if (name.length > 100) {
    return "Project name is too long (max 100 characters)"
  }
  const isDuplicate = allProjects.some(
    (p) => p.id !== currentProjectId && p.name.toLowerCase() === name.toLowerCase()
  )
  if (isDuplicate) {
    return "A project with this name already exists"
  }
  return null
}
