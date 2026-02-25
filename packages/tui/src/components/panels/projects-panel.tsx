import React from 'react'
import { Text } from 'ink'
import { Panel } from '../layout/panel.js'
import { ScrollableList, type ListItem } from '../shared/scrollable-list.js'
import { Spinner } from '../shared/spinner.js'
import { useProjectsStore } from '../../stores/projects-store.js'
import { useTuiStore } from '../../stores/tui-store.js'
import { getStatusColor } from '../../lib/status-colors.js'
import { formatRelativeTime } from '../../lib/format.js'

interface ProjectsPanelProps {
  height: number
}

export function ProjectsPanel({ height }: ProjectsPanelProps) {
  const projects = useProjectsStore((s) => s.projects)
  const loading = useProjectsStore((s) => s.loading)
  const error = useProjectsStore((s) => s.error)
  const focusedPanel = useTuiStore((s) => s.focusedPanel)
  const scrollIndex = useTuiStore((s) => s.scrollIndex.projects)
  const selectedProjectId = useTuiStore((s) => s.selectedProjectId)

  const isFocused = focusedPanel === 'projects'

  const items: ListItem[] = projects.map((p) => ({
    id: p.id,
    label: p.name,
    sublabel: p.status,
    rightLabel: formatRelativeTime(p.updatedAt),
    color: p.id === selectedProjectId ? 'cyan' : getStatusColor(p.status) as string,
  }))

  return (
    <Panel title="PROJECTS" isFocused={isFocused} height={height}>
      {loading && projects.length === 0 ? (
        <Spinner label="Loading projects..." />
      ) : error ? (
        <Text color="red">{error}</Text>
      ) : (
        <ScrollableList
          items={items}
          selectedIndex={scrollIndex}
          height={height - 3}
          isFocused={isFocused}
        />
      )}
    </Panel>
  )
}
