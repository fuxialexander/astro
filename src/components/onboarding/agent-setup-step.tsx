/**
 * AgentSetupStep — desktop-only onboarding step that installs the
 * astro-agent and astro-cli binaries, then runs `astro-agent setup`
 * inside an embedded terminal so the user completes authentication
 * (device auth, Claude OAuth) without leaving the app.
 *
 * Lifecycle:
 *   checking   → call agent:setup-status
 *   installing → call agent:setup (copy bundles to ~/.astro/bin)
 *   ready      → show TerminalTab with `astro-agent setup` pre-fed
 *   done       → user clicked "Continue" or setup already complete
 *   error      → binaries not built yet (dev without build:binaries)
 *
 * Shows only in the desktop app and only once (localStorage flag).
 * If the agent is already installed the step is skipped entirely.
 */

import { useEffect, useState, useCallback } from "react"
import { Terminal, ChevronRight, X, CheckCircle2, AlertCircle } from "lucide-react"
import { TerminalTab } from "@/components/desktop/TerminalTab"
import { isDesktop } from "@/lib/desktop-detect"
import { desktopBridge } from "@/lib/desktop-bridge"

const STORAGE_KEY = "astro-agent-setup-v1"

type Phase =
  | { type: "checking" }
  | { type: "installing" }
  | { type: "ready"; binDir: string }
  | { type: "done" }
  | { type: "error"; message: string }

export function AgentSetupStep() {
  const [phase, setPhase] = useState<Phase>({ type: "checking" })
  // Compute initial visibility synchronously so we never flicker or set state in an effect.
  const [visible] = useState(
    () => isDesktop() && localStorage.getItem(STORAGE_KEY) !== "true"
  )

  useEffect(() => {
    if (!visible) return

    void (async () => {
      try {
        const status = await desktopBridge.agent.setupStatus()
        if (status.installed) {
          // Binaries already in ~/.astro/bin — skip straight through
          localStorage.setItem(STORAGE_KEY, "true")
          setPhase({ type: "done" })
          return
        }
      } catch {
        // status check failed — proceed to install anyway
      }

      setPhase({ type: "installing" })
      try {
        const result = await desktopBridge.agent.setup()
        setPhase({ type: "ready", binDir: result.binDir })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Likely running in dev before build:binaries — show a helpful error
        setPhase({
          type: "error",
          message: msg.includes("not found")
            ? "Bundled binaries not built yet. Run `npm run build:binaries` first."
            : msg,
        })
      }
    })()
  }, [visible])

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true")
    setPhase({ type: "done" })
  }, [])

  if (!visible || phase.type === "done") return null

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9997,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        padding: "1.5rem",
        animation: "agent-setup-fade 0.4s ease forwards",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400&family=JetBrains+Mono:wght@400;500&display=swap');
        @keyframes agent-setup-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes agent-setup-up   { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none } }
        .as-btn-ghost:hover { background: var(--muted) !important; }
        .as-btn-primary:hover { opacity: 0.82 !important; }
      `}</style>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          width: "100%",
          maxWidth: 760,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "agent-setup-up 0.45s ease forwards",
          position: "relative",
        }}
      >
        {/* Skip button */}
        <button
          onClick={dismiss}
          className="as-btn-ghost"
          style={{
            position: "absolute",
            top: "1rem",
            right: "1rem",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--muted-foreground)",
            padding: "0.3rem",
            borderRadius: 7,
            display: "flex",
            alignItems: "center",
            zIndex: 1,
            transition: "background 0.15s",
          }}
        >
          <X size={15} />
        </button>

        {/* Header */}
        <div style={{ padding: "2rem 2.5rem 1.5rem" }}>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.5625rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--muted-foreground)",
              marginBottom: "0.625rem",
            }}
          >
            Setup · Agent runner
          </div>
          <h2
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: "clamp(1.75rem, 3.5vw, 2.25rem)",
              fontWeight: 300,
              letterSpacing: "0.02em",
              lineHeight: 1.1,
              color: "var(--foreground)",
              marginBottom: "0.625rem",
            }}
          >
            Connect your local machine.
          </h2>
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--muted-foreground)",
              fontWeight: 300,
              lineHeight: 1.65,
              maxWidth: 520,
              margin: 0,
            }}
          >
            The agent runner executes AI tasks on your machine. Complete the setup
            below — it authenticates your device and configures Claude Code access.
            Takes about a minute.
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: "0 2.5rem 2rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>

          {/* Preparing / error states */}
          {(phase.type === "checking" || phase.type === "installing") && (
            <div
              style={{
                height: 80,
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                color: "var(--muted-foreground)",
                fontSize: "0.8125rem",
              }}
            >
              <span style={{ opacity: 0.5 }}>
                {phase.type === "checking" ? "Checking…" : "Installing agent binaries…"}
              </span>
            </div>
          )}

          {phase.type === "error" && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.75rem",
                padding: "1rem 1.25rem",
                borderRadius: 12,
                background: "rgba(255,80,80,0.07)",
                border: "1px solid rgba(255,80,80,0.18)",
              }}
            >
              <AlertCircle size={16} style={{ color: "#ff6b6b", marginTop: 1, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--foreground)", marginBottom: "0.25rem" }}>
                  Binary install failed
                </div>
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.75rem",
                    color: "var(--muted-foreground)",
                    lineHeight: 1.5,
                  }}
                >
                  {phase.message}
                </div>
              </div>
            </div>
          )}

          {/* Terminal */}
          {phase.type === "ready" && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem 0.875rem",
                  borderRadius: "8px 8px 0 0",
                  background: "var(--muted)",
                  border: "1px solid var(--border)",
                  borderBottom: "none",
                }}
              >
                <Terminal size={12} style={{ color: "var(--muted-foreground)" }} />
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.625rem",
                    letterSpacing: "0.1em",
                    color: "var(--muted-foreground)",
                  }}
                >
                  astro-agent setup
                </span>
              </div>
              <div
                style={{
                  height: 380,
                  borderRadius: "0 0 10px 10px",
                  border: "1px solid var(--border)",
                  overflow: "hidden",
                  background: "var(--background)",
                }}
              >
                <TerminalTab
                  cwd={phase.binDir}
                  active={true}
                  initialInput="astro-agent setup\n"
                />
              </div>
            </>
          )}

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: "0.25rem",
            }}
          >
            <button
              onClick={dismiss}
              className="as-btn-ghost"
              style={{
                background: "none",
                border: "1px solid var(--border)",
                cursor: "pointer",
                color: "var(--muted-foreground)",
                padding: "0.5rem 0.875rem",
                borderRadius: 9,
                fontSize: "0.8125rem",
                transition: "background 0.15s",
              }}
            >
              Skip for now
            </button>

            {phase.type === "ready" && (
              <button
                onClick={dismiss}
                className="as-btn-primary"
                style={{
                  display: "flex",
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
                }}
              >
                <CheckCircle2 size={13} />
                Done, continue
                <ChevronRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
