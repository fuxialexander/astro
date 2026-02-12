import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { Send, Loader2, ChevronDown, Bot, CheckCircle2, Pencil, GitBranch } from "lucide-react"
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
import { chatWithAgent, type ChatPlanNodeContext, type ChatPlanEdgeContext } from "@/lib/api-client"
import { useSettingsStore } from "@/stores/settings-store"
import { useExecutionStore } from "@/stores/execution-store"
import { usePlanStore } from "@/stores/plan-store"
import { useVoiceTranscription } from "@/hooks/use-voice-transcription"
import type { PlanNode, ProviderStatus } from "@/types"

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

/** All mutations extracted from a single assistant message */
interface AppliedMutations {
  nodeUpdates: ParsedNodeUpdate[]
  edgeOps: ParsedEdgeOp[]
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

const UPDATE_BLOCK_RE = /```nexus-updates\s*\n([\s\S]*?)```/g
const EDGE_BLOCK_RE = /```nexus-edges\s*\n([\s\S]*?)```/g

/** Extract nexus-updates and nexus-edges blocks from a message. */
function extractMutations(content: string): { cleanContent: string; mutations: AppliedMutations } {
  const nodeUpdates: ParsedNodeUpdate[] = []
  const edgeOps: ParsedEdgeOp[] = []

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
  }).trim()

  return { cleanContent, mutations: { nodeUpdates, edgeOps } }
}

/** Compact label for a model id (strip dates and common prefixes). */
function shortModelLabel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function ChatPanel({ projectId, visionDoc }: { projectId: string; visionDoc?: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Plan store — read nodes/edges for context, write updates
  const planNodes = usePlanStore((s) => s.nodes)
  const planEdges = usePlanStore((s) => s.edges)
  const updateNode = usePlanStore((s) => s.updateNode)
  const addEdge = usePlanStore((s) => s.addEdge)
  const removeEdge = usePlanStore((s) => s.removeEdge)

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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  /** Apply all mutations (node updates + edge operations) to the plan store. */
  const applyMutations = useCallback((mutations: AppliedMutations) => {
    const { nodeUpdates, edgeOps } = mutations

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
  }, [planNodes, updateNode, addEdge, removeEdge])

  async function handleSend() {
    const text = input.trim()
    if (!text || isStreaming) return

    setInput("")
    setMessages((prev) => [...prev, { role: "user", content: text }])
    setIsStreaming(true)
    setMessages((prev) => [...prev, { role: "assistant", content: "" }])

    abortRef.current = new AbortController()

    try {
      await chatWithAgent(
        {
          message: text,
          sessionId,
          projectId,
          visionDoc,
          model: effectiveModel,
          providerId: effectiveProviderId,
          planNodes: planNodeContext,
          planEdges: planEdgeContext,
        },
        {
          onText: (chunk) => {
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last && last.role === "assistant") {
                updated[updated.length - 1] = { ...last, content: last.content + chunk }
              }
              return updated
            })
          },
          onDone: (newSessionId) => {
            if (newSessionId) setSessionId(newSessionId)
            // Parse the final message for node updates and edge operations
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last && last.role === "assistant" && last.content) {
                const { cleanContent, mutations } = extractMutations(last.content)
                const hasMutations = mutations.nodeUpdates.length > 0 || mutations.edgeOps.length > 0
                if (hasMutations) {
                  applyMutations(mutations)
                  updated[updated.length - 1] = {
                    ...last,
                    content: cleanContent,
                    appliedMutations: mutations,
                  }
                }
              }
              return updated
            })
            setIsStreaming(false)
          },
          onError: (error) => {
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last && last.role === "assistant") {
                updated[updated.length - 1] = { ...last, content: `Error: ${error}` }
              }
              return updated
            })
            setIsStreaming(false)
          },
        },
        abortRef.current.signal,
      )
    } catch {
      setIsStreaming(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

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

  return (
    <div className="flex h-full flex-col border-l border-border bg-card">
      {/* Header with model/provider picker */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-4 border-b border-border">
        <span className="text-sm font-semibold">Plan Chat</span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors cursor-pointer max-w-[180px]">
              <Bot className="h-3 w-3 shrink-0" />
              <span className="truncate">{providerLabel}</span>
              <span className="text-muted-foreground/50">/</span>
              <span className="truncate">{modelLabel}</span>
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

            {selectedProviderObj?.capabilities?.availableModels &&
              selectedProviderObj.capabilities.availableModels.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Model</DropdownMenuLabel>
                {selectedProviderObj.capabilities.availableModels.map((m) => (
                  <DropdownMenuItem
                    key={m}
                    onClick={(e) => { e.stopPropagation(); setSelectedModel(m) }}
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
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="flex flex-col gap-4">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              Ask questions or request changes to your plan.
              The assistant can modify any task property, reassign milestones,
              add or remove dependencies, and restructure the graph.
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
                <pre className="whitespace-pre-wrap font-secondary text-sm">
                  {msg.content || (isStreaming && i === messages.length - 1 ? "..." : "")}
                </pre>
              </div>
              {/* Show applied mutation banners */}
              {msg.appliedMutations && (msg.appliedMutations.nodeUpdates.length > 0 || msg.appliedMutations.edgeOps.length > 0) && (
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
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRecording ? "Listening..." : isTranscribing ? "Transcribing..." : "Ask about your plan..."}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
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
    </div>
  )
}
