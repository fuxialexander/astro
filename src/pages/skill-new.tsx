/**
 * Create Skill with AI Page
 *
 * Two-panel layout for collaborative skill creation:
 * - Left panel: Chat interface for collaborative skill refinement
 * - Right panel: Live preview of skill definition
 */

import { useState, useMemo } from "react"
import { useNavigate } from "react-router"
import { ArrowLeft, Sparkles, FileCode2, Edit3, Save, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { StreamingMarkdown } from "@/components/ui/streaming-markdown"
import { parseSkillMd } from "@/lib/skill-parser"
import { useSkillStore } from "@/stores/skill-store"
import { useToastStore } from "@/stores/toast-store"
import { cn } from "@/lib/utils"

export function SkillNew() {
  const navigate = useNavigate()
  const [chatInput, setChatInput] = useState("")
  const [skillMarkdown, setSkillMarkdown] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)

  const handleBack = () => {
    navigate("/skills")
  }

  const handleStartOver = () => {
    setSkillMarkdown("")
    setIsStreaming(false)
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
              <ChatPanel
                chatInput={chatInput}
                setChatInput={setChatInput}
                onSkillMarkdown={setSkillMarkdown}
                onStreaming={setIsStreaming}
              />
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right panel: Preview */}
            <ResizablePanel defaultSize={40} minSize={30}>
              <PreviewPanel
                skillMarkdown={skillMarkdown}
                isStreaming={isStreaming}
                onMarkdownChange={setSkillMarkdown}
                onStartOver={handleStartOver}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Mobile: Stacked vertically */}
        <div className="md:hidden h-full overflow-auto">
          <div className="flex flex-col min-h-full">
            {/* Chat section */}
            <div className="flex-1 min-h-[50vh]">
              <ChatPanel
                chatInput={chatInput}
                setChatInput={setChatInput}
                onSkillMarkdown={setSkillMarkdown}
                onStreaming={setIsStreaming}
              />
            </div>

            {/* Preview section */}
            <div className="flex-1 min-h-[50vh] border-t border-border">
              <PreviewPanel
                skillMarkdown={skillMarkdown}
                isStreaming={isStreaming}
                onMarkdownChange={setSkillMarkdown}
                onStartOver={handleStartOver}
              />
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
  onSkillMarkdown,
  onStreaming,
}: {
  chatInput: string
  setChatInput: (value: string) => void
  onSkillMarkdown: (markdown: string) => void
  onStreaming: (streaming: boolean) => void
}) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([])

  const handleSend = () => {
    if (!chatInput.trim()) return

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: chatInput }])

    // TODO: Connect to AI chat endpoint for skill generation
    // For now, generate a sample SKILL.md
    onStreaming(true)
    setTimeout(() => {
      const sampleSkill = `---
name: example-skill
description: An example skill that demonstrates the format
category: productivity
tags: example, demo
---

## Example Skill

This is an example skill that shows the SKILL.md format. Replace this with actual skill instructions.

### Usage

Describe how to use this skill here.

### Configuration

List any required configuration or environment variables.`

      onSkillMarkdown(sampleSkill)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'I\'ve created a skill template for you. You can see the preview on the right panel and edit it as needed.'
      }])
      onStreaming(false)
    }, 1000)

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
function PreviewPanel({
  skillMarkdown,
  isStreaming,
  onMarkdownChange,
  onStartOver,
}: {
  skillMarkdown: string
  isStreaming: boolean
  onMarkdownChange: (markdown: string) => void
  onStartOver: () => void
}) {
  const navigate = useNavigate()
  const addSkill = useSkillStore((s) => s.addSkill)
  const addToast = useToastStore((s) => s.add)

  const [editMode, setEditMode] = useState(false)
  const [editedMarkdown, setEditedMarkdown] = useState("")
  const [saving, setSaving] = useState(false)

  // Use edited markdown when in edit mode, otherwise use parent's markdown
  const displayMarkdown = editMode ? editedMarkdown : skillMarkdown

  // Compute parse error as derived state
  const parseError = useMemo(() => {
    if (!displayMarkdown) return null
    const parsed = parseSkillMd(displayMarkdown, 'user')
    if (!parsed) {
      return 'Invalid SKILL.md format. Must include frontmatter with "name" field and instructions body.'
    }
    return null
  }, [displayMarkdown])

  const handleEditToggle = () => {
    if (editMode) {
      // Exiting edit mode: save edits back to parent
      onMarkdownChange(editedMarkdown)
    } else {
      // Entering edit mode: copy current markdown to edited state
      setEditedMarkdown(skillMarkdown)
    }
    setEditMode(!editMode)
  }

  const handleSave = async () => {
    const parsed = parseSkillMd(displayMarkdown, 'user')
    if (!parsed) {
      addToast({
        type: 'error',
        title: 'Invalid skill format',
        description: 'Cannot parse SKILL.md. Please check the frontmatter and format.',
      })
      return
    }

    setSaving(true)
    try {
      addSkill(parsed)
      addToast({
        type: 'success',
        title: 'Skill created',
        description: `"${parsed.name}" has been saved successfully.`,
      })
      // Navigate back to skills list after a short delay
      setTimeout(() => {
        navigate('/skills')
      }, 500)
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Failed to save skill',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      setSaving(false)
    }
  }

  // Parse frontmatter for badge display
  const parsedSkill = displayMarkdown ? parseSkillMd(displayMarkdown, 'user') : null
  const hasContent = !!displayMarkdown

  // Extract category and tags from frontmatter
  const extractMetadata = () => {
    const fmMatch = displayMarkdown.match(/^---\s*\n([\s\S]*?)\n---/)
    if (!fmMatch) return { category: null, tags: [] }

    const frontmatter = fmMatch[1]
    let category: string | null = null
    let tags: string[] = []

    for (const line of frontmatter.split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      if (key === 'category') category = value
      if (key === 'tags') tags = value.split(',').map(t => t.trim()).filter(Boolean)
    }

    return { category, tags }
  }

  const { category, tags } = extractMetadata()

  return (
    <div className="flex flex-col h-full bg-muted/20">
      {/* Preview header */}
      <div className="px-4 md:px-6 py-3 border-b border-border shrink-0 bg-background">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCode2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Preview</h2>
          </div>
          {hasContent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleEditToggle}
              className="gap-1.5 h-7"
            >
              <Edit3 className="h-3.5 w-3.5" />
              {editMode ? 'View' : 'Edit'}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {editMode ? 'Edit the skill markdown directly' : 'Live preview of your skill definition'}
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
        ) : editMode ? (
          <textarea
            value={editedMarkdown}
            onChange={(e) => setEditedMarkdown(e.target.value)}
            className="w-full h-full min-h-[400px] rounded-md border border-border bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Edit SKILL.md content..."
          />
        ) : (
          <div className="space-y-4">
            {/* Frontmatter badges */}
            {parsedSkill && (
              <div className="space-y-3 pb-4 border-b border-border">
                <div>
                  <h3 className="text-base font-semibold mb-2">{parsedSkill.name}</h3>
                  <p className="text-sm text-muted-foreground">{parsedSkill.description}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {category && (
                    <Badge variant="secondary" className="gap-1.5">
                      <span className="text-xs">Category:</span>
                      <span className="font-medium">{category}</span>
                    </Badge>
                  )}
                  {tags.map((tag, idx) => (
                    <Badge key={idx} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Markdown content */}
            {parseError ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
                <p className="text-sm font-medium text-destructive mb-1">Parse Error</p>
                <p className="text-xs text-destructive/90">{parseError}</p>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <StreamingMarkdown
                  content={displayMarkdown}
                  isStreaming={isStreaming}
                  className="text-sm"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Preview actions */}
      {hasContent && (
        <div className="px-4 md:px-6 py-3 border-t border-border shrink-0 bg-background space-y-2">
          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={!!parseError || saving}
              className="flex-1 gap-2"
              size="sm"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Skill'}
            </Button>
            <Button
              onClick={onStartOver}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Start Over
            </Button>
          </div>
          {parseError && (
            <p className="text-xs text-destructive">
              Fix the errors before saving
            </p>
          )}
        </div>
      )}
    </div>
  )
}
