import { useCallback, useEffect, useRef, useState } from "react"

interface VisualiseEmbedState {
  isFullscreen: boolean
  isCopied: boolean
  isLoaded: boolean
}

/**
 * Manages the embed lifecycle: loading state, fullscreen toggle, copy action.
 */
export function useVisualiseEmbed(html: string) {
  const [state, setState] = useState<VisualiseEmbedState>({
    isFullscreen: false,
    isCopied: false,
    isLoaded: false,
  })
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mark as loaded once we have html content
  useEffect(() => {
    if (html && !state.isLoaded) {
      // Small delay to let the iframe initialize
      const timer = setTimeout(() => {
        setState((s) => ({ ...s, isLoaded: true }))
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [html, state.isLoaded])

  const toggleFullscreen = useCallback(() => {
    setState((s) => ({ ...s, isFullscreen: !s.isFullscreen }))
  }, [])

  const closeFullscreen = useCallback(() => {
    setState((s) => ({ ...s, isFullscreen: false }))
  }, [])

  const copySource = useCallback(() => {
    navigator.clipboard.writeText(html).then(() => {
      setState((s) => ({ ...s, isCopied: true }))
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = setTimeout(() => {
        setState((s) => ({ ...s, isCopied: false }))
      }, 2000)
    })
  }, [html])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  return { ...state, toggleFullscreen, closeFullscreen, copySource }
}
