import { useEffect, useState, useCallback, useRef } from "react"
import {
  Inbox,
  Activity,
  Folder,
  FlaskConical,
  Server,
  BookOpen,
  MessageSquare,
  GitBranch,
  Microscope,
  X,
  ChevronRight,
  ChevronLeft,
  Search,
  ArrowDown,
} from "lucide-react"

const ONBOARDING_KEY = "astro-onboarding-v3"
// Mark old tours as done so they never auto-trigger
const LEGACY_KEYS = ["astro-tour-completed-v2", "astro-inbox-tour-v1"]

// ─── Sidebar items in sidebar display order ───────────────────────────────────

const SIDEBAR_ITEMS = [
  {
    icon: Inbox,
    label: "Dashboard",
    desc: "Your home — activity, pending approvals, and a summary of everything in flight",
    accent: "#5b7fa0",
  },
  {
    icon: Activity,
    label: "Active Jobs",
    desc: "Live feed of every AI task currently running — watch output, follow up anytime",
    accent: "#a07b5b",
  },
  {
    icon: Folder,
    label: "Projects",
    desc: "Goals broken into runnable tasks — AI handles the breakdown, you handle decisions",
    accent: "#7b9b7d",
  },
  {
    icon: FlaskConical,
    label: "Sessions",
    desc: "Fire off a quick AI task without creating a project first",
    accent: "#8b7bad",
  },
  {
    icon: BookOpen,
    label: "References",
    desc: "Papers, docs, and links that get injected into every AI session as context",
    accent: "#b07b8b",
  },
  {
    icon: Server,
    label: "Environments",
    desc: "Connect the machines where your agents execute — laptop, HPC, or cloud",
    accent: "#7b97ad",
  },
]

// ─── Mode definitions (user-facing analogies, no jargon) ─────────────────────

const MODES = [
  {
    id: "session",
    icon: MessageSquare,
    name: "Session",
    tagline: "Like Claude Code or Codex",
    description: "A chat with an AI agent. Describe the task, pick where to run it, watch it work. Follow up as many times as you want.",
    good: ["One-off tasks", "Exploring a codebase", "Prototyping"],
    accent: "#5ba3d0",
    rgb: "91, 163, 208",
  },
  {
    id: "worktree",
    icon: GitBranch,
    name: "Work Tree",
    tagline: "Parallel, isolated branches",
    description: "Work on independent parts of the same project simultaneously. Each part runs in isolation — no conflicts. You review and merge when done.",
    good: ["Multiple features at once", "Large refactors", "Anything ending in a PR"],
    accent: "#d4a574",
    rgb: "212, 165, 116",
  },
  {
    id: "discovery",
    icon: Microscope,
    name: "Discovery",
    tagline: "Separate folders, always parallel",
    description: "Every task gets its own folder. Outputs never mix. Tasks run in parallel. Best for analysis and research — not iterative coding.",
    good: ["Data analysis", "Running many variations", "Research & reports"],
    accent: "#6ec07a",
    rgb: "110, 192, 122",
  },
]

// ─── CSS Keyframes ────────────────────────────────────────────────────────────

const KEYFRAMES = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=JetBrains+Mono:wght@400;500&display=swap');

  @keyframes ob-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes ob-fade-out {
    from { opacity: 1; }
    to   { opacity: 0; }
  }
  @keyframes ob-slide-up {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes ob-item-in {
    from { opacity: 0; transform: translateY(5px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes ob-chip-in {
    from { opacity: 0; transform: translateY(8px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes ob-bounce-arrow {
    0%, 100% { transform: translateY(0); }
    50%       { transform: translateY(4px); }
  }
  .ob-item-hover:hover {
    background: var(--muted) !important;
    border-color: var(--border) !important;
  }
  .ob-btn-primary:hover { opacity: 0.82 !important; }
  .ob-btn-ghost:hover { background: var(--muted) !important; }
  .ob-mode-card:hover {
    border-color: var(--ob-card-accent, rgba(255,255,255,0.2)) !important;
  }
  .ob-dot:hover { opacity: 0.8 !important; }
`

// ─── Shared primitives ────────────────────────────────────────────────────────

function CloseBtn({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      onClick={onDismiss}
      className="ob-btn-ghost"
      style={{
        position: "absolute",
        top: "1.125rem",
        right: "1.125rem",
        background: "none",
        border: "none",
        cursor: "pointer",
        color: "var(--muted-foreground)",
        padding: "0.3rem",
        borderRadius: "7px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.15s",
      }}
    >
      <X size={15} />
    </button>
  )
}

function PageLabel({ label }: { label: string }) {
  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.5625rem",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--muted-foreground)",
        marginBottom: "0.75rem",
      }}
    >
      {label}
    </div>
  )
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "'Cormorant Garamond', serif",
        fontSize: "clamp(1.875rem, 4vw, 2.5rem)",
        fontWeight: 300,
        letterSpacing: "0.02em",
        lineHeight: 1.08,
        color: "var(--foreground)",
        marginBottom: "0.5rem",
      }}
    >
      {children}
    </h2>
  )
}

// ─── Page 0: App Map ──────────────────────────────────────────────────────────

function AppMapPage({ onNext, onDismiss }: { onNext: () => void; onDismiss: () => void }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "20px",
        padding: "2.25rem 2.5rem 2rem",
        width: "100%",
        maxWidth: 680,
        position: "relative",
        animation: "ob-slide-up 0.45s ease forwards",
      }}
    >
      <CloseBtn onDismiss={onDismiss} />

      {/* Header */}
      <div style={{ marginBottom: "1.75rem" }}>
        <PageLabel label="1 of 3 · Your workspace" />
        <CardTitle>
          Your workspace,<br />at a glance.
        </CardTitle>
        <p
          style={{
            fontSize: "0.875rem",
            color: "var(--muted-foreground)",
            fontWeight: 300,
            lineHeight: 1.65,
            maxWidth: 460,
          }}
        >
          Everything lives in the sidebar. Here's what each section does — hover to explore.
        </p>
      </div>

      {/* Sidebar item grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.5rem",
          marginBottom: "1.5rem",
        }}
      >
        {SIDEBAR_ITEMS.map((item, i) => {
          const Icon = item.icon
          return (
            <div
              key={item.label}
              className="ob-item-hover"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.75rem",
                padding: "0.75rem 0.875rem",
                borderRadius: "11px",
                background: "transparent",
                border: "1px solid transparent",
                transition: "background 0.14s ease, border-color 0.14s ease",
                cursor: "default",
                animation: `ob-item-in 0.4s ease forwards ${0.05 + i * 0.06}s`,
                opacity: 0,
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "var(--muted)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon size={13} style={{ color: item.accent }} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                    color: "var(--foreground)",
                    marginBottom: "0.15rem",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--muted-foreground)",
                    lineHeight: 1.55,
                    fontWeight: 300,
                  }}
                >
                  {item.desc}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Search callout */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.625rem 0.875rem",
          borderRadius: "10px",
          background: "var(--muted)",
          border: "1px solid var(--border)",
          marginBottom: "2rem",
          animation: "ob-item-in 0.4s ease forwards 0.42s",
          opacity: 0,
        }}
      >
        <Search size={13} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
        <kbd
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.6875rem",
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            padding: "0.1rem 0.4rem",
            color: "var(--foreground)",
            flexShrink: 0,
          }}
        >
          ⌘K
        </kbd>
        <span
          style={{
            fontSize: "0.8125rem",
            color: "var(--muted-foreground)",
            fontWeight: 300,
            lineHeight: 1.4,
          }}
        >
          Search and navigate anything — projects, tasks, commands — from anywhere
        </span>
      </div>

      {/* Navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          animation: "ob-item-in 0.4s ease forwards 0.5s",
          opacity: 0,
        }}
      >
        <button
          onClick={onNext}
          className="ob-btn-primary"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.45rem",
            padding: "0.5625rem 1.125rem",
            borderRadius: "9px",
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
          Workflow modes
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

// ─── Page 1: Three Modes ──────────────────────────────────────────────────────

function ModeCard({
  mode,
  index,
}: {
  mode: (typeof MODES)[number]
  index: number
}) {
  const [hovered, setHovered] = useState(false)
  const Icon = mode.icon
  const border = hovered
    ? `1px solid rgba(${mode.rgb}, 0.4)`
    : `1px solid var(--border)`
  const bg = hovered ? `rgba(${mode.rgb}, 0.06)` : "var(--card)"

  return (
    <div
      className="ob-mode-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "1.375rem 1.5rem",
        borderRadius: "14px",
        border,
        background: bg,
        transition: "border-color 0.18s ease, background 0.18s ease",
        display: "flex",
        flexDirection: "column",
        gap: "0.875rem",
        animation: `ob-item-in 0.4s ease forwards ${0.08 + index * 0.1}s`,
        opacity: 0,
        position: "relative",
        overflow: "hidden",
        cursor: "default",
      }}
    >
      {/* Top glow bar */}
      {hovered && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "15%",
            right: "15%",
            height: "1px",
            background: `linear-gradient(90deg, transparent, ${mode.accent}, transparent)`,
            opacity: 0.6,
          }}
        />
      )}

      {/* Icon + name */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: `rgba(${mode.rgb}, 0.1)`,
            border: `1px solid rgba(${mode.rgb}, 0.22)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={15} style={{ color: mode.accent }} />
        </div>
        <div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.5625rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: mode.accent,
              marginBottom: "1px",
            }}
          >
            {mode.tagline}
          </div>
          <div
            style={{
              fontSize: "0.9375rem",
              fontWeight: 500,
              color: "var(--foreground)",
              letterSpacing: "-0.01em",
            }}
          >
            {mode.name}
          </div>
        </div>
      </div>

      {/* Description */}
      <p
        style={{
          fontSize: "0.8125rem",
          color: "var(--muted-foreground)",
          lineHeight: 1.65,
          fontWeight: 300,
          margin: 0,
        }}
      >
        {mode.description}
      </p>

      {/* Good for list */}
      <div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.5rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: `rgba(${mode.rgb}, 0.55)`,
            marginBottom: "0.5rem",
          }}
        >
          Great for
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {mode.good.map((g, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
              }}
            >
              <div
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: mode.accent,
                  marginTop: "0.4em",
                  flexShrink: 0,
                  opacity: 0.7,
                }}
              />
              <span
                style={{
                  fontSize: "0.75rem",
                  color: "var(--muted-foreground)",
                  fontWeight: 300,
                  lineHeight: 1.5,
                }}
              >
                {g}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ModesPage({
  onNext,
  onBack,
  onDismiss,
}: {
  onNext: () => void
  onBack: () => void
  onDismiss: () => void
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "20px",
        padding: "2.25rem 2.5rem 2rem",
        width: "100%",
        maxWidth: 920,
        position: "relative",
        animation: "ob-slide-up 0.45s ease forwards",
      }}
    >
      <CloseBtn onDismiss={onDismiss} />

      {/* Header */}
      <div style={{ marginBottom: "1.75rem" }}>
        <PageLabel label="2 of 3 · Workflow modes" />
        <CardTitle>Three ways to work.</CardTitle>
        <p
          style={{
            fontSize: "0.875rem",
            color: "var(--muted-foreground)",
            fontWeight: 300,
            lineHeight: 1.65,
            maxWidth: 500,
          }}
        >
          Same starting point — the compose box on your dashboard. Different execution paths
          depending on what you're trying to do.
        </p>
      </div>

      {/* Mode cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        {MODES.map((mode, i) => (
          <ModeCard key={mode.id} mode={mode} index={i} />
        ))}
      </div>

      {/* Navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          animation: "ob-item-in 0.4s ease forwards 0.4s",
          opacity: 0,
        }}
      >
        <button
          onClick={onBack}
          className="ob-btn-ghost"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: "0.5rem 0.875rem",
            borderRadius: "9px",
            background: "none",
            border: "1px solid var(--border)",
            cursor: "pointer",
            fontSize: "0.8125rem",
            color: "var(--muted-foreground)",
            transition: "background 0.15s",
          }}
        >
          <ChevronLeft size={14} />
          Back
        </button>

        <button
          onClick={onNext}
          className="ob-btn-primary"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.45rem",
            padding: "0.5625rem 1.125rem",
            borderRadius: "9px",
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
          Get started
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

// ─── Page 2: Dashboard Hints ──────────────────────────────────────────────────

interface HintChipData {
  id: string
  text: string
  /**
   * 'down' — chip above element, arrow at bottom pointing down
   * 'left' — chip to the right of element, arrow at left pointing left
   * 'right' — chip to the left of element, arrow at right pointing right (unused currently)
   */
  arrowDir: "down" | "left" | "right"
  /** For 'down' only: where the arrow sits horizontally on the chip */
  alignX?: "left" | "center" | "right"
  x: number
  y: number
  delay: number
}

function HintChip({ chip }: { chip: HintChipData }) {
  // Outer positioning
  let outerStyle: React.CSSProperties
  if (chip.arrowDir === "left") {
    // chip is to the RIGHT — x = element's right edge + gap, vertically centered
    outerStyle = { left: chip.x, top: chip.y, transform: "translateY(-50%)" }
  } else if (chip.arrowDir === "right") {
    // chip is to the LEFT — x = element's left edge - gap, extends leftward
    outerStyle = { left: chip.x, top: chip.y, transform: "translateX(-100%) translateY(-50%)" }
  } else {
    // 'down': chip is ABOVE — x = anchor, y = chip top
    const tx = chip.alignX === "left" ? "0" : chip.alignX === "right" ? "-100%" : "-50%"
    outerStyle = { left: chip.x, top: chip.y, transform: `translateX(${tx})` }
  }

  // Arrow position for down-arrows
  const arrowLeft =
    chip.alignX === "left" ? "12px" : chip.alignX === "right" ? "calc(100% - 17px)" : "50%"

  return (
    <div
      style={{
        position: "absolute",
        ...outerStyle,
        pointerEvents: "none",
        zIndex: 10001,
      }}
    >
      <div
        style={{
          animation: `ob-chip-in 0.4s ease ${chip.delay}s forwards`,
          opacity: 0,
        }}
      >
        <div
          style={{
            background: "var(--foreground)",
            color: "var(--background)",
            borderRadius: "20px",
            padding: "0.375rem 0.875rem",
            fontSize: "0.75rem",
            fontWeight: 500,
            whiteSpace: "nowrap",
            boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
            letterSpacing: "-0.01em",
            position: "relative",
          }}
        >
          {chip.text}
          {/* Arrow — direction-aware */}
          {chip.arrowDir === "down" && (
            <div style={{
              position: "absolute", bottom: -6, left: arrowLeft,
              transform: "translateX(-50%)",
              width: 0, height: 0,
              borderLeft: "5px solid transparent", borderRight: "5px solid transparent",
              borderTop: "6px solid var(--foreground)",
            }} />
          )}
          {chip.arrowDir === "left" && (
            <div style={{
              position: "absolute", left: -6, top: "50%",
              transform: "translateY(-50%)",
              width: 0, height: 0,
              borderTop: "5px solid transparent", borderBottom: "5px solid transparent",
              borderRight: "6px solid var(--foreground)",
            }} />
          )}
          {chip.arrowDir === "right" && (
            <div style={{
              position: "absolute", right: -6, top: "50%",
              transform: "translateY(-50%)",
              width: 0, height: 0,
              borderTop: "5px solid transparent", borderBottom: "5px solid transparent",
              borderLeft: "6px solid var(--foreground)",
            }} />
          )}
        </div>
      </div>
    </div>
  )
}

function DashboardHintsPage({ onDismiss }: { onDismiss: () => void }) {
  const [chips, setChips] = useState<HintChipData[]>([])
  const measured = useRef(false)

  useEffect(() => {
    if (measured.current) return
    measured.current = true

    // Give a frame for the underlying UI to be fully painted
    requestAnimationFrame(() => {
      const found: HintChipData[] = []
      const GAP = 10 // px gap between element edge and chip

      // ── Sidebar items: chip appears to the RIGHT, arrow points LEFT ──────────
      const sidebarItems: Array<{ selector: string; text: string; delay: number }> = [
        { selector: '[data-tour-id="dashboard"]', text: "Your starting point", delay: 0.15 },
        { selector: '[data-tour-id="active"]',    text: "Watch live progress",  delay: 0.28 },
      ]
      sidebarItems.forEach(({ selector, text, delay }) => {
        const el = document.querySelector(selector)
        if (!el) return
        const rect = el.getBoundingClientRect()
        found.push({
          id: selector, text, arrowDir: "left",
          x: rect.right + GAP,
          y: rect.top + rect.height / 2,
          delay,
        })
      })

      // ── Toolbar buttons: chip ABOVE, anchored to opposite edges to avoid overlap ──
      const planEl = document.querySelector('[data-tour-id="plan-mode"]')
      const discEl = document.querySelector('[data-tour-id="discovery-mode"]')
      if (planEl) {
        const r = planEl.getBoundingClientRect()
        found.push({
          id: "plan-mode", text: "Plan mode: AI structures your goal first",
          arrowDir: "down", alignX: "right",
          x: r.left, y: r.top - 52, delay: 0.42,
        })
      }
      if (discEl) {
        const r = discEl.getBoundingClientRect()
        found.push({
          id: "discovery-mode", text: "Discovery mode: separate folders, parallel",
          arrowDir: "down", alignX: "left",
          x: r.right, y: r.top - 52, delay: 0.56,
        })
      }

      // ── Bottom sidebar bar: model-tier above, yolo to the right ─────────────
      const modelEl = document.querySelector('[data-tour-id="model-tier"]')
      const yoloEl  = document.querySelector('[data-tour-id="yolo"]')
      if (modelEl) {
        const r = modelEl.getBoundingClientRect()
        found.push({
          id: "model-tier", text: "Model size — small / medium / large",
          arrowDir: "down", alignX: "center",
          x: r.left + r.width / 2, y: r.top - 48, delay: 0.70,
        })
      }
      if (yoloEl) {
        const r = yoloEl.getBoundingClientRect()
        found.push({
          id: "yolo", text: "YOLO: auto-approve all decisions",
          arrowDir: "left",
          x: r.right + GAP,
          y: r.top + r.height / 2,
          delay: 0.84,
        })
      }

      setChips(found)
    })
  }, [])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />
      {/* Light overlay — click anywhere to dismiss */}
      <div
        onClick={onDismiss}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          background: "rgba(0, 0, 0, 0.28)",
          animation: "ob-fade-in 0.35s ease forwards",
          cursor: "pointer",
        }}
      />

      {/* Floating "ready" card */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 10000,
          pointerEvents: "none",
          animation: "ob-slide-up 0.45s ease forwards",
          textAlign: "center",
        }}
      >
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "16px",
            padding: "2rem 2.75rem",
            display: "inline-block",
          }}
        >
          <div
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: "2rem",
              fontWeight: 300,
              color: "var(--foreground)",
              letterSpacing: "0.02em",
              lineHeight: 1.1,
              marginBottom: "0.5rem",
            }}
          >
            You're all set.
          </div>
          <div
            style={{
              fontSize: "0.8125rem",
              color: "var(--muted-foreground)",
              fontWeight: 300,
              lineHeight: 1.6,
              marginBottom: "1.25rem",
            }}
          >
            Start by typing a goal in the compose box, or explore the sidebar.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
            }}
          >
            <ArrowDown
              size={13}
              style={{
                color: "var(--muted-foreground)",
                animation: "ob-bounce-arrow 1.6s ease-in-out infinite",
              }}
            />
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.5625rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--muted-foreground)",
              }}
            >
              Click anywhere or press ESC to begin
            </span>
            <ArrowDown
              size={13}
              style={{
                color: "var(--muted-foreground)",
                animation: "ob-bounce-arrow 1.6s ease-in-out 0.2s infinite",
              }}
            />
          </div>
        </div>
      </div>

      {/* Positioned hint chips */}
      {chips.map((chip) => (
        <HintChip key={chip.id} chip={chip} />
      ))}
    </>
  )
}

// ─── Dot progress indicator ───────────────────────────────────────────────────

function DotNav({
  total,
  current,
  onSelect,
}: {
  total: number
  current: number
  onSelect: (i: number) => void
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "6px",
        alignItems: "center",
      }}
    >
      {Array.from({ length: total }).map((_, i) => (
        <button
          key={i}
          className="ob-dot"
          onClick={() => onSelect(i)}
          style={{
            all: "unset" as unknown as undefined,
            cursor: "pointer",
            width: i === current ? 18 : 6,
            height: 6,
            borderRadius: 3,
            background:
              i === current ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.2)",
            transition: "width 0.25s ease, background 0.25s ease",
          }}
        />
      ))}
    </div>
  )
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export function OnboardingFlow() {
  const [visible, setVisible] = useState(false)
  const [page, setPage] = useState(0)
  const [transitioning, setTransitioning] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(ONBOARDING_KEY) === "true") return
    const t = setTimeout(() => setVisible(true), 700)
    return () => clearTimeout(t)
  }, [])

  const dismiss = useCallback(() => {
    setVisible(false)
    localStorage.setItem(ONBOARDING_KEY, "true")
    LEGACY_KEYS.forEach((k) => localStorage.setItem(k, "true"))
    // Notify same-window listeners (storage events don't fire in the window
    // that wrote the value). AgentSetupStep waits for this so the two
    // modals don't stack on first launch.
    window.dispatchEvent(new Event("astro-onboarding-dismissed"))
  }, [])

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next > 2) {
        dismiss()
        return
      }
      setTransitioning(true)
      setTimeout(() => {
        setPage(next)
        setTransitioning(false)
      }, 180)
    },
    [dismiss],
  )

  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [visible, dismiss])

  if (!visible) return null

  // Page 3 renders its own full-screen overlay — don't wrap it
  if (page === 2) {
    return <DashboardHintsPage onDismiss={dismiss} />
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.76)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        padding: "1.5rem",
        animation: "ob-fade-in 0.45s ease forwards",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* Page content */}
      <div
        style={{
          opacity: transitioning ? 0 : 1,
          transform: transitioning ? "translateY(10px)" : "translateY(0)",
          transition: "opacity 0.18s ease, transform 0.18s ease",
          width: "100%",
          display: "flex",
          justifyContent: "center",
        }}
      >
        {page === 0 && (
          <AppMapPage onNext={() => goTo(1)} onDismiss={dismiss} />
        )}
        {page === 1 && (
          <ModesPage
            onNext={() => goTo(2)}
            onBack={() => goTo(0)}
            onDismiss={dismiss}
          />
        )}
      </div>

      {/* Bottom bar: ESC hint + dot nav */}
      <div
        style={{
          position: "fixed",
          bottom: "1.75rem",
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.5625rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.3)",
          }}
        >
          ESC to skip
        </span>
        <div style={{ pointerEvents: "auto" }}>
          <DotNav total={3} current={page} onSelect={goTo} />
        </div>
      </div>
    </div>
  )
}
