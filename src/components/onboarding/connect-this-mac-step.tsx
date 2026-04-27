/**
 * ConnectThisMacStep — onboarding step 1 (after binary install).
 *
 * Uses the callback-style pair flow: we open the browser at the server-
 * issued pair URL, the user clicks Approve, the browser hands tokens to
 * us via astro://pair/callback (handled in electron/main/index.ts +
 * handlePairCallback in agent.ts), and the broker publishes 'authorized'.
 * No polling, no slow-down errors, no race between background loops.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowRight, Check, AlertCircle, ExternalLink } from "lucide-react"
import { desktopBridge, type DeviceAuthState } from "@/lib/desktop-bridge"

interface Props {
  onComplete: () => void
  onSkip: () => void
}

type LocalState =
  | { kind: "idle" }
  | { kind: "starting" }
  | {
      kind: "pending"
      pairUrl: string
    }
  | { kind: "authorized" }
  | { kind: "starting-agent" }
  | { kind: "error"; message: string }

export function ConnectThisMacStep({ onComplete, onSkip: _onSkip }: Props) {
  void _onSkip
  const [state, setState] = useState<LocalState>({ kind: "idle" })
  const unsubRef = useRef<(() => void) | null>(null)

  const cleanupSubscription = useCallback(() => {
    if (unsubRef.current) {
      unsubRef.current()
      unsubRef.current = null
    }
  }, [])

  useEffect(() => () => cleanupSubscription(), [cleanupSubscription])

  // If a prior session already finished auth (or we missed the broker event
  // last time), don't re-run the device-code dance. Probe the local config
  // on mount and self-advance.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const auth = await desktopBridge.onboarding.authState()
        if (cancelled || !auth.authed) return
        // Idempotent — start() returns the existing pid if already running.
        void desktopBridge.localAgent.start().catch(() => {})
        onComplete()
      } catch {
        // probe failed — keep showing the connect button
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onComplete])

  const handleAuthEvent = useCallback(
    async (s: DeviceAuthState) => {
      if (s.state === "pending") {
        // server still polling, keep current pending UI
        return
      }
      if (s.state === "authorized") {
        cleanupSubscription()
        setState({ kind: "authorized" })
        // Brief flash of success, then start the local agent
        setTimeout(() => {
          void (async () => {
            setState({ kind: "starting-agent" })
            try {
              const res = await desktopBridge.localAgent.start()
              if (!res.ok) {
                setState({
                  kind: "error",
                  message:
                    res.error ?? "Failed to start local agent runner.",
                })
                return
              }
              onComplete()
            } catch (err) {
              setState({
                kind: "error",
                message: err instanceof Error ? err.message : String(err),
              })
            }
          })()
        }, 700)
        return
      }
      cleanupSubscription()
      if (s.state === "expired") {
        setState({
          kind: "error",
          message: "The login code expired. Try again.",
        })
      } else if (s.state === "denied") {
        setState({
          kind: "error",
          message: "The login was denied. Try again.",
        })
      } else if (s.state === "network-error") {
        setState({
          kind: "error",
          message: `Network error: ${s.message}`,
        })
      } else if (s.state === "error") {
        setState({ kind: "error", message: s.message })
      }
    },
    [cleanupSubscription, onComplete],
  )

  const startFlow = useCallback(async () => {
    cleanupSubscription()
    setState({ kind: "starting" })
    try {
      // Subscribe BEFORE starting the pair flow so we don't miss the
      // 'authorized' event if the user is already signed in and clicks
      // Approve almost instantly.
      unsubRef.current = desktopBridge.onboarding.onDeviceAuth(handleAuthEvent)
      const res = await desktopBridge.onboarding.pairStart()
      setState({
        kind: "pending",
        pairUrl: res.pairUrl,
      })
    } catch (err) {
      cleanupSubscription()
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [cleanupSubscription, handleAuthEvent])

  const reopenBrowser = useCallback(async () => {
    if (state.kind !== "pending") return
    try {
      await desktopBridge.editor.openExternal(state.pairUrl)
    } catch {
      // ignore
    }
  }, [state])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <div style={ebrowStyle}>Step 1 of 3 · Sign in</div>
        <h2 style={headingStyle}>Connect this Mac.</h2>
        <p style={subtitleStyle}>Sign in to connect this Mac.</p>
      </div>

      {state.kind === "idle" && (
        <div>
          <button
            onClick={startFlow}
            className="as-btn-primary"
            style={primaryBtnStyle}
          >
            Open browser to connect
            <ArrowRight size={13} />
          </button>
        </div>
      )}

      {state.kind === "starting" && (
        <div style={mutedRowStyle}>
          <span style={{ opacity: 0.6 }}>Requesting device code…</span>
        </div>
      )}

      {state.kind === "pending" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={pendingCardStyle}>
            <div style={smallLabelStyle}>Approve in your browser</div>
            <div
              style={{
                fontSize: "0.8125rem",
                color: "var(--foreground)",
                fontWeight: 400,
                lineHeight: 1.55,
              }}
            >
              We opened a browser tab to authorize this Mac. Sign in if asked,
              then click <strong>Approve</strong>. The desktop app will pick it
              up automatically — no codes to copy.
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              fontSize: "0.75rem",
              color: "var(--muted-foreground)",
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.04em",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#e6a447",
                animation: "as-pulse 1.4s ease-in-out infinite",
              }}
            />
            <span>Waiting for browser approval…</span>
          </div>
          <div style={{ display: "flex", gap: "0.625rem", alignItems: "center" }}>
            <button
              onClick={reopenBrowser}
              className="as-btn-ghost"
              style={ghostLinkStyle}
            >
              <ExternalLink size={12} />
              Reopen browser
            </button>
          </div>
        </div>
      )}

      {state.kind === "authorized" && (
        <div style={successRowStyle}>
          <Check size={16} style={{ color: "#5dd39e" }} />
          <span>Connected — your CLI is signed in too.</span>
        </div>
      )}

      {state.kind === "starting-agent" && (
        <div style={mutedRowStyle}>
          <span style={{ opacity: 0.6 }}>Starting local agent runner…</span>
        </div>
      )}

      {state.kind === "error" && (
        <div style={errorCardStyle}>
          <AlertCircle
            size={16}
            style={{ color: "#ff6b6b", marginTop: 1, flexShrink: 0 }}
          />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: "0.8125rem",
                fontWeight: 500,
                color: "var(--foreground)",
                marginBottom: "0.25rem",
              }}
            >
              Sign-in failed
            </div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.75rem",
                color: "var(--muted-foreground)",
                lineHeight: 1.5,
                marginBottom: "0.75rem",
              }}
            >
              {state.message}
            </div>
            <button
              onClick={startFlow}
              className="as-btn-primary"
              style={primaryBtnStyle}
            >
              Try again
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── shared inline styles ──────────────────────────────────────────────────

const ebrowStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: "0.5625rem",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--muted-foreground)",
  marginBottom: "0.625rem",
}

const headingStyle: React.CSSProperties = {
  fontFamily: "'Cormorant Garamond', serif",
  fontSize: "clamp(1.75rem, 3.5vw, 2.25rem)",
  fontWeight: 300,
  letterSpacing: "0.02em",
  lineHeight: 1.1,
  color: "var(--foreground)",
  marginBottom: "0.625rem",
}

const subtitleStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  color: "var(--muted-foreground)",
  fontWeight: 300,
  lineHeight: 1.65,
  maxWidth: 520,
  margin: 0,
}

const primaryBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.45rem",
  padding: "0.5625rem 1.125rem",
  borderRadius: 9,
  background: "var(--foreground)",
  color: "var(--background)",
  border: "none",
  cursor: "pointer",
  fontSize: "0.8125rem",
  fontWeight: 500,
  letterSpacing: "-0.01em",
  transition: "opacity 0.15s",
}

const ghostLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.4rem",
  background: "none",
  border: "none",
  padding: "0.25rem 0",
  color: "var(--muted-foreground)",
  cursor: "pointer",
  fontSize: "0.75rem",
  fontFamily: "'JetBrains Mono', monospace",
  letterSpacing: "0.04em",
  width: "fit-content",
}

const mutedRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  color: "var(--muted-foreground)",
  fontSize: "0.8125rem",
  height: 40,
}

const pendingCardStyle: React.CSSProperties = {
  padding: "1.25rem",
  borderRadius: 12,
  background: "var(--muted)",
  border: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
}

const smallLabelStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: "0.5625rem",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--muted-foreground)",
}

const successRowStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.875rem",
  color: "var(--foreground)",
  fontWeight: 400,
}

const errorCardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "0.75rem",
  padding: "1rem 1.25rem",
  borderRadius: 12,
  background: "rgba(255,80,80,0.07)",
  border: "1px solid rgba(255,80,80,0.18)",
}
