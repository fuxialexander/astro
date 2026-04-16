import type { Project } from '@/types'

import type { InitialPane } from './PaneHost'

export type ShortcutPaneKind = 'chat' | 'plan-graph' | 'file-browser' | 'git' | 'terminal'

export function getPaneForProject(project: Project | undefined, kind: ShortcutPaneKind): InitialPane | null {
  if (!project) return null

  switch (kind) {
    case 'chat':
      return {
        id: `chat-${project.id}`,
        title: `Chat — ${project.name}`,
        kind: 'chat',
        state: { projectId: project.id },
      }
    case 'plan-graph':
      return {
        id: `plan-${project.id}`,
        title: `Plan — ${project.name}`,
        kind: 'plan-graph',
        state: { projectId: project.id },
      }
    case 'file-browser':
      return {
        id: `files-${project.id}`,
        title: 'Files',
        kind: 'file-browser',
        state: { projectId: project.id, cwd: project.workingDirectory ?? undefined },
      }
    case 'git':
      return {
        id: `git-${project.id}`,
        title: 'Git',
        kind: 'git',
        state: { projectId: project.id, cwd: project.workingDirectory ?? undefined },
      }
    case 'terminal':
      return {
        id: `terminal-${project.id}`,
        title: 'Terminal',
        kind: 'terminal',
        state: { projectId: project.id, cwd: project.workingDirectory ?? undefined },
      }
  }
}

export function getDefaultPanes(project?: Project): InitialPane[] {
  const panes = [
    getPaneForProject(project, 'chat'),
    getPaneForProject(project, 'plan-graph'),
    getPaneForProject(project, 'file-browser'),
  ]

  return panes.filter((pane): pane is InitialPane => pane !== null)
}
