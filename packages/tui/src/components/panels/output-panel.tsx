import React from 'react'
import { Box, Text } from 'ink'
import { Panel } from '../layout/panel.js'
import { Spinner } from '../shared/spinner.js'
import { useExecutionStore } from '../../stores/execution-store.js'
import { useTuiStore } from '../../stores/tui-store.js'

interface OutputPanelProps {
  height: number
}

export function OutputPanel({ height }: OutputPanelProps) {
  const watchingId = useExecutionStore((s) => s.watchingId)
  const outputs = useExecutionStore((s) => s.outputs)
  const focusedPanel = useTuiStore((s) => s.focusedPanel)
  const scrollIndex = useTuiStore((s) => s.scrollIndex.output)

  const isFocused = focusedPanel === 'output'
  const execution = watchingId ? outputs.get(watchingId) : null

  const visibleHeight = Math.max(1, height - 4)

  let title = 'OUTPUT'
  if (execution) {
    title = `OUTPUT (${execution.nodeId}) [${execution.status}]`
  }

  if (!execution) {
    return (
      <Panel title={title} isFocused={isFocused} height={height}>
        <Text dimColor>  No active execution. Dispatch a task with 'd' or :dispatch</Text>
      </Panel>
    )
  }

  const lines = execution.lines
  const isRunning = execution.status === 'running'

  // Auto-scroll: show last N lines unless user has scrolled up
  let start: number
  if (scrollIndex >= lines.length - visibleHeight) {
    // Auto-scroll mode: show latest lines
    start = Math.max(0, lines.length - visibleHeight)
  } else {
    start = Math.max(0, scrollIndex)
  }
  const visibleLines = lines.slice(start, start + visibleHeight)

  return (
    <Panel title={title} isFocused={isFocused} height={height}>
      <Box flexDirection="column">
        {visibleLines.map((line, i) => {
          const color = line.startsWith('[tool]') ? 'yellow'
            : line.startsWith('[error]') ? 'red'
            : line.startsWith('[progress]') ? 'cyan'
            : line.startsWith('[') ? 'gray'
            : undefined
          return (
            <Text key={start + i} color={color} wrap="truncate">
              {line}
            </Text>
          )
        })}
        {isRunning && (
          <Spinner label="Running..." />
        )}
        {lines.length > visibleHeight && (
          <Text dimColor>  [{start + 1}-{Math.min(start + visibleHeight, lines.length)}/{lines.length}]</Text>
        )}
      </Box>
    </Panel>
  )
}
