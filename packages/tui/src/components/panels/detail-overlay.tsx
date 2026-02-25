import React from 'react'
import { Box, Text } from 'ink'
import { useTuiStore } from '../../stores/tui-store.js'
import { useProjectsStore } from '../../stores/projects-store.js'
import { usePlanStore } from '../../stores/plan-store.js'
import { useMachinesStore } from '../../stores/machines-store.js'
import { getStatusColor } from '../../lib/status-colors.js'
import { formatRelativeTime } from '../../lib/format.js'

export function DetailOverlay() {
  const showDetail = useTuiStore((s) => s.showDetail)
  const detailType = useTuiStore((s) => s.detailType)
  const detailId = useTuiStore((s) => s.detailId)

  if (!showDetail || !detailType || !detailId) return null

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      {detailType === 'project' && <ProjectDetail id={detailId} />}
      {detailType === 'node' && <NodeDetail id={detailId} />}
      {detailType === 'machine' && <MachineDetail id={detailId} />}
      <Text dimColor>Press Esc to close</Text>
    </Box>
  )
}

function ProjectDetail({ id }: { id: string }) {
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === id))
  if (!project) return <Text color="red">Project not found</Text>

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{project.name}</Text>
      <Text> </Text>
      <Field label="ID" value={project.id} />
      <Field label="Status" value={project.status} color={getStatusColor(project.status)} />
      <Field label="Description" value={project.description || '\u2014'} />
      <Field label="Health" value={project.health ?? '\u2014'} />
      <Field label="Progress" value={`${project.progress}%`} />
      <Field label="Working Dir" value={project.workingDirectory ?? '\u2014'} />
      <Field label="Repository" value={project.repository ?? '\u2014'} />
      <Field label="Delivery" value={project.deliveryMode ?? '\u2014'} />
      <Field label="Start Date" value={project.startDate ?? '\u2014'} />
      <Field label="Target Date" value={project.targetDate ?? '\u2014'} />
      <Field label="Created" value={formatRelativeTime(project.createdAt)} />
      <Field label="Updated" value={formatRelativeTime(project.updatedAt)} />
      <Text> </Text>
    </Box>
  )
}

function NodeDetail({ id }: { id: string }) {
  const node = usePlanStore((s) => s.nodes.find((n) => n.id === id))
  if (!node) return <Text color="red">Node not found</Text>

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{node.title}</Text>
      <Text> </Text>
      <Field label="ID" value={node.id} />
      <Field label="Type" value={node.type} />
      <Field label="Status" value={node.status} color={getStatusColor(node.status)} />
      <Field label="Description" value={node.description || '\u2014'} />
      <Field label="Priority" value={node.priority ?? '\u2014'} />
      <Field label="Estimate" value={node.estimate ?? '\u2014'} />
      <Field label="Start Date" value={node.startDate ?? '\u2014'} />
      <Field label="End Date" value={node.endDate ?? '\u2014'} />
      <Field label="Due Date" value={node.dueDate ?? '\u2014'} />
      <Field label="Branch" value={node.branchName ?? '\u2014'} />
      <Field label="PR URL" value={node.prUrl ?? '\u2014'} />
      <Field label="Execution ID" value={node.executionId ?? '\u2014'} />
      <Field label="Exec Started" value={node.executionStartedAt ? formatRelativeTime(node.executionStartedAt) : '\u2014'} />
      <Field label="Exec Completed" value={node.executionCompletedAt ? formatRelativeTime(node.executionCompletedAt) : '\u2014'} />
      <Text> </Text>
    </Box>
  )
}

function MachineDetail({ id }: { id: string }) {
  const machine = useMachinesStore((s) => s.machines.find((m) => m.id === id))
  if (!machine) return <Text color="red">Machine not found</Text>

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{machine.name}</Text>
      <Text> </Text>
      <Field label="ID" value={machine.id} />
      <Field label="Hostname" value={machine.hostname} />
      <Field label="Platform" value={machine.platform} />
      <Field label="Env Type" value={machine.environmentType} />
      <Field label="Connected" value={machine.isConnected ? 'Yes' : 'No'} color={machine.isConnected ? 'green' : 'red'} />
      <Field label="Providers" value={machine.providers.join(', ') || '\u2014'} />
      <Field label="Registered" value={formatRelativeTime(machine.registeredAt)} />
      <Field label="Last Seen" value={formatRelativeTime(machine.lastSeenAt)} />
      <Text> </Text>
    </Box>
  )
}

function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box>
      <Text dimColor>{label.padEnd(16)}</Text>
      {color ? <Text color={color}>{value}</Text> : <Text>{value}</Text>}
    </Box>
  )
}
