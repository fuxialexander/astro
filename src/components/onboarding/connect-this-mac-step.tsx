/**
 * ConnectThisMacStep — onboarding step 1 (after binary install).
 *
 * Starts the OAuth2 device-auth flow against the Astro server, opens the
 * verification URL in the user's default browser, and listens for state
 * transitions on the broker channel `onboarding:device-auth`. On success,
 * starts the local agent runner and notifies the parent.
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
      // The XXXX-XXXX user-friendly code that's also shown on the browser
      // verification page. This is what the user reads / confirms — NOT the
      // long opaque `userCode` field, which is only the internal poll key.
      // (The server's `token-manager.ts` names these in the inverse of RFC
      // 8628 conventions; we display whatever the browser shows.)
      displayCode: string
      verificationUrl: string
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
      const res = await desktopBridge.onboarding.deviceAuthStart()
      unsubRef.current = desktopBridge.onboarding.onDeviceAuth(handleAuthEvent)
      try {
        await desktopBridge.editor.openExternal(res.verificationUriComplete)
      } catch {
        // openExternal failure is non-fatal; the user can click "Reopen browser"
      }
      setState({
        kind: "pending",
        displayCode: res.deviceCode,
        verificationUrl: res.verificationUriComplete,
      })
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [cleanupSubscription, handleAuthEvent])

  const reopenBrowser = useCallback(async () => {
    if (state.kind !== "pending") return
    try {
      await desktopBridge.editor.openExternal(state.verificationUrl)
    } catch {
      // ignore
    }
  }, [state])

  // "Verify now" — explicit one-shot poll for users whose background timer
  // appears stuck. The handler triggers exactly the same processing as the
  // background loop (success path publishes 'authorized' state, which our
  // handleAuthEvent receives). If still pending, surfaces a short hint
  // without disturbing the existing pending UI.
  const [verifyHint, setVerifyHint] = useState<string | null>(null)
  const verifyNow = useCallback(async () => {
    if (state.kind !== "pending") return
    setVerifyHint("Checking…")
    try {
      const r = await desktopBridge.onboarding.deviceAuthVerify()
      if (r.kind === "pending") {
        setVerifyHint("Still waiting on browser approval. Click Approve, then try again.")
      } else if (r.kind === "no-session") {
        setVerifyHint("Session expired. Click Open browser to start a new sign-in.")
      } else if (r.kind === "slow-down") {
        setVerifyHint("Polling too quickly — try again in a few seconds.")
      } else if (r.kind === "network-error") {
        setVerifyHint(`Network error: ${r.message}`)
      } else {
        // 'terminal' — handleAuthEvent will receive the authorized/error event
        // via the broker subscription and advance the UI.
        setVerifyHint(null)
      }
    } catch (err) {
      setVerifyHint(err instanceof Error ? err.message : String(err))
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
            <div style={smallLabelStyle}>Your sign-in code</div>
            <div style={codePillStyle}>{state.displayCode}</div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--muted-foreground)",
                fontWeight: 300,
                lineHeight: 1.55,
                marginTop: "0.5rem",
              }}
            >
              Confirm this code in your browser to authorize this Mac.
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.625rem", alignItems: "center" }}>
            <button
              onClick={verifyNow}
              className="as-btn-primary"
              style={{
                ...primaryBtnStyle,
                paddingLeft: "0.875rem",
                paddingRight: "0.875rem",
              }}
            >
              <Check size={13} />
              I clicked Approve — verify now
            </button>
            <button
              onClick={reopenBrowser}
              className="as-btn-ghost"
              style={ghostLinkStyle}
            >
              <ExternalLink size={12} />
              Reopen browser
            </button>
          </div>
          {verifyHint && (
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--muted-foreground)",
                fontWeight: 300,
              }}
            >
              {verifyHint}
            </div>
          )}
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

const codePillStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: "1.5rem",
  letterSpacing: "0.4em",
  fontWeight: 500,
  color: "var(--foreground)",
  padding: "0.625rem 1rem",
  borderRadius: 8,
  background: "var(--card)",
  border: "1px solid var(--border)",
  width: "fit-content",
  userSelect: "all",
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
