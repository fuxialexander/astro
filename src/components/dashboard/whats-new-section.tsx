import { useState, useMemo } from "react"
import { X, Sparkles, Eye, GitBranch, RefreshCw, Zap, Bug, ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const DISMISS_KEY = "astro-whats-new-dismissed-v2026-03-13"

interface ChangelogEntry {
  pr: number
  title: string
  type: "feature" | "fix" | "refactor"
}

const HERO_FEATURE = {
  title: "Interactive Visualise",
  description:
    "Agents can now generate live, interactive visualizations — charts, diagrams, and dashboards — directly inside chat. Powered by a sandboxed iframe renderer with theme-aware styling and auto-resize.",
  prs: [962, 963, 964, 965, 966, 968],
}

const CHANGELOG: ChangelogEntry[] = [
  { pr: 969, title: "Recent workdir popover in playground", type: "feature" },
  { pr: 972, title: "Unified machine/workdir/provider selectors", type: "refactor" },
  { pr: 961, title: "Auto-refresh expired GitHub OAuth tokens", type: "fix" },
  { pr: 971, title: "Explicit NodeFS for PGlite persistence", type: "fix" },
  { pr: 970, title: "Codex provider resume & model defaults", type: "fix" },
  { pr: 957, title: "Cron scheduler concurrency check ordering", type: "fix" },
  { pr: 954, title: "Reduce Supabase egress with targeted fixes", type: "fix" },
]

const typeConfig = {
  feature: { label: "Feature", class: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  fix: { label: "Fix", class: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  refactor: { label: "Refactor", class: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20" },
}

// ── CSS-animated Visualise Preview (GPU-accelerated) ───────────────

const bars = [30, 70, 50, 90, 60, 80, 40, 95, 55, 75]
const linePoints = [80, 65, 70, 40, 45, 30, 35, 15, 20, 10] // inverted Y (SVG coords)

function VisualisePreview() {
  const w = 260
  const h = 120
  const padL = 20
  const padR = 8
  const padT = 4
  const padB = 4
  const plotW = w - padL - padR
  const plotH = h - padT - padB
  const barGap = plotW / bars.length
  const barW = barGap * 0.5

  // Build SVG polyline points
  const polyline = linePoints.map((pct, i) => {
    const x = padL + i * barGap + barGap / 2
    const y = padT + (pct / 100) * plotH
    return `${x},${y}`
  }).join(" ")

  // Last point for the pulsing dot
  const lastX = padL + (linePoints.length - 1) * barGap + barGap / 2
  const lastY = padT + (linePoints[linePoints.length - 1] / 100) * plotH

  return (
    <div className="relative rounded-lg overflow-hidden bg-background/50 border border-border/30 p-2">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block mx-auto">
        <defs>
          <linearGradient id="wn-bar-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0.06" />
          </linearGradient>
          <style>{`
            @keyframes wn-bar-grow {
              from { transform: scaleY(0); }
              to { transform: scaleY(1); }
            }
            @keyframes wn-line-draw {
              from { stroke-dashoffset: 600; }
              to { stroke-dashoffset: 0; }
            }
            @keyframes wn-dot-pulse {
              0%, 100% { r: 2; opacity: 0.9; }
              50% { r: 4; opacity: 0.4; }
            }
            @keyframes wn-dot-fade {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            .wn-bar {
              fill: url(#wn-bar-grad);
              animation: wn-bar-grow 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
            }
            .wn-line {
              animation: wn-line-draw 1.2s cubic-bezier(0.22, 1, 0.36, 1) 0.3s both;
            }
            .wn-dot {
              animation: wn-dot-fade 0.3s ease 1.4s both, wn-dot-pulse 2s ease-in-out 1.4s infinite;
            }
          `}</style>
        </defs>

        {/* Grid lines */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1={padL} y1={padT + (plotH / 4) * i}
            x2={padL + plotW} y2={padT + (plotH / 4) * i}
            stroke="currentColor" strokeOpacity="0.06" strokeWidth="0.5"
          />
        ))}

        {/* Bars — each staggers via animation-delay, grows from bottom */}
        {bars.map((pct, i) => {
          const barH = (pct / 100) * plotH
          const x = padL + i * barGap + (barGap - barW) / 2
          const y = padT + plotH - barH
          return (
            <rect
              key={i}
              className="wn-bar"
              x={x} y={y} width={barW} height={barH}
              rx={2}
              style={{
                transformOrigin: `${x + barW / 2}px ${padT + plotH}px`,
                animationDelay: `${i * 60}ms`,
              }}
            />
          )
        })}

        {/* Line chart */}
        <polyline
          className="wn-line"
          points={polyline}
          fill="none"
          stroke="rgb(99 102 241)"
          strokeOpacity="0.7"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="600"
          strokeDashoffset="600"
        />

        {/* Pulsing dot at end of line */}
        <circle
          className="wn-dot"
          cx={lastX} cy={lastY}
          r={2}
          fill="rgb(99 102 241)"
          opacity="0"
        />
      </svg>

      {/* Floating "live" indicator */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
        </span>
        <span className="text-[9px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Live</span>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────

export function WhatsNewSection() {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1" } catch { return false }
  })
  const [showFixes, setShowFixes] = useState(false)

  const fixes = useMemo(() => CHANGELOG.filter((c) => c.type === "fix"), [])
  const others = useMemo(() => CHANGELOG.filter((c) => c.type !== "fix"), [])

  if (dismissed) return null

  function dismiss() {
    setDismissed(true)
    try { localStorage.setItem(DISMISS_KEY, "1") } catch { /* noop */ }
  }

  return (
    <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-500">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-primary/70" />
        <h2 className="text-[13px] font-semibold tracking-wide">What&apos;s New</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-muted-foreground/40 hover:text-muted-foreground"
          onClick={dismiss}
        >
          <X className="h-3 w-3" />
        </Button>
        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-primary/20 text-primary/60">
          Mar 13
        </Badge>
      </div>

      {/* Hero feature card */}
      <div className="rounded-xl border border-primary/15 bg-primary/[0.02] overflow-hidden">
        <div className="flex flex-col md:flex-row">
          {/* Left: description */}
          <div className="flex-1 p-5">
            <div className="flex items-center gap-2 mb-2">
              <Eye className="h-4 w-4 text-primary/70" />
              <h3 className="text-sm font-semibold">{HERO_FEATURE.title}</h3>
            </div>
            <p className="text-xs text-muted-foreground/70 leading-relaxed mb-4">
              {HERO_FEATURE.description}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { icon: Zap, text: "Sandboxed rendering" },
                { icon: RefreshCw, text: "Auto-resize" },
                { icon: Eye, text: "Theme-aware" },
              ].map(({ icon: Icon, text }) => (
                <span
                  key={text}
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50 bg-muted/40 rounded-full px-2 py-0.5"
                >
                  <Icon className="h-2.5 w-2.5" />
                  {text}
                </span>
              ))}
            </div>
          </div>

          {/* Right: animated preview */}
          <div className="md:w-[280px] p-3 flex items-center justify-center border-t md:border-t-0 md:border-l border-border/20">
            <VisualisePreview />
          </div>
        </div>
      </div>

      {/* Other changes */}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {others.map((entry) => {
            const config = typeConfig[entry.type]
            return (
              <div
                key={entry.pr}
                className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-background/50 px-3 py-1.5"
              >
                <Badge
                  variant="outline"
                  className={cn("text-[9px] px-1.5 py-0 h-4 border", config.class)}
                >
                  {config.label}
                </Badge>
                <span className="text-[11px] text-foreground/80">{entry.title}</span>
                <span className="text-[10px] text-muted-foreground/30">#{entry.pr}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Bug fixes (collapsible) */}
      {fixes.length > 0 && (
        <div>
          <button
            onClick={() => setShowFixes(!showFixes)}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            <Bug className="h-3 w-3" />
            <span>{fixes.length} bug fixes</span>
            {showFixes ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showFixes && (
            <div className="mt-2 flex flex-col gap-1 pl-4 border-l border-border/30 animate-in fade-in slide-in-from-top-1 duration-200">
              {fixes.map((entry) => (
                <div key={entry.pr} className="flex items-center gap-2 py-0.5">
                  <GitBranch className="h-2.5 w-2.5 text-muted-foreground/30 shrink-0" />
                  <span className="text-[11px] text-muted-foreground/60">{entry.title}</span>
                  <span className="text-[10px] text-muted-foreground/25">#{entry.pr}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
