import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { Send, ChevronDown, Bot, CheckCircle2, Pencil, MessageSquare, Plus, History, Trash2, Sparkles, Paperclip, Square } from "lucide-react"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FileCompletionTextarea, type MentionItem, type SlashCommand, type ChatImageAttachment } from "@/components/ui/file-completion-textarea"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { fetchSlashCommands } from "@/lib/api-client"
import { useSettingsStore, resolveModel } from "@/stores/settings-store"
import { useExecutionStore, type MachineInfo } from "@/stores/execution-store"

import { useProjectStore } from "@/stores/project-store"
import { useSessionStore, getSessionTitle } from "@/stores/session-store"
import { InlineRenameInput } from "@/components/inline-rename-input"
import { useProjectMachineId } from "@/hooks/use-project-machine"
import { useStreamEvents } from "@/hooks/use-stream-events"
import { ActivityBlockRenderer } from "@/components/activity-block-renderer"
import { deriveAvailableProviders } from "@/components/execution/provider-utils"
import { usePlanContext } from "@/hooks/use-plan-context"
import { useAutoScroll } from "@/hooks/use-auto-scroll"
import type { AppliedMutations } from "@/lib/plan-mutations"
import type { ProviderStatus, Session, TaskActivityEvent } from "@/types"

interface Message {
  role: "user" | "assistant"
  content: string
  /** Mutations applied from this message */
  appliedMutations?: AppliedMutations
}

/** Compact label for a model id (strip dates and common prefixes). */
function shortModelLabel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

interface ChatPanelProps {
  projectId: string
  visionDoc?: string
  /** Pre-fill and auto-send a message (e.g. from decompose button) */
  initialMessage?: string
  /** Called when the user clicks a [node_id] link in a chat message */
  onNodeSelect?: (nodeId: string) => void
  /** Extra elements rendered in the header bar (right side, before provider selector) */
  headerActions?: React.ReactNode
}

export function ChatPanel({ projectId, visionDoc, initialMessage, onNodeSelect, headerActions }: ChatPanelProps) {
  const [input, setInput] = useState("")
  const [chatImages, setChatImages] = useState<ChatImageAttachment[]>([])
  /** When set, the next send will truncate the conversation from this message before re-sending */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const filePickerRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const initialMessageSent = useRef(false)
  // Session store for persistent chat
  const createSession = useSessionStore((s) => s.createSession)
  const getOrCreateSession = useSessionStore((s) => s.getOrCreateSession)
  const addMessage = useSessionStore((s) => s.addMessage)
  const sendChatMessage = useSessionStore((s) => s.sendChatMessage)
  const abortChatStream = useSessionStore((s) => s.abortChatStream)
  const streamingSessions = useSessionStore((s) => s.streamingSessions)
  const registerMounted = useSessionStore((s) => s.registerMounted)
  const unregisterMounted = useSessionStore((s) => s.unregisterMounted)
  const getSessionsForProject = useSessionStore((s) => s.getSessionsForProject)
  const getActiveSessionId = useSessionStore((s) => s.getActiveSessionId)
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId)
  const getSession = useSessionStore((s) => s.getSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const clearActiveSessionId = useSessionStore((s) => s.clearActiveSessionId)
  // Subscribe to sessions and activeSessionIds so memos recompute on changes
  const sessions = useSessionStore((s) => s.sessions)
  const sessionsLoaded = useSessionStore((s) => s.loaded)
  const activeSessionIds = useSessionStore((s) => s.activeSessionIds)

  // State for session dropdown and inline rename
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)

  // Slash command autocomplete state
  // Dropdown refs for provider/model menus (for /sessions and /model commands)
  const sessionDropdownRef = useRef<HTMLButtonElement>(null)
  const modelDropdownRef = useRef<HTMLButtonElement>(null)

  // Get all project-chat sessions for this project (re-evaluates when sessions map changes)
  const projectChatSessions = useMemo(
    () => getSessionsForProject(projectId, "project-chat"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getSessionsForProject, projectId, sessions]
  )

  // Get the active session ID (re-evaluates when activeSessionIds changes)
  const activeSessionId = useMemo(
    () => getActiveSessionId(projectId, "project-chat"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getActiveSessionId, projectId, activeSessionIds]
  )
  const currentSession: Session | undefined = useMemo(() => {
    // If we have an active session ID, try to get that session
    if (activeSessionId) {
      const session = getSession(activeSessionId)
      // Verify the session still exists and belongs to this project
      if (session && session.projectId === projectId && session.type === "project-chat") {
        return session
      }
    }
    // Fall back to the most recent session
    return projectChatSessions[0]
  }, [activeSessionId, getSession, projectChatSessions, projectId])

  // Ensure session exists and track as active — wait for sessions to load first
  // to avoid creating duplicates before existing sessions are fetched from DB.
  // Uses getOrCreateSession for idempotent session creation (safe when multiple
  // components mount simultaneously, e.g. chat-panel + plan-generation).
  useEffect(() => {
    if (!sessionsLoaded) return
    if (!currentSession) {
      const session = getOrCreateSession({ type: "project-chat", projectId })
      setActiveSessionId(projectId, "project-chat", session.id)
    } else if (!activeSessionId || activeSessionId !== currentSession.id) {
      setActiveSessionId(projectId, "project-chat", currentSession.id)
    }
  }, [sessionsLoaded, currentSession, getOrCreateSession, projectId, activeSessionId, setActiveSessionId])

  // Derive streaming state from store
  const isStreaming = currentSession ? streamingSessions.has(currentSession.id) : false

  // Detect active plan generation (plan-{projectId} execution in non-terminal state)
  const planExecution = useExecutionStore((s) => s.executions.get(`plan-${projectId}`))
  const isPlanGenerating = !!planExecution && !['success', 'failure', 'cancelled'].includes(planExecution.status)

  // Combined "busy" state — either chat streaming or plan generation in progress
  const isBusy = isStreaming || isPlanGenerating

  // Lazy-load full session data (messages) after page refresh
  const ensureFullSession = useSessionStore((s) => s.ensureFullSession)
  const currentSessionId = currentSession?.id
  const ensuredSessionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (currentSessionId && currentSessionId !== ensuredSessionRef.current && currentSession && currentSession.messages.length === 0 && !isStreaming) {
      ensuredSessionRef.current = currentSessionId
      ensureFullSession(currentSessionId)
    }
  }, [currentSessionId, currentSession, isStreaming, ensureFullSession])

  // Register/unregister mounted state for background notification detection
  useEffect(() => {
    if (!currentSessionId) return
    registerMounted(currentSessionId)
    return () => unregisterMounted(currentSessionId)
  }, [currentSessionId, registerMounted, unregisterMounted])

  // Handler to switch to a different session — abort any in-flight stream first
  const handleSessionSwitch = useCallback((sessionId: string) => {
    if (currentSession?.id) {
      abortChatStream(currentSession.id)
    }
    setEditingMessageId(null)
    setActiveSessionId(projectId, "project-chat", sessionId)
  }, [projectId, setActiveSessionId, currentSession?.id, abortChatStream])

  // Handler to create a new session
  const handleNewSession = useCallback(() => {
    const newSession = createSession({ type: "project-chat", projectId })
    setActiveSessionId(projectId, "project-chat", newSession.id)
  }, [createSession, projectId, setActiveSessionId])


  const handleDeleteSession = useCallback((sessionId: string) => {
    const isActiveSession = currentSession?.id === sessionId

    // Delete the session
    deleteSession(sessionId)

    // If we deleted the active session, switch to another or create new
    if (isActiveSession) {
      // Get remaining sessions (after deletion, so filter out the deleted one)
      const remainingSessions = projectChatSessions.filter(s => s.id !== sessionId)

      if (remainingSessions.length > 0) {
        // Switch to the most recent remaining session
        const mostRecent = remainingSessions[0]
        setActiveSessionId(projectId, "project-chat", mostRecent.id)
      } else {
        // No sessions left, clear active and let the effect create a new one
        clearActiveSessionId(projectId, "project-chat")
      }
    }
  }, [currentSession?.id, deleteSession, projectChatSessions, projectId, setActiveSessionId, clearActiveSessionId])

  // Handler to clear all project-chat sessions.
  const handleClearAllSessions = useCallback(() => {
    for (const session of projectChatSessions) {
      deleteSession(session.id)
    }
    clearActiveSessionId(projectId, "project-chat")
  }, [projectChatSessions, deleteSession, projectId, clearActiveSessionId])

  const messages: (Message & { id: string })[] = (currentSession?.messages || []).map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    appliedMutations: m.appliedMutations as AppliedMutations | undefined,
  }))

  // Activity view: hydrate events from streaming_events or session messages
  const sessionMessages = useMemo(() => currentSession?.messages || [], [currentSession?.messages])
  const { activityEvents: sessionActivityEvents, displayBlocks: sessionDisplayBlocks, isHydrating: isRestoring } = useStreamEvents(
    currentSession?.id,
    { legacySessionMessages: sessionMessages, projectId },
  )

  const displayBlocks = sessionDisplayBlocks
  const answeredApprovals = useMemo(() => {
    const ids = new Set<string>()
    const responses = new Map<string, Extract<TaskActivityEvent, { type: 'approval_response' }>>()
    for (const event of sessionActivityEvents) {
      if (event.type === 'approval_response') {
        ids.add(event.requestId)
        responses.set(event.requestId, event)
      }
    }
    return { answeredApprovals: ids, approvalResponses: responses }
  }, [sessionActivityEvents])

  // Project store — for file tree and working directory
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const resolvedMachineId = useProjectMachineId(project)

  // Plan context — shared hook
  const { planNodes, planNodeContext, planEdgeContext } = usePlanContext(projectId)

  // Build @mention items for the chat input (task/milestone references)
  const mentionItems: MentionItem[] = useMemo(() => {
    return planNodes.map((n) => ({
      id: n.id,
      label: n.title,
      detail: n.type,
      kind: n.type === "milestone" ? "milestone" as const : "task" as const,
    }))
  }, [planNodes])

  // Slash commands from connected machine
  const [slashCmds, setSlashCmds] = useState<SlashCommand[]>([])
  useEffect(() => {
    if (!resolvedMachineId) return
    fetchSlashCommands(resolvedMachineId, project?.workingDirectory).then(setSlashCmds).catch(() => {})
  }, [resolvedMachineId, project?.workingDirectory])

  // Settings defaults
  const defaultProvider = useSettingsStore((s) => s.defaultProvider)

  // Provider list — filtered to providers on the project's machine
  const globalProviders = useExecutionStore((s) => s.providers)
  const executionMachines = useExecutionStore((s) => s.machines)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)
  const providers = useMemo(() => {
    if (!resolvedMachineId) return globalProviders
    const machine = executionMachines.find((m: MachineInfo) => m.machineId === resolvedMachineId)
    return deriveAvailableProviders(machine?.providers, globalProviders)
  }, [resolvedMachineId, executionMachines, globalProviders])

  // Use project-level provider from settings (shared with workdir bar)
  const setDefaultProvider = useSettingsStore((s) => s.setDefaultProvider)
  const [selectedModel, setSelectedModel] = useState("")

  // Load providers on mount if not already loaded
  useEffect(() => {
    if (!providersLoaded) loadProviders()
  }, [providersLoaded, loadProviders])

  // Resolve the effective provider object, model, and providerId for the API call
  const selectedProviderObj: ProviderStatus | undefined =
    defaultProvider ? providers.find((p) => p.id === defaultProvider) : undefined

  const effectiveProviderId = defaultProvider || undefined

  const customModelMap = useSettingsStore((s) => s.customModelMap)
  const modelTier = useSettingsStore((s) => s.modelTier)
  const effectiveModel = (() => {
    if (selectedModel) return selectedModel
    return resolveModel(modelTier, effectiveProviderId, customModelMap)
  })()

  // No unmount abort needed — SSE is owned by session-store, survives navigation

  // Auto-scroll
  const { autoScroll, handleScroll, scrollToBottom } = useAutoScroll(
    scrollRef,
    [displayBlocks.length, isStreaming],
  )

  // Send message — delegates to store-owned SSE which handles queuing when streaming.
  // No local queue needed: the store's chatMessageQueues auto-drain on stream completion.
  const sendMessage = useCallback((text: string) => {
    // Read session fresh from store — never use stale ref
    const store = useSessionStore.getState()
    const activeId = store.activeSessionIds.get(`${projectId}:project-chat`)
    const session = activeId ? store.sessions.get(activeId) : undefined
    if (!text || !session) return

    const currentImages = chatImages
    setInput("")
    setChatImages([])

    const sid = session.id

    // Edit & retry: if editing a previous message, truncate the conversation
    // from that message forward before re-sending. This gives Claude a clean
    // conversation without the old response to the edited message.
    if (editingMessageId) {
      store.truncateAfterMessage(sid, editingMessageId)
      setEditingMessageId(null)
    }

    addMessage(sid, { role: "user", content: text })
    addMessage(sid, { role: "assistant", content: "" })

    // Re-read messages from store after adding user msg + placeholder
    const freshSession = useSessionStore.getState().sessions.get(sid)
    const freshMessages = freshSession?.messages || []
    const historyMessages = freshMessages
      .slice(0, -2)
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    sendChatMessage({
      sessionId: sid,
      projectId,
      message: text,
      visionDoc,
      model: effectiveModel,
      providerId: effectiveProviderId,
      planNodes: planNodeContext,
      planEdges: planEdgeContext,
      messages: historyMessages,
      imageRefs: currentImages.length > 0 ? currentImages.map((img) => img.id) : undefined,
    })
  }, [projectId, visionDoc, effectiveModel, effectiveProviderId, planNodeContext, planEdgeContext, addMessage, sendChatMessage, chatImages, editingMessageId])

  const handleEditMessage = useCallback((msg: string, timestamp: Date) => {
    const session = useSessionStore.getState().sessions.get(
      useSessionStore.getState().activeSessionIds.get(`${projectId}:project-chat`) ?? ''
    )
    const msgs = session?.messages || []
    const eventTime = timestamp.getTime()
    let bestIdx = -1
    let bestDelta = Infinity
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role === 'user' && msgs[i].content === msg) {
        const delta = Math.abs(msgs[i].timestamp.getTime() - eventTime)
        if (delta < bestDelta) {
          bestDelta = delta
          bestIdx = i
        }
      }
    }
    if (bestIdx >= 0) {
      setEditingMessageId(msgs[bestIdx].id)
    } else {
      console.warn('[ChatPanel] edit: no matching session message found — sending as new message')
    }
    setInput(msg)
  }, [projectId])

  function handleSend() {
    const text = input.trim()
    if (!text && chatImages.length === 0) return
    sendMessage(text || "(See attached images)")
  }

  // Listen for send_chat_message events from json-render interactive specs
  useEffect(() => {
    const handler = (e: Event) => {
      const message = (e as CustomEvent<{ message: string }>).detail?.message
      if (message) sendMessage(message)
    }
    window.addEventListener('astro:send-chat-message', handler)
    return () => window.removeEventListener('astro:send-chat-message', handler)
  }, [sendMessage])

  // Handle initialMessage (from decompose button)
  useEffect(() => {
    if (initialMessage && !initialMessageSent.current && !isBusy) {
      initialMessageSent.current = true
      // Auto-send after a brief delay so the session is ready
      const timer = setTimeout(() => sendMessage(initialMessage), 100)
      return () => clearTimeout(timer)
    }
  }, [initialMessage, isBusy, sendMessage])

  // Display labels
  const providerLabel = selectedProviderObj?.name
    ?? (effectiveProviderId ? effectiveProviderId : "Auto")
  const modelLabel = selectedModel
    ? shortModelLabel(selectedModel)
    : effectiveModel
      ? shortModelLabel(effectiveModel)
      : "Default"

  /** Resolve a node title from its ID for the update banner. */
  const getNodeTitle = useCallback((nodeId: string) => {
    return planNodes.find((n) => n.id === nodeId)?.title ?? nodeId
  }, [planNodes])

  /** Set of known node IDs for quick lookup */
  const nodeIdSet = useMemo(() => new Set(planNodes.map((n) => n.id)), [planNodes])

  /**
   * Preprocess markdown to replace [uuid] references with clickable node links.
   * Converts `[uuid]` to `[Title](astro:node:uuid)` when the uuid matches a known node.
   */
  const preprocessNodeRefs = useCallback((text: string) => {
    // Match [uuid] patterns — UUIDs are 8-4-4-4-12 hex chars
    return text.replace(/\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi, (_match, id) => {
      if (nodeIdSet.has(id)) {
        const title = planNodes.find((n) => n.id === id)?.title ?? id
        return `[${title}](astro:node:${id})`
      }
      return _match
    })
  }, [nodeIdSet, planNodes])

  /**
   * Strip raw tool call XML from text and apply node ref preprocessing.
   * The relay streams Claude's raw output which includes tool call XML
   * (e.g. <function_calls>, <function_calls>, <invoke>, etc.);
   * these are already represented as separate tool_use/tool_result activity events,
   * so the XML in the text stream is redundant and should be hidden.
   */
  const preprocessTextContent = useCallback((text: string) => {
    // Strip complete function_calls blocks (with or without antml: prefix)
    let cleaned = text.replace(/<(?:antml:)?function_calls>[\s\S]*?<\/(?:antml:)?function_calls>/g, '')
    // Strip incomplete/trailing function_calls blocks (during streaming, the closing tag may not have arrived yet)
    cleaned = cleaned.replace(/<(?:antml:)?function_calls>[\s\S]*$/g, '')
    // Strip standalone invoke blocks that may appear outside function_calls wrappers
    cleaned = cleaned.replace(/<(?:antml:)?invoke\b[\s\S]*?<\/(?:antml:)?invoke>/g, '')
    cleaned = cleaned.replace(/<(?:antml:)?invoke\b[\s\S]*$/g, '')
    // Trim leftover whitespace from stripped blocks
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()
    if (!cleaned) return ''
    return preprocessNodeRefs(cleaned)
  }, [preprocessNodeRefs])

  return (
    <div className="flex h-full flex-col border-l border-border/60 bg-card relative">
      {/* Header with session switcher and model/provider picker */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-4 border-b border-border/60">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Project Chat</span>
          <Link
            to={`/welcome?projectId=${projectId}`}
            className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
            title="Open planning session"
          >
            <Sparkles className="h-3 w-3" />
            <span>Plan</span>
          </Link>
          {/* Session metadata */}
          {isStreaming ? (
            <span className="flex items-center gap-1.5 text-[10px] text-info">
              <span className="relative h-2 w-2 shrink-0">
                <span className="absolute inset-0 rounded-full border-[1.5px] border-info border-t-transparent animate-spin" />
              </span>
              Running
            </span>
          ) : messages.length > 0 ? (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {messages.length} msgs
            </span>
          ) : null}
          {/* Session Switcher */}
          {projectChatSessions.length > 0 && (
            <DropdownMenu open={sessionDropdownOpen} onOpenChange={setSessionDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <button ref={sessionDropdownRef} className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors cursor-pointer">
                  <History className="h-3 w-3" />
                  <span>{projectChatSessions.length}</span>
                  <ChevronDown className="h-2.5 w-2.5 opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[240px]">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-xs font-semibold">Sessions</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { handleClearAllSessions(); setSessionDropdownOpen(false) }}
                      className="flex items-center gap-1 text-[10px] text-destructive hover:text-destructive/80 font-normal px-1.5 py-0.5 rounded hover:bg-destructive/10 transition-colors"
                      title="Delete all sessions"
                    >
                      <Trash2 className="h-3 w-3" />
                      Clear All
                    </button>
                    <button
                      onClick={() => { handleNewSession(); setSessionDropdownOpen(false) }}
                      className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 font-normal px-1.5 py-0.5 rounded hover:bg-primary/10 transition-colors"
                      title="New session"
                    >
                      <Plus className="h-3 w-3" />
                      New
                    </button>
                  </div>
                </div>
                <DropdownMenuSeparator />
                {projectChatSessions.map((session) => {
                  const messageCount = session.messageCount ?? session.messages.length
                  const sessionTitle = getSessionTitle(session)
                  const isActive = currentSession?.id === session.id
                  return (
                    <div
                      key={session.id}
                      onClick={() => { if (renamingSessionId !== session.id) { handleSessionSwitch(session.id); setSessionDropdownOpen(false) } }}
                      className="flex flex-col items-start gap-0.5 py-2 px-2 rounded-sm cursor-pointer hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center gap-2 w-full">
                        <MessageSquare className="h-3 w-3 shrink-0" />
                        {renamingSessionId === session.id ? (
                          <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                            <InlineRenameInput
                              value={sessionTitle}
                              onSave={(newTitle) => {
                                renameSession(session.id, newTitle)
                                setRenamingSessionId(null)
                              }}
                              onCancel={() => setRenamingSessionId(null)}
                              validate={(v) => v.trim().length === 0 ? "Title cannot be empty" : null}
                              className="text-xs"
                            />
                          </div>
                        ) : (
                          <span
                            className="text-xs truncate flex-1"
                            title={sessionTitle}
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              setRenamingSessionId(session.id)
                            }}
                          >
                            {sessionTitle}
                          </span>
                        )}
                        {isActive && renamingSessionId !== session.id && (
                          <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                        )}
                        {renamingSessionId !== session.id && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setRenamingSessionId(session.id) }}
                            className="p-1.5 hover:bg-accent rounded opacity-60 [@media(hover:hover)]:opacity-40 hover:opacity-100 transition-opacity"
                            title="Rename session"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id) }}
                          className="p-1.5 hover:bg-destructive/10 rounded opacity-60 [@media(hover:hover)]:opacity-40 hover:opacity-100 transition-opacity text-destructive"
                          title="Delete session"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="text-[10px] text-muted-foreground truncate w-full pl-5">
                        {`${messageCount} messages`}
                      </span>
                    </div>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center gap-2">
          {headerActions}
          {/* Provider Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button ref={modelDropdownRef} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors cursor-pointer max-w-[140px]">
                <Bot className="h-3 w-3 shrink-0" />
                <span className="truncate">{providerLabel}</span>
                <ChevronDown className="h-2.5 w-2.5 opacity-50 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[240px]">
              <DropdownMenuLabel>Agent</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => { setDefaultProvider(""); setSelectedModel("") }}
                className="gap-2"
              >
                <Bot className="h-3.5 w-3.5" />
                <span>Auto</span>
                {!defaultProvider && (
                  <CheckCircle2 className="h-3.5 w-3.5 ml-auto text-primary" />
                )}
              </DropdownMenuItem>
              {providers.map((provider) => (
                <DropdownMenuItem
                  key={provider.id}
                  onClick={() => { setDefaultProvider(provider.id); setSelectedModel("") }}
                  className="gap-2"
                  disabled={!provider.available}
                >
                  <Bot className="h-3.5 w-3.5" />
                  <div className="flex flex-col">
                    <span>{provider.name}</span>
                    {!provider.available && (
                      <span className="text-[10px] text-muted-foreground">
                        {provider.installed ? `Auth: ${provider.authStatus}` : "Not installed"}
                      </span>
                    )}
                  </div>
                  {defaultProvider === provider.id && (
                    <CheckCircle2 className="h-3.5 w-3.5 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Model Selector - only show when provider has models */}
          {selectedProviderObj?.capabilities?.availableModels &&
            selectedProviderObj.capabilities.availableModels.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors cursor-pointer max-w-[140px]">
                  <span className="truncate">{modelLabel}</span>
                  <ChevronDown className="h-2.5 w-2.5 opacity-50 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[240px]">
                <DropdownMenuLabel>Model</DropdownMenuLabel>
                {selectedProviderObj.capabilities.availableModels.map((m) => (
                  <DropdownMenuItem
                    key={m}
                    onClick={() => setSelectedModel(m)}
                    className="gap-2"
                  >
                    <span className="text-xs truncate">{shortModelLabel(m)}</span>
                    {m === selectedProviderObj.capabilities?.defaultModel && (
                      <Badge variant="secondary" className="ml-auto text-[9px] px-1">default</Badge>
                    )}
                    {(selectedModel === m || (!selectedModel && m === effectiveModel)) && (
                      <CheckCircle2 className="h-3.5 w-3.5 ml-auto text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="flex-1 overflow-auto py-3 bg-muted/20 relative" ref={scrollRef} onScroll={handleScroll}>
        {displayBlocks.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full">
            {isRestoring ? (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <TypingIndicator className="text-muted-foreground" />
                Loading activity...
              </span>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">
                Ask questions or request changes to your plan.
                Use <span className="font-mono text-[10px] bg-muted px-1 rounded">/help</span> for commands,{" "}
                <span className="font-mono text-[10px] bg-muted px-1 rounded">@</span> to reference tasks.
              </p>
            )}
          </div>
        )}

        <ActivityBlockRenderer
          blocks={displayBlocks}
          isStreaming={isStreaming}
          isRunning={isStreaming}
          onSendPrompt={sendMessage}
          onLinkClick={(href) => {
            const match = href.match(/^astro:node:(.+)$/)
            if (match) {
              onNodeSelect?.(match[1])
              return true
            }
          }}
          onEditMessage={!isStreaming ? handleEditMessage : undefined}
          preprocessContent={preprocessTextContent}
          answeredApprovals={answeredApprovals.answeredApprovals}
          approvalResponses={answeredApprovals.approvalResponses}
          getNodeTitle={getNodeTitle}
          onNodeSelect={onNodeSelect}
        />

        {/* Typing indicator when streaming starts but no events yet */}
        {isStreaming && displayBlocks.length === 0 && (
          <div className="px-4 py-2">
            <TypingIndicator className="text-muted-foreground py-1" />
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
          <ChevronDown className="h-3.5 w-3.5" />
          Bottom
        </Button>
      )}

      {/* Input */}
      <div className="border-t border-border/60 p-3">
        <div className="flex items-end gap-2">
          <FileCompletionTextarea
            projectId={projectId}
            machineId={resolvedMachineId}
            workingDirectory={project?.workingDirectory}
            fileTree={project?.fileTree}
            slashCommands={slashCmds}
            mentionItems={mentionItems}
            value={input}
            onChange={setInput}
            placeholder={isBusy ? "Type a message — it will be sent when the current response finishes..." : "Ask about the project, modify tasks, or explore ideas..."}
            rows={2}
            onSubmit={handleSend}
            className="flex-1 rounded-lg border border-border/20 bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring/50 focus:bg-muted/40 transition-colors"
            images={chatImages}
            onImagesChange={setChatImages}
            filePickerRef={filePickerRef}
          />
          <div className="flex flex-row items-end gap-1 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => filePickerRef.current?.()}
              title="Attach image (or paste/drag-drop)"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            {isStreaming && (
              <Button
                size="icon"
                variant="destructive"
                className="h-9 w-9"
                onClick={() => currentSession && abortChatStream(currentSession.id)}
                title="Stop generation"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              className="h-9 w-9"
              onClick={handleSend}
              disabled={!input.trim() && chatImages.length === 0}
              title={isBusy ? "Queue message (⌘+Enter)" : "Send (⌘+Enter)"}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Session Edit/Delete Dialog */}
      {/* SessionDialog removed — inline rename replaces it */}
    </div>
  )
}
