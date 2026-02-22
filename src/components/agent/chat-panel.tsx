import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { Send, Loader2, ChevronDown, Bot, CheckCircle2, Pencil, GitBranch, PlusCircle, MessageSquare, Plus, History, Trash2 } from "lucide-react"
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
import { VoiceInputButton } from "@/components/ui/voice-input-button"
import { MentionTextarea, type MentionItem } from "@/components/ui/mention-textarea"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { chatWithAgent, compactConversation, type ChatPlanNodeContext, type ChatPlanEdgeContext } from "@/lib/api-client"
import { useSettingsStore } from "@/stores/settings-store"
import { useExecutionStore } from "@/stores/execution-store"
import { usePlanStore, isLive } from "@/stores/plan-store"
import { useProjectStore } from "@/stores/project-store"
import { useSessionStore, getSessionTitle } from "@/stores/session-store"
import { SessionDialog } from "@/components/session-dialog"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { useVoiceTranscription } from "@/hooks/use-voice-transcription"
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
  environment?: string
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

// ---- Slash commands ----
interface SlashCommand {
  name: string
  description: string
  usage?: string
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/clear", description: "Clear session and start fresh" },
  { name: "/new", description: "Create a new session" },
  { name: "/rename", description: "Rename current session", usage: "/rename <name>" },
  { name: "/sessions", description: "Show session list" },
  { name: "/model", description: "Show model picker" },
  { name: "/compact", description: "Compress conversation to reduce context" },
  { name: "/context", description: "Show context usage info" },
  { name: "/help", description: "Show available commands" },
]

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
  // Subscribe to sessions and activeSessionIds so we re-render on changes
  useSessionStore((s) => s.sessions)
  useSessionStore((s) => s.activeSessionIds)

  // State for session dialog and dropdown
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false)

  // Slash command autocomplete state
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashFilter, setSlashFilter] = useState("")
  // Dropdown refs for provider/model menus (for /sessions and /model commands)
  const sessionDropdownRef = useRef<HTMLButtonElement>(null)
  const modelDropdownRef = useRef<HTMLButtonElement>(null)

  // Get all plan-chat sessions for this project (re-evaluates when sessions map changes)
  const planChatSessions = useMemo(
    () => getSessionsForProject(projectId, "plan-chat"),
    [getSessionsForProject, projectId]
  )

  // Get the active session ID (re-evaluates when activeSessionIds changes)
  const activeSessionId = useMemo(
    () => getActiveSessionId(projectId, "plan-chat"),
    [getActiveSessionId, projectId]
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

  // Filtered slash commands for autocomplete
  const filteredSlashCommands = useMemo(() => {
    if (!slashFilter) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(slashFilter.toLowerCase()))
  }, [slashFilter])

  // Handle input changes to detect slash commands
  const handleInputChange = useCallback((value: string) => {
    setInput(value)
    if (value.startsWith("/")) {
      setShowSlashMenu(true)
      setSlashFilter(value.split(" ")[0])
    } else {
      setShowSlashMenu(false)
      setSlashFilter("")
    }
  }, [])

  const messages: Message[] = (currentSession?.messages || []).map((m) => ({
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

  // Project store — for @codebase context
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId))

  // Build lean plan context for the API (only nodes in this project)
  const planNodeContext: ChatPlanNodeContext[] = useMemo(() => {
    return planNodes
      .filter((n) => n.projectId === projectId)
      .map((n) => ({
        id: n.id,
        title: n.title,
        description: n.description,
        status: n.status,
        type: n.type,
        priority: n.priority,
        estimate: n.estimate,
        environment: n.environment,
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

  // Build @mention items for the chat input
  const mentionItems: MentionItem[] = useMemo(() => {
    const projectNodes = planNodes.filter((n) => n.projectId === projectId)
    const items: MentionItem[] = [
      { id: "codebase", label: "codebase", detail: "Include repo context", kind: "special" },
    ]
    for (const n of projectNodes) {
      items.push({
        id: n.id,
        label: n.title,
        detail: n.type,
        kind: n.type === "milestone" ? "milestone" : "task",
      })
    }
    return items
  }, [planNodes, projectId])

  // Settings defaults
  const settingsModel = useSettingsStore((s) => s.model)
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from settings
      setSelectedProvider(defaultProvider)
    }
  }, [providersLoaded, defaultProvider, selectedProvider])

  // Resolve the effective provider object, model, and providerId for the API call
  const selectedProviderObj: ProviderStatus | undefined =
    selectedProvider ? providers.find((p) => p.id === selectedProvider) : undefined

  const effectiveProviderId = selectedProvider || defaultProvider || undefined

  const effectiveModel = (() => {
    if (selectedModel) return selectedModel
    const isClaudeProvider = !effectiveProviderId || effectiveProviderId === "claude-code"
    if (isClaudeProvider) return settingsModel
    return undefined
  })()

  /** Add a system-style message to the current session (gray, informational). */
  const addSystemMessage = useCallback((text: string) => {
    if (!currentSession) return
    addMessage(currentSession.id, { role: "assistant", content: `_${text}_` })
  }, [currentSession, addMessage])

  /**
   * Process slash commands. Returns true if the input was handled as a command.
   */
  const processSlashCommand = useCallback(async (text: string): Promise<boolean> => {
    const trimmed = text.trim()
    if (!trimmed.startsWith("/")) return false

    const parts = trimmed.split(/\s+/)
    const command = parts[0].toLowerCase()
    const args = parts.slice(1).join(" ")

    switch (command) {
      case "/clear": {
        if (currentSession && currentSession.messages.length > 0) {
          if (abortRef.current) {
            abortRef.current.abort()
            abortRef.current = null
          }
          setIsStreaming(false)
          handleNewSession()
          setTimeout(() => {
            const store = useSessionStore.getState()
            const activeId = store.activeSessionIds.get(`${projectId}:plan-chat`)
            if (activeId) addMessage(activeId, { role: "assistant", content: "_Session cleared. Starting fresh._" })
          }, 50)
        }
        return true
      }

      case "/new": {
        handleNewSession()
        setTimeout(() => {
          const store = useSessionStore.getState()
          const activeId = store.activeSessionIds.get(`${projectId}:plan-chat`)
          if (activeId) addMessage(activeId, { role: "assistant", content: "_New session created._" })
        }, 50)
        return true
      }

      case "/rename": {
        if (!args.trim()) {
          addSystemMessage("Usage: /rename <name>")
          return true
        }
        if (currentSession) {
          renameSession(currentSession.id, args.trim())
          addSystemMessage(`Session renamed to "${args.trim()}"`)
        }
        return true
      }

      case "/sessions": {
        sessionDropdownRef.current?.click()
        return true
      }

      case "/model": {
        modelDropdownRef.current?.click()
        return true
      }

      case "/compact": {
        if (!currentSession || currentSession.messages.length < 4) {
          addSystemMessage("Not enough messages to compact. Continue chatting first.")
          return true
        }

        addSystemMessage("Compacting conversation...")
        setIsStreaming(true)

        const allMessages = currentSession.messages
          .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

        const abortController = new AbortController()
        abortRef.current = abortController

        let summaryText = ""
        try {
          await compactConversation(
            { messages: allMessages, projectId, model: effectiveModel, providerId: effectiveProviderId },
            {
              onText: (chunk) => { summaryText += chunk },
              onDone: () => {
                if (!summaryText) {
                  addSystemMessage("Compaction produced no output. Try again later.")
                  setIsStreaming(false)
                  return
                }
                handleNewSession()
                setTimeout(() => {
                  const store = useSessionStore.getState()
                  const activeId = store.activeSessionIds.get(`${projectId}:plan-chat`)
                  if (activeId) {
                    addMessage(activeId, { role: "assistant", content: `_Context compressed from ${allMessages.length} messages._\n\n**Summary of prior conversation:**\n${summaryText}` })
                  }
                  setIsStreaming(false)
                }, 50)
              },
              onError: (error) => {
                addSystemMessage(`Compaction failed: ${error}`)
                setIsStreaming(false)
              },
            },
            abortController.signal,
          )
        } catch {
          setIsStreaming(false)
        }
        return true
      }

      case "/context": {
        const msgs = currentSession?.messages || []
        const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0)
        const estimatedTokens = Math.round(totalChars / 4)
        addSystemMessage(
          `Session: ${msgs.length} messages, ~${estimatedTokens.toLocaleString()} tokens (~${Math.round(totalChars / 1000)}K chars)`
        )
        return true
      }

      case "/help": {
        const helpText = SLASH_COMMANDS
          .map((cmd) => `**${cmd.usage || cmd.name}** - ${cmd.description}`)
          .join("\n")
        addSystemMessage(`Available commands:\n${helpText}`)
        return true
      }

      default:
        return false
    }
  }, [currentSession, projectId, handleNewSession, addMessage, addSystemMessage, renameSession, effectiveModel, effectiveProviderId])

  // Voice transcription
  const handleTranscript = useCallback((text: string) => {
    setInput((prev) => (prev.trim() ? prev.trim() + " " + text : text))
  }, [])

  const {
    isRecording,
    isTranscribing,
    isAvailable,
    duration,
    toggleRecording,
  } = useVoiceTranscription({ onTranscript: handleTranscript })

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

  /** Apply all mutations (node updates + edge operations + new nodes) to the plan store. */
  const applyMutations = useCallback((mutations: AppliedMutations) => {
    const { nodeUpdates, edgeOps, newNodes } = mutations

    // Create new nodes (from decomposition)
    const prefix = projectId.slice(0, 8)
    const safePrefixId = (id: string) => id.startsWith(prefix) ? id : `${prefix}-${id}`
    const idMap = new Map<string, string>() // map AI-generated IDs to real IDs
    for (const n of newNodes) {
      const realId = n.id ? safePrefixId(n.id) : `${prefix}-${crypto.randomUUID().slice(0, 8)}`
      if (n.id) idMap.set(n.id, realId)

      const now = new Date()
      const node: PlanNode = {
        id: realId,
        projectId,
        type: (n.type as PlanNode["type"]) ?? "task",
        title: n.title,
        description: n.description,
        status: "planned",
        parentId: null,
        dependencies: (n.dependencies ?? []).map((d) => idMap.get(d) ?? safePrefixId(d)),
        environment: (n.environment as PlanNode["environment"]) ?? "local",
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

    // Detect @codebase mention — inject file tree context into the message
    const hasCodebaseMention = /@codebase\b/i.test(text)
    let enrichedMessage = text
    if (hasCodebaseMention && project?.fileTree?.length) {
      const fileTreeContext = `\n\n[Codebase context: ${project.fileTree.length} files]\nFile tree:\n${project.fileTree.slice(0, 200).join("\n")}${project.fileTree.length > 200 ? "\n... (truncated)" : ""}`
      enrichedMessage = text + fileTreeContext
    }

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

    try {
      await chatWithAgent(
        {
          message: enrichedMessage,
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
          onDone: (newProviderSessionId) => {
            if (newProviderSessionId) setProviderSessionId(sid, newProviderSessionId)

            // Extract mutations from the raw text (available synchronously,
            // unlike React state which may be batched).
            const { cleanContent, mutations } = extractMutations(rawAssistantText)
            const hasMutations = mutations.nodeUpdates.length > 0 || mutations.edgeOps.length > 0 || mutations.newNodes.length > 0

            if (hasMutations) {
              // Apply side-effects outside setState to avoid React StrictMode
              // double-invocation duplicating nodes/edges.
              applyMutations(mutations)

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
  }, [isStreaming, projectId, visionDoc, effectiveModel, effectiveProviderId, planNodeContext, planEdgeContext, applyMutations, project, addMessage, appendToLastAssistantMessage, updateLastAssistantMessage, setProviderSessionId])

  function handleSend() {
    const text = input.trim()
    if (!text) return
    setShowSlashMenu(false)
    setSlashFilter("")
    // Process slash commands first; if not a command, send as regular message
    if (text.startsWith("/")) {
      setInput("")
      processSlashCommand(text)
    } else {
      sendMessage(text)
    }
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

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
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
              key={i}
              className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {msg.role === "user" ? "You" : providerLabel}
              </span>
              <div
                className={`rounded-lg px-3 py-2 text-sm leading-relaxed max-w-[320px] ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {msg.content ? (
                  msg.role === "assistant" ? (
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
                      className="flex items-center gap-1.5 rounded-md bg-blue-500/10 border border-blue-500/20 px-2.5 py-1.5 text-[11px] text-blue-600 dark:text-blue-400"
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
                      className="flex items-center gap-1.5 rounded-md bg-green-500/10 border border-green-500/20 px-2.5 py-1.5 text-[11px] text-green-600 dark:text-green-400"
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
      </ScrollArea>

      {/* Input */}
      <div className="flex items-end gap-2 border-t border-border p-3">
        <VoiceInputButton
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          isAvailable={isAvailable}
          duration={duration}
          onClick={toggleRecording}
          disabled={isStreaming}
          className="h-9 w-9 shrink-0"
        />
        <div className="relative flex-1">
          {/* Slash command autocomplete */}
          {showSlashMenu && filteredSlashCommands.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1 w-full rounded-lg border border-border bg-popover shadow-md z-10 max-h-[200px] overflow-y-auto">
              {filteredSlashCommands.map((cmd) => (
                <button
                  key={cmd.name}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault() // Prevent textarea blur
                    setInput(cmd.name === "/rename" ? "/rename " : cmd.name)
                    setShowSlashMenu(false)
                    setSlashFilter("")
                  }}
                >
                  <span className="font-mono text-xs text-primary">{cmd.name}</span>
                  <span className="text-xs text-muted-foreground">{cmd.description}</span>
                </button>
              ))}
            </div>
          )}
          <MentionTextarea
            value={input}
            onChange={handleInputChange}
            items={mentionItems}
            placeholder={isRecording ? "Listening..." : isTranscribing ? "Transcribing..." : "Type / for commands, @ to reference tasks..."}
            rows={1}
            disabled={isStreaming}
            onSubmit={handleSend}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <Button
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={handleSend}
          disabled={!input.trim() || isStreaming || isRecording || isTranscribing}
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
