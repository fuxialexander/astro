/**
 * ActivityBlockRenderer — Shared block rendering component.
 *
 * All streaming pathways (PlanGeneration, ChatPanel, Playground, Task Execution)
 * use this single renderer. Block availability is determined by which tools the
 * agent has access to, not by which pathway is active.
 *
 * Part of the Unified Streaming Pipeline (Phase 2).
 */

import React, { lazy, Suspense } from "react"
import {
  TextBlock,
  OperationalBlock,
  ToolBlock,
  ToolGroupBlock,
  VisualBlock,
  SteerBlock,
  FileChangeBlock,
  ErrorBlock,
  ChatUserBlock,
  ChatAssistantBlock,
  MutationBlock,
  GitHubCommentBlock,
  BranchLinkedBlock,
  SystemMessageBlock,
  SystemPromptBlock,
  PlanGraphBlock,
  type DisplayBlock,
} from "@/components/activity-blocks"
import type { TaskActivityEvent } from "@/types"

// Lazy-load pathway-specific components that are heavier
const InlineApprovalCard = lazy(() =>
  import("@/components/plan-generation/inline-approval-card").then(m => ({ default: m.InlineApprovalCard }))
)

// JsonRenderSpec uses the existing JsonRenderView component
const JsonRenderView = lazy(() =>
  import("@/components/ui/json-render-view").then(m => ({ default: m.JsonRenderView }))
)

export interface ActivityBlockRendererProps {
  blocks: DisplayBlock[]
  /** Whether the stream is currently active */
  isStreaming?: boolean
  /** Callback for link clicks (e.g., astro:node:uuid navigation) */
  onLinkClick?: (href: string, e: React.MouseEvent) => boolean | void
  /** Callback for sending a prompt (e.g., from visual block actions) */
  onSendPrompt?: (text: string) => void
  /** Callback for file selection in file change blocks */
  onFileSelect?: (path: string) => void
  /** Callback for editing a chat user message */
  onEditMessage?: (message: string) => void
  /** Callback for responding to an approval request */
  onApprovalResponse?: (requestId: string, answer: string) => void
  /** Text preprocessing function (e.g., strip XML tags, convert uuid links) */
  preprocessContent?: (text: string) => string
  /** GitHub context for comment blocks */
  githubContext?: { owner: string; repo: string; number: number }
  /** Map of answered approval request IDs */
  answeredApprovals?: Set<string>
  /** Approval responses keyed by requestId for rendering answered cards */
  approvalResponses?: Map<string, Extract<TaskActivityEvent, { type: 'approval_response' }>>
  /** Whether this is a running execution (affects tool block display) */
  isRunning?: boolean
  /** Optional helpers for mutation blocks */
  getNodeTitle?: (nodeId: string) => string
  onNodeSelect?: (nodeId: string) => void
  /** Optional pathway-owned PR renderer */
  renderPrStatus?: (block: Extract<DisplayBlock, { type: 'pr_status' }>, key: string) => React.ReactNode
}

/**
 * Renders an array of DisplayBlocks using the shared block component registry.
 * All block types are available in all pathways — irrelevant blocks simply never
 * appear because the agent doesn't have access to the tools that produce them.
 */
export function ActivityBlockRenderer({
  blocks,
  isStreaming,
  onLinkClick,
  onSendPrompt,
  onFileSelect,
  onEditMessage,
  onApprovalResponse,
  preprocessContent,
  githubContext,
  answeredApprovals,
  approvalResponses,
  isRunning,
  getNodeTitle,
  onNodeSelect,
  renderPrStatus,
}: ActivityBlockRendererProps) {
  return (
    <>
      {blocks.map((block, i) => {
        const isLast = i === blocks.length - 1
        const key = block.events[0]?.seq?.toString()
          ?? `block-${i}-${block.type}`

        switch (block.type) {
          case 'text':
            return (
              <TextBlock
                key={key}
                events={block.events}
                isStreaming={isStreaming && isLast}
                onLinkClick={onLinkClick}
                onSendPrompt={onSendPrompt}
                preprocessContent={preprocessContent}
              />
            )

          case 'operational':
            return <OperationalBlock key={key} events={block.events} />

          case 'tool':
            return <ToolBlock key={key} events={block.events} isRunning={isRunning} />

          case 'tool_group':
            return <ToolGroupBlock key={key} events={block.events} isRunning={isRunning} />

          case 'visual':
            return <VisualBlock key={key} block={block} onSendPrompt={onSendPrompt} />

          case 'steer': {
            const steerEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'steer' }>
            return <SteerBlock key={key} event={steerEvent} />
          }

          case 'file_change': {
            const fileEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'file_change' }>
            return <FileChangeBlock key={key} event={fileEvent} onFileSelect={onFileSelect} />
          }

          case 'error': {
            const errorEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'error' }>
            return <ErrorBlock key={key} event={errorEvent} />
          }

          case 'chat_user': {
            const chatEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'chat_user' }>
            return <ChatUserBlock key={key} event={chatEvent} onEdit={onEditMessage} />
          }

          case 'chat_assistant': {
            const assistantEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'chat_assistant' }>
            return (
              <ChatAssistantBlock
                key={key}
                event={assistantEvent}
                isStreaming={isStreaming && isLast}
                onLinkClick={onLinkClick}
                onSendPrompt={onSendPrompt}
              />
            )
          }

          case 'approval_request': {
            const approvalEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'approval_request' }>
            const isAnswered = answeredApprovals?.has(approvalEvent.requestId) ?? false
            const response = approvalResponses?.get(approvalEvent.requestId)
            return (
              <Suspense key={key} fallback={null}>
                <InlineApprovalCard
                  requestId={approvalEvent.requestId}
                  question={approvalEvent.question}
                  options={approvalEvent.options}
                  answered={isAnswered}
                  answer={response?.answer}
                  autoApproved={response?.autoApproved}
                  onRespond={onApprovalResponse
                    ? async (reqId: string, answer: string) => { onApprovalResponse(reqId, answer) }
                    : async () => {}}
                />
              </Suspense>
            )
          }

          case 'approval_response':
            // Approval responses are typically shown as part of the approval card
            return null

          case 'mutation': {
            const mutationEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'mutation' }>
            return <MutationBlock key={key} event={mutationEvent} getNodeTitle={getNodeTitle} onNodeSelect={onNodeSelect} />
          }

          case 'github_comment': {
            const commentEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'github_comment' }>
            return <GitHubCommentBlock key={key} event={commentEvent} githubContext={githubContext} />
          }

          case 'branch_linked': {
            const branchEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'branch_linked' }>
            return <BranchLinkedBlock key={key} event={branchEvent} />
          }

          case 'system_message': {
            const sysEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'system_message' }>
            return <SystemMessageBlock key={key} event={sysEvent} />
          }

          case 'system_prompt': {
            const promptEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'system_prompt' }>
            return <div key={key} className="px-4"><SystemPromptBlock event={promptEvent} /></div>
          }

          case 'plan_result': {
            // Only show the most recent plan graph — skip older ones to avoid cluttering the feed
            const lastPlanResultIdx = blocks.map(b => b.type).lastIndexOf('plan_result')
            if (i !== lastPlanResultIdx) return null
            const planEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'plan_result' }>
            return <PlanGraphBlock key={key} event={planEvent} />
          }

          case 'json_render_spec': {
            const specEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'json_render_spec' }>
            return (
              <Suspense key={key} fallback={null}>
                <div className="px-4 py-2">
                  <JsonRenderView spec={specEvent.spec as unknown as import("@json-render/core").Spec} componentDefs={block.componentDefs} />
                </div>
              </Suspense>
            )
          }

          case 'pr_status':
            return renderPrStatus ? renderPrStatus(block as Extract<DisplayBlock, { type: 'pr_status' }>, key) : null

          default:
            return null
        }
      })}
    </>
  )
}
