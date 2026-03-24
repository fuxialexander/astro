/**
 * SplashScreen — shown while the sidecar agent starts up.
 *
 * Displays an Astro logo with a loading animation. Shows an error
 * state if the sidecar fails to start. Fades out smoothly when ready.
 */
import { useState, useEffect } from 'react'
import { cn } from '@desktop/lib/utils'

interface SplashScreenProps {
  ready: boolean
  error: string | null
  onFadeComplete?: () => void
}

export function SplashScreen({ ready, error, onFadeComplete }: SplashScreenProps) {
  const [visible, setVisible] = useState(true)

  // When ready, begin fade-out, then call onFadeComplete
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      setVisible(false)
      // Allow the CSS transition to finish before unmounting
      const cleanup = setTimeout(() => onFadeComplete?.(), 400)
      return () => clearTimeout(cleanup)
    }, 200) // brief delay so user sees the "ready" state
    return () => clearTimeout(timer)
  }, [ready, onFadeComplete])

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center',
        'bg-background transition-opacity duration-400',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
      )}
    >
      {/* Logo */}
      <div className="relative mb-8">
        <div
          className={cn(
            'w-16 h-16 rounded-2xl flex items-center justify-center',
            'bg-gradient-to-br from-primary/20 to-primary/5',
            'border border-primary/20',
          )}
        >
          <span className="text-3xl select-none">✦</span>
        </div>

        {/* Spinning ring (hidden when error) */}
        {!error && !ready && (
          <div
            className={cn(
              'absolute -inset-2 rounded-2xl border-2 border-transparent',
              'border-t-primary/40 animate-spin',
            )}
            style={{ animationDuration: '1.2s' }}
          />
        )}

        {/* Check mark when ready */}
        {ready && (
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-success flex items-center justify-center">
            <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 6l3 3 5-5" />
            </svg>
          </div>
        )}
      </div>

      {/* Title */}
      <h1 className="text-lg font-semibold text-foreground mb-1">Astro</h1>

      {/* Status text */}
      {error ? (
        <div className="text-center max-w-xs">
          <p className="text-sm text-error mb-3">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs',
              'bg-primary text-primary-foreground',
              'hover:opacity-90 transition-opacity',
            )}
          >
            Retry
          </button>
        </div>
      ) : ready ? (
        <p className="text-sm text-muted-foreground">Ready</p>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <p className="text-sm text-muted-foreground">Starting agent...</p>
        </div>
      )}
    </div>
  )
}
