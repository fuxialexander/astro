import React from 'react'
import { Box, Text } from 'ink'
import { Panel } from '../layout/panel.js'
import { Spinner } from '../shared/spinner.js'
import { useExecutionStore } from '../../stores/execution-store.js'
import { useTuiStore } from '../../stores/tui-store.js'
import { truncate } from '../../lib/format.js'

interface OutputPanelProps {
  height: number
}

function lineColor(line: string): string | undefined {
  if (line.startsWith('[Tool Call]')) return 'gray'
  if (line.startsWith('[error]')) return 'red'
  if (line.startsWith('[progress]')) return 'cyan'
  if (line.startsWith('[created]') || line.startsWith('[modified]') || line.startsWith('[deleted]')) return 'yellow'
  return undefined
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
    const shortId = execution.nodeId.length > 20
      ? execution.nodeId.slice(0, 8) + '\u2026'
      : execution.nodeId
    title = `OUTPUT (${shortId}) [${execution.status}]`
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
  const hasPendingTools = execution.pendingToolCount > 0

  // Auto-scroll: show last N lines unless user has scrolled up
  let start: number
  if (scrollIndex >= lines.length - visibleHeight) {
    start = Math.max(0, lines.length - visibleHeight)
  } else {
    start = Math.max(0, scrollIndex)
  }
  const visibleLines = lines.slice(start, start + visibleHeight)

  return (
    <Panel title={title} isFocused={isFocused} height={height}>
      <Box flexDirection="column">
        {visibleLines.map((line, i) => (
          <Text key={start + i} color={lineColor(line)} dimColor={line.startsWith('[Tool Call]')} wrap="truncate">
            {truncate(line, 200)}
          </Text>
        ))}
        {hasPendingTools && (
          <Text dimColor>
            {'[Tool Call] ' + '\u00B7'.repeat(execution.pendingToolCount)}
          </Text>
        )}
        {isRunning && !hasPendingTools && (
          <Spinner label="Running..." />
        )}
        {lines.length > visibleHeight && (
          <Text dimColor>  [{start + 1}-{Math.min(start + visibleHeight, lines.length)}/{lines.length}]</Text>
        )}
      </Box>
    </Panel>
  )
}
