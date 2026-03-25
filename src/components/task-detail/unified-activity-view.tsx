import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { stripHtml } from "@/lib/html-utils"
import {
  Send,
  Square,
  CheckCircle2,
  XCircle,
  ArrowDown,
  Info,
  FolderOpen,
  Paperclip,
} from "lucide-react"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { apiUrl } from "@/lib/api-url"
import { authHeaders } from "@/lib/auth-headers"
import { Button } from "@/components/ui/button"
import { FileCompletionTextarea, type ChatImageAttachment } from "@/components/ui/file-completion-textarea"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useRealtimeStore, type TaskStream } from "@/stores/realtime-store"
import { useProjectStore } from "@/stores/project-store"
import { useSessionStore } from "@/stores/session-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useExecutionStore } from "@/stores/execution-store"
import { cn } from "@/lib/utils"
import type { PlanNode, TaskExecution } from "@/types"
import {
  SummaryCard,
  NewCommentComposer,
} from "@/components/activity-blocks"
import { ActivityBlockRenderer } from "@/components/activity-block-renderer"
import { useGitHubCommentsStore } from "@/stores/github-comments-store"
import { PrStatusCard } from "@/components/pr-status-card"
import type { PrData, PrCheckRun, PrReview } from "@/components/pr-status-card"
import { PRReviewThreads } from "@/components/pr-review-threads"
import type { GitHubReviewThread, TaskActivityEvent } from "@/types"
import { FileBrowser } from "@/components/file-browser"
import { useMediaQuery } from "@/hooks/use-media-query"
import { projectWorktreePath, resolveFilePathForBrowsing } from "./file-path-utils"
import { useAutoScroll } from "@/hooks/use-auto-scroll"
import { useChatSession } from "@/hooks/use-chat-session"
import { useActivityFeed } from "@/hooks/use-activity-feed"

const EMPTY_REVIEW_THREADS: GitHubReviewThread[] = []

interface UnifiedActivityViewProps {
  node: PlanNode
  projectId: string
  execution?: TaskExecution
  taskStream?: TaskStream
  isRunning: boolean
  executionId: string
  machineId?: string
}

export function UnifiedActivityView({
  node,
  projectId,
  execution,
  taskStream,
  isRunning,
  executionId,
  machineId,
}: UnifiedActivityViewProps) {
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [taskImages, setTaskImages] = useState<ChatImageAttachment[]>([])
  const taskFilePickerRef = useRef<(() => void) | null>(null)
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false)
  const [initialFilePath, setInitialFilePath] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isMobile = useMediaQuery("(max-width: 767px)")

  // Resizable file browser panel (desktop only)
  const [fileBrowserWidth, setFileBrowserWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("astro:fileBrowserWidth")
      if (stored) return Math.max(200, Math.min(500, parseInt(stored, 10)))
    }
    return 280
  })
  const isDraggingRef = useRef(false)
  const dragStartPosRef = useRef(0)
  const dragStartSizeRef = useRef(0)

  useEffect(() => {
    localStorage.setItem("astro:fileBrowserWidth", String(fileBrowserWidth))
  }, [fileBrowserWidth])

  useEffect(() => {
    const handleMove = (clientX: number) => {
      if (!isDraggingRef.current) return
      const delta = dragStartPosRef.current - clientX
      const maxW = Math.min(500, window.innerWidth * 0.5)
      setFileBrowserWidth(Math.max(200, Math.min(maxW, dragStartSizeRef.current + delta)))
    }
    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX)
    const handleTouchMove = (e: TouchEvent) => {
      if (isDraggingRef.current) e.preventDefault()
      handleMove(e.touches[0].clientX)
    }
    const handleEnd = () => { isDraggingRef.current = false }
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleEnd)
    document.addEventListener("touchmove", handleTouchMove, { passive: false })
    document.addEventListener("touchend", handleEnd)
    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleEnd)
      document.removeEventListener("touchmove", handleTouchMove)
      document.removeEventListener("touchend", handleEnd)
    }
  }, [])

  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const githubOwner = project?.githubOwner
  const githubRepo = project?.githubRepo

  // GitHub comment context
  const githubCommentNumber = node.prNumber ?? node.githubIssueNumber
  const githubContext = useMemo(() => {
    if (githubOwner && githubRepo && githubCommentNumber) {
      return { owner: githubOwner, repo: githubRepo, number: githubCommentNumber }
    }
    return undefined
  }, [githubOwner, githubRepo, githubCommentNumber])

  const subscribeToStream = useGitHubCommentsStore((s) => s.subscribeToStream)
  useEffect(() => {
    if (!githubContext) return
    const cleanup = subscribeToStream(githubContext.owner, githubContext.repo, githubContext.number)
    return cleanup
  }, [githubContext, subscribeToStream])

  const reviewThreadsKey = githubContext ? `${githubContext.owner}/${githubContext.repo}/${githubContext.number}` : ""
  const reviewThreadsRaw = useGitHubCommentsStore((s) => reviewThreadsKey ? s.reviewThreads[reviewThreadsKey] : undefined)
  const reviewThreads = reviewThreadsRaw ?? EMPTY_REVIEW_THREADS
  const reviewCommentCount = reviewThreads.reduce((sum, t) => sum + t.comments.length, 0)
  const [scrollToReviewThreadId] = useState<number | null>(null)

  const handleReviewCommentsClick = useCallback(() => {
    const el = document.getElementById("pr-review-threads")
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [])

  const addSteerMessage = useRealtimeStore((s) => s.addSteerMessage)
  const updateSteerMessage = useRealtimeStore((s) => s.updateSteerMessage)
  const respondToDynamicApproval = useRealtimeStore((s) => s.respondToDynamicApproval)
  const cancelExecution = useExecutionStore((s) => s.cancelExecution)
  const model = useSettingsStore((s) => s.model)

  // ─── Shared Hooks ─────────────────────────────────────────────────
  const { chatSession, isChatStreaming, addMessage, sendPlaygroundChat, abortChatStream } =
    useChatSession({ projectId, type: "task-chat", nodeId: node.id })

  const sessionMessages = useMemo(() => chatSession?.messages || [], [chatSession?.messages])
  const {
    execActivityEvents: activityEvents,
    allActivityEvents, displayBlocks, answeredRequestIds, approvalResponseMap, isRestoring,
  } = useActivityFeed({
    executionId: executionId || undefined,
    chatSessionId: chatSession?.id,
    execution,
    projectId,
    chatMessages: sessionMessages,
  })

  const { autoScroll, handleScroll, scrollToBottom } = useAutoScroll(
    containerRef,
    [allActivityEvents.length, displayBlocks.length],
  )

  // ─── Handlers ─────────────────────────────────────────────────────
  async function handleApprovalResponse(requestId: string, answer: string) {
    if (!executionId) return
    await respondToDynamicApproval(executionId, requestId, answer)
  }

  const outputText = execution?.streamText || taskStream?.stdout || node.executionOutput || ""

  // Steer handler (with ack tracking and interrupt support)
  async function handleSteer(text: string, interrupt = false) {
    if (!text || sending) return
    setSending(true)

    const resolvedMachineId = machineId
      || useExecutionStore.getState().getExecution(node.id)?.machineId
      || useRealtimeStore.getState().taskStreams.get(executionId)?.machineId

    const steerIndex = taskStream?.steerMessages.length ?? 0
    addSteerMessage(executionId, text, interrupt)

    if (!resolvedMachineId) {
      updateSteerMessage(executionId, steerIndex, { accepted: false, ackMessage: 'No machine connected — cannot steer' })
      setSending(false)
      return
    }

    const timeoutId = setTimeout(() => {
      updateSteerMessage(executionId, steerIndex, {
        accepted: false,
        ackMessage: isCompletedExecution ? "Timed out — dispatching follow-up execution..." : "Timed out",
      })
      if (isCompletedExecution) {
        handleFollowUpDispatch(text, true)
      }
    }, 15000)

    try {
      const response = await fetch(apiUrl("/api/dispatch/steer"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          taskId: executionId,
          machineId: resolvedMachineId,
          message: text,
          action: "guidance",
          interrupt,
          sessionId: execution?.sessionId,
          branchName: node.branchName || execution?.branchName,
        }),
      })

      if (!response.ok) {
        clearTimeout(timeoutId)
        const errText = await response.text().catch(() => "Unknown error")
        // If steer was rejected because session expired on a completed task,
        // fall back to chat mode instead of showing an error
        if (!isRunning && (errText.includes("not found") || errText.includes("session expired") || errText.includes("not accepted"))) {
          updateSteerMessage(executionId, steerIndex, {
            accepted: false,
            ackMessage: "Session expired — dispatching follow-up execution...",
          })
          handleFollowUpDispatch(text, true)
          return
        }
        updateSteerMessage(executionId, steerIndex, {
          accepted: false,
          ackMessage: `Failed: ${response.status} ${errText.slice(0, 100)}`,
        })
      } else {
        clearTimeout(timeoutId)
        const result = await response.json().catch(() => ({ delivered: false }))
        // Machine offline + completed task → fall back to follow-up execution
        if (!result.delivered && !isRunning) {
          updateSteerMessage(executionId, steerIndex, {
            accepted: false,
            ackMessage: "Machine offline — dispatching follow-up execution...",
          })
          handleFollowUpDispatch(text, true)
          return
        }
        // Session expired on agent side
        if (result.accepted === false && !isRunning) {
          updateSteerMessage(executionId, steerIndex, {
            accepted: false,
            ackMessage: "Session expired — dispatching follow-up execution...",
          })
          handleFollowUpDispatch(text, true)
          return
        }
        updateSteerMessage(executionId, steerIndex, { accepted: result.delivered ?? true })
      }
    } catch (error) {
      clearTimeout(timeoutId)
      if (isCompletedExecution) {
        updateSteerMessage(executionId, steerIndex, {
          accepted: false,
          ackMessage: "Network error — dispatching follow-up execution...",
        })
        handleFollowUpDispatch(text, true)
      } else {
        updateSteerMessage(executionId, steerIndex, {
          accepted: false,
          ackMessage: `Failed: ${error instanceof Error ? error.message : "Network error"}`,
        })
      }
    } finally {
      setSending(false)
    }
  }

  // Follow-up execution handler — re-dispatches as a full execution with delivery
  // skipSendingGuard: true when called from steer fallback (sending is already true)
  async function handleFollowUpDispatch(text: string, skipSendingGuard = false) {
    if (!text || (!skipSendingGuard && sending)) return
    setSending(true)
    try {
      await useExecutionStore.getState().startExecution(node.id, projectId, {
        isFollowUp: true,
        followUpMessage: text,
        targetMachineId: execution?.machineId || machineId,
        preferredProvider: execution?.providerId || undefined,
      })
    } catch (error) {
      console.error("[unified-activity] Follow-up dispatch failed:", error)
    } finally {
      setSending(false)
    }
  }

  // Chat handler (post-completion)
  function handleChat(text: string) {
    if ((!text && taskImages.length === 0) || !chatSession) return

    const currentImages = taskImages
    setTaskImages([])

    const sid = chatSession.id
    addMessage(sid, { role: "user", content: text || "(See attached images)" })
    addMessage(sid, { role: "assistant", content: "" })

    const freshSession = useSessionStore.getState().sessions.get(sid)
    const freshMessages = freshSession?.messages || []
    const historyMessages = freshMessages
      .slice(0, -2)
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    sendPlaygroundChat({
      sessionId: sid,
      projectId,
      nodeId: node.id,
      message: text || "(See attached images)",
      taskTitle: node.title,
      taskDescription: node.content ? stripHtml(node.content) : (node.description || node.title || ""),
      taskOutput: outputText,
      visionDoc: project?.visionDoc,
      model,
      providerId: execution?.providerId || undefined,
      messages: historyMessages,
      branchName: execution?.branchName,
      prUrl: execution?.prUrl,
      imageRefs: currentImages.length > 0 ? currentImages.map((img) => img.id) : undefined,
    })
  }

  const execMachineId = useExecutionStore(s => s.executions.get(node.id)?.machineId)
  const streamMachineId = useRealtimeStore(s =>
    executionId ? s.taskStreams.get(executionId)?.machineId : undefined
  )
  const resolvedMachineIdForCanSteer = machineId || execMachineId || streamMachineId
  const hasPreservedSession = !isRunning && !!execution?.sessionId && !!resolvedMachineIdForCanSteer
  const canSteer = (isRunning && !!resolvedMachineIdForCanSteer) || hasPreservedSession

  // Completed execution = node in terminal status with an existing execution
  const TERMINAL_STATUSES = new Set(["completed", "auto_verified", "awaiting_judgment", "awaiting_approval"])
  const isCompletedExecution = !isRunning && !!execution?.executionId && TERMINAL_STATUSES.has(node.status)

  function handleSend(interrupt = false) {
    const text = input.trim()
    if (!text && (canSteer || taskImages.length === 0)) return
    setInput("")

    if (isCompletedExecution) {
      handleFollowUpDispatch(text)
    } else if (canSteer) {
      handleSteer(text, interrupt)
    } else {
      handleChat(text)
    }
  }

  function handleSendPrompt(text: string) {
    if (isCompletedExecution) {
      handleFollowUpDispatch(text)
    } else if (canSteer) {
      handleSteer(text)
    } else {
      handleChat(text)
    }
  }

  const isInputDisabled = sending || isChatStreaming

  const baseWorkDir = project?.workingDirectory || ""
  const fileBrowserDir = useMemo(() => {
    if (baseWorkDir && project?.projectBranch) {
      return projectWorktreePath(baseWorkDir, project.projectBranch)
    }
    return baseWorkDir
  }, [baseWorkDir, project?.projectBranch])

  const handleFileSelect = useCallback((filePath: string) => {
    const resolved = resolveFilePathForBrowsing(filePath, fileBrowserDir)
    setInitialFilePath(resolved)
    setFileBrowserOpen(true)
  }, [fileBrowserDir])

  const renderPrStatus = useCallback((block: import("@/components/activity-blocks").DisplayBlock, key: string) => {
    const prEvent = block.events[0] as Extract<TaskActivityEvent, { type: 'pr_status' }>
    const prDataFromEvent: PrData = {
      title: prEvent.title || `PR #${prEvent.prNumber}`,
      number: prEvent.prNumber,
      state: prEvent.state || 'open',
      htmlUrl: prEvent.prUrl,
      branchName: prEvent.branchName,
      baseBranch: prEvent.baseBranch,
      additions: prEvent.additions,
      deletions: prEvent.deletions,
      changedFiles: prEvent.changedFiles,
      draft: prEvent.draft,
      checks: (prEvent.checks || []).map(c => ({
        name: c.name,
        status: c.status as PrCheckRun["status"],
        conclusion: c.conclusion as PrCheckRun["conclusion"],
        startedAt: c.startedAt,
        completedAt: c.completedAt,
        htmlUrl: c.htmlUrl,
      })),
      reviews: (prEvent.reviews || []).map(r => ({
        user: r.user,
        state: r.state as PrReview["state"],
        submittedAt: r.submittedAt,
      })),
    }
    return (
      <PrStatusCard
        key={key}
        node={node}
        prData={prDataFromEvent}
        owner={githubOwner}
        repo={githubRepo}
        reviewCommentCount={reviewCommentCount}
        onReviewCommentsClick={handleReviewCommentsClick}
      />
    )
  }, [node, githubOwner, githubRepo, reviewCommentCount, handleReviewCommentsClick])

  return (
    <div className="flex h-full">
    <div className="flex flex-col flex-1 min-w-0 relative">
      {/* File browser toggle */}
      {machineId && fileBrowserDir && (
        <div className="absolute top-2 right-2 z-10">
          <Button
            variant={fileBrowserOpen ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setFileBrowserOpen(!fileBrowserOpen)}
            title={fileBrowserOpen ? "Close file browser" : "Open file browser"}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Timeline */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto py-3 bg-muted/20"
      >
        {execution?.summary && (
          <SummaryCard summary={execution.summary} />
        )}

        {node.prNumber && !displayBlocks.some(b => b.type === 'pr_status') && (
          <PrStatusCard
            node={node}
            owner={githubOwner}
            repo={githubRepo}
            reviewCommentCount={reviewCommentCount}
            onReviewCommentsClick={handleReviewCommentsClick}
          />
        )}

        {displayBlocks.length === 0 && (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {isRunning ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <TypingIndicator className="text-muted-foreground" />
                Waiting for output...
              </span>
            ) : isRestoring ? (
              <span className="flex items-center gap-2">
                <TypingIndicator className="text-muted-foreground" />
                Loading activity...
              </span>
            ) : "No output available"}
          </div>
        )}

        <ActivityBlockRenderer
          blocks={displayBlocks}
          isStreaming={isRunning || isChatStreaming}
          isRunning={isRunning || isChatStreaming}
          onSendPrompt={handleSendPrompt}
          onFileSelect={machineId && fileBrowserDir ? handleFileSelect : undefined}
          onEditMessage={!isRunning && !isChatStreaming ? (msg) => setInput(msg) : undefined}
          onApprovalResponse={handleApprovalResponse}
          githubContext={githubContext}
          answeredApprovals={answeredRequestIds}
          approvalResponses={approvalResponseMap}
          renderPrStatus={renderPrStatus}
        />

        {isRunning && activityEvents.length > 0 && (
          <span className="px-4 animate-pulse text-info text-xs font-mono">|</span>
        )}

        {isChatStreaming && (
          <div className="flex items-center gap-2 px-4 py-2">
            <TypingIndicator className="text-muted-foreground" />
          </div>
        )}

        {githubContext && node.prNumber && (
          <PRReviewThreads
            owner={githubContext.owner}
            repo={githubContext.repo}
            prNumber={githubContext.number}
            scrollToThreadId={scrollToReviewThreadId}
          />
        )}

        {githubContext && displayBlocks.some(b => b.type === 'github_comment') && (
          <NewCommentComposer githubContext={githubContext} />
        )}

        {!isRunning && (execution?.status === "success" || execution?.status === "failure") && activityEvents.length > 0 && (
          <div className={cn(
            "flex items-center gap-2 mx-4 my-3 px-3 py-2 rounded-lg border text-xs font-medium",
            execution.status === "success"
              ? "border-success/30 bg-success/5 text-success"
              : "border-error/30 bg-error/5 text-error"
          )}>
            {execution.status === "success" ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <XCircle className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {execution.status === "success"
                ? "Execution completed successfully"
                : "Execution failed"}
            </span>
            {execution.fileChanges.length > 0 && (
              <>
                <span className="opacity-50">&middot;</span>
                <span className="opacity-70">{execution.fileChanges.length} file{execution.fileChanges.length !== 1 ? "s" : ""} changed</span>
              </>
            )}
            {execution.startedAt && execution.completedAt && (
              <>
                <span className="opacity-50">&middot;</span>
                <span className="opacity-70 tabular-nums">
                  {(() => {
                    const ms = new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()
                    if (ms < 60_000) return `${Math.round(ms / 1000)}s`
                    const m = Math.floor(ms / 60_000)
                    const s = Math.round((ms % 60_000) / 1000)
                    return `${m}m ${s}s`
                  })()}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {!autoScroll && (
        <Button
          variant="secondary"
          size="sm"
          className="absolute bottom-16 right-4 h-8 gap-1.5 shadow-md z-10"
          onClick={scrollToBottom}
        >
          <ArrowDown className="h-3.5 w-3.5" />
          Bottom
        </Button>
      )}

      {/* Input Bar */}
      <div className="border-t border-border bg-background shrink-0">
      {!isRunning && execution?.sessionId && (
        <div className="px-3 pt-2 pb-0 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Info className="h-3 w-3 shrink-0" />
          <span>
            {`${hasPreservedSession ? 'Resume session' : isCompletedExecution ? 'Follow-up execution' : 'Follow-up chat'}${execution.branchName ? ` — changes on \`${execution.branchName}\`` : ''}`}
            {execution.prUrl ? ` — ` : ''}
          </span>
          {execution.prUrl && (
            <a href={execution.prUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              View PR
            </a>
          )}
        </div>
      )}
      {isRunning && (
        <div className="px-3 pt-2 pb-0">
          <span className="text-[10px] text-muted-foreground">
            ⌘+Enter to send · Shift+Enter to interrupt
          </span>
        </div>
      )}
      <div className="flex items-end gap-2 p-3 pt-1.5">
        <FileCompletionTextarea
          projectId={projectId}
          machineId={machineId || project?.defaultMachineId}
          workingDirectory={project?.workingDirectory}
          fileTree={project?.fileTree}
          value={input}
          onChange={setInput}
          onSubmit={(opts) => handleSend(opts?.interrupt ?? false)}
          placeholder={
            isCompletedExecution
              ? "Continue working on this task... (type @ to reference files)"
              : canSteer
              ? "Steer the agent... (type @ to reference files)"
              : "Ask about this task... (type @ to reference files)"
          }
          rows={2}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          {...(!canSteer ? {
            images: taskImages,
            onImagesChange: setTaskImages,
            filePickerRef: taskFilePickerRef,
          } : {})}
        />
        <div className="flex flex-row items-end gap-1 shrink-0">
          {!canSteer && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => taskFilePickerRef.current?.()}
              title="Attach image (or paste/drag-drop)"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          )}
          {(isRunning || isChatStreaming) && (
            <Button
              size="icon"
              variant="destructive"
              className="h-9 w-9"
              onClick={() => {
                if (isChatStreaming && chatSession) abortChatStream(chatSession.id)
                if (isRunning) cancelExecution(node.id)
              }}
              title={isRunning ? "Stop execution" : "Stop response"}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            className="h-9 w-9"
            onClick={(e) => handleSend(e.shiftKey)}
            disabled={(!input.trim() && (canSteer || taskImages.length === 0)) || isInputDisabled}
            title="Send (⌘+Enter)"
          >
            {sending ? (
              <TypingIndicator className="text-current scale-75" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      </div>
    </div>

    {/* File Browser Sidebar */}
    {fileBrowserOpen && machineId && fileBrowserDir && !isMobile && (
      <div className="relative shrink-0 flex border-l border-border" style={{ width: fileBrowserWidth }}>
        <div
          className="w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 shrink-0 touch-none"
          onMouseDown={(e) => {
            isDraggingRef.current = true
            dragStartPosRef.current = e.clientX
            dragStartSizeRef.current = fileBrowserWidth
          }}
          onTouchStart={(e) => {
            isDraggingRef.current = true
            dragStartPosRef.current = e.touches[0].clientX
            dragStartSizeRef.current = fileBrowserWidth
          }}
        />
        <FileBrowser
          machineId={machineId}
          workingDirectory={fileBrowserDir}
          fallbackDirectory={baseWorkDir}
          embedded
          onClose={() => { setFileBrowserOpen(false); setInitialFilePath(null) }}
          initialFilePath={initialFilePath}
        />
      </div>
    )}
    {isMobile && machineId && fileBrowserDir && (
      <Sheet open={fileBrowserOpen} onOpenChange={(open) => { setFileBrowserOpen(open); if (!open) setInitialFilePath(null) }}>
        <SheetContent side="bottom" className="h-[70vh] p-0">
          <FileBrowser
            machineId={machineId}
            workingDirectory={fileBrowserDir}
            fallbackDirectory={baseWorkDir}
            embedded
            onClose={() => { setFileBrowserOpen(false); setInitialFilePath(null) }}
            initialFilePath={initialFilePath}
          />
        </SheetContent>
      </Sheet>
    )}
    </div>
  )
}
