import React from 'react'
import { Box, Text } from 'ink'

export interface ListItem {
  id: string
  label: string
  sublabel?: string
  rightLabel?: string
  color?: string
}

interface ScrollableListProps {
  items: ListItem[]
  selectedIndex: number
  height: number
  isFocused: boolean
}

export function ScrollableList({ items, selectedIndex, height, isFocused }: ScrollableListProps) {
  if (items.length === 0) {
    return (
      <Box>
        <Text dimColor>  No items.</Text>
      </Box>
    )
  }

  // Calculate visible window
  const visibleHeight = Math.max(1, height - 1)
  let start = 0
  if (selectedIndex >= visibleHeight) {
    start = selectedIndex - visibleHeight + 1
  }
  const visibleItems = items.slice(start, start + visibleHeight)

  return (
    <Box flexDirection="column">
      {visibleItems.map((item, i) => {
        const actualIndex = start + i
        const isSelected = actualIndex === selectedIndex && isFocused
        return (
          <Box key={item.id}>
            <Text
              color={isSelected ? 'cyan' : item.color ?? undefined}
              bold={isSelected}
              inverse={isSelected}
            >
              {isSelected ? ' \u25B6 ' : '   '}
              {item.label}
              {item.sublabel ? ` ${item.sublabel}` : ''}
            </Text>
            {item.rightLabel && (
              <Text dimColor> {item.rightLabel}</Text>
            )}
          </Box>
        )
      })}
      {items.length > visibleHeight && (
        <Text dimColor>  [{start + 1}-{Math.min(start + visibleHeight, items.length)}/{items.length}]</Text>
      )}
    </Box>
  )
}
