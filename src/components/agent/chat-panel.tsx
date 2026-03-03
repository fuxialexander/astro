import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { stripHtml, escapeHtml } from "@/lib/html-utils"
import { Send, Loader2, ChevronDown, Bot, CheckCircle2, Pencil, MessageSquare, Plus, History, Trash2 } from "lucide-react"
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
import { FileCompletionTextarea, type MentionItem, type SlashCommand } from "@/components/ui/file-completion-textarea"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { planChatWithAgent, fetchSlashCommands, type ChatPlanNodeContext, type ChatPlanEdgeContext } from "@/lib/api-client"
import { useSettingsStore, resolveModel } from "@/stores/settings-store"
import { useExecutionStore } from "@/stores/execution-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useSessionStore, getSessionTitle } from "@/stores/session-store"
import { SessionDialog } from "@/components/session-dialog"
import { useProjectMachineId } from "@/hooks/use-project-machine"
import { useRealtimeStore } from "@/stores/realtime-store"
import { useChatActivityEvents } from "@/hooks/use-chat-activity-events"
import {
  TextBlock,
  ToolBlock,
  ToolGroupBlock,
  SteerBlock,
  FileChangeBlock,
  ErrorBlock,
  ChatUserBlock,
  ChatAssistantBlock,
  MutationBlock,
} from "@/components/activity-blocks"
import type { PlanNode, ProviderStatus, Session, TaskActivityEvent } from "@/types"

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
  /** Extra elements rendered in the header bar (right side, before provider selector) */
  headerActions?: React.ReactNode
}

export function ChatPanel({ projectId, visionDoc, initialMessage, onNodeSelect, headerActions }: ChatPanelProps) {
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
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

  // Activity view: hydrate events from streaming_events or session messages
  const sessionMessages = useMemo(() => currentSession?.messages || [], [currentSession?.messages])
  const { displayBlocks, isRestoring } = useChatActivityEvents(
    currentSession?.id,
    sessionMessages,
    isStreaming,
  )

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
  }, [displayBlocks.length, isStreaming])

  /** Apply all mutations (node updates + edge operations + new nodes) to the plan store.
   *  Returns the real (prefixed) node IDs that were affected. */
  const applyMutations = useCallback((mutations: AppliedMutations): string[] => {
    const { nodeUpdates, edgeOps, newNodes } = mutations
    const affectedNodeIds: string[] = []

    // Create new nodes (from decomposition)
    // Map AI-generated IDs to proper UUIDs for consistency with manually created tasks.
    // Deduplicate by title + type: if a node with the same title and type already exists,
    // update it instead of creating a duplicate. This allows multiple tasks with the same
    // title but different types (e.g., "Review PR" as both task and milestone).
    const idMap = new Map<string, string>() // map AI-generated IDs to real UUIDs
    const projectNodes = planNodes.filter((n) => n.projectId === projectId)

    for (const n of newNodes) {
      const normalizedTitle = n.title.trim().toLowerCase()
      const nodeType = (n.type as PlanNode["type"]) ?? "task"

      // Find existing node with same title and type (compound key for more precise matching)
      let existing = projectNodes.find(
        (node) => node.title.trim().toLowerCase() === normalizedTitle && node.type === nodeType
      )

      // Fallback: if no type match, check for same title with description similarity
      // (AI might reference existing task without specifying type)
      if (!existing && n.description) {
        const matches = projectNodes.filter((node) => node.title.trim().toLowerCase() === normalizedTitle)
        if (matches.length === 1) {
          // Only one match by title — assume it's the same task
          existing = matches[0]
        } else if (matches.length > 1) {
          // Multiple matches — prefer one with similar description or same status
          existing = matches.find((m) => m.description === n.description || m.status === "planned")
        }
      }

      if (existing) {
        // Node already exists — map the AI ID to the existing UUID and update instead
        const realId = existing.id
        affectedNodeIds.push(realId)
        if (n.id) idMap.set(n.id, realId)
        const patch: Partial<PlanNode> = {}
        // Use != null instead of truthy check to allow clearing fields with empty strings
        if (n.description != null && n.description !== existing.description) {
          patch.description = n.description
          patch.content = n.description ? `<p>${escapeHtml(n.description)}</p>` : ''
        }
        if (n.priority != null && n.priority !== existing.priority) patch.priority = n.priority as PlanNode["priority"]
        if (n.estimate != null && n.estimate !== existing.estimate) patch.estimate = n.estimate as PlanNode["estimate"]
        if (n.verification != null && n.verification !== existing.verification) patch.verification = n.verification as PlanNode["verification"]
        if (Object.keys(patch).length > 0) {
          updateNode(realId, patch)
        }
        continue
      }

      const realId = crypto.randomUUID()
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
        dependencies: (n.dependencies ?? []).map((d) => idMap.get(d) ?? d),
        verification: (n.verification as PlanNode["verification"]) ?? "auto",
        position: { x: 40, y: 40 },
        priority: (n.priority as PlanNode["priority"]) ?? "medium",
        estimate: (n.estimate as PlanNode["estimate"]) ?? undefined,
        milestoneId: n.milestoneId ?? undefined,
        createdAt: now,
        updatedAt: now,
      }
      addNode(node)

      // Add edges for dependencies
      for (const dep of node.dependencies) {
        addEdge({ id: crypto.randomUUID(), source: dep, target: realId, type: "dependency" })
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

      // When description is updated, also generate the HTML content field
      // (UI renders content, not description)
      if (typeof patch.description === 'string' && !patch.content) {
        patch.content = `<p>${escapeHtml(patch.description)}</p>`
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

    // Push user message to realtime store for activity timeline
    // session.id is always available and stable across all turns
    useRealtimeStore.getState().pushActivityEvent(session.id, {
      type: 'chat_user',
      message: text,
      timestamp: new Date(),
    })

    // Track raw assistant text outside React state so it's available
    // synchronously in onDone (React 18 batches setState updaters).
    let rawAssistantText = ""

    // Plan-mutating MCP tools that should trigger a plan refresh
    const PLAN_MUTATING_TOOLS = new Set(["create_task", "update_task", "delete_task", "create_dependency"])
    let needsPlanRefresh = false

    // Use session.id as the stable key for pushing activity events.
    // It's always available (unlike providerSessionId which comes back from onDone).
    const resolvedTaskId = session.id
    let localToolCount = 0

    try {
      await planChatWithAgent(
        {
          message: text,
          sessionId: hasCompletedExchange ? session.providerSessionId : undefined,
          streamId: session.id,
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
            useRealtimeStore.getState().pushActivityEvent(resolvedTaskId, {
              type: 'text',
              content: chunk,
              timestamp: new Date(),
            })
          },
          onToolUse: (data) => {
            if (PLAN_MUTATING_TOOLS.has(data.toolName)) {
              needsPlanRefresh = true
            }
            localToolCount++
            useRealtimeStore.getState().pushActivityEvent(resolvedTaskId, {
              type: 'tool_use',
              id: `tool-${localToolCount}`,
              toolName: data.toolName,
              toolInput: data.toolInput,
              timestamp: new Date(),
            })
          },
          onToolResult: (data) => {
            if (PLAN_MUTATING_TOOLS.has(data.toolName)) {
              needsPlanRefresh = true
            }
            useRealtimeStore.getState().pushActivityEvent(resolvedTaskId, {
              type: 'tool_result',
              id: `tool-${localToolCount}`,
              toolName: data.toolName,
              toolResult: data.result,
              success: data.success,
              timestamp: new Date(),
            })
          },
          onDone: (newProviderSessionId) => {
            if (newProviderSessionId) {
              setProviderSessionId(sid, newProviderSessionId)
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

              // Push mutation event to realtime store for activity timeline
              useRealtimeStore.getState().pushActivityEvent(resolvedTaskId, {
                type: 'mutation',
                nodeUpdates: mutations.nodeUpdates,
                edgeOps: mutations.edgeOps,
                newNodes: mutations.newNodes,
                timestamp: new Date(),
              })

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

      {/* Activity Timeline */}
      <div className="flex-1 overflow-auto py-3 bg-muted/20" ref={scrollRef}>
        {displayBlocks.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full">
            {isRestoring ? (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
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

        {displayBlocks.map((block, i) => {
          const isLastBlock = i === displayBlocks.length - 1
          switch (block.type) {
            case 'text':
              return (
                <TextBlock
                  key={i}
                  events={block.events}
                  isStreaming={isStreaming && isLastBlock}
                  preprocessContent={preprocessTextContent}
                  onLinkClick={(href) => {
                    const match = href.match(/^astro:node:(.+)$/)
                    if (match) {
                      onNodeSelect?.(match[1])
                      return true
                    }
                  }}
                />
              )
            case 'tool':
              return <ToolBlock key={i} events={block.events} isRunning={isStreaming} />
            case 'tool_group':
              return <ToolGroupBlock key={i} events={block.events} isRunning={isStreaming} />
            case 'steer':
              return <SteerBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'steer' }>} />
            case 'file_change':
              return <FileChangeBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'file_change' }>} />
            case 'error':
              return <ErrorBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'error' }>} />
            case 'chat_user':
              return <ChatUserBlock key={i} event={block.events[0] as Extract<TaskActivityEvent, { type: 'chat_user' }>} />
            case 'chat_assistant':
              return (
                <ChatAssistantBlock
                  key={i}
                  event={block.events[0] as Extract<TaskActivityEvent, { type: 'chat_assistant' }>}
                  isStreaming={isStreaming && isLastBlock}
                  onLinkClick={(href) => {
                    const match = href.match(/^astro:node:(.+)$/)
                    if (match) {
                      onNodeSelect?.(match[1])
                      return true
                    }
                  }}
                />
              )
            case 'mutation':
              return (
                <MutationBlock
                  key={i}
                  event={block.events[0] as Extract<TaskActivityEvent, { type: 'mutation' }>}
                  getNodeTitle={getNodeTitle}
                  onNodeSelect={onNodeSelect}
                />
              )
            default:
              return null
          }
        })}

        {/* Typing indicator when streaming starts but no events yet */}
        {isStreaming && displayBlocks.length === 0 && (
          <div className="px-4 py-2">
            <TypingIndicator className="text-muted-foreground py-1" />
          </div>
        )}
      </div>

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
