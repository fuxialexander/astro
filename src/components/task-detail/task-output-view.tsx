import { useEffect, useRef, useState } from "react"
import { Copy, Check, Search, ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"

interface TaskOutputViewProps {
  text: string
  isStreaming: boolean
}

export function TaskOutputView({ text, isStreaming }: TaskOutputViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)
  const [search, setSearch] = useState("")
  const [showSearch, setShowSearch] = useState(false)

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [text, autoScroll])

  // Detect manual scroll
  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
    setAutoScroll(isAtBottom)
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Highlight search matches
  const renderText = () => {
    if (!search || !text) return text

    const regex = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
    const parts = text.split(regex)
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-warning/30 text-foreground rounded-sm px-0.5">{part}</mark>
      ) : (
        part
      )
    )
  }

  if (!text) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {isStreaming ? "Waiting for output..." : "No output available"}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5"
          onClick={() => setShowSearch(!showSearch)}
        >
          <Search className="h-3.5 w-3.5" />
          Search
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <div className="flex-1" />
        {isStreaming && (
          <span className="text-xs text-info font-medium animate-pulse">Streaming...</span>
        )}
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="px-6 py-2 border-b border-border">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search output..."
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
        </div>
      )}

      {/* Output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-6 bg-muted/30"
      >
        <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-foreground">
          {renderText()}
          {isStreaming && <span className="animate-pulse text-info">|</span>}
        </pre>
      </div>

      {/* Scroll to bottom button */}
      {!autoScroll && (
        <Button
          variant="secondary"
          size="sm"
          className="absolute bottom-4 right-4 h-8 gap-1.5 shadow-md"
          onClick={() => {
            setAutoScroll(true)
            containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" })
          }}
        >
          <ArrowDown className="h-3.5 w-3.5" />
          Bottom
        </Button>
      )}
    </div>
  )
}
