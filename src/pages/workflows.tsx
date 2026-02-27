import { useEffect, useRef, type SVGProps } from "react"
import { cn } from "@/lib/utils"
import {
  GitBranch,
  FolderOpen,
  Copy,
  Database,
  Server,
  ArrowRight,
  Shield,
  Zap,
  Users,
  FlaskConical,
  Code2,
  Layers,
  MonitorSmartphone,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Animated SVG Illustrations
// ---------------------------------------------------------------------------

function GitWorktreeSvg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 280 180" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <style>{`
        @keyframes wt-node-pop { 0% { r: 0; } 60% { r: 7; } 100% { r: 5.5; } }
        @keyframes wt-pulse { 0% { r: 5.5; opacity: 0.6; } 100% { r: 14; opacity: 0; } }
        @keyframes wt-fade { from { opacity: 0; } to { opacity: 1; } }
        .wt-node { animation: wt-node-pop 0.5s ease-out forwards; }
        .wt-d1 { animation-delay: 0.2s; }
        .wt-d2 { animation-delay: 0.4s; }
        .wt-d3 { animation-delay: 0.6s; }
        .wt-d4 { animation-delay: 0.8s; }
        .wt-d5 { animation-delay: 1.0s; }
        .wt-pulse { animation: wt-pulse 2s ease-out infinite; }
        .wt-pulse-d { animation-delay: 1s; }
        .wt-line { opacity: 0; animation: wt-fade 0.4s ease-out forwards; }
        .wt-line-d1 { animation-delay: 0.3s; }
        .wt-line-d2 { animation-delay: 0.5s; }
      `}</style>

      {/* Main branch — single continuous line */}
      <line x1="30" y1="90" x2="250" y2="90" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" className="wt-line" />

      {/* Branch 1 (top): curve from main at x=90 up to y=50, then straight to x=220 */}
      <path d="M90 90 C90 90, 90 50, 130 50 L220 50" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" fill="none" className="wt-line wt-line-d1" />

      {/* Branch 2 (bottom): curve from main at x=140 down to y=135, then straight to x=230 */}
      <path d="M140 90 C140 90, 140 135, 175 135 L230 135" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" fill="none" className="wt-line wt-line-d2" />

      {/* Commit nodes on main */}
      <circle cx="30" cy="90" r="0" className="wt-node" fill="var(--primary)" />
      <circle cx="90" cy="90" r="0" className="wt-node wt-d1" fill="var(--primary)" />
      <circle cx="140" cy="90" r="0" className="wt-node wt-d2" fill="var(--primary)" />
      <circle cx="200" cy="90" r="0" className="wt-node wt-d3" fill="var(--primary)" />
      <circle cx="250" cy="90" r="0" className="wt-node wt-d4" fill="var(--primary)" />

      {/* Commit nodes on branch 1 */}
      <circle cx="160" cy="50" r="0" className="wt-node wt-d3" fill="var(--success)" />
      <circle cx="195" cy="50" r="0" className="wt-node wt-d4" fill="var(--success)" />
      <circle cx="220" cy="50" r="0" className="wt-node wt-d5" fill="var(--success)" />

      {/* Commit nodes on branch 2 */}
      <circle cx="200" cy="135" r="0" className="wt-node wt-d4" fill="var(--warning)" />
      <circle cx="230" cy="135" r="0" className="wt-node wt-d5" fill="var(--warning)" />

      {/* Active pulse on heads */}
      <circle cx="250" cy="90" r="5.5" className="wt-pulse" fill="none" stroke="var(--primary)" strokeWidth="1.5" />
      <circle cx="220" cy="50" r="5.5" className="wt-pulse wt-pulse-d" fill="none" stroke="var(--success)" strokeWidth="1.5" />

      {/* Labels */}
      <text x="30" y="112" fill="var(--muted-foreground)" fontSize="9" fontFamily="var(--font-primary)">main</text>
      <text x="140" y="40" fill="var(--success)" fontSize="9" fontFamily="var(--font-primary)">astro/task-1</text>
      <text x="178" y="156" fill="var(--warning)" fontSize="9" fontFamily="var(--font-primary)">astro/task-2</text>
    </svg>
  )
}

function DirectModeSvg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 280 180" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <style>{`
        @keyframes cursor-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes type-in { from { width: 0; } to { width: 100%; } }
        @keyframes file-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
        .cursor { animation: cursor-blink 1s step-end infinite; }
        .file-pulse { animation: file-glow 3s ease-in-out infinite; }
        .file-pulse-d1 { animation-delay: 0.5s; }
        .file-pulse-d2 { animation-delay: 1s; }
      `}</style>
      {/* Folder structure */}
      <rect x="30" y="20" width="220" height="140" rx="8" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      <rect x="30" y="20" width="220" height="28" rx="8" fill="var(--muted)" />
      <rect x="30" y="40" width="220" height="8" fill="var(--muted)" />
      <text x="44" y="38" fill="var(--foreground)" fontSize="10" fontWeight="500" fontFamily="var(--font-primary)">~/my-project/</text>
      {/* Files */}
      <rect x="50" y="58" width="14" height="16" rx="2" className="file-pulse" fill="var(--primary)" opacity="0.3" />
      <text x="70" y="70" fill="var(--foreground)" fontSize="10" fontFamily="monospace" opacity="0.8">main.py</text>
      <rect x="50" y="82" width="14" height="16" rx="2" className="file-pulse file-pulse-d1" fill="var(--success)" opacity="0.3" />
      <text x="70" y="94" fill="var(--foreground)" fontSize="10" fontFamily="monospace" opacity="0.8">config.yaml</text>
      <rect x="50" y="106" width="14" height="16" rx="2" className="file-pulse file-pulse-d2" fill="var(--warning)" opacity="0.3" />
      <text x="70" y="118" fill="var(--foreground)" fontSize="10" fontFamily="monospace" opacity="0.8">analysis.ipynb</text>
      {/* Agent cursor */}
      <rect x="155" y="60" width="2" height="14" rx="1" className="cursor" fill="var(--primary)" />
      <text x="160" y="70" fill="var(--muted-foreground)" fontSize="9" fontFamily="monospace" opacity="0.6">editing...</text>
      {/* "Zero overhead" label */}
      <text x="140" y="170" fill="var(--muted-foreground)" fontSize="8" fontFamily="var(--font-primary)" textAnchor="middle">Zero overhead</text>
    </svg>
  )
}

function CopyWorktreeSvg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 280 180" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <style>{`
        @keyframes copy-slide { 0% { transform: translate(0, 0); opacity: 0.3; } 50% { opacity: 0.8; } 100% { transform: translate(80px, 0); opacity: 1; } }
        @keyframes check-draw { from { stroke-dashoffset: 20; } to { stroke-dashoffset: 0; } }
        .copy-anim { animation: copy-slide 1.5s ease-out forwards; }
        .copy-anim-d { animation-delay: 0.3s; opacity: 0; }
        .check-mark { stroke-dasharray: 20; animation: check-draw 0.5s ease-out forwards; animation-delay: 2s; stroke-dashoffset: 20; }
      `}</style>
      {/* Source folder */}
      <rect x="20" y="30" width="100" height="90" rx="6" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      <rect x="20" y="30" width="100" height="22" rx="6" fill="var(--muted)" />
      <rect x="20" y="46" width="100" height="6" fill="var(--muted)" />
      <text x="34" y="44" fill="var(--foreground)" fontSize="8" fontWeight="500" fontFamily="var(--font-primary)">Source</text>
      <rect x="32" y="60" width="76" height="6" rx="2" fill="var(--primary)" opacity="0.15" />
      <rect x="32" y="72" width="60" height="6" rx="2" fill="var(--primary)" opacity="0.15" />
      <rect x="32" y="84" width="70" height="6" rx="2" fill="var(--primary)" opacity="0.15" />
      <rect x="32" y="96" width="50" height="6" rx="2" fill="var(--primary)" opacity="0.15" />
      {/* Copy arrows */}
      <path d="M125 60 L155 60" className="copy-anim" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0" />
      <path d="M125 75 L155 75" className="copy-anim copy-anim-d" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0" />
      {/* Worktree folder */}
      <rect x="160" y="30" width="100" height="90" rx="6" fill="var(--card)" stroke="var(--success)" strokeWidth="1.5" />
      <rect x="160" y="30" width="100" height="22" rx="6" fill="var(--success)" opacity="0.12" />
      <rect x="160" y="46" width="100" height="6" fill="var(--success)" opacity="0.12" />
      <text x="174" y="44" fill="var(--success)" fontSize="8" fontWeight="500" fontFamily="var(--font-primary)">Worktree Copy</text>
      <rect x="172" y="60" width="76" height="6" rx="2" fill="var(--success)" opacity="0.15" />
      <rect x="172" y="72" width="60" height="6" rx="2" fill="var(--success)" opacity="0.15" />
      <rect x="172" y="84" width="70" height="6" rx="2" fill="var(--success)" opacity="0.15" />
      <rect x="172" y="96" width="50" height="6" rx="2" fill="var(--success)" opacity="0.15" />
      {/* Shield icon area */}
      <circle cx="140" cy="145" r="16" fill="var(--success)" opacity="0.1" />
      <path d="M134 145 L139 150 L147 140" className="check-mark" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <text x="140" y="172" fill="var(--muted-foreground)" fontSize="8" fontFamily="var(--font-primary)" textAnchor="middle">Original untouched</text>
    </svg>
  )
}

function ReferenceFolderSvg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 280 180" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <style>{`
        @keyframes scan-line { 0% { transform: translateY(0); } 100% { transform: translateY(60px); } }
        @keyframes data-flow { 0% { opacity: 0; transform: translateX(-10px); } 50% { opacity: 1; } 100% { opacity: 0; transform: translateX(10px); } }
        .scan { animation: scan-line 3s ease-in-out infinite alternate; }
        .data-dot { animation: data-flow 2s ease-in-out infinite; }
        .data-dot-d1 { animation-delay: 0.3s; }
        .data-dot-d2 { animation-delay: 0.6s; }
        .data-dot-d3 { animation-delay: 0.9s; }
      `}</style>
      {/* Large data folder */}
      <rect x="15" y="20" width="110" height="130" rx="6" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      <rect x="15" y="20" width="110" height="22" rx="6" fill="var(--muted)" />
      <rect x="15" y="36" width="110" height="6" fill="var(--muted)" />
      <text x="28" y="34" fill="var(--foreground)" fontSize="8" fontWeight="500" fontFamily="var(--font-primary)">15 GB Data</text>
      {/* Data file representations */}
      <rect x="28" y="52" width="84" height="10" rx="2" fill="var(--warning)" opacity="0.12" />
      <text x="34" y="60" fill="var(--warning)" fontSize="7" fontFamily="monospace">patients.csv 800MB</text>
      <rect x="28" y="68" width="84" height="10" rx="2" fill="var(--warning)" opacity="0.12" />
      <text x="34" y="76" fill="var(--warning)" fontSize="7" fontFamily="monospace">controls.csv 600MB</text>
      <rect x="28" y="84" width="84" height="10" rx="2" fill="var(--primary)" opacity="0.12" />
      <text x="34" y="92" fill="var(--primary)" fontSize="7" fontFamily="monospace">preprocess.py 2KB</text>
      <rect x="28" y="100" width="84" height="10" rx="2" fill="var(--primary)" opacity="0.12" />
      <text x="34" y="108" fill="var(--primary)" fontSize="7" fontFamily="monospace">analyze.R 4KB</text>
      {/* Read arrows */}
      <circle cx="140" cy="75" r="3" className="data-dot" fill="var(--primary)" />
      <circle cx="140" cy="85" r="2.5" className="data-dot data-dot-d1" fill="var(--primary)" />
      <circle cx="140" cy="95" r="2" className="data-dot data-dot-d2" fill="var(--primary)" />
      <text x="140" y="115" fill="var(--muted-foreground)" fontSize="7" fontFamily="var(--font-primary)" textAnchor="middle">read</text>
      {/* Empty worktree */}
      <rect x="155" y="40" width="110" height="90" rx="6" fill="var(--card)" stroke="var(--success)" strokeWidth="1.5" strokeDasharray="4 4" />
      <text x="178" y="58" fill="var(--success)" fontSize="8" fontWeight="500" fontFamily="var(--font-primary)">Worktree</text>
      <text x="168" y="80" fill="var(--muted-foreground)" fontSize="8" fontFamily="monospace" opacity="0.5">results/</text>
      <text x="168" y="94" fill="var(--muted-foreground)" fontSize="8" fontFamily="monospace" opacity="0.5">output.csv</text>
      <text x="168" y="108" fill="var(--muted-foreground)" fontSize="8" fontFamily="monospace" opacity="0.5">report.md</text>
      {/* Label */}
      <text x="140" y="168" fill="var(--muted-foreground)" fontSize="8" fontFamily="var(--font-primary)" textAnchor="middle">Reads source, writes to worktree</text>
    </svg>
  )
}

function DeliveryFlowSvg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 600 120" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <style>{`
        @keyframes flow-appear { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .flow-node { animation: flow-appear 0.5s ease-out forwards; opacity: 0; }
        .flow-d1 { animation-delay: 0.15s; }
        .flow-d2 { animation-delay: 0.3s; }
        .flow-d3 { animation-delay: 0.45s; }
        .flow-d4 { animation-delay: 0.6s; }
      `}</style>
      {/* Directory */}
      <g className="flow-node">
        <rect x="10" y="25" width="100" height="50" rx="8" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
        <text x="60" y="50" fill="var(--foreground)" fontSize="10" fontWeight="500" fontFamily="var(--font-primary)" textAnchor="middle">Your Directory</text>
        <text x="60" y="64" fill="var(--muted-foreground)" fontSize="8" fontFamily="var(--font-primary)" textAnchor="middle">auto-detected</text>
      </g>
      <path d="M115 50 L155 50" className="flow-node flow-d1" stroke="var(--primary)" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
      {/* Detection */}
      <g className="flow-node flow-d1">
        <rect x="160" y="25" width="100" height="50" rx="8" fill="var(--primary)" opacity="0.08" stroke="var(--primary)" strokeWidth="1.5" />
        <text x="210" y="50" fill="var(--primary)" fontSize="10" fontWeight="500" fontFamily="var(--font-primary)" textAnchor="middle">Detection</text>
        <text x="210" y="64" fill="var(--muted-foreground)" fontSize="8" fontFamily="var(--font-primary)" textAnchor="middle">git? remote? size?</text>
      </g>
      <path d="M265 50 L305 50" className="flow-node flow-d2" stroke="var(--primary)" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
      {/* Isolation */}
      <g className="flow-node flow-d2">
        <rect x="310" y="25" width="100" height="50" rx="8" fill="var(--success)" opacity="0.08" stroke="var(--success)" strokeWidth="1.5" />
        <text x="360" y="50" fill="var(--success)" fontSize="10" fontWeight="500" fontFamily="var(--font-primary)" textAnchor="middle">Isolation</text>
        <text x="360" y="64" fill="var(--muted-foreground)" fontSize="8" fontFamily="var(--font-primary)" textAnchor="middle">worktree / copy</text>
      </g>
      <path d="M415 50 L455 50" className="flow-node flow-d3" stroke="var(--primary)" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
      {/* Delivery */}
      <g className="flow-node flow-d3">
        <rect x="460" y="25" width="110" height="50" rx="8" fill="var(--warning)" opacity="0.08" stroke="var(--warning)" strokeWidth="1.5" />
        <text x="515" y="50" fill="var(--warning)" fontSize="10" fontWeight="500" fontFamily="var(--font-primary)" textAnchor="middle">Delivery</text>
        <text x="515" y="64" fill="var(--muted-foreground)" fontSize="8" fontFamily="var(--font-primary)" textAnchor="middle">PR / push / diff</text>
      </g>
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <path d="M0 0 L8 3 L0 6" fill="var(--primary)" />
        </marker>
      </defs>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Animated background grid (subtle, like landing page aesthetic)
// ---------------------------------------------------------------------------

function GridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animId: number
    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }
    resize()
    window.addEventListener("resize", resize)

    const dots: { x: number; y: number; vx: number; vy: number }[] = []
    const count = 40
    for (let i = 0; i < count; i++) {
      dots.push({
        x: Math.random() * canvas.offsetWidth,
        y: Math.random() * canvas.offsetHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
      })
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
      const isDark = document.documentElement.classList.contains("dark")
      const dotColor = isDark ? "rgba(138, 174, 200, 0.15)" : "rgba(74, 109, 138, 0.08)"
      const lineColor = isDark ? "rgba(138, 174, 200, 0.06)" : "rgba(74, 109, 138, 0.04)"

      for (const d of dots) {
        d.x += d.vx
        d.y += d.vy
        if (d.x < 0 || d.x > canvas.offsetWidth) d.vx *= -1
        if (d.y < 0 || d.y > canvas.offsetHeight) d.vy *= -1
        ctx.beginPath()
        ctx.arc(d.x, d.y, 1.5, 0, Math.PI * 2)
        ctx.fillStyle = dotColor
        ctx.fill()
      }

      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x
          const dy = dots[i].y - dots[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 120) {
            ctx.beginPath()
            ctx.moveTo(dots[i].x, dots[i].y)
            ctx.lineTo(dots[j].x, dots[j].y)
            ctx.strokeStyle = lineColor
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }

      animId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener("resize", resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full opacity-60"
    />
  )
}

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium tracking-wider text-primary uppercase">
      {children}
    </span>
  )
}

function ScenarioCard({
  icon: Icon,
  title,
  description,
  tags,
  children,
  accent = "primary",
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  tags: string[]
  children: React.ReactNode
  accent?: "primary" | "success" | "warning"
}) {
  const accentMap = {
    primary: {
      border: "hover:border-primary/30",
      iconBg: "bg-primary/8",
      iconText: "text-primary",
      tag: "bg-primary/6 text-primary/80 border-primary/10",
    },
    success: {
      border: "hover:border-success/30",
      iconBg: "bg-success/8",
      iconText: "text-success",
      tag: "bg-success/6 text-success/80 border-success/10",
    },
    warning: {
      border: "hover:border-warning/30",
      iconBg: "bg-warning/8",
      iconText: "text-warning",
      tag: "bg-warning/6 text-warning/80 border-warning/10",
    },
  }
  const a = accentMap[accent]

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border bg-card p-0 transition-all duration-300",
        a.border,
        "hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20",
        "hover:-translate-y-0.5"
      )}
    >
      {/* Top gradient line */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-300 group-hover:opacity-100",
          accent === "primary" && "bg-gradient-to-r from-transparent via-primary/40 to-transparent",
          accent === "success" && "bg-gradient-to-r from-transparent via-success/40 to-transparent",
          accent === "warning" && "bg-gradient-to-r from-transparent via-warning/40 to-transparent"
        )}
      />
      {/* SVG area */}
      <div className="flex items-center justify-center border-b border-border bg-muted/30 px-6 py-6">
        {children}
      </div>
      {/* Content */}
      <div className="p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", a.iconBg)}>
            <Icon className={cn("h-4 w-4", a.iconText)} />
          </div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", a.tag)}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function PersonaCard({
  icon: Icon,
  persona,
  title,
  steps,
}: {
  icon: React.ComponentType<{ className?: string }>
  persona: string
  title: string
  steps: string[]
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:border-primary/20 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wider text-primary">{persona}</span>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
      </div>
      <ol className="space-y-2.5">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
              {i + 1}
            </span>
            <span className="text-[13px] leading-relaxed text-muted-foreground">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function SafetyTierRow({
  icon: Icon,
  label,
  condition,
  behavior,
  iconColor,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  condition: string
  behavior: string
  iconColor: string
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:bg-muted/30">
      <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconColor)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="mb-0.5 text-sm font-semibold text-foreground">{label}</div>
        <div className="text-[13px] text-muted-foreground">{condition}</div>
        <div className="mt-1 text-xs text-muted-foreground/70">{behavior}</div>
      </div>
    </div>
  )
}

function DeliveryModeRow({
  mode,
  source,
  description,
}: {
  mode: string
  source: string
  description: string
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-3.5 transition-colors hover:bg-muted/30">
      <code className="shrink-0 rounded-md bg-primary/8 px-2.5 py-1 text-xs font-semibold text-primary">
        {mode}
      </code>
      <div className="min-w-0 flex-1">
        <span className="text-sm text-foreground">{source}</span>
        <span className="mx-2 text-muted-foreground/40">—</span>
        <span className="text-[13px] text-muted-foreground">{description}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function Workflows() {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-primary/[0.03] to-transparent px-6 pb-12 pt-10">
        <GridBackground />
        <div className="relative mx-auto max-w-5xl">
          <div className="mb-8 text-center">
            <SectionLabel>Workspace Model</SectionLabel>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              How Astro Manages Your Work
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
              Point Astro at a directory. Everything else — git detection, isolation strategy,
              delivery mode — is auto-detected. One entry point for engineers, scientists, and planners.
            </p>
          </div>

          {/* Flow diagram */}
          <div className="mx-auto max-w-2xl overflow-x-auto">
            <DeliveryFlowSvg className="h-auto w-full" />
          </div>
        </div>
      </section>

      {/* Execution Modes */}
      <section className="mx-auto w-full max-w-5xl px-6 py-12">
        <div className="mb-8 text-center">
          <SectionLabel>Execution Modes</SectionLabel>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">
            Every Project, One Model
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Astro picks the right isolation strategy based on what it finds in your directory.
            Git repos get worktrees. Non-git directories work in-place or with copies.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <ScenarioCard
            icon={GitBranch}
            title="Git Worktree Isolation"
            description="For git repositories. Each task gets its own worktree branching from your base branch. Parallel-safe by default. Results delivered as PRs, pushed branches, or local branches."
            tags={["Parallel", "PR Ready", "Default for Git"]}
            accent="primary"
          >
            <GitWorktreeSvg className="h-[140px] w-full" />
          </ScenarioCard>

          <ScenarioCard
            icon={FolderOpen}
            title="Direct In-Place"
            description="For non-git directories. The agent works directly in your folder with zero overhead. Serial execution only — one task at a time. Opt-in when you trust the agent or want speed."
            tags={["Zero Overhead", "Serial Only", "Non-Git Default"]}
            accent="warning"
          >
            <DirectModeSvg className="h-[140px] w-full" />
          </ScenarioCard>

          <ScenarioCard
            icon={Copy}
            title="Copy-to-Worktree"
            description="Opt-in for non-git directories. Copies your folder into an isolated worktree. Changes reviewed as a diff before applying back. Parallel-safe with full isolation."
            tags={["Isolated", "Diff Review", "Parallel Safe"]}
            accent="success"
          >
            <CopyWorktreeSvg className="h-[140px] w-full" />
          </ScenarioCard>
        </div>

        {/* Reference folder — full-width card */}
        <div className="mt-5">
          <div className="group relative overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:border-primary/20 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <div className="grid gap-0 md:grid-cols-2">
              <div className="flex items-center justify-center border-b border-border bg-muted/30 p-6 md:border-b-0 md:border-r">
                <ReferenceFolderSvg className="h-[160px] w-full max-w-[300px]" />
              </div>
              <div className="p-6">
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/8">
                    <Database className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">Reference Folder Mode</h3>
                </div>
                <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
                  For large directories (1 GB+) where copying is impractical. The agent reads your files via absolute paths
                  and writes new or modified files to an empty worktree. A file map is injected into the agent prompt
                  so it knows what exists. Perfect for scientists with large datasets.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-primary/10 bg-primary/6 px-2 py-0.5 text-[10px] font-medium text-primary/80">Read-Only Source</span>
                  <span className="rounded-full border border-primary/10 bg-primary/6 px-2 py-0.5 text-[10px] font-medium text-primary/80">File Map Injected</span>
                  <span className="rounded-full border border-primary/10 bg-primary/6 px-2 py-0.5 text-[10px] font-medium text-primary/80">Large Data</span>
                  <span className="rounded-full border border-primary/10 bg-primary/6 px-2 py-0.5 text-[10px] font-medium text-primary/80">Parallel Safe</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Delivery Modes */}
      <section className="border-y border-border bg-muted/20 px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-center">
            <SectionLabel>Delivery</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold text-foreground">
              How Results Get Back to You
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
              Astro picks the delivery mode based on your directory type and remote configuration.
            </p>
          </div>

          <div className="space-y-2.5">
            <DeliveryModeRow mode="pr" source="Git + GitHub/GitLab" description="Push branch and create Pull Request or Merge Request automatically" />
            <DeliveryModeRow mode="push" source="Git + generic remote" description="Push branch to remote; you create the PR manually" />
            <DeliveryModeRow mode="branch" source="Git + no remote" description="Commit to a local branch; you merge manually" />
            <DeliveryModeRow mode="copy" source="Non-git (copy/reference)" description="Generate diff, review changes, apply back to original directory" />
            <DeliveryModeRow mode="direct" source="Non-git (in-place)" description="Files modified directly in your directory; no undo" />
          </div>
        </div>
      </section>

      {/* Persona Workflows */}
      <section className="mx-auto w-full max-w-5xl px-6 py-12">
        <div className="mb-8 text-center">
          <SectionLabel>Workflows</SectionLabel>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">
            Same Entry Point, Different Journeys
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            All paths go through the same form: describe what you're working on and point at a directory.
            The difference is entirely in what Astro detects.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <PersonaCard
            icon={Code2}
            persona="Software Engineer"
            title="PR-based development"
            steps={[
              "Clone repo locally, paste directory path",
              'Detection: "Git repo · github.com:user/repo · PRs enabled"',
              "AI generates plan with task dependencies",
              "Each task runs in a git worktree, opens a PR",
              "Review and merge PRs from GitHub",
            ]}
          />
          <PersonaCard
            icon={FlaskConical}
            persona="Scientist"
            title="Data analysis pipeline"
            steps={[
              "Point at your scripts + data folder",
              'Detection: "No git · 15 GB · agent works directly"',
              "Opt-in to reference mode for large data",
              "Agent reads data, writes results to worktree",
              "Review outputs, apply back to original directory",
            ]}
          />
          <PersonaCard
            icon={Users}
            persona="Planner"
            title="Coordination & planning"
            steps={[
              "Leave directory as default location",
              "Default: ~/.astro/projects/{id}/ created",
              "Use Astro for planning and task decomposition",
              "Define dependencies and milestones",
              "Tasks are specs, not executed code",
            ]}
          />
        </div>
      </section>

      {/* Safety Tiers */}
      <section className="border-t border-border bg-muted/20 px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-center">
            <SectionLabel>Safety</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold text-foreground">
              Execution Safety Model
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
              Astro enforces safety based on what it detects. Git repos are parallel-safe by default.
              Non-git directories are serial unless you opt into isolation.
            </p>
          </div>

          <div className="grid gap-2.5 md:grid-cols-2">
            <SafetyTierRow
              icon={CheckCircle2}
              label="Git + Worktree"
              condition="Default for all git repositories"
              behavior="Parallel execution, full isolation, automatic branch per task"
              iconColor="bg-success/10 text-success"
            />
            <SafetyTierRow
              icon={Shield}
              label="Non-git + Copy"
              condition="User opts in via checkbox"
              behavior="Parallel-safe, files copied to worktree, diff review before apply"
              iconColor="bg-primary/10 text-primary"
            />
            <SafetyTierRow
              icon={AlertTriangle}
              label="Non-git + Direct"
              condition="Default for non-git (serial enforced)"
              behavior="One task at a time, files modified in place, no undo"
              iconColor="bg-warning/10 text-warning"
            />
            <SafetyTierRow
              icon={XCircle}
              label="Parallel on Direct"
              condition="Blocked — would cause file conflicts"
              behavior="Second dispatch returns 409 error. Use copy mode or init git."
              iconColor="bg-error/10 text-error"
            />
          </div>
        </div>
      </section>

      {/* Agent Directory Structure */}
      <section className="mx-auto w-full max-w-5xl px-6 py-12">
        <div className="mb-8 text-center">
          <SectionLabel>Structure</SectionLabel>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">
            Agent Directory Layout
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            All agent state lives in a single configurable directory inside your project.
            Default: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">.astro/</code>
          </p>
        </div>

        <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border bg-muted/50 px-5 py-3">
            <span className="font-mono text-xs text-muted-foreground">~/my-project/</span>
          </div>
          <div className="p-5 font-mono text-[13px] leading-loose text-foreground">
            <div className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-primary" />
              <span className="font-semibold text-primary">.astro/</span>
              <span className="text-xs text-muted-foreground">agent directory</span>
            </div>
            <div className="ml-6 border-l border-border pl-4">
              <div className="flex items-center gap-2">
                <span>config.json</span>
                <span className="text-xs text-muted-foreground">project settings</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">worktrees/</span>
                <span className="text-xs text-muted-foreground/60">gitignored</span>
              </div>
              <div className="ml-5 border-l border-border/50 pl-4 text-muted-foreground">
                <div>task-abc123/</div>
                <div>task-def456/</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">cache/</span>
                <span className="text-xs text-muted-foreground/60">gitignored</span>
              </div>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span>CLAUDE.md</span>
              <span className="text-xs text-muted-foreground">agent instructions</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>src/</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>package.json</span>
            </div>
          </div>
        </div>

        {/* Compatibility note */}
        <div className="mx-auto mt-4 flex max-w-xl items-start gap-3 rounded-xl border border-primary/15 bg-primary/[0.03] px-5 py-4">
          <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Claude Code compatible.</strong>{" "}
            Set the agent directory to <code className="rounded bg-muted px-1 py-0.5 text-xs">.claude</code> and
            the layout is byte-for-byte compatible with Claude Code Desktop. Use Claude Code for interactive work
            and Astro for planned task dispatch on the same project.
          </p>
        </div>
      </section>

      {/* Quick Start */}
      <section className="border-t border-border bg-muted/20 px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-center">
            <SectionLabel>Get Started</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold text-foreground">
              Three Steps to Launch
            </h2>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {[
              {
                num: "01",
                icon: FolderOpen,
                title: "Point at a directory",
                desc: "Paste any directory path. Astro auto-detects git, remotes, and project type.",
              },
              {
                num: "02",
                icon: Zap,
                title: "Describe the mission",
                desc: "Tell Astro what you're building or analyzing. AI generates a structured plan.",
              },
              {
                num: "03",
                icon: Server,
                title: "Execute in parallel",
                desc: "Tasks dispatch across your machines. Results come back as PRs, branches, or diffs.",
              },
            ].map((step) => (
              <div key={step.num} className="group relative rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:border-primary/20 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/20">
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground/50">{step.num}</span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/8">
                    <step.icon className="h-4 w-4 text-primary" />
                  </div>
                </div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">{step.title}</h3>
                <p className="text-[13px] leading-relaxed text-muted-foreground">{step.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex justify-center">
            <a
              href="/projects"
              className="inline-flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/8 px-5 py-2.5 text-sm font-medium text-primary transition-all hover:bg-primary/15 hover:border-primary/30"
            >
              Create Your First Project
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-6 text-center">
        <p className="text-xs text-muted-foreground/50">
          Workspace model aligned with Claude Code conventions. See docs/design/WORKSPACE_V2.md for full specification.
        </p>
      </footer>
    </div>
  )
}
