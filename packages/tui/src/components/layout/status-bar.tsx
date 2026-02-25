import React from 'react'
import { Box, Text } from 'ink'
import { useTuiStore } from '../../stores/tui-store.js'
import { formatCost } from '../../lib/format.js'

export function StatusBar() {
  const connected = useTuiStore((s) => s.connected)
  const machineCount = useTuiStore((s) => s.machineCount)
  const todayCost = useTuiStore((s) => s.todayCost)
  const lastError = useTuiStore((s) => s.lastError)

  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box gap={2}>
        <Text bold color="cyan">Astro TUI</Text>
        <Text color={connected ? 'green' : 'red'}>
          {connected ? '\u25CF connected' : '\u25CB disconnected'}
        </Text>
        <Text dimColor>{machineCount} machine{machineCount !== 1 ? 's' : ''}</Text>
        <Text dimColor>{formatCost(todayCost)} today</Text>
      </Box>
      {lastError && (
        <Box>
          <Text color="red">{lastError.length > 60 ? lastError.slice(0, 57) + '...' : lastError}</Text>
        </Box>
      )}
    </Box>
  )
}
