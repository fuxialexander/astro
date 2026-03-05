/**
 * OpenClaw Execution Dispatcher
 *
 * Dispatches Astro tasks directly to the OpenClaw gateway via WebSocket,
 * bypassing the relay/agent-runner path. Translates OpenClaw event frames
 * into relay-compatible events so existing SSE streaming works unchanged.
 *
 * Flow:
 *   Dispatch route → dispatchViaOpenClaw() → adapter.sendRequest('task.dispatch')
 *   Gateway streams events → adapter emits → this module translates → relayServer.emit()
 */

import type { TaskDispatch } from '../../types/relay.js'
import { openClawChannel } from '../channel/adapters/openclaw-channel.js'
import type { OpenClawEventFrame } from '../channel/adapters/openclaw-channel.js'

// Lazy import to avoid circular dependency (relay-server imports dispatch, dispatch imports relay-server)
let _relayServer: import('../relay-server.js').RelayServer | null = null
async function getRelayServer() {
  if (!_relayServer) {
    const mod = await import('../relay-server.js')
    _relayServer = mod.relayServer
  }
  return _relayServer
}

/** Virtual machine ID for the OpenClaw gateway */
export const OPENCLAW_MACHINE_ID = 'openclaw-gateway'

/**
 * Check if the OpenClaw gateway is available for task dispatch.
 */
export function isOpenClawAvailable(): boolean {
  return openClawChannel.isConnected
}

/**
 * Dispatch a task to the OpenClaw gateway and wire up event forwarding.
 * Returns true if dispatch was accepted, false otherwise.
 */
export async function dispatchViaOpenClaw(
  task: TaskDispatch
): Promise<boolean> {
  if (!openClawChannel.isConnected) {
    console.error('[openclaw-dispatch] Gateway not connected')
    return false
  }

  const taskId = task.taskId

  // Build prompt from task parts (same logic as relay-server)
  let finalPrompt: string
  if (task.prompt) {
    finalPrompt = task.prompt
  } else {
    const parts: string[] = []
    if (task.visionDoc) parts.push(`## Project Vision\n\n${task.visionDoc}`)
    if (task.dependencies && task.dependencies.length > 0) {
      parts.push(`## Previous Task Outputs\n\n${task.dependencies.join('\n\n---\n\n')}`)
    }
    parts.push(`## Current Task\n\n**${task.title}**\n\n${task.description}`)
    finalPrompt = parts.join('\n\n---\n\n')
  }

  // Set up event forwarding before dispatching
  const relay = await getRelayServer()

  const onGatewayEvent = (frame: OpenClawEventFrame) => {
    // Only handle events for this task
    const payload = frame.payload
    if (payload.taskId !== taskId) return

    switch (frame.event) {
      case 'task.text':
        relay.emit('task:text', {
          taskId,
          text: payload.text as string,
        })
        break

      case 'task.session_init':
        relay.emit('task:session_init', {
          taskId,
          sessionId: (payload.sessionId as string) || taskId,
          model: (payload.model as string) || 'openclaw',
        })
        break

      case 'task.tool_use':
        relay.emit('task:tool_trace', {
          taskId,
          toolName: payload.toolName as string,
          toolInput: payload.toolInput,
        })
        break

      case 'task.tool_result':
        relay.emit('task:tool_trace', {
          taskId,
          toolName: payload.toolName as string,
          toolResult: payload.result,
          success: payload.success ?? true,
        })
        break

      case 'task.file_change':
        relay.emit('task:file_change', {
          taskId,
          path: payload.path as string,
          action: (payload.action as string) || 'modified',
          linesAdded: payload.linesAdded as number | undefined,
          linesRemoved: payload.linesRemoved as number | undefined,
        })
        break

      case 'task.progress':
        relay.emit('task:progress', {
          taskId,
          message: payload.message as string,
          progress: payload.progress as number,
        })
        break

      case 'task.result':
        // Clean up listener before emitting result
        openClawChannel.off('gateway-event', onGatewayEvent)
        relay.emit('task:result', {
          taskId,
          result: {
            status: (payload.status as string) || 'completed',
            output: (payload.output as string) || '',
            error: payload.error as string | undefined,
            branchName: payload.branchName as string | undefined,
            prUrl: payload.prUrl as string | undefined,
            prNumber: payload.prNumber as number | undefined,
            metrics: payload.metrics as Record<string, unknown> | undefined,
          },
        })
        break

      case 'task.error':
        openClawChannel.off('gateway-event', onGatewayEvent)
        relay.emit('task:result', {
          taskId,
          result: {
            status: 'error',
            output: '',
            error: (payload.error as string) || 'OpenClaw execution failed',
          },
        })
        break

      case 'task.approval_request':
        relay.emit('task:approval_request', {
          taskId,
          requestId: payload.requestId as string,
          question: payload.question as string,
          options: (payload.options as string[]) || [],
          machineId: OPENCLAW_MACHINE_ID,
        })
        break
    }
  }

  openClawChannel.on('gateway-event', onGatewayEvent)

  // Also clean up on adapter disconnect
  const onDisconnect = () => {
    openClawChannel.off('gateway-event', onGatewayEvent)
    openClawChannel.off('disconnected', onDisconnect)
    relay.emit('machine:disconnected', OPENCLAW_MACHINE_ID)
  }
  openClawChannel.on('disconnected', onDisconnect)

  try {
    await openClawChannel.sendRequest('task.dispatch', {
      taskId,
      projectId: task.projectId,
      nodeId: task.nodeId,
      prompt: finalPrompt,
      provider: 'openclaw',
      workingDirectory: task.workingDirectory || '',
      model: task.model,
      maxTurns: task.maxTurns,
      timeout: task.timeout,
      ...(task.systemPrompt && { systemPrompt: task.systemPrompt }),
      ...(task.deliveryMode && { deliveryMode: task.deliveryMode }),
      ...(task.title && { title: task.title }),
      ...(task.description && { description: task.description }),
    })

    console.log(`[openclaw-dispatch] Task ${taskId} dispatched to gateway`)
    return true
  } catch (err) {
    openClawChannel.off('gateway-event', onGatewayEvent)
    openClawChannel.off('disconnected', onDisconnect)
    console.error(`[openclaw-dispatch] Failed to dispatch task ${taskId}:`, err)
    return false
  }
}
