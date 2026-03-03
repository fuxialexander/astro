/**
 * Create Skill with AI Page
 *
 * Two-panel layout for collaborative skill creation:
 * - Left panel: Chat interface for collaborative skill refinement
 * - Right panel: Live preview of skill definition
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { useNavigate } from "react-router"
import { ArrowLeft, Sparkles, FileCode2, Send, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { FileCompletionTextarea } from "@/components/ui/file-completion-textarea"
import { useSessionStore } from "@/stores/session-store"
import { useSettingsStore } from "@/stores/settings-store"
import { planChatWithAgent } from "@/lib/api-client"
import { cn } from "@/lib/utils"

export function SkillNew() {
  const navigate = useNavigate()
  const [skillPreview, setSkillPreview] = useState<SkillDefinition>({
    name: "",
    description: "",
    category: "",
    instructions: "",
  })

  const handleBack = () => {
    navigate("/skills")
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 md:px-6 h-14 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="gap-1.5 -ml-2"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back to Skills</span>
        </Button>
        <div className="h-4 w-px bg-border" />
        <h1 className="text-lg font-semibold">Create Skill with AI</h1>
      </div>

      {/* Two-panel layout: Chat (left) + Preview (right) */}
      <div className="flex-1 overflow-hidden">
        {/* Desktop: Resizable two-panel layout */}
        <div className="hidden md:block h-full">
          <ResizablePanelGroup orientation="horizontal">
            {/* Left panel: Chat interface */}
            <ResizablePanel defaultSize={60} minSize={40}>
              <ChatPanel onSkillUpdate={setSkillPreview} />
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right panel: Preview */}
            <ResizablePanel defaultSize={40} minSize={30}>
              <PreviewPanel skillPreview={skillPreview} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Mobile: Stacked vertically */}
        <div className="md:hidden h-full overflow-auto">
          <div className="flex flex-col min-h-full">
            {/* Chat section */}
            <div className="flex-1 min-h-[50vh]">
              <ChatPanel onSkillUpdate={setSkillPreview} />
            </div>

            {/* Preview section */}
            <div className="flex-1 min-h-[50vh] border-t border-border">
              <PreviewPanel skillPreview={skillPreview} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface SkillDefinition {
  name: string
  description: string
  category: string
  instructions: string
}

/**
 * Chat Panel Component
 * Left side: Interactive chat for skill creation guidance
 */
function ChatPanel({ onSkillUpdate }: { onSkillUpdate: (updater: SkillDefinition | ((prev: SkillDefinition) => SkillDefinition)) => void }) {
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const model = useSettingsStore((s) => s.model)
  const sessionsLoaded = useSessionStore((s) => s.loaded)
  const createSession = useSessionStore((s) => s.createSession)
  const addMessage = useSessionStore((s) => s.addMessage)
  const appendToLastAssistantMessage = useSessionStore((s) => s.appendToLastAssistantMessage)
  const setProviderSessionId = useSessionStore((s) => s.setProviderSessionId)

  // Get or create a skill-create session
  const allSessions = useSessionStore((s) => s.sessions)
  const session = useMemo(() => {
    let latest: ReturnType<typeof allSessions.get> | undefined
    for (const sess of allSessions.values()) {
      if (sess.type === "skill-create") {
        if (!latest || sess.createdAt > latest.createdAt) latest = sess
      }
    }
    return latest
  }, [allSessions])

  // Create session on mount
  useEffect(() => {
    if (sessionsLoaded && !session) {
      createSession({
        type: "skill-create",
        projectId: "skill-onboarder", // Synthetic project ID for skill creation
      })
    }
  }, [sessionsLoaded, session, createSession])

  // Load skill-onboarder SKILL.md as system prompt
  useEffect(() => {
    async function loadSystemPrompt() {
      try {
        const response = await fetch("/skills/skill-onboarder/SKILL.md")
        if (response.ok) {
          const content = await response.text()
          // Extract instructions section from SKILL.md
          const instructionsMatch = content.match(/^---[\s\S]*?---\n([\s\S]*)$/m)
          if (instructionsMatch) {
            setSystemPrompt(instructionsMatch[1].trim())
          } else {
            setSystemPrompt(content)
          }
        }
      } catch (error) {
        console.error("Failed to load skill-onboarder SKILL.md:", error)
      }
    }
    loadSystemPrompt()
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [session?.messages?.length])

  // Extract SKILL.md content from assistant message
  const extractSkillContent = useCallback((text: string) => {
    // Look for SKILL.md content in markdown code blocks or structured sections
    const skillData: Partial<SkillDefinition> = {}

    // Match ```yaml or ```markdown code blocks with frontmatter
    const yamlMatch = text.match(/```(?:yaml|markdown|md)\s*\n---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*?)\n```/i)
    if (yamlMatch) {
      const frontmatter = yamlMatch[1]
      const body = yamlMatch[2]

      // Parse frontmatter
      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
      const descMatch = frontmatter.match(/^description:\s*"?(.+?)"?$/m)
      const catMatch = frontmatter.match(/^category:\s*(.+)$/m)

      if (nameMatch) skillData.name = nameMatch[1].trim()
      if (descMatch) skillData.description = descMatch[1].trim()
      if (catMatch) skillData.category = catMatch[1].trim()
      if (body) skillData.instructions = body.trim()
    } else {
      // Fallback: Look for structured sections
      const nameMatch = text.match(/(?:^|\n)(?:##?\s*)?(?:Skill )?Name:\s*(.+)/i)
      const descMatch = text.match(/(?:^|\n)(?:##?\s*)?Description:\s*(.+)/i)
      const catMatch = text.match(/(?:^|\n)(?:##?\s*)?Category:\s*(.+)/i)
      const instrMatch = text.match(/(?:^|\n)(?:##?\s*)?(?:Instructions|Workflow|How to use):\s*([\s\S]+?)(?:\n##|\n---|\n\n\n|$)/i)

      if (nameMatch) skillData.name = nameMatch[1].trim()
      if (descMatch) skillData.description = descMatch[1].trim()
      if (catMatch) skillData.category = catMatch[1].trim()
      if (instrMatch) skillData.instructions = instrMatch[1].trim()
    }

    // Only update if we found at least one field
    if (Object.keys(skillData).length > 0) {
      onSkillUpdate((prev: SkillDefinition) => ({ ...prev, ...skillData }))
    }
  }, [onSkillUpdate])

  const handleSend = useCallback(async () => {
    if (!input.trim() || streaming || !session) return

    const sid = session.id
    const text = input.trim()
    setInput("")

    // Add user message
    addMessage(sid, { role: "user", content: text })

    setStreaming(true)
    abortRef.current = new AbortController()

    // Build message history for context (system prompt prepended in backend)
    const historyMessages = (session.messages || [])
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content.length > 0))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    // Add empty assistant message to stream into
    addMessage(sid, { role: "assistant", content: "" })

    let fullResponse = ""

    try {
      await planChatWithAgent(
        {
          message: text,
          sessionId: session.providerSessionId,
          projectId: "skill-onboarder",
          model,
          visionDoc: systemPrompt, // Use visionDoc field for system prompt
          messages: historyMessages,
        },
        {
          onText: (chunk) => {
            fullResponse += chunk
            appendToLastAssistantMessage(sid, chunk)
          },
          onDone: (providerSessionId) => {
            if (providerSessionId && !session.providerSessionId) {
              setProviderSessionId(sid, providerSessionId)
            }
            // Extract skill content from the full response
            extractSkillContent(fullResponse)
          },
          onError: (error) => {
            console.error("Chat error:", error)
            addMessage(sid, {
              role: "assistant",
              content: `Error: ${error}`,
            })
          },
        },
        abortRef.current.signal
      )
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.error("Chat error:", error)
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [input, streaming, session, addMessage, appendToLastAssistantMessage, setProviderSessionId, model, systemPrompt, extractSkillContent])

  const messages = session?.messages || []

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Chat header */}
      <div className="px-4 md:px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium">Chat</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Describe the skill you want to create, and I'll help you refine it
        </p>
      </div>

      {/* Messages area */}
      <div ref={containerRef} className="flex-1 overflow-auto px-4 md:px-6 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="rounded-full bg-primary/10 p-3 mb-4">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-sm font-medium mb-2">Start Creating Your Skill</h3>
            <p className="text-xs text-muted-foreground max-w-sm">
              Tell me what kind of skill you want to create. For example:
            </p>
            <div className="mt-4 space-y-2 text-xs text-muted-foreground text-left max-w-sm">
              <div className="flex items-start gap-2">
                <span className="text-primary shrink-0">•</span>
                <span>"Create a code review skill that checks for security issues"</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary shrink-0">•</span>
                <span>"I need a skill for writing comprehensive test cases"</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary shrink-0">•</span>
                <span>"Help me create a documentation generator skill"</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-3",
                  msg.role === 'user' ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "rounded-lg px-4 py-2.5 max-w-[80%] text-sm whitespace-pre-wrap",
                    msg.role === 'user'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                >
                  {msg.content || <Loader2 className="h-4 w-4 animate-spin inline-block" />}
                </div>
              </div>
            ))}
            {streaming && messages[messages.length - 1]?.role === "assistant" && (
              <div className="flex gap-2 items-center text-xs text-muted-foreground pl-4">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>AI is typing...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="px-4 md:px-6 py-3 border-t border-border shrink-0">
        <div className="flex items-end gap-2">
          <FileCompletionTextarea
            projectId="skill-onboarder"
            value={input}
            onChange={setInput}
            placeholder="Describe the skill you want to create..."
            rows={3}
            disabled={streaming}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            size="sm"
            className="shrink-0"
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Press Cmd+Enter to send
        </p>
      </div>
    </div>
  )
}

/**
 * Preview Panel Component
 * Right side: Live preview of the skill being created
 */
function PreviewPanel({ skillPreview }: { skillPreview: SkillDefinition }) {
  const hasContent = skillPreview.name || skillPreview.description || skillPreview.instructions

  return (
    <div className="flex flex-col h-full bg-muted/20">
      {/* Preview header */}
      <div className="px-4 md:px-6 py-3 border-b border-border shrink-0 bg-background">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Preview</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Live preview of your skill definition
        </p>
      </div>

      {/* Preview content */}
      <div className="flex-1 overflow-auto px-4 md:px-6 py-4">
        {!hasContent ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <FileCode2 className="h-8 w-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              Your skill preview will appear here as you chat
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Skill name */}
            {skillPreview.name && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Name
                </label>
                <div className="mt-1 text-sm font-medium">
                  {skillPreview.name}
                </div>
              </div>
            )}

            {/* Skill description */}
            {skillPreview.description && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Description
                </label>
                <div className="mt-1 text-sm text-foreground">
                  {skillPreview.description}
                </div>
              </div>
            )}

            {/* Category */}
            {skillPreview.category && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Category
                </label>
                <div className="mt-1 text-sm text-foreground">
                  {skillPreview.category}
                </div>
              </div>
            )}

            {/* Instructions */}
            {skillPreview.instructions && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Instructions
                </label>
                <div className="mt-1 rounded-md border border-border bg-background p-3 text-xs font-mono text-foreground whitespace-pre-wrap">
                  {skillPreview.instructions}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Preview actions */}
      {hasContent && (
        <div className="px-4 md:px-6 py-3 border-t border-border shrink-0 bg-background">
          <Button className="w-full gap-2" size="sm">
            <FileCode2 className="h-4 w-4" />
            Save Skill
          </Button>
        </div>
      )}
    </div>
  )
}
