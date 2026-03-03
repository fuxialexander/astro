/**
 * Create Skill with AI Page
 *
 * Two-panel layout for collaborative skill creation:
 * - Left panel: Chat interface for collaborative skill refinement
 * - Right panel: Live preview of skill definition
 */

import { useState } from "react"
import { useNavigate } from "react-router"
import { ArrowLeft, Sparkles, FileCode2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { cn } from "@/lib/utils"

export function SkillNew() {
  const navigate = useNavigate()
  const [chatInput, setChatInput] = useState("")

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
              <ChatPanel chatInput={chatInput} setChatInput={setChatInput} />
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right panel: Preview */}
            <ResizablePanel defaultSize={40} minSize={30}>
              <PreviewPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Mobile: Stacked vertically */}
        <div className="md:hidden h-full overflow-auto">
          <div className="flex flex-col min-h-full">
            {/* Chat section */}
            <div className="flex-1 min-h-[50vh]">
              <ChatPanel chatInput={chatInput} setChatInput={setChatInput} />
            </div>

            {/* Preview section */}
            <div className="flex-1 min-h-[50vh] border-t border-border">
              <PreviewPanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Chat Panel Component
 * Left side: Interactive chat for skill creation guidance
 */
function ChatPanel({
  chatInput,
  setChatInput,
}: {
  chatInput: string
  setChatInput: (value: string) => void
}) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([])

  const handleSend = () => {
    if (!chatInput.trim()) return

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: chatInput }])

    // TODO: Connect to AI chat endpoint
    // For now, just echo back
    setTimeout(() => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'I can help you create a custom skill. Tell me what you want the skill to do, and I\'ll help you define the instructions, categories, and usage examples.'
      }])
    }, 500)

    setChatInput("")
  }

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
      <div className="flex-1 overflow-auto px-4 md:px-6 py-4">
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
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex gap-3",
                  msg.role === 'user' ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "rounded-lg px-4 py-2.5 max-w-[80%] text-sm",
                    msg.role === 'user'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                >
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="px-4 md:px-6 py-3 border-t border-border shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Describe the skill you want to create..."
            rows={3}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
          <Button
            onClick={handleSend}
            disabled={!chatInput.trim()}
            size="sm"
            className="shrink-0"
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}

/**
 * Preview Panel Component
 * Right side: Live preview of the skill being created
 */
function PreviewPanel() {
  // TODO: This will be populated from chat context
  const previewSkill = {
    name: "",
    description: "",
    category: "",
    instructions: "",
  }

  const hasContent = previewSkill.name || previewSkill.description || previewSkill.instructions

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
            {previewSkill.name && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Name
                </label>
                <div className="mt-1 text-sm font-medium">
                  {previewSkill.name}
                </div>
              </div>
            )}

            {/* Skill description */}
            {previewSkill.description && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Description
                </label>
                <div className="mt-1 text-sm text-foreground">
                  {previewSkill.description}
                </div>
              </div>
            )}

            {/* Category */}
            {previewSkill.category && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Category
                </label>
                <div className="mt-1 text-sm text-foreground">
                  {previewSkill.category}
                </div>
              </div>
            )}

            {/* Instructions */}
            {previewSkill.instructions && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Instructions
                </label>
                <div className="mt-1 rounded-md border border-border bg-background p-3 text-xs font-mono text-foreground whitespace-pre-wrap">
                  {previewSkill.instructions}
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
