/**
 * AgentSetupStep — desktop-only onboarding wizard.
 *
 * Mounted once from `src/components/layout/app-layout.tsx`. Shown only on
 * desktop and only when the localStorage flag `astro-agent-setup-v1` has
 * not been set.
 *
 * Lifecycle:
 *   preparing  → check `agent:setup-status`; install bundled binaries via
 *                `agent:setup` if needed (writes ~/.astro/bin/{astro-agent,astro-cli}).
 *                Errors here render an actionable red card.
 *   connect    → ConnectThisMacStep (device-auth flow + start local agent)
 *   providers  → ProviderSetupStep (Claude/Codex/pi/OpenClaw detect + sign in)
 *   ssh        → SshHostPickerStep (~/.ssh/config picker + install/register)
 *   done       → set localStorage flag and unmount
 *
 * Skip from any step writes the localStorage flag and dismisses immediately.
 */

import { useCallback, useEffect, useState } from "react"
import { X, AlertCircle } from "lucide-react"
import { isDesktop } from "@/lib/desktop-detect"
import { desktopBridge } from "@/lib/desktop-bridge"
import { ConnectThisMacStep } from "./connect-this-mac-step"
import { ProviderSetupStep } from "./provider-setup-step"
import { SshHostPickerStep } from "./ssh-host-picker-step"

const STORAGE_KEY = "astro-agent-setup-v1"

type Step =
  | { type: "preparing" }
  | { type: "preparing-error"; message: string }
  | { type: "connect" }
  | { type: "providers" }
  | { type: "ssh" }
  | { type: "done" }

export function AgentSetupStep() {
  const [step, setStep] = useState<Step>({ type: "preparing" })
  const [visible] = useState(
    () => isDesktop() && localStorage.getItem(STORAGE_KEY) !== "true",
  )

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true")
    setStep({ type: "done" })
  }, [])

  const runPreparing = useCallback(async () => {
    setStep({ type: "preparing" })

    // 1. Install bundled binaries to ~/.astro/bin if needed.
    try {
      const status = await desktopBridge.agent.setupStatus()
      if (!status.installed) {
        await desktopBridge.agent.setup()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setStep({
        type: "preparing-error",
        message: msg.includes("not found")
          ? "Bundled binaries not built yet. Run `npm run build:binaries` first."
          : msg,
      })
      return
    }

    // 2. If the user is already signed in (config.json has tokens +
    //    setupCompleted), skip the connect step. Also kick off the local
    //    agent in the background — it might not be running if a previous
    //    attempt crashed or if the user reset the modal without quitting
    //    the app.
    try {
      const auth = await desktopBridge.onboarding.authState()
      if (auth.authed) {
        // Fire-and-forget: starting the agent shouldn't block onboarding.
        // The orchestrator is idempotent (re-call returns the existing pid).
        void desktopBridge.localAgent.start().catch(() => {})
        setStep({ type: "providers" })
        return
      }
    } catch {
      // If the auth-state probe fails, fall through to the connect step.
    }

    setStep({ type: "connect" })
  }, [])

  useEffect(() => {
    if (!visible) return
    // Bootstrap the wizard. setState happens inside the async fn — this is
    // an external-system sync (binary install on disk), so the
    // set-state-in-effect rule doesn't apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runPreparing()
  }, [visible, runPreparing])

  if (!visible || step.type === "done") return null

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
        .as-btn-primary:disabled, .as-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          width: "100%",
          maxWidth: 760,
          maxHeight: "calc(100vh - 3rem)",
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
          aria-label="Skip onboarding"
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

        <div
          style={{
            padding: "2rem 2.5rem",
            overflowY: "auto",
          }}
        >
          {step.type === "preparing" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.5625rem",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--muted-foreground)",
                }}
              >
                Setup · Preparing
              </div>
              <h2
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: "clamp(1.75rem, 3.5vw, 2.25rem)",
                  fontWeight: 300,
                  letterSpacing: "0.02em",
                  lineHeight: 1.1,
                  color: "var(--foreground)",
                  margin: 0,
                }}
              >
                Installing agent binaries…
              </h2>
              <p
                style={{
                  fontSize: "0.875rem",
                  color: "var(--muted-foreground)",
                  fontWeight: 300,
                  lineHeight: 1.65,
                  margin: 0,
                  maxWidth: 520,
                }}
              >
                Copying astro-agent and astro-cli to ~/.astro/bin. This is a
                one-time step.
              </p>
            </div>
          )}

          {step.type === "preparing-error" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.5625rem",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--muted-foreground)",
                }}
              >
                Setup · Preparing
              </div>
              <h2
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: "clamp(1.75rem, 3.5vw, 2.25rem)",
                  fontWeight: 300,
                  letterSpacing: "0.02em",
                  lineHeight: 1.1,
                  color: "var(--foreground)",
                  margin: 0,
                }}
              >
                Couldn't install agent binaries.
              </h2>
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
                <AlertCircle
                  size={16}
                  style={{
                    color: "#ff6b6b",
                    marginTop: 1,
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 500,
                      color: "var(--foreground)",
                      marginBottom: "0.25rem",
                    }}
                  >
                    Binary install failed
                  </div>
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.75rem",
                      color: "var(--muted-foreground)",
                      lineHeight: 1.5,
                    }}
                  >
                    {step.message}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.625rem" }}>
                <button
                  onClick={() => void runPreparing()}
                  className="as-btn-primary"
                  style={{
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
                  }}
                >
                  Retry
                </button>
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
              </div>
            </div>
          )}

          {step.type === "connect" && (
            <ConnectThisMacStep
              onComplete={() => setStep({ type: "providers" })}
              onSkip={dismiss}
            />
          )}

          {step.type === "providers" && (
            <ProviderSetupStep
              onComplete={() => setStep({ type: "ssh" })}
              onSkip={dismiss}
            />
          )}

          {step.type === "ssh" && (
            <SshHostPickerStep onComplete={dismiss} onSkip={dismiss} />
          )}
        </div>
      </div>
    </div>
  )
}
