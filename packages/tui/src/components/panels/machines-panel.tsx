import React from 'react'
import { Text } from 'ink'
import { Panel } from '../layout/panel.js'
import { ScrollableList, type ListItem } from '../shared/scrollable-list.js'
import { Spinner } from '../shared/spinner.js'
import { useMachinesStore } from '../../stores/machines-store.js'
import { useTuiStore } from '../../stores/tui-store.js'

interface MachinesPanelProps {
  height: number
}

export function MachinesPanel({ height }: MachinesPanelProps) {
  const machines = useMachinesStore((s) => s.machines)
  const loading = useMachinesStore((s) => s.loading)
  const error = useMachinesStore((s) => s.error)
  const focusedPanel = useTuiStore((s) => s.focusedPanel)
  const scrollIndex = useTuiStore((s) => s.scrollIndex.machines)

  const isFocused = focusedPanel === 'machines'

  const activeMachines = machines.filter((m) => !m.isRevoked)
  const items: ListItem[] = activeMachines.map((m) => ({
    id: m.id,
    label: m.name,
    sublabel: m.platform,
    rightLabel: m.isConnected ? '\u25CF online' : '\u25CB offline',
    color: m.isConnected ? 'green' : 'gray',
  }))

  return (
    <Panel title="MACHINES" isFocused={isFocused} height={height}>
      {loading && machines.length === 0 ? (
        <Spinner label="Loading machines..." />
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
