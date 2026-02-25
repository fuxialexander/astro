import React from 'react'
import { Box, Text } from 'ink'

const KEYBINDINGS = [
  ['Navigation', [
    ['j / \u2193', 'Move down'],
    ['k / \u2191', 'Move up'],
    ['h / \u2190', 'Focus left panel'],
    ['l / \u2192', 'Focus right panel'],
    ['Tab', 'Cycle panel focus'],
    ['1-4', 'Jump to panel'],
    ['gg', 'Scroll to top'],
    ['G', 'Scroll to bottom'],
    ['Ctrl+u', 'Page up'],
    ['Ctrl+d', 'Page down'],
    ['Enter', 'Select / expand'],
  ]],
  ['Actions', [
    ['d', 'Dispatch selected task'],
    ['c', 'Cancel running task'],
    ['r', 'Refresh all data'],
    ['q', 'Quit'],
  ]],
  ['Modes', [
    [':', 'Command mode'],
    ['/', 'Search mode'],
    ['i', 'Insert mode (steer)'],
    ['?', 'Toggle this help'],
    ['Esc', 'Return to normal mode'],
  ]],
  ['Commands', [
    [':project list/create/delete', 'Project management'],
    [':plan tree/create-node', 'Plan operations'],
    [':dispatch <nodeId>', 'Dispatch task'],
    [':cancel <execId>', 'Cancel execution'],
    [':steer <message>', 'Steer running task'],
    [':watch <execId>', 'Watch execution output'],
    [':env list/status', 'Machine management'],
    [':activity', 'Activity feed'],
    [':refresh / :r', 'Force refresh'],
    [':quit / :q', 'Exit TUI'],
  ]],
] as const

export function HelpOverlay() {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="yellow"> Keybindings Reference </Text>
      <Text> </Text>
      {KEYBINDINGS.map(([section, bindings]) => (
        <Box key={section as string} flexDirection="column" marginBottom={1}>
          <Text bold underline>{section as string}</Text>
          {(bindings as ReadonlyArray<readonly [string, string]>).map(([key, desc]) => (
            <Box key={key} gap={2}>
              <Text color="cyan">{(key as string).padEnd(28)}</Text>
              <Text>{desc as string}</Text>
            </Box>
          ))}
        </Box>
      ))}
      <Text dimColor>Press Esc or ? to close</Text>
    </Box>
  )
}
