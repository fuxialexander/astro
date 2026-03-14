import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Manages the embed lifecycle: loading state, fullscreen toggle, copy action.
 */
export function useVisualiseEmbed(html: string) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  // Track which html content has finished "loading" — when it doesn't match
  // the current html, the skeleton shows. This avoids calling setState
  // directly in an effect to reset isLoaded.
  const [loadedHtml, setLoadedHtml] = useState<string | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isLoaded = loadedHtml === html

  // Mark as loaded after a small delay to let the iframe initialize
  useEffect(() => {
    if (!html || isLoaded) return
    const timer = setTimeout(() => {
      setLoadedHtml(html)
    }, 150)
    return () => clearTimeout(timer)
  }, [html, isLoaded])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((v) => !v)
  }, [])

  const closeFullscreen = useCallback(() => {
    setIsFullscreen(false)
  }, [])

  const copySource = useCallback(() => {
    navigator.clipboard.writeText(html).then(() => {
      setIsCopied(true)
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = setTimeout(() => {
        setIsCopied(false)
      }, 2000)
    })
  }, [html])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  return { isFullscreen, isCopied, isLoaded, toggleFullscreen, closeFullscreen, copySource }
}
