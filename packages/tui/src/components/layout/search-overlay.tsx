import React from 'react'
import { Box, Text, useInput } from 'ink'
import { useSearchStore } from '../../stores/search-store.js'
import { useTuiStore } from '../../stores/tui-store.js'
import { getStatusColor } from '../../lib/status-colors.js'

export function SearchOverlay() {
  const isOpen = useSearchStore((s) => s.isOpen)
  const query = useSearchStore((s) => s.query)
  const results = useSearchStore((s) => s.results)
  const selectedIndex = useSearchStore((s) => s.selectedIndex)
  const { setQuery, moveUp, moveDown, close } = useSearchStore()
  const { setSelectedProject, setSelectedNode, setSelectedMachine, focusPanel } = useTuiStore()

  useInput((input, key) => {
    if (!isOpen) return

    if (key.escape) {
      close()
      return
    }

    if (key.upArrow) {
      moveUp()
      return
    }

    if (key.downArrow) {
      moveDown()
      return
    }

    if (key.return && results.length > 0) {
      const item = results[selectedIndex]
      if (item) {
        switch (item.type) {
          case 'project':
            setSelectedProject(item.id)
            focusPanel('projects')
            break
          case 'task':
            setSelectedNode(item.id)
            focusPanel('plan')
            break
          case 'machine':
            setSelectedMachine(item.id)
            focusPanel('machines')
            break
        }
      }
      close()
      return
    }

    if (key.backspace || key.delete) {
      setQuery(query.slice(0, -1))
      return
    }

    if (input && input.length === 1 && !key.ctrl && !key.meta) {
      setQuery(query + input)
    }
  }, { isActive: isOpen })

  if (!isOpen) return null

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={0}
      width="60%"
      height={Math.min(results.length + 4, 15)}
    >
      <Box>
        <Text bold color="cyan">Search: </Text>
        <Text>{query}</Text>
        <Text color="cyan">{'\u2588'}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {results.length === 0 && query.length > 0 && (
          <Text dimColor>  No results</Text>
        )}
        {results.slice(0, 10).map((item, i) => (
          <Box key={item.id}>
            <Text
              inverse={i === selectedIndex}
              bold={i === selectedIndex}
              color={i === selectedIndex ? 'cyan' : undefined}
            >
              {i === selectedIndex ? ' \u25B6 ' : '   '}
              <Text dimColor>[{item.type}]</Text>
              {' '}{item.title}
              {item.status && (
                <Text color={getStatusColor(item.status)}> [{item.status}]</Text>
              )}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
