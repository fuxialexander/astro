import React from 'react'
import { Box, Text } from 'ink'

interface PanelProps {
  title: string
  isFocused: boolean
  children: React.ReactNode
  width?: string | number
  height?: string | number
}

export function Panel({ title, isFocused, children, width, height }: PanelProps) {
  const borderColor = isFocused ? 'cyan' : 'gray'

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      width={width}
      height={height}
      flexGrow={1}
    >
      <Box paddingX={1}>
        <Text bold color={isFocused ? 'cyan' : 'white'}>
          {title}
        </Text>
      </Box>
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {children}
      </Box>
    </Box>
  )
}
