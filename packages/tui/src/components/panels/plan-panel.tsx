import React from 'react'
import { Box, Text } from 'ink'
import { Panel } from '../layout/panel.js'
import { Spinner } from '../shared/spinner.js'
import { usePlanStore } from '../../stores/plan-store.js'
import { useTuiStore } from '../../stores/tui-store.js'
import { useProjectsStore } from '../../stores/projects-store.js'
import { getStatusColor } from '../../lib/status-colors.js'

interface PlanPanelProps {
  height: number
}

export function PlanPanel({ height }: PlanPanelProps) {
  const treeLines = usePlanStore((s) => s.treeLines)
  const loading = usePlanStore((s) => s.loading)
  const error = usePlanStore((s) => s.error)
  const focusedPanel = useTuiStore((s) => s.focusedPanel)
  const scrollIndex = useTuiStore((s) => s.scrollIndex.plan)
  const selectedProjectId = useTuiStore((s) => s.selectedProjectId)
  const projects = useProjectsStore((s) => s.projects)

  const isFocused = focusedPanel === 'plan'
  const projectName = projects.find((p) => p.id === selectedProjectId)?.name ?? 'none'

  const visibleHeight = Math.max(1, height - 4)
  let start = 0
  if (scrollIndex >= visibleHeight) {
    start = scrollIndex - visibleHeight + 1
  }
  const visibleLines = treeLines.slice(start, start + visibleHeight)

  return (
    <Panel title={`PLAN (${projectName})`} isFocused={isFocused} height={height}>
      {loading && treeLines.length === 0 ? (
        <Spinner label="Loading plan..." />
      ) : error ? (
        <Text color="red">{error}</Text>
      ) : !selectedProjectId ? (
        <Text dimColor>  Select a project to view its plan</Text>
      ) : treeLines.length === 0 ? (
        <Text dimColor>  No plan nodes. Use :plan create-node &lt;title&gt;</Text>
      ) : (
        <Box flexDirection="column">
          {visibleLines.map((line, i) => {
            const actualIndex = start + i
            const isSelected = actualIndex === scrollIndex && isFocused
            return (
              <Box key={line.id + '-' + actualIndex}>
                <Text
                  color={isSelected ? 'cyan' : getStatusColor(line.status)}
                  bold={isSelected}
                  inverse={isSelected}
                >
                  {line.text}
                </Text>
              </Box>
            )
          })}
          {treeLines.length > visibleHeight && (
            <Text dimColor>  [{start + 1}-{Math.min(start + visibleHeight, treeLines.length)}/{treeLines.length}]</Text>
          )}
        </Box>
      )}
    </Panel>
  )
}
