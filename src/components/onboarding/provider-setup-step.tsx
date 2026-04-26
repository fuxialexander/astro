/**
 * ProviderSetupStep — onboarding step 2.
 *
 * Detects which AI provider CLIs (Claude Code, Codex, pi, OpenClaw) are
 * installed on the local machine and lets the user sign in or supply an
 * API key for each. Skip is always available.
 */

import { useCallback, useEffect, useState } from "react"
import { ArrowRight, Check, AlertCircle, ExternalLink } from "lucide-react"
import {
  desktopBridge,
  type ProviderId,
  type ProviderInfo,
} from "@/lib/desktop-bridge"

interface Props {
  onComplete: () => void
  onSkip: () => void
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; providers: ProviderInfo[] }
  | { kind: "error"; message: string }

export function ProviderSetupStep({ onComplete, onSkip }: Props) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" })
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [showApiKeyFor, setShowApiKeyFor] = useState<ProviderId | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)

  const refreshProvider = useCallback(
    (info: ProviderInfo) => {
      setLoad((prev) => {
        if (prev.kind !== "ready") return prev
        return {
          kind: "ready",
          providers: prev.providers.map((p) => (p.id === info.id ? info : p)),
        }
      })
    },
    [],
  )

  const detect = useCallback(async () => {
    setLoad({ kind: "loading" })
    try {
      const res = await desktopBridge.providers.detect()
      setLoad({ kind: "ready", providers: res.providers })
    } catch (err) {
      setLoad({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [])

  useEffect(() => {
    void detect()
  }, [detect])

  const setBusyFor = (id: string, v: boolean) =>
    setBusy((prev) => ({ ...prev, [id]: v }))

  const handleSignIn = useCallback(async (id: ProviderId) => {
    setBusyFor(`signin:${id}`, true)
    try {
      await desktopBridge.providers.openSignIn(id)
    } catch {
      // ignore
    } finally {
      setBusyFor(`signin:${id}`, false)
    }
  }, [])

  const handleVerify = useCallback(
    async (id: ProviderId) => {
      setBusyFor(`verify:${id}`, true)
      try {
        const info = await desktopBridge.providers.verify(id)
        refreshProvider(info)
      } catch {
        // ignore — the row keeps its previous state
      } finally {
        setBusyFor(`verify:${id}`, false)
      }
    },
    [refreshProvider],
  )

  const handleApiKeySubmit = useCallback(async () => {
    if (!apiKey.trim()) {
      setApiKeyError("Enter an API key.")
      return
    }
    setApiKeyError(null)
    setBusyFor("apiKey", true)
    try {
      await desktopBridge.providers.writeClaudeKey(apiKey.trim())
      const info = await desktopBridge.providers.verify("claude")
      refreshProvider(info)
      setShowApiKeyFor(null)
      setApiKey("")
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyFor("apiKey", false)
    }
  }, [apiKey, refreshProvider])

  const openInstallDocs = useCallback(async (id: ProviderId) => {
    try {
      await desktopBridge.editor.openExternal(
        `https://docs.astroanywhere.com/providers/${id}`,
      )
    } catch {
      // ignore
    }
  }, [])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <div style={ebrowStyle}>Step 2 of 3 · Providers</div>
        <h2 style={headingStyle}>Connect your AI tools.</h2>
        <p style={subtitleStyle}>Sign in to the ones you use, or skip.</p>
      </div>

      {load.kind === "loading" && (
        <div style={mutedRowStyle}>
          <span style={{ opacity: 0.6 }}>Detecting installed providers…</span>
        </div>
      )}

      {load.kind === "error" && (
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
              Couldn't detect providers
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
              {load.message}
            </div>
            <button
              onClick={detect}
              className="as-btn-primary"
              style={primaryBtnStyle}
            >
              Retry
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {load.kind === "ready" && load.providers.every((p) => !p.installed) && (
        <div
          style={{
            padding: "1.25rem",
            borderRadius: 12,
            background: "var(--muted)",
            border: "1px solid var(--border)",
            fontSize: "0.8125rem",
            color: "var(--muted-foreground)",
            lineHeight: 1.55,
            display: "flex",
            alignItems: "flex-start",
            gap: "0.875rem",
          }}
        >
          <div style={{ flex: 1 }}>
            None detected. Install Claude Code, Codex, OpenClaw, or Pi to use this Mac as a runner.
          </div>
          <button
            onClick={detect}
            className="as-btn-ghost"
            style={ghostLinkStyle}
          >
            Refresh
          </button>
        </div>
      )}

      {load.kind === "ready" && load.providers.some((p) => p.installed) && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}
        >
          {load.providers.filter((p) => p.installed).map((p) => {
            const status = !p.installed
              ? "not-installed"
              : p.authed
                ? "ready"
                : "needs-signin"
            return (
              <div key={p.id} style={providerCardStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "1rem",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div
                      style={{
                        fontSize: "0.875rem",
                        fontWeight: 500,
                        color: "var(--foreground)",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {p.label}
                    </div>
                    {p.version && (
                      <div
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "0.6875rem",
                          color: "var(--muted-foreground)",
                          letterSpacing: "0.04em",
                        }}
                      >
                        v{p.version}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.625rem",
                    }}
                  >
                    {status === "ready" && <StatusPill kind="ready" />}
                    {status === "needs-signin" && (
                      <StatusPill kind="needs-signin" />
                    )}
                    {status === "not-installed" && (
                      <StatusPill kind="not-installed" />
                    )}
                  </div>
                </div>

                {status === "needs-signin" && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginTop: "0.875rem",
                    }}
                  >
                    <button
                      onClick={() => void handleSignIn(p.id)}
                      disabled={busy[`signin:${p.id}`]}
                      className="as-btn-primary"
                      style={primaryBtnStyle}
                    >
                      Sign in
                      <ExternalLink size={12} />
                    </button>
                    <button
                      onClick={() => void handleVerify(p.id)}
                      disabled={busy[`verify:${p.id}`]}
                      className="as-btn-ghost"
                      style={secondaryBtnStyle}
                    >
                      {busy[`verify:${p.id}`] ? "Verifying…" : "I've signed in — verify"}
                    </button>
                    {p.id === "claude" && (
                      <button
                        onClick={() =>
                          setShowApiKeyFor((prev) =>
                            prev === "claude" ? null : "claude",
                          )
                        }
                        className="as-btn-ghost"
                        style={ghostLinkStyle}
                      >
                        {showApiKeyFor === "claude"
                          ? "Cancel"
                          : "Use API key instead"}
                      </button>
                    )}
                  </div>
                )}

                {status === "needs-signin" &&
                  p.id === "claude" &&
                  showApiKeyFor === "claude" && (
                    <div
                      style={{
                        marginTop: "0.75rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-ant-…"
                        style={inputStyle}
                      />
                      {apiKeyError && (
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#ff6b6b",
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {apiKeyError}
                        </div>
                      )}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <button
                          onClick={() => void handleApiKeySubmit()}
                          disabled={busy.apiKey}
                          className="as-btn-primary"
                          style={primaryBtnStyle}
                        >
                          {busy.apiKey ? "Saving…" : "Save key"}
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    </div>
                  )}

                {status === "not-installed" && (
                  <div style={{ marginTop: "0.875rem" }}>
                    <button
                      onClick={() => void openInstallDocs(p.id)}
                      className="as-btn-ghost"
                      style={ghostLinkStyle}
                    >
                      <ExternalLink size={12} />
                      Install instructions
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={footerStyle}>
        <button onClick={onSkip} className="as-btn-ghost" style={skipBtnStyle}>
          Skip — set up later
        </button>
        <button
          onClick={onComplete}
          className="as-btn-primary"
          style={primaryBtnStyle}
        >
          Continue
          <ArrowRight size={13} />
        </button>
      </div>
    </div>
  )
}

function StatusPill({
  kind,
}: {
  kind: "ready" | "needs-signin" | "not-installed"
}) {
  const config: Record<typeof kind, { label: string; bg: string; fg: string }> =
    {
      ready: {
        label: "Ready",
        bg: "rgba(93,211,158,0.13)",
        fg: "#5dd39e",
      },
      "needs-signin": {
        label: "Needs sign-in",
        bg: "rgba(245,180,90,0.13)",
        fg: "#e6a447",
      },
      "not-installed": {
        label: "Not installed",
        bg: "var(--muted)",
        fg: "var(--muted-foreground)",
      },
    }
  const c = config[kind]
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.625rem",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "0.25rem 0.5rem",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
      }}
    >
      {kind === "ready" && <Check size={10} />}
      {c.label}
    </span>
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

const secondaryBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.45rem",
  padding: "0.5rem 0.875rem",
  borderRadius: 9,
  background: "transparent",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  cursor: "pointer",
  fontSize: "0.8125rem",
  fontWeight: 400,
  letterSpacing: "-0.01em",
  transition: "background 0.15s",
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

const providerCardStyle: React.CSSProperties = {
  padding: "1rem 1.125rem",
  borderRadius: 12,
  background: "var(--card)",
  border: "1px solid var(--border)",
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

const inputStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: "0.8125rem",
  padding: "0.5rem 0.75rem",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--background)",
  color: "var(--foreground)",
  outline: "none",
  width: "100%",
  maxWidth: 360,
}

const footerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  paddingTop: "0.5rem",
}

const skipBtnStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid var(--border)",
  cursor: "pointer",
  color: "var(--muted-foreground)",
  padding: "0.5rem 0.875rem",
  borderRadius: 9,
  fontSize: "0.8125rem",
  transition: "background 0.15s",
}
