/**
 * Hook to manage SSE connection lifecycle.
 * Dispatches events to Zustand stores.
 */
import { useEffect, useRef } from 'react'
import { SSEClient, type SSEEvent } from '../sse-client.js'
import type { AstroClient, Machine } from '../client-adapter.js'
import { useTuiStore } from '../stores/tui-store.js'
import { useMachinesStore } from '../stores/machines-store.js'
import { useExecutionStore } from '../stores/execution-store.js'
import { usePlanStore } from '../stores/plan-store.js'

export function useSSEStream(client: AstroClient) {
  const sseRef = useRef<SSEClient | null>(null)

  const setConnected = useTuiStore((s) => s.setConnected)
  const setMachineCount = useTuiStore((s) => s.setMachineCount)
  const setLastError = useTuiStore((s) => s.setLastError)

  useEffect(() => {
    const handler = (event: SSEEvent) => {
      switch (event.type) {
        case '__connected':
          setConnected(true)
          setLastError(null)
          break

        case '__disconnected':
          setConnected(false)
          setLastError(event.data.error as string)
          break

        case '__reconnecting':
          setConnected(false)
          break

        case 'machines:snapshot': {
          const machines = (event.data as unknown as Machine[]) ?? []
          useMachinesStore.getState().setMachines(machines)
          setMachineCount(machines.filter((m) => m.isConnected).length)
          break
        }

        case 'machine:connected': {
          const machine = event.data as unknown as Machine
          useMachinesStore.getState().addMachine(machine)
          setMachineCount(useMachinesStore.getState().machines.filter((m) => m.isConnected).length)
          break
        }

        case 'machine:disconnected': {
          const id = event.data.machineId as string
          useMachinesStore.getState().updateMachine(id, { isConnected: false } as Partial<Machine>)
          setMachineCount(useMachinesStore.getState().machines.filter((m) => m.isConnected).length)
          break
        }

        case 'task:stdout':
        case 'task:text': {
          const taskId = event.data.taskId as string
          const text = (event.data.data ?? event.data.output ?? '') as string
          if (typeof text === 'string' && text.length > 0) {
            useExecutionStore.getState().appendText(taskId, text)
          }
          break
        }

        case 'task:progress': {
          const taskId = event.data.taskId as string
          const message = event.data.message as string
          if (message) {
            useExecutionStore.getState().appendLine(taskId, `[progress] ${message}`)
          }
          break
        }

        case 'task:result': {
          const taskId = event.data.taskId as string
          const status = event.data.status as string
          useExecutionStore.getState().setStatus(taskId, status)
          // Update plan node status
          const nodeId = event.data.nodeId as string
          if (nodeId && status) {
            const mappedStatus = status === 'success' ? 'completed'
              : status === 'failure' ? 'planned'
              : status
            usePlanStore.getState().updateNodeStatus(nodeId, mappedStatus)
          }
          break
        }

        case 'task:tool_trace': {
          const taskId = event.data.taskId as string
          const toolName = event.data.toolName as string
          useExecutionStore.getState().appendLine(taskId, `[tool] ${toolName}`)
          break
        }

        case 'task:file_change': {
          const taskId = event.data.taskId as string
          const path = event.data.path as string
          const action = event.data.action as string
          useExecutionStore.getState().appendLine(taskId, `[${action}] ${path}`)
          break
        }

        case 'task:session_init': {
          const taskId = event.data.taskId as string
          const nodeId = (event.data.nodeId ?? taskId) as string
          useExecutionStore.getState().initExecution(taskId, nodeId)
          useExecutionStore.getState().setWatching(taskId)
          break
        }

        case 'heartbeat':
          // Keep-alive, no action needed
          break
      }
    }

    const sse = new SSEClient(client, handler)
    sseRef.current = sse
    sse.start().catch(() => {
      // Connection failed, will retry
    })

    return () => {
      sse.stop()
    }
  }, [client, setConnected, setMachineCount, setLastError])
}
