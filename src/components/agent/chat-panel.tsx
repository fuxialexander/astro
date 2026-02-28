import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { stripHtml, escapeHtml } from "@/lib/html-utils"
import { Send, Loader2, ChevronDown, Bot, CheckCircle2, Pencil, GitBranch, PlusCircle, MessageSquare, Plus, History, Trash2, Activity } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FileCompletionTextarea, type MentionItem, type SlashCommand } from "@/components/ui/file-completion-textarea"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { planChatWithAgent, fetchSlashCommands, type ChatPlanNodeContext, type ChatPlanEdgeContext } from "@/lib/api-client"
import { useSettingsStore, resolveModel } from "@/stores/settings-store"
import { useExecutionStore } from "@/stores/execution-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useSessionStore, getSessionTitle } from "@/stores/session-store"
import { SessionDialog } from "@/components/session-dialog"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { StreamingMarkdown } from "@/components/ui/streaming-markdown"
import { useProjectMachineId } from "@/hooks/use-project-machine"
import { useRealtimeStore } from "@/stores/realtime-store"
import { ChatActivityView } from "@/components/agent/chat-activity-view"
import type { PlanNode, ProviderStatus, Session } from "@/types"

/** A node update: nodeId + any properties to patch */
interface ParsedNodeUpdate {
  nodeId: string
  [key: string]: unknown
}

/** An edge operation: add or remove */
interface ParsedEdgeOp {
  action: "add" | "remove"
  source: string
  target: string
  type?: string
}

/** A new node to create (from decomposition) */
interface ParsedNewNode {
  id?: string
  title: string
  description: string
  type?: string
  milestoneId?: string
  dependencies?: string[]
  priority?: string
  estimate?: string
  verification?: string
}

/** All mutations extracted from a single assistant message */
interface AppliedMutations {
  nodeUpdates: ParsedNodeUpdate[]
  edgeOps: ParsedEdgeOp[]
  newNodes: ParsedNewNode[]
}

interface Message {
  role: "user" | "assistant"
  content: string
  /** Mutations applied from this message */
  appliedMutations?: AppliedMutations
}

// ---- Fields that are internal and should not be written from chat ----
const INTERNAL_FIELDS = new Set(["id", "projectId", "createdAt", "updatedAt", "position", "boardOrder", "executionId", "executionOutput", "executionError", "executionStartedAt", "executionCompletedAt", "branchName", "prUrl", "prNumber"])

// ---- Update parsing utilities ----

const UPDATE_BLOCK_RE = /```astro-updates\s*\n([\s\S]*?)```/g
const EDGE_BLOCK_RE = /```astro-edges\s*\n([\s\S]*?)```/g
const ADD_NODES_BLOCK_RE = /```astro-add-nodes\s*\n([\s\S]*?)```/g

/** Extract astro-updates, astro-edges, and astro-add-nodes blocks from a message. */
function extractMutations(content: string): { cleanContent: string; mutations: AppliedMutations } {
  const nodeUpdates: ParsedNodeUpdate[] = []
  const edgeOps: ParsedEdgeOp[] = []
  const newNodes: ParsedNewNode[] = []

  let cleanContent = content.replace(UPDATE_BLOCK_RE, (match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim())
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object" && item.nodeId) {
            nodeUpdates.push(item as ParsedNodeUpdate)
          }
        }
      }
    } catch {
      return match // malformed — keep visible
    }
    return ""
  })

  cleanContent = cleanContent.replace(EDGE_BLOCK_RE, (match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim())
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object" && item.action && item.source && item.target) {
            edgeOps.push(item as ParsedEdgeOp)
          }
        }
      }
    } catch {
      return match
    }
    return ""
  })

  cleanContent = cleanContent.replace(ADD_NODES_BLOCK_RE, (match, json: string) => {
    try {
      const parsed = JSON.parse(json.trim())
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object" && item.title) {
            newNodes.push(item as ParsedNewNode)
          }
        }
      }
    } catch {
      return match
    }
    return ""
  }).trim()

  return { cleanContent, mutations: { nodeUpdates, edgeOps, newNodes } }
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
}

export function ChatPanel({ projectId, visionDoc, initialMessage, onNodeSelect }: ChatPanelProps) {
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [activeTab, setActiveTab] = useState<'chat' | 'activity'>('chat')
  const [toolCallCount, setToolCallCount] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const initialMessageSent = useRef(false)
  // Session store for persistent chat
  const createSession = useSessionStore((s) => s.createSession)
  const addMessage = useSessionStore((s) => s.addMessage)
  const appendToLastAssistantMessage = useSessionStore((s) => s.appendToLastAssistantMessage)
  const updateLastAssistantMessage = useSessionStore((s) => s.updateLastAssistantMessage)
  const setProviderSessionId = useSessionStore((s) => s.setProviderSessionId)
  const getSessionsForProject = useSessionStore((s) => s.getSessionsForProject)
  const getActiveSessionId = useSessionStore((s) => s.getActiveSessionId)
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId)
  const getSession = useSessionStore((s) => s.getSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const truncateAfterMessage = useSessionStore((s) => s.truncateAfterMessage)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const clearActiveSessionId = useSessionStore((s) => s.clearActiveSessionId)
  // Subscribe to sessions and activeSessionIds so memos recompute on changes
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionIds = useSessionStore((s) => s.activeSessionIds)

  // State for session dialog and dropdown
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false)

  // Slash command autocomplete state
  // Dropdown refs for provider/model menus (for /sessions and /model commands)
  const sessionDropdownRef = useRef<HTMLButtonElement>(null)
  const modelDropdownRef = useRef<HTMLButtonElement>(null)

  // Get all plan-chat sessions for this project (re-evaluates when sessions map changes)
  const planChatSessions = useMemo(
    () => getSessionsForProject(projectId, "plan-chat"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getSessionsForProject, projectId, sessions]
  )

  // Get the active session ID (re-evaluates when activeSessionIds changes)
  const activeSessionId = useMemo(
    () => getActiveSessionId(projectId, "plan-chat"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getActiveSessionId, projectId, activeSessionIds]
  )
  const currentSession: Session | undefined = useMemo(() => {
    // If we have an active session ID, try to get that session
    if (activeSessionId) {
      const session = getSession(activeSessionId)
      // Verify the session still exists and belongs to this project
      if (session && session.projectId === projectId && session.type === "plan-chat") {
        return session
      }
    }
    // Fall back to the most recent session
    return planChatSessions[planChatSessions.length - 1]
  }, [activeSessionId, getSession, planChatSessions, projectId])

  // Ensure session exists and track as active
  useEffect(() => {
    if (!currentSession) {
      const newSession = createSession({ type: "plan-chat", projectId })
      setActiveSessionId(projectId, "plan-chat", newSession.id)
    } else if (!activeSessionId || activeSessionId !== currentSession.id) {
      // If the current session exists but isn't marked as active, mark it
      setActiveSessionId(projectId, "plan-chat", currentSession.id)
    }
  }, [currentSession, createSession, projectId, activeSessionId, setActiveSessionId])

  // Handler to switch to a different session — abort any in-flight stream first
  const handleSessionSwitch = useCallback((sessionId: string) => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsStreaming(false)
    setActiveSessionId(projectId, "plan-chat", sessionId)
  }, [projectId, setActiveSessionId])

  // Handler to create a new session
  const handleNewSession = useCallback(() => {
    const newSession = createSession({ type: "plan-chat", projectId })
    setActiveSessionId(projectId, "plan-chat", newSession.id)
  }, [createSession, projectId, setActiveSessionId])

  // Handler to open session edit dialog
  const handleEditSession = useCallback((session: Session, e?: React.UIEvent) => {
    e?.stopPropagation() // Prevent dropdown item click
    setEditingSession(session)
    setSessionDialogOpen(true)
  }, [])

  // Handler for session rename
  const handleRenameSession = useCallback((sessionId: string, title: string) => {
    renameSession(sessionId, title)
  }, [renameSession])

  // Handler for session delete
  const handleDeleteSession = useCallback((sessionId: string) => {
    const isActiveSession = currentSession?.id === sessionId

    // Delete the session
    deleteSession(sessionId)

    // If we deleted the active session, switch to another or create new
    if (isActiveSession) {
      // Get remaining sessions (after deletion, so filter out the deleted one)
      const remainingSessions = planChatSessions.filter(s => s.id !== sessionId)

      if (remainingSessions.length > 0) {
        // Switch to the most recent remaining session
        const mostRecent = remainingSessions[remainingSessions.length - 1]
        setActiveSessionId(projectId, "plan-chat", mostRecent.id)
      } else {
        // No sessions left, clear active and let the effect create a new one
        clearActiveSessionId(projectId, "plan-chat")
      }
    }
  }, [currentSession?.id, deleteSession, planChatSessions, projectId, setActiveSessionId, clearActiveSessionId])

  // Handler to edit a user message: truncate history and populate input
  const handleEditMessage = useCallback((messageId: string) => {
    if (!currentSession || isStreaming) return
    const content = truncateAfterMessage(currentSession.id, messageId)
    if (content !== undefined) {
      setInput(content)
    }
  }, [currentSession, isStreaming, truncateAfterMessage])

  // Handler to clear all sessions
  const handleClearAllSessions = useCallback(() => {
    for (const session of planChatSessions) {
      deleteSession(session.id)
    }
    clearActiveSessionId(projectId, "plan-chat")
  }, [planChatSessions, deleteSession, projectId, clearActiveSessionId])

  const messages: (Message & { id: string })[] = (currentSession?.messages || []).map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    appliedMutations: m.appliedMutations as AppliedMutations | undefined,
  }))

  // Plan store — read nodes/edges for context, write updates
  const rawPlanNodes = usePlanStore((s) => s.nodes)
  const planNodes = useMemo(() => rawPlanNodes.filter(isLive), [rawPlanNodes])
  const rawPlanEdges = usePlanStore((s) => s.edges)
  const planEdges = useMemo(() => rawPlanEdges.filter(isLive), [rawPlanEdges])
  const updateNode = usePlanStore((s) => s.updateNode)
  const addNode = usePlanStore((s) => s.addNode)
  const addEdge = usePlanStore((s) => s.addEdge)
  const removeEdge = usePlanStore((s) => s.removeEdge)
  const reorganizeProject = usePlanStore((s) => s.reorganizeProject)
  const markNodesAsUpdating = usePlanStore((s) => s.markNodesAsUpdating)

  // Project store — for file tree and working directory
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))
  const resolvedMachineId = useProjectMachineId(project)

  // Build lean plan context for the API (only nodes in this project)
  const planNodeContext: ChatPlanNodeContext[] = useMemo(() => {
    return planNodes
      .filter((n) => n.projectId === projectId)
      .map((n) => ({
        id: n.id,
        title: n.title,
        description: n.content ? stripHtml(n.content) : (n.description ?? ''),
        status: n.status,
        type: n.type,
        priority: n.priority,
        estimate: n.estimate,
        verification: n.verification,
        milestoneId: n.milestoneId,
        dependencies: n.dependencies,
        dueDate: n.dueDate,
        startDate: n.startDate,
        endDate: n.endDate,
      }))
  }, [planNodes, projectId])

  // Build edge context for the API
  const planEdgeContext: ChatPlanEdgeContext[] = useMemo(() => {
    const projectNodeIds = new Set(planNodes.filter((n) => n.projectId === projectId).map((n) => n.id))
    return planEdges
      .filter((e) => projectNodeIds.has(e.source) || projectNodeIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, type: e.type }))
  }, [planNodes, planEdges, projectId])

  // Build @mention items for the chat input (task/milestone references)
  const mentionItems: MentionItem[] = useMemo(() => {
    const projectNodes = planNodes.filter((n) => n.projectId === projectId)
    return projectNodes.map((n) => ({
      id: n.id,
      label: n.title,
      detail: n.type,
      kind: n.type === "milestone" ? "milestone" as const : "task" as const,
    }))
  }, [planNodes, projectId])

  // Slash commands from connected machine
  const [slashCmds, setSlashCmds] = useState<SlashCommand[]>([])
  useEffect(() => {
    if (!resolvedMachineId) return
    fetchSlashCommands(resolvedMachineId, project?.workingDirectory).then(setSlashCmds).catch(() => {})
  }, [resolvedMachineId, project?.workingDirectory])

  // Settings defaults
  const defaultProvider = useSettingsStore((s) => s.defaultProvider)

  // Provider list from execution store
  const providers = useExecutionStore((s) => s.providers)
  const providersLoaded = useExecutionStore((s) => s.providersLoaded)
  const loadProviders = useExecutionStore((s) => s.loadProviders)

  // Local overrides (empty string = use default)
  const [selectedProvider, setSelectedProvider] = useState("")
  const [selectedModel, setSelectedModel] = useState("")

  // Load providers on mount if not already loaded
  useEffect(() => {
    if (!providersLoaded) loadProviders()
  }, [providersLoaded, loadProviders])

  // Sync defaults from settings on first load
  useEffect(() => {
    if (providersLoaded && !selectedProvider && defaultProvider) {
      setSelectedProvider(defaultProvider)
    }
  }, [providersLoaded, defaultProvider, selectedProvider])

  // Resolve the effective provider object, model, and providerId for the API call
  const selectedProviderObj: ProviderStatus | undefined =
    selectedProvider ? providers.find((p) => p.id === selectedProvider) : undefined

  const effectiveProviderId = selectedProvider || defaultProvider || undefined

  const customModelMap = useSettingsStore((s) => s.customModelMap)
  // Plan chat defaults to small tier (haiku); large is reserved for plan generation
  const effectiveModel = (() => {
    if (selectedModel) return selectedModel
    return resolveModel("small", effectiveProviderId, customModelMap)
  })()

  // Abort any in-flight SSE stream on unmount (e.g. page navigation)
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  /** Apply all mutations (node updates + edge operations + new nodes) to the plan store.
   *  Returns the real (prefixed) node IDs that were affected. */
  const applyMutations = useCallback((mutations: AppliedMutations): string[] => {
    const { nodeUpdates, edgeOps, newNodes } = mutations
    const affectedNodeIds: string[] = []

    // Create new nodes (from decomposition)
    const prefix = projectId.slice(0, 8)
    const safePrefixId = (id: string) => id.startsWith(prefix) ? id : `${prefix}-${id}`
    const idMap = new Map<string, string>() // map AI-generated IDs to real IDs
    for (const n of newNodes) {
      const realId = n.id ? safePrefixId(n.id) : `${prefix}-${crypto.randomUUID().slice(0, 8)}`
      affectedNodeIds.push(realId)
      if (n.id) idMap.set(n.id, realId)

      const now = new Date()
      const node: PlanNode = {
        id: realId,
        projectId,
        type: (n.type as PlanNode["type"]) ?? "task",
        title: n.title,
        description: n.description,
        content: n.description ? `<p>${escapeHtml(n.description)}</p>` : '',
        status: "planned",
        parentId: null,
        dependencies: (n.dependencies ?? []).map((d) => idMap.get(d) ?? safePrefixId(d)),
        verification: (n.verification as PlanNode["verification"]) ?? "auto",
        position: { x: 40, y: 40 },
        priority: (n.priority as PlanNode["priority"]) ?? "medium",
        estimate: (n.estimate as PlanNode["estimate"]) ?? undefined,
        milestoneId: n.milestoneId ? safePrefixId(n.milestoneId) : undefined,
        createdAt: now,
        updatedAt: now,
      }
      addNode(node)

      // Add edges for dependencies
      for (const dep of node.dependencies) {
        addEdge({ id: `e-${dep}-${realId}`, source: dep, target: realId, type: "dependency" })
      }
    }

    if (newNodes.length > 0) {
      // Auto-layout after adding new nodes
      reorganizeProject(projectId)
    }

    // Apply node property updates
    for (const u of nodeUpdates) {
      affectedNodeIds.push(u.nodeId)
      const patch: Partial<PlanNode> = {}
      for (const [key, value] of Object.entries(u)) {
        if (key === "nodeId") continue // not a property
        if (INTERNAL_FIELDS.has(key)) continue // skip internal fields
        ;(patch as Record<string, unknown>)[key] = value
      }

      // If dependencies were updated, reconcile edges automatically
      if (Array.isArray(u.dependencies)) {
        const currentNode = planNodes.find((n) => n.id === u.nodeId)
        if (currentNode) {
          const newDeps = new Set(u.dependencies as string[])
          const oldDeps = new Set(currentNode.dependencies)
          // Remove edges for removed dependencies
          for (const dep of oldDeps) {
            if (!newDeps.has(dep)) removeEdge(dep, u.nodeId)
          }
          // Add edges for new dependencies
          for (const dep of newDeps) {
            if (!oldDeps.has(dep)) {
              addEdge({ id: `e-${dep}-${u.nodeId}`, source: dep, target: u.nodeId, type: "dependency" })
            }
          }
        }
      }

      if (Object.keys(patch).length > 0) {
        updateNode(u.nodeId, patch)
      }
    }

    // Apply edge operations
    for (const op of edgeOps) {
      if (op.action === "add") {
        addEdge({
          id: `e-${op.source}-${op.target}`,
          source: op.source,
          target: op.target,
          type: (op.type as "dependency" | "branch") ?? "dependency",
        })
        // Also update the target node's dependencies array
        const targetNode = planNodes.find((n) => n.id === op.target)
        if (targetNode && !targetNode.dependencies.includes(op.source)) {
          updateNode(op.target, { dependencies: [...targetNode.dependencies, op.source] })
        }
      } else if (op.action === "remove") {
        removeEdge(op.source, op.target)
        // Also update the target node's dependencies array
        const targetNode = planNodes.find((n) => n.id === op.target)
        if (targetNode) {
          updateNode(op.target, { dependencies: targetNode.dependencies.filter((d) => d !== op.source) })
        }
      }
    }

    return affectedNodeIds
  }, [planNodes, projectId, updateNode, addNode, addEdge, removeEdge, reorganizeProject])

  const sendMessage = useCallback(async (text: string) => {
    // Read session fresh from store — never use stale ref
    const store = useSessionStore.getState()
    const activeId = store.activeSessionIds.get(`${projectId}:plan-chat`)
    const session = activeId ? store.sessions.get(activeId) : undefined
    if (!text || isStreaming || !session) return

    setInput("")
    const sid = session.id
    addMessage(sid, { role: "user", content: text })
    setIsStreaming(true)
    addMessage(sid, { role: "assistant", content: "" })

    // Abort any in-flight request before starting a new one
    if (abortRef.current) {
      abortRef.current.abort()
    }
    abortRef.current = new AbortController()

    // Re-read messages from store after adding user msg + placeholder to get fresh state
    const freshSession = useSessionStore.getState().sessions.get(sid)
    const freshMessages = freshSession?.messages || []
    // Exclude the just-added user message and empty assistant placeholder
    const historyMessages = freshMessages
      .slice(0, -2)
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    // Only send providerSessionId if the session has completed at least one exchange
    const hasCompletedExchange = (freshSession?.messages || []).some(
      (m) => m.role === "assistant" && m.content.length > 0
    )

    // Track raw assistant text outside React state so it's available
    // synchronously in onDone (React 18 batches setState updaters).
    let rawAssistantText = ""

    // Plan-mutating MCP tools that should trigger a plan refresh
    const PLAN_MUTATING_TOOLS = new Set(["create_task", "update_task", "delete_task", "create_dependency"])
    let needsPlanRefresh = false

    // Use the existing providerSessionId as the relay task ID for pushing activity events.
    // On first message it's not set yet — we'll get it from onDone.
    const sessionTaskId = hasCompletedExchange ? session.providerSessionId : undefined
    let resolvedTaskId = sessionTaskId || ''
    let localToolCount = 0

    try {
      await planChatWithAgent(
        {
          message: text,
          sessionId: hasCompletedExchange ? session.providerSessionId : undefined,
          projectId,
          visionDoc,
          model: effectiveModel,
          providerId: effectiveProviderId,
          planNodes: planNodeContext,
          planEdges: planEdgeContext,
          messages: historyMessages,
        },
        {
          onText: (chunk) => {
            rawAssistantText += chunk
            appendToLastAssistantMessage(sid, chunk)
          },
          onToolUse: (data) => {
            if (PLAN_MUTATING_TOOLS.has(data.toolName)) {
              needsPlanRefresh = true
            }
            localToolCount++
            setToolCallCount(localToolCount)
            if (resolvedTaskId) {
              useRealtimeStore.getState().pushActivityEvent(resolvedTaskId, {
                type: 'tool_use',
                id: `tool-${localToolCount}`,
                toolName: data.toolName,
                toolInput: data.toolInput,
                timestamp: new Date(),
              })
            }
          },
          onToolResult: (data) => {
            if (PLAN_MUTATING_TOOLS.has(data.toolName)) {
              needsPlanRefresh = true
            }
            if (resolvedTaskId) {
              useRealtimeStore.getState().pushActivityEvent(resolvedTaskId, {
                type: 'tool_result',
                id: `tool-${localToolCount}`,
                toolName: data.toolName,
                toolResult: data.result,
                success: data.success,
                timestamp: new Date(),
              })
            }
          },
          onDone: (newProviderSessionId) => {
            if (newProviderSessionId) {
              setProviderSessionId(sid, newProviderSessionId)
              resolvedTaskId = newProviderSessionId
            }

            // Refresh plan from server if MCP tools modified the plan
            if (needsPlanRefresh) {
              usePlanStore.getState().load()
            }

            // Extract mutations from the raw text (available synchronously,
            // unlike React state which may be batched).
            // This is a fallback for text-block mutations; MCP tool calls
            // are handled above via plan refresh.
            const { cleanContent, mutations } = extractMutations(rawAssistantText)
            const hasMutations = mutations.nodeUpdates.length > 0 || mutations.edgeOps.length > 0 || mutations.newNodes.length > 0

            if (hasMutations) {
              // Apply side-effects outside setState to avoid React StrictMode
              // double-invocation duplicating nodes/edges.
              const affectedNodeIds = applyMutations(mutations)
              if (affectedNodeIds.length > 0) {
                markNodesAsUpdating(affectedNodeIds)
              }

              // Update message display with clean content and mutation record
              updateLastAssistantMessage(sid, cleanContent, mutations)
            } else {
              // Force an immediate save — appendToLastAssistantMessage only
              // debounce-saves to the database and never calls the API, so without
              // this the final content can be lost on reload.
              updateLastAssistantMessage(sid, rawAssistantText)
            }
            setIsStreaming(false)
          },
          onError: (error) => {
            appendToLastAssistantMessage(sid, `\nError: ${error}`)
            setIsStreaming(false)
          },
        },
        abortRef.current.signal,
      )
    } catch {
      setIsStreaming(false)
    }
  }, [isStreaming, projectId, visionDoc, effectiveModel, effectiveProviderId, planNodeContext, planEdgeContext, applyMutations, markNodesAsUpdating, addMessage, appendToLastAssistantMessage, updateLastAssistantMessage, setProviderSessionId])

  function handleSend() {
    const text = input.trim()
    if (!text) return
    sendMessage(text)
  }

  // Handle initialMessage (from decompose button)
  useEffect(() => {
    if (initialMessage && !initialMessageSent.current && !isStreaming) {
      initialMessageSent.current = true
      // Auto-send after a brief delay so the session is ready
      const timer = setTimeout(() => sendMessage(initialMessage), 100)
      return () => clearTimeout(timer)
    }
  }, [initialMessage, isStreaming, sendMessage])

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

  return (
    <div className="flex h-full flex-col border-l border-border bg-card">
      {/* Header with session switcher and model/provider picker */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-4 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Plan Chat</span>
          {/* Session metadata */}
          {messages.length > 0 && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {messages.length} msgs
            </span>
          )}
          {/* Session Switcher */}
          {planChatSessions.length > 0 && (
            <DropdownMenu open={sessionDropdownOpen} onOpenChange={setSessionDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <button ref={sessionDropdownRef} className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors cursor-pointer">
                  <History className="h-3 w-3" />
                  <span>{planChatSessions.length}</span>
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
                {[...planChatSessions].reverse().map((session) => {
                  const messageCount = session.messages.length
                  const sessionTitle = getSessionTitle(session)
                  const isActive = currentSession?.id === session.id
                  return (
                    <div
                      key={session.id}
                      onClick={() => { handleSessionSwitch(session.id); setSessionDropdownOpen(false) }}
                      className="flex flex-col items-start gap-0.5 py-2 px-2 rounded-sm cursor-pointer hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center gap-2 w-full">
                        <MessageSquare className="h-3 w-3 shrink-0" />
                        <span className="text-xs truncate flex-1" title={sessionTitle}>
                          {sessionTitle}
                        </span>
                        {isActive && (
                          <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEditSession(session); setSessionDropdownOpen(false) }}
                          className="p-0.5 hover:bg-accent rounded opacity-60 hover:opacity-100 transition-opacity"
                          title="Rename session"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id) }}
                          className="p-0.5 hover:bg-destructive/10 rounded opacity-60 hover:opacity-100 transition-opacity text-destructive"
                          title="Delete session"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <span className="text-[10px] text-muted-foreground truncate w-full pl-5">
                        {messageCount} messages
                      </span>
                    </div>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center gap-2">
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
                onClick={() => { setSelectedProvider(""); setSelectedModel("") }}
                className="gap-2"
              >
                <Bot className="h-3.5 w-3.5" />
                <span>Auto</span>
                {!selectedProvider && (
                  <CheckCircle2 className="h-3.5 w-3.5 ml-auto text-primary" />
                )}
              </DropdownMenuItem>
              {providers.map((provider) => (
                <DropdownMenuItem
                  key={provider.id}
                  onClick={() => { setSelectedProvider(provider.id); setSelectedModel("") }}
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
                  {selectedProvider === provider.id && (
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

      {/* Chat / Activity tab bar */}
      <div className="flex shrink-0 border-b border-border">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'chat'
              ? 'text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === 'activity'
              ? 'text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Activity className="h-3 w-3" />
          Activity
          {toolCallCount > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 min-w-[16px]">
              {toolCallCount}
            </Badge>
          )}
        </button>
      </div>

      {/* Activity tab */}
      {activeTab === 'activity' && (
        <ChatActivityView
          sessionId={currentSession?.providerSessionId || ''}
          isStreaming={isStreaming}
        />
      )}

      {/* Messages (Chat tab) */}
      {activeTab === 'chat' && <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="flex flex-col gap-4">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              Ask questions or request changes to your plan.
              Use <span className="font-mono text-[10px] bg-muted px-1 rounded">/help</span> for commands,{" "}
              <span className="font-mono text-[10px] bg-muted px-1 rounded">@</span> to reference tasks.
            </p>
          )}
          {messages.map((msg, i) => (
            <div
              key={msg.id}
              className={`group/msg flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <div className="flex items-center gap-1.5">
                {msg.role === "user" && !isStreaming && (
                  <button
                    onClick={() => handleEditMessage(msg.id)}
                    className="opacity-0 group-hover/msg:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                    title="Edit & resend"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                )}
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {msg.role === "user" ? "You" : providerLabel}
                </span>
              </div>
              <div
                className={`rounded-lg px-3 py-2 text-sm leading-relaxed max-w-[320px] ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {msg.content ? (
                  msg.role === "assistant" ? (
                    isStreaming && i === messages.length - 1 ? (
                      <StreamingMarkdown
                        content={preprocessNodeRefs(msg.content)}
                        isStreaming
                        className="text-sm"
                        onLinkClick={(href) => {
                          const match = href.match(/^astro:node:(.+)$/)
                          if (match) {
                            onNodeSelect?.(match[1])
                            return true
                          }
                        }}
                      />
                    ) : (
                      <MarkdownRenderer
                        content={preprocessNodeRefs(msg.content)}
                        className="text-sm"
                        onLinkClick={(href) => {
                          const match = href.match(/^astro:node:(.+)$/)
                          if (match) {
                            onNodeSelect?.(match[1])
                            return true
                          }
                        }}
                      />
                    )
                  ) : (
                    <pre className="whitespace-pre-wrap font-primary text-sm">
                      {msg.content}
                    </pre>
                  )
                ) : isStreaming && i === messages.length - 1 ? (
                  <TypingIndicator className="text-muted-foreground py-1" />
                ) : null}
              </div>
              {/* Show applied mutation banners */}
              {msg.appliedMutations && (msg.appliedMutations.nodeUpdates.length > 0 || msg.appliedMutations.edgeOps.length > 0 || msg.appliedMutations.newNodes.length > 0) && (
                <div className="flex flex-col gap-1 mt-1 max-w-[320px]">
                  {msg.appliedMutations.nodeUpdates.map((u, j) => {
                    const changedFields = Object.keys(u).filter((k) => k !== "nodeId" && !INTERNAL_FIELDS.has(k))
                    const summary = changedFields.map((k) => {
                      const val = u[k]
                      // Resolve milestoneId and dependencies to human-readable names
                      if (k === "milestoneId" && typeof val === "string") return `milestone\u2192${getNodeTitle(val)}`
                      if (k === "dependencies" && Array.isArray(val)) return `deps\u2192[${val.map(getNodeTitle).join(", ")}]`
                      if (typeof val === "string" && val.length > 30) return k
                      return `${k}\u2192${val}`
                    }).join(", ")
                    return (
                      <div
                        key={`u-${j}`}
                        className="flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 px-2.5 py-1.5 text-[11px] text-primary"
                      >
                        <Pencil className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          <strong>{getNodeTitle(u.nodeId)}</strong> {summary}
                        </span>
                        <CheckCircle2 className="h-3 w-3 shrink-0 ml-auto" />
                      </div>
                    )
                  })}
                  {msg.appliedMutations.edgeOps.map((op, j) => (
                    <div
                      key={`e-${j}`}
                      className="flex items-center gap-1.5 rounded-md bg-info/10 border border-info/20 px-2.5 py-1.5 text-[11px] text-info"
                    >
                      <GitBranch className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {op.action === "add" ? "Added" : "Removed"} edge: {getNodeTitle(op.source)} → {getNodeTitle(op.target)}
                      </span>
                      <CheckCircle2 className="h-3 w-3 shrink-0 ml-auto" />
                    </div>
                  ))}
                  {msg.appliedMutations.newNodes.map((n, j) => (
                    <div
                      key={`n-${j}`}
                      className="flex items-center gap-1.5 rounded-md bg-success/10 border border-success/20 px-2.5 py-1.5 text-[11px] text-success"
                    >
                      <PlusCircle className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        Created <strong>{n.title}</strong>{n.type && n.type !== "task" ? ` (${n.type})` : ""}
                      </span>
                      <CheckCircle2 className="h-3 w-3 shrink-0 ml-auto" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>}

      {/* Input */}
      <div className="flex items-end gap-2 border-t border-border p-3">
        <FileCompletionTextarea
          projectId={projectId}
          machineId={resolvedMachineId}
          workingDirectory={project?.workingDirectory}
          fileTree={project?.fileTree}
          slashCommands={slashCmds}
          mentionItems={mentionItems}
          value={input}
          onChange={setInput}
          placeholder="Type a message, @ for files or tasks..."
          rows={1}
          disabled={isStreaming}
          onSubmit={handleSend}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
        >
          {isStreaming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Session Edit/Delete Dialog */}
      <SessionDialog
        open={sessionDialogOpen}
        onOpenChange={setSessionDialogOpen}
        session={editingSession}
        onRename={handleRenameSession}
        onDelete={handleDeleteSession}
      />
    </div>
  )
}
