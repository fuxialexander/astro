import React from 'react'
import { Box, Text } from 'ink'
import { useTuiStore } from '../../stores/tui-store.js'

const MODE_LABELS: Record<string, { label: string; color: string }> = {
  normal: { label: 'NORMAL', color: 'blue' },
  command: { label: 'COMMAND', color: 'yellow' },
  search: { label: 'SEARCH', color: 'green' },
  insert: { label: 'INSERT', color: 'magenta' },
}

export function CommandLine() {
  const mode = useTuiStore((s) => s.mode)
  const commandBuffer = useTuiStore((s) => s.commandBuffer)
  const searchQuery = useTuiStore((s) => s.searchQuery)
  const pendingKeys = useTuiStore((s) => s.pendingKeys)

  const modeInfo = MODE_LABELS[mode] ?? MODE_LABELS.normal

  let content = ''
  let prefix = ''

  switch (mode) {
    case 'command':
      prefix = ':'
      content = commandBuffer
      break
    case 'search':
      prefix = '/'
      content = searchQuery
      break
    case 'normal':
      if (pendingKeys) {
        content = pendingKeys
      } else {
        content = 'Press : for commands, / to search, ? for help'
      }
      break
    case 'insert':
      content = '-- INSERT MODE -- (Esc to exit)'
      break
  }

  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box gap={1}>
        <Text bold color={modeInfo.color} inverse>
          {' '}{modeInfo.label}{' '}
        </Text>
        {(mode === 'command' || mode === 'search') ? (
          <Text>
            <Text bold>{prefix}</Text>
            <Text>{content}</Text>
            <Text color="cyan">{'\u2588'}</Text>
          </Text>
        ) : (
          <Text dimColor>{content}</Text>
        )}
      </Box>
    </Box>
  )
}
