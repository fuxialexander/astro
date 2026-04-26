/**
 * SshHostPickerStep — onboarding step 3.
 *
 * Discovers entries from the user's ~/.ssh/config, lets the user select
 * which to register as Astro runners, tests reachability, and offers
 * inline guidance to fix auth issues (key generation + ssh-copy-id or
 * manual instructions).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowRight,
  Check,
  AlertCircle,
  Copy,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
} from "lucide-react"
import { desktopBridge, type SSHHost } from "@/lib/desktop-bridge"

interface Props {
  onComplete: () => void
  onSkip: () => void
}

type RowState =
  | "idle"
  | "testing"
  | "reachable"
  | "needs-manual"
  | "installing"
  | "failed"
  | "connected"

interface RowMeta {
  state: RowState
  message?: string
  expanded: boolean
  generatedKeyPath?: string
  copyMethod?: "ssh-copy-id" | "manual"
  copyInstructions?: string | null
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; hosts: SSHHost[] }
  | { kind: "empty" }
  | { kind: "error"; message: string }

export function SshHostPickerStep({ onComplete, onSkip }: Props) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" })
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [rows, setRows] = useState<Record<string, RowMeta>>({})
  const [registering, setRegistering] = useState(false)
  const [kickedOff, setKickedOff] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  const updateRow = useCallback((alias: string, patch: Partial<RowMeta>) => {
    setRows((prev) => {
      const cur: RowMeta = prev[alias] ?? { state: "idle", expanded: false }
      return { ...prev, [alias]: { ...cur, ...patch } }
    })
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const res = await desktopBridge.ssh.discoverHosts()
        if (!res.hosts.length) {
          setLoad({ kind: "empty" })
        } else {
          setLoad({ kind: "ready", hosts: res.hosts })
        }
      } catch (err) {
        setLoad({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })()
    return () => {
      if (unsubRef.current) {
        unsubRef.current()
        unsubRef.current = null
      }
    }
  }, [])

  const toggleSelected = (alias: string) =>
    setSelected((prev) => ({ ...prev, [alias]: !prev[alias] }))

  const toggleExpanded = (alias: string) =>
    updateRow(alias, {
      expanded: !(rows[alias]?.expanded ?? false),
    })

  const testHost = useCallback(
    async (alias: string) => {
      updateRow(alias, { state: "testing", message: undefined })
      try {
        const res = await desktopBridge.ssh.testHost(alias)
        if (res.reachable) {
          updateRow(alias, { state: "reachable", message: undefined })
        } else if (res.needsAuth) {
          updateRow(alias, {
            state: "needs-manual",
            message: res.error ?? "Host requires authentication.",
            expanded: true,
          })
        } else {
          updateRow(alias, {
            state: "failed",
            message: res.error ?? "Host unreachable.",
          })
        }
      } catch (err) {
        updateRow(alias, {
          state: "failed",
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [updateRow],
  )

  const generateKey = useCallback(
    async (alias: string) => {
      try {
        const res = await desktopBridge.ssh.generateKey()
        updateRow(alias, { generatedKeyPath: res.publicKeyPath })
      } catch (err) {
        updateRow(alias, {
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [updateRow],
  )

  const copyKey = useCallback(
    async (alias: string) => {
      try {
        const res = await desktopBridge.ssh.copyKey(alias)
        updateRow(alias, {
          copyMethod: res.method,
          copyInstructions: res.instructions,
          message: res.error ?? undefined,
        })
      } catch (err) {
        updateRow(alias, {
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [updateRow],
  )

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore — selection is fallback
    }
  }, [])

  const connectSelected = useCallback(async () => {
    if (load.kind !== "ready") return
    const aliases = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k)
    if (aliases.length === 0) {
      onComplete()
      return
    }
    setRegistering(true)

    // Phase 1: test each
    const reachable: string[] = []
    for (const alias of aliases) {
      updateRow(alias, { state: "testing", message: undefined })
      try {
        const res = await desktopBridge.ssh.testHost(alias)
        if (res.reachable) {
          updateRow(alias, { state: "reachable" })
          reachable.push(alias)
        } else if (res.needsAuth) {
          updateRow(alias, {
            state: "needs-manual",
            message: res.error ?? "Needs authentication.",
            expanded: true,
          })
        } else {
          updateRow(alias, {
            state: "failed",
            message: res.error ?? "Host unreachable.",
          })
        }
      } catch (err) {
        updateRow(alias, {
          state: "failed",
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    if (reachable.length === 0) {
      setRegistering(false)
      return
    }

    // Phase 2: subscribe to progress events and call install
    if (unsubRef.current) {
      unsubRef.current()
      unsubRef.current = null
    }
    unsubRef.current = desktopBridge.onboarding.onHostProgress((evt) => {
      const stateMap: Record<typeof evt.state, RowState> = {
        testing: "testing",
        installing: "installing",
        registering: "installing",
        starting: "installing",
        connected: "connected",
        failed: "failed",
        "needs-manual": "needs-manual",
      }
      updateRow(evt.alias, {
        state: stateMap[evt.state],
        message: evt.message,
        expanded:
          evt.state === "needs-manual"
            ? true
            : (rows[evt.alias]?.expanded ?? false),
      })
    })

    try {
      await desktopBridge.ssh.installAndRegister(reachable)
      // Install runs fire-and-forget on the main process. The user can leave
      // the wizard now — progress continues to land in the registered_machines
      // table and shows up in the Environments view later.
      setKickedOff(true)
    } catch (err) {
      for (const alias of reachable) {
        updateRow(alias, {
          state: "failed",
          message: err instanceof Error ? err.message : String(err),
        })
      }
    } finally {
      setRegistering(false)
    }
  }, [load, selected, onComplete, rows, updateRow])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <div style={ebrowStyle}>Step 3 of 3 · Remote machines</div>
        <h2 style={headingStyle}>Connect remote machines.</h2>
        <p style={subtitleStyle}>Pick remote machines to connect.</p>
      </div>

      {load.kind === "loading" && (
        <div style={mutedRowStyle}>
          <span style={{ opacity: 0.6 }}>Reading ~/.ssh/config…</span>
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
              Couldn't read SSH config
            </div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.75rem",
                color: "var(--muted-foreground)",
                lineHeight: 1.5,
              }}
            >
              {load.message}
            </div>
          </div>
        </div>
      )}

      {load.kind === "empty" && (
        <div
          style={{
            padding: "1.25rem",
            borderRadius: 12,
            background: "var(--muted)",
            border: "1px solid var(--border)",
            fontSize: "0.8125rem",
            color: "var(--muted-foreground)",
            lineHeight: 1.55,
          }}
        >
          No remote machines found in ~/.ssh/config. You can add them later in
          Settings.
        </div>
      )}

      {load.kind === "ready" && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          {load.hosts.map((host) => {
            const meta = rows[host.alias] ?? {
              state: "idle" as const,
              expanded: false,
            }
            const isSelected = !!selected[host.alias]
            return (
              <div key={host.alias} style={hostCardStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelected(host.alias)}
                    style={{ cursor: "pointer", flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "0.8125rem",
                        color: "var(--foreground)",
                        fontWeight: 500,
                      }}
                    >
                      {host.alias}
                    </div>
                    <div
                      style={{
                        fontSize: "0.6875rem",
                        color: "var(--muted-foreground)",
                        fontFamily: "'JetBrains Mono', monospace",
                        marginTop: 2,
                      }}
                    >
                      {host.user ? `${host.user}@` : ""}
                      {host.hostname}:{host.port}
                    </div>
                  </div>

                  <RowStatus state={meta.state} />

                  <button
                    onClick={() => void testHost(host.alias)}
                    className="as-btn-ghost"
                    disabled={meta.state === "testing"}
                    style={{
                      ...ghostLinkStyle,
                      padding: "0.25rem 0.5rem",
                    }}
                  >
                    {meta.state === "testing" ? "Testing…" : "Test"}
                  </button>
                </div>

                {meta.message && meta.state !== "needs-manual" && (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color:
                        meta.state === "failed"
                          ? "#ff6b6b"
                          : "var(--muted-foreground)",
                      fontFamily: "'JetBrains Mono', monospace",
                      marginTop: "0.5rem",
                      paddingLeft: "1.65rem",
                    }}
                  >
                    {meta.message}
                  </div>
                )}

                {meta.state === "needs-manual" && (
                  <div style={{ marginTop: "0.5rem", paddingLeft: "1.65rem" }}>
                    <button
                      onClick={() => toggleExpanded(host.alias)}
                      className="as-btn-ghost"
                      style={{
                        ...ghostLinkStyle,
                        color: "var(--foreground)",
                      }}
                    >
                      {meta.expanded ? (
                        <ChevronDown size={12} />
                      ) : (
                        <ChevronRightIcon size={12} />
                      )}
                      Fix this
                    </button>
                    {meta.expanded && (
                      <FixThisDisclosure
                        alias={host.alias}
                        meta={meta}
                        onGenerate={() => void generateKey(host.alias)}
                        onCopy={() => void copyKey(host.alias)}
                        onRetry={() => void testHost(host.alias)}
                        onCopyText={(t) => void copyToClipboard(t)}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={footerStyle}>
        <button onClick={onSkip} className="as-btn-ghost" style={skipBtnStyle}>
          Skip
        </button>
        {load.kind === "ready" &&
        !kickedOff &&
        Object.values(selected).some(Boolean) ? (
          <button
            onClick={() => void connectSelected()}
            className="as-btn-primary"
            disabled={registering}
            style={primaryBtnStyle}
          >
            {registering ? "Connecting…" : "Connect selected"}
            {!registering && <ArrowRight size={13} />}
          </button>
        ) : (
          <button
            onClick={onComplete}
            className="as-btn-primary"
            style={primaryBtnStyle}
          >
            Done
            <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

function RowStatus({ state }: { state: RowState }) {
  if (state === "idle" || state === "testing") return null
  const config: Record<
    Exclude<RowState, "idle" | "testing">,
    { label: string; bg: string; fg: string; icon?: "check" | "x" }
  > = {
    reachable: {
      label: "Reachable",
      bg: "rgba(93,211,158,0.13)",
      fg: "#5dd39e",
      icon: "check",
    },
    "needs-manual": {
      label: "Needs auth",
      bg: "rgba(245,180,90,0.13)",
      fg: "#e6a447",
    },
    installing: {
      label: "Installing",
      bg: "rgba(120,140,255,0.13)",
      fg: "#7d8cff",
    },
    failed: {
      label: "Failed",
      bg: "rgba(255,107,107,0.13)",
      fg: "#ff6b6b",
      icon: "x",
    },
    connected: {
      label: "Connected",
      bg: "rgba(93,211,158,0.13)",
      fg: "#5dd39e",
      icon: "check",
    },
  }
  const c = config[state]
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.5625rem",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "0.2rem 0.45rem",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
      }}
    >
      {c.icon === "check" && <Check size={9} />}
      {c.label}
    </span>
  )
}

function FixThisDisclosure({
  alias,
  meta,
  onGenerate,
  onCopy,
  onRetry,
  onCopyText,
}: {
  alias: string
  meta: RowMeta
  onGenerate: () => void
  onCopy: () => void
  onRetry: () => void
  onCopyText: (text: string) => void
}) {
  return (
    <div
      style={{
        marginTop: "0.5rem",
        padding: "0.875rem",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--muted)",
        display: "flex",
        flexDirection: "column",
        gap: "0.875rem",
      }}
    >
      <FixStep
        n={1}
        label="Generate SSH key (if needed)"
        action={
          <button
            onClick={onGenerate}
            className="as-btn-ghost"
            style={secondaryBtnStyle}
          >
            Generate
          </button>
        }
        note={
          meta.generatedKeyPath
            ? `Key generated at ${meta.generatedKeyPath}`
            : null
        }
      />
      <FixStep
        n={2}
        label={`Copy key to ${alias}`}
        action={
          <button
            onClick={onCopy}
            className="as-btn-ghost"
            style={secondaryBtnStyle}
          >
            Copy automatically
          </button>
        }
        note={null}
      />
      {meta.copyMethod === "manual" && meta.copyInstructions && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          <pre
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.75rem",
              color: "var(--foreground)",
              background: "var(--background)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "0.625rem 0.75rem",
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              lineHeight: 1.5,
            }}
          >
            {meta.copyInstructions}
          </pre>
          <button
            onClick={() => onCopyText(meta.copyInstructions ?? "")}
            className="as-btn-ghost"
            style={{ ...secondaryBtnStyle, alignSelf: "flex-start" }}
          >
            <Copy size={11} />
            Copy command
          </button>
        </div>
      )}
      <FixStep
        n={3}
        label="Retry the connection"
        action={
          <button
            onClick={onRetry}
            className="as-btn-primary"
            style={primaryBtnStyle}
          >
            Retry
            <ArrowRight size={13} />
          </button>
        }
        note={meta.message ?? null}
      />
    </div>
  )
}

function FixStep({
  n,
  label,
  action,
  note,
}: {
  n: number
  label: string
  action: React.ReactNode
  note: string | null
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          background: "var(--card)",
          border: "1px solid var(--border)",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.6875rem",
          color: "var(--muted-foreground)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {n}
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div
          style={{ fontSize: "0.8125rem", color: "var(--foreground)" }}
        >
          {label}
        </div>
        {note && (
          <div
            style={{
              fontSize: "0.6875rem",
              color: "var(--muted-foreground)",
              fontFamily: "'JetBrains Mono', monospace",
              marginTop: 2,
            }}
          >
            {note}
          </div>
        )}
      </div>
      {action}
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

const secondaryBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.4rem",
  padding: "0.45rem 0.75rem",
  borderRadius: 9,
  background: "transparent",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  cursor: "pointer",
  fontSize: "0.75rem",
  fontWeight: 400,
  transition: "background 0.15s",
}

const ghostLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.35rem",
  background: "none",
  border: "none",
  padding: "0.25rem 0.5rem",
  color: "var(--muted-foreground)",
  cursor: "pointer",
  fontSize: "0.75rem",
  fontFamily: "'JetBrains Mono', monospace",
  letterSpacing: "0.04em",
}

const mutedRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  color: "var(--muted-foreground)",
  fontSize: "0.8125rem",
  height: 40,
}

const hostCardStyle: React.CSSProperties = {
  padding: "0.875rem 1rem",
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
