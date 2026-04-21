import { useState } from "react"
import {
  MessageSquare,
  GitBranch,
  Microscope,
  ArrowRight,
  GitPullRequest,
  GitMerge,
  Terminal,
  Zap,
  BookOpen,
  FileText,
  FolderOpen,
  Layers,
  Check,
} from "lucide-react"

// ─── Types ─────────────────────────────────────────────────────────────────

interface WorkflowStep {
  icon: React.ElementType
  label: string
  sublabel?: string
}

interface Workflow {
  id: string
  name: string
  tagline: string
  description: string
  accent: string
  accentRgb: string
  accentDim: string
  icon: React.ElementType
  steps: WorkflowStep[]
  features: string[]
  bestFor: string[]
  notIdealFor: string
}

// ─── Workflow data ──────────────────────────────────────────────────────────

const WORKFLOWS: Workflow[] = [
  {
    id: "sessions",
    name: "Sessions",
    tagline: "Chat & Execute",
    description:
      "The fastest path from thought to action. Type a goal, point at a directory, and a single agent session executes directly — no plan graph, no branches, no overhead. Ideal for exploration, one-off tasks, and ad-hoc queries where you want streaming output and immediate feedback.",
    accent: "#5ba3d0",
    accentRgb: "91, 163, 208",
    accentDim: "rgba(91, 163, 208, 0.12)",
    icon: MessageSquare,
    steps: [
      { icon: Terminal, label: "Type goal", sublabel: "in inbox" },
      { icon: Zap, label: "Session starts", sublabel: "single agent" },
      { icon: FolderOpen, label: "Direct exec", sublabel: "in workdir" },
      { icon: MessageSquare, label: "Stream results", sublabel: "back to you" },
    ],
    features: [
      "No plan graph — agent executes directly",
      "Streaming output visible in real time",
      "Optional YOLO mode — auto-approve all decisions",
      "Persistent chat history, re-steer anytime",
      "Works without a git repo",
    ],
    bestFor: ["Quick explorations", "One-off scripts", "Answering codebase questions", "Prototyping ideas"],
    notIdealFor: "Large, multi-step goals where parallel execution matters",
  },
  {
    id: "development",
    name: "PR + Worktree",
    tagline: "Software Development",
    description:
      "The full planning lifecycle for software projects. Astro decomposes your goal into a dependency graph, dispatches each task into an isolated git worktree on its own branch, and auto-creates GitHub PRs when each task completes. Tasks with no dependencies run in parallel. You review and merge — Astro does the execution.",
    accent: "#d4a574",
    accentRgb: "212, 165, 116",
    accentDim: "rgba(212, 165, 116, 0.12)",
    icon: GitBranch,
    steps: [
      { icon: Terminal, label: "Goal in inbox", sublabel: "+ git repo" },
      { icon: Layers, label: "Plan graph", sublabel: "AI-generated" },
      { icon: GitBranch, label: "Worktrees", sublabel: "per task, isolated" },
      { icon: GitPullRequest, label: "Auto PRs", sublabel: "on completion" },
      { icon: GitMerge, label: "You review", sublabel: "& merge" },
    ],
    features: [
      "Dependency-aware task graph — tasks wait for upstream results",
      "Each task in an isolated git worktree, no conflicts",
      "Automatic GitHub PR creation per task",
      "Parallel execution for independent tasks",
      "Re-plan anytime — edit nodes, add dependencies",
    ],
    bestFor: ["Feature development", "Large refactors", "Multi-file changes", "Team-scale codebases"],
    notIdealFor: "Exploratory research or tasks without a code deliverable",
  },
  {
    id: "discovery",
    name: "Discovery",
    tagline: "Research & Science",
    description:
      "Built for scientists and researchers running multi-step analyses. Each task writes scripts and outputs to its own isolated directory under analysis/{milestone}/{task}/. Tasks inherit upstream outputs by path. Your reference library (papers, PDFs, web pages) is injected as context. A final synthesis task can compile findings into a report.",
    accent: "#6ec07a",
    accentRgb: "110, 192, 122",
    accentDim: "rgba(110, 192, 122, 0.12)",
    icon: Microscope,
    steps: [
      { icon: Terminal, label: "Goal + data dir", sublabel: "research context" },
      { icon: Layers, label: "Milestone plan", sublabel: "AI-decomposed" },
      { icon: FolderOpen, label: "analysis/ dirs", sublabel: "task-scoped" },
      { icon: BookOpen, label: "Refs injected", sublabel: "papers + PDFs" },
      { icon: FileText, label: "Synthesis", sublabel: "report generated" },
    ],
    features: [
      "Each task owns analysis/{milestone}/{task}/ — no clobbering",
      "Upstream outputs referenced by path across tasks",
      "Reference library (papers, PDFs) injected into context",
      "No git worktrees — directory isolation instead",
      "Final task can synthesize a paper / report",
    ],
    bestFor: ["Data analysis pipelines", "Bioinformatics", "Literature reviews", "HPC batch workflows"],
    notIdealFor: "Software development where PRs and branch isolation are needed",
  },
]

// ─── Flow diagram components ────────────────────────────────────────────────

function PlaygroundDiagram({ accent, accentRgb }: { accent: string; accentRgb: string }) {
  // Each node: x = left edge, w = width, lines = text rows
  const nodes = [
    { x: 5,   w: 155, lines: ["Choose a machine", "& working directory"] },
    { x: 196, w: 148, lines: ["Describe what",    "you want done"]       },
    { x: 385, w: 148, lines: ["Results stream",   "back in real time"]   },
    { x: 574, w: 148, lines: ["Follow up",        "or steer the agent"]  },
  ]
  const cy = 56
  return (
    <svg viewBox="0 0 730 112" className="w-full h-full" style={{ overflow: "visible" }}>
      <defs>
        <marker id="arrow-play" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={accent} opacity="0.7" />
        </marker>
      </defs>
      {/* Connectors */}
      {[0, 1, 2].map((i) => (
        <line
          key={i}
          x1={nodes[i].x + nodes[i].w + 2} y1={cy}
          x2={nodes[i + 1].x - 6}           y2={cy}
          stroke={accent} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.5"
          markerEnd="url(#arrow-play)"
          style={{ animation: `dashFlow 1.4s linear infinite ${i * 0.25}s` }}
        />
      ))}
      {/* Nodes */}
      {nodes.map((n, i) => (
        <g key={i} style={{ animation: `nodeIn 0.4s ease forwards ${i * 0.1}s`, opacity: 0 }}>
          <rect x={n.x} y={cy - 22} width={n.w} height={46} rx="8"
            fill={`rgba(${accentRgb}, 0.07)`} stroke={`rgba(${accentRgb}, 0.3)`} strokeWidth="1" />
          <text x={n.x + n.w / 2} y={cy - 4} textAnchor="middle" fill={accent}
            fontFamily="'JetBrains Mono', monospace" fontSize="10.5" fontWeight="500">
            {n.lines[0]}
          </text>
          <text x={n.x + n.w / 2} y={cy + 13} textAnchor="middle" fill={`rgba(${accentRgb}, 0.55)`}
            fontFamily="'JetBrains Mono', monospace" fontSize="9">
            {n.lines[1]}
          </text>
        </g>
      ))}
    </svg>
  )
}

function DevelopmentDiagram({ accent, accentRgb }: { accent: string; accentRgb: string }) {
  const branches = [
    { y: 28, label: "task-a", sub: "worktree" },
    { y: 60, label: "task-b", sub: "worktree" },
    { y: 92, label: "task-c", sub: "worktree" },
  ]
  return (
    <svg viewBox="0 0 780 130" className="w-full h-full" style={{ overflow: "visible" }}>
      <defs>
        <marker id="arrow-dev" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill={accent} opacity="0.7" />
        </marker>
      </defs>

      {/* Goal node */}
      <g style={{ animation: "nodeIn 0.35s ease forwards", opacity: 0 }}>
        <rect x="10" y="43" width="90" height="44" rx="8"
          fill={`rgba(${accentRgb}, 0.07)`} stroke={`rgba(${accentRgb}, 0.3)`} strokeWidth="1" />
        <text x="55" y="62" textAnchor="middle" fill={accent}
          fontFamily="'JetBrains Mono', monospace" fontSize="11" fontWeight="500">Goal</text>
        <text x="55" y="78" textAnchor="middle" fill={`rgba(${accentRgb}, 0.5)`}
          fontFamily="'JetBrains Mono', monospace" fontSize="9">+plan mode</text>
      </g>

      {/* Plan node */}
      <g style={{ animation: "nodeIn 0.35s ease forwards 0.1s", opacity: 0 }}>
        <rect x="140" y="43" width="90" height="44" rx="8"
          fill={`rgba(${accentRgb}, 0.07)`} stroke={`rgba(${accentRgb}, 0.3)`} strokeWidth="1" />
        <text x="185" y="62" textAnchor="middle" fill={accent}
          fontFamily="'JetBrains Mono', monospace" fontSize="11" fontWeight="500">Plan</text>
        <text x="185" y="78" textAnchor="middle" fill={`rgba(${accentRgb}, 0.5)`}
          fontFamily="'JetBrains Mono', monospace" fontSize="9">dep-graph</text>
      </g>

      {/* Connector goal→plan */}
      <line x1="100" y1="65" x2="135" y2="65"
        stroke={accent} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.5"
        markerEnd="url(#arrow-dev)"
        style={{ animation: "dashFlow 1.4s linear infinite" }} />

      {/* Fan-out lines */}
      {branches.map((b, i) => (
        <g key={i}>
          <path d={`M230,65 Q265,65 265,${b.y + 22} L275,${b.y + 22}`}
            fill="none" stroke={accent} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.4"
            markerEnd="url(#arrow-dev)"
            style={{ animation: `dashFlow 1.4s linear infinite ${i * 0.2}s` }} />
        </g>
      ))}

      {/* Branch nodes */}
      {branches.map((b, i) => (
        <g key={i} style={{ animation: `nodeIn 0.35s ease forwards ${0.2 + i * 0.08}s`, opacity: 0 }}>
          <rect x="275" y={b.y + 2} width="104" height="40" rx="7"
            fill={`rgba(${accentRgb}, 0.06)`} stroke={`rgba(${accentRgb}, 0.25)`} strokeWidth="1" />
          <text x="327" y={b.y + 19} textAnchor="middle" fill={accent}
            fontFamily="'JetBrains Mono', monospace" fontSize="10" fontWeight="500">{b.label}</text>
          <text x="327" y={b.y + 32} textAnchor="middle" fill={`rgba(${accentRgb}, 0.45)`}
            fontFamily="'JetBrains Mono', monospace" fontSize="8">{b.sub}</text>
        </g>
      ))}

      {/* Fan-in lines to PRs */}
      {branches.map((b, i) => (
        <line key={i} x1="379" y1={b.y + 22} x2="459" y2="65"
          stroke={accent} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.4"
          markerEnd="url(#arrow-dev)"
          style={{ animation: `dashFlow 1.4s linear infinite ${0.3 + i * 0.12}s` }} />
      ))}

      {/* PRs node */}
      <g style={{ animation: "nodeIn 0.35s ease forwards 0.5s", opacity: 0 }}>
        <rect x="460" y="43" width="88" height="44" rx="8"
          fill={`rgba(${accentRgb}, 0.07)`} stroke={`rgba(${accentRgb}, 0.3)`} strokeWidth="1" />
        <text x="504" y="62" textAnchor="middle" fill={accent}
          fontFamily="'JetBrains Mono', monospace" fontSize="11" fontWeight="500">PRs</text>
        <text x="504" y="78" textAnchor="middle" fill={`rgba(${accentRgb}, 0.5)`}
          fontFamily="'JetBrains Mono', monospace" fontSize="9">auto-created</text>
      </g>

      {/* PRs → Merged */}
      <line x1="548" y1="65" x2="608" y2="65"
        stroke={accent} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.5"
        markerEnd="url(#arrow-dev)"
        style={{ animation: "dashFlow 1.4s linear infinite 0.6s" }} />

      {/* Merged node */}
      <g style={{ animation: "nodeIn 0.35s ease forwards 0.65s", opacity: 0 }}>
        <rect x="610" y="43" width="100" height="44" rx="8"
          fill={`rgba(${accentRgb}, 0.1)`} stroke={`rgba(${accentRgb}, 0.4)`} strokeWidth="1.5" />
        <text x="660" y="62" textAnchor="middle" fill={accent}
          fontFamily="'JetBrains Mono', monospace" fontSize="11" fontWeight="600">Merge</text>
        <text x="660" y="78" textAnchor="middle" fill={`rgba(${accentRgb}, 0.6)`}
          fontFamily="'JetBrains Mono', monospace" fontSize="9">you decide</text>
      </g>
    </svg>
  )
}

function DiscoveryDiagram({ accent, accentRgb }: { accent: string; accentRgb: string }) {
  const milestones = [
    { y: 22, label: "milestone-1" },
    { y: 80, label: "milestone-2" },
  ]
  const tasks = [
    { mIdx: 0, y: 10, label: "task-1/" },
    { mIdx: 0, y: 38, label: "task-2/" },
    { mIdx: 1, y: 75, label: "analysis/" },
  ]
  return (
    <svg viewBox="0 0 820 130" className="w-full h-full" style={{ overflow: "visible" }}>
      <defs>
        <marker id="arrow-disc" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill={accent} opacity="0.7" />
        </marker>
      </defs>

      {/* Goal */}
      <g style={{ animation: "nodeIn 0.35s ease forwards", opacity: 0 }}>
        <rect x="10" y="43" width="88" height="44" rx="8"
          fill={`rgba(${accentRgb}, 0.07)`} stroke={`rgba(${accentRgb}, 0.3)`} strokeWidth="1" />
        <text x="54" y="62" textAnchor="middle" fill={accent}
          fontFamily="'JetBrains Mono', monospace" fontSize="11" fontWeight="500">Goal</text>
        <text x="54" y="78" textAnchor="middle" fill={`rgba(${accentRgb}, 0.5)`}
          fontFamily="'JetBrains Mono', monospace" fontSize="9">+refs</text>
      </g>

      {/* Goal → milestone fan */}
      {milestones.map((m, i) => (
        <path key={i} d={`M98,65 Q148,65 148,${m.y + 20} L158,${m.y + 20}`}
          fill="none" stroke={accent} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.4"
          markerEnd="url(#arrow-disc)"
          style={{ animation: `dashFlow 1.4s linear infinite ${i * 0.2}s` }} />
      ))}

      {/* Milestone nodes */}
      {milestones.map((m, i) => (
        <g key={i} style={{ animation: `nodeIn 0.35s ease forwards ${0.1 + i * 0.1}s`, opacity: 0 }}>
          <rect x="158" y={m.y} width="112" height="40" rx="7"
            fill={`rgba(${accentRgb}, 0.07)`} stroke={`rgba(${accentRgb}, 0.28)`} strokeWidth="1" />
          <text x="214" y={m.y + 17} textAnchor="middle" fill={accent}
            fontFamily="'JetBrains Mono', monospace" fontSize="9.5" fontWeight="500">{m.label}</text>
          <text x="214" y={m.y + 31} textAnchor="middle" fill={`rgba(${accentRgb}, 0.45)`}
            fontFamily="'JetBrains Mono', monospace" fontSize="8">milestone</text>
        </g>
      ))}

      {/* Milestone → task connectors */}
      {tasks.slice(0, 2).map((t, i) => (
        <path key={i} d={`M270,${milestones[0].y + 20} Q310,${milestones[0].y + 20} 310,${t.y + 18} L320,${t.y + 18}`}
          fill="none" stroke={accent} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.35"
          markerEnd="url(#arrow-disc)"
          style={{ animation: `dashFlow 1.4s linear infinite ${0.2 + i * 0.15}s` }} />
      ))}
      <path d={`M270,${milestones[1].y + 20} L320,${milestones[1].y + 20}`}
        fill="none" stroke={accent} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.35"
        markerEnd="url(#arrow-disc)"
        style={{ animation: "dashFlow 1.4s linear infinite 0.4s" }} />

      {/* Task dir nodes */}
      {tasks.map((t, i) => (
        <g key={i} style={{ animation: `nodeIn 0.35s ease forwards ${0.25 + i * 0.08}s`, opacity: 0 }}>
          <rect x="320" y={t.y} width="118" height="36" rx="6"
            fill={`rgba(${accentRgb}, 0.05)`} stroke={`rgba(${accentRgb}, 0.2)`} strokeWidth="1" />
          <text x="379" y={t.y + 15} textAnchor="middle" fill={accent}
            fontFamily="'JetBrains Mono', monospace" fontSize="9" fontWeight="500">{t.label}</text>
          <text x="379" y={t.y + 28} textAnchor="middle" fill={`rgba(${accentRgb}, 0.4)`}
            fontFamily="'JetBrains Mono', monospace" fontSize="8">scripts+outputs</text>
        </g>
      ))}

      {/* Refs node */}
      <g style={{ animation: "nodeIn 0.35s ease forwards 0.45s", opacity: 0 }}>
        <rect x="480" y="18" width="100" height="36" rx="7"
          fill={`rgba(${accentRgb}, 0.06)`} stroke={`rgba(${accentRgb}, 0.25)`} strokeWidth="1" />
        <text x="530" y="35" textAnchor="middle" fill={accent}
          fontFamily="'JetBrains Mono', monospace" fontSize="10" fontWeight="500">refs/</text>
        <text x="530" y="48" textAnchor="middle" fill={`rgba(${accentRgb}, 0.45)`}
          fontFamily="'JetBrains Mono', monospace" fontSize="8">papers+PDFs</text>
      </g>
      {/* Refs inject lines */}
      {[10, 28, 75].map((y, i) => (
        <line key={i} x1="480" y1="36" x2="438" y2={y + 18}
          stroke={accent} strokeWidth="1" strokeDasharray="3 4" opacity="0.25" />
      ))}

      {/* Connector tasks → synthesis */}
      {[10, 28, 75].map((y, i) => (
        <path key={i} d={`M438,${y + 18} Q610,${y + 18} 610,90`}
          fill="none" stroke={accent} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.3"
          markerEnd="url(#arrow-disc)"
          style={{ animation: `dashFlow 1.4s linear infinite ${0.5 + i * 0.12}s` }} />
      ))}

      {/* Synthesis node */}
      <g style={{ animation: "nodeIn 0.35s ease forwards 0.7s", opacity: 0 }}>
        <rect x="612" y="70" width="120" height="44" rx="8"
          fill={`rgba(${accentRgb}, 0.1)`} stroke={`rgba(${accentRgb}, 0.4)`} strokeWidth="1.5" />
        <text x="672" y="89" textAnchor="middle" fill={accent}
          fontFamily="'JetBrains Mono', monospace" fontSize="11" fontWeight="600">synthesis</text>
        <text x="672" y="105" textAnchor="middle" fill={`rgba(${accentRgb}, 0.6)`}
          fontFamily="'JetBrains Mono', monospace" fontSize="9">report.md</text>
      </g>
    </svg>
  )
}

// ─── Main page ──────────────────────────────────────────────────────────────

export function OnboardingWorkflows() {
  const [active, setActive] = useState(0)
  const wf = WORKFLOWS[active]

  return (
    <div className="min-h-full w-full bg-background" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=JetBrains+Mono:wght@400;500&display=swap');

        @keyframes dashFlow {
          from { stroke-dashoffset: 18; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes nodeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.8; }
        }

        .wf-tab-active-glow {
          animation: pulseGlow 2.5s ease-in-out infinite;
        }
        .wf-content-enter {
          animation: fadeUp 0.35s ease forwards;
        }
        .wf-feature-item:hover {
          background: var(--muted);
        }

        /* Dot grid — adapts to light/dark via CSS variable */
        .wf-page-bg {
          --dot: rgba(0,0,0,0.045);
          background-image: radial-gradient(circle, var(--dot) 1px, transparent 1px);
          background-size: 28px 28px;
        }
        .dark .wf-page-bg {
          --dot: rgba(255,255,255,0.04);
        }
      `}</style>

      <div className="wf-page-bg" style={{ minHeight: "100%", padding: "3rem 2rem 5rem" }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ marginBottom: "3rem", animation: "fadeUp 0.5s ease forwards" }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.625rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--muted-foreground)",
              marginBottom: "0.875rem",
            }}>
              Workflow Guide
            </div>
            <h1 style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: "clamp(2.25rem, 5vw, 3.25rem)",
              fontWeight: 300,
              letterSpacing: "0.03em",
              lineHeight: 1.1,
              color: "var(--foreground)",
              marginBottom: "0.875rem",
            }}>
              Three ways to build with Astro
            </h1>
            <p style={{
              fontSize: "0.9375rem",
              color: "var(--muted-foreground)",
              fontWeight: 300,
              lineHeight: 1.7,
              maxWidth: 540,
            }}>
              Same inbox. Different execution paths. Choose the workflow that matches your goal —
              you can switch or mix per project.
            </p>
          </div>

          {/* Tab selector */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "0.875rem",
              marginBottom: "2.5rem",
            }}
          >
            {WORKFLOWS.map((w, i) => {
              const isActive = active === i
              const Icon = w.icon
              return (
                <button
                  key={w.id}
                  onClick={() => setActive(i)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.625rem",
                    padding: "1.25rem 1.5rem",
                    borderRadius: "14px",
                    border: isActive
                      ? `1px solid rgba(${w.accentRgb}, 0.45)`
                      : "1px solid var(--border)",
                    background: isActive
                      ? `rgba(${w.accentRgb}, 0.07)`
                      : "var(--card)",
                    position: "relative",
                    overflow: "hidden",
                    transition: "border-color 0.2s ease, background 0.2s ease",
                  }}
                >
                  {/* Top glow bar */}
                  {isActive && (
                    <div
                      className="wf-tab-active-glow"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: "10%",
                        right: "10%",
                        height: "1px",
                        background: `linear-gradient(90deg, transparent, ${w.accent}, transparent)`,
                      }}
                    />
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: `rgba(${w.accentRgb}, 0.1)`,
                      border: `1px solid rgba(${w.accentRgb}, 0.2)`,
                      flexShrink: 0,
                    }}>
                      <Icon size={15} style={{ color: w.accent }} />
                    </div>
                    <div>
                      <div style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "0.625rem",
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: isActive ? w.accent : "var(--muted-foreground)",
                        marginBottom: 2,
                        transition: "color 0.2s",
                      }}>
                        {w.tagline}
                      </div>
                      <div style={{
                        fontSize: "0.9375rem",
                        fontWeight: 500,
                        color: isActive ? "var(--foreground)" : "var(--muted-foreground)",
                        letterSpacing: "-0.01em",
                        transition: "color 0.2s",
                      }}>
                        {w.name}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Flow diagram panel */}
          <div
            key={`diagram-${active}`}
            className="wf-content-enter"
            style={{
              background: "var(--card)",
              border: `1px solid rgba(${wf.accentRgb}, 0.18)`,
              borderRadius: "16px",
              padding: "2rem 2rem 1.5rem",
              marginBottom: "1.5rem",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Corner glow */}
            <div style={{
              position: "absolute",
              top: -60,
              right: -60,
              width: 180,
              height: 180,
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(${wf.accentRgb}, 0.08) 0%, transparent 70%)`,
              pointerEvents: "none",
            }} />

            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.5625rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: `rgba(${wf.accentRgb}, 0.55)`,
              marginBottom: "1.25rem",
            }}>
              Execution flow
            </div>

            <div style={{ height: 130 }}>
              {active === 0 && <PlaygroundDiagram accent={wf.accent} accentRgb={wf.accentRgb} />}
              {active === 1 && <DevelopmentDiagram accent={wf.accent} accentRgb={wf.accentRgb} />}
              {active === 2 && <DiscoveryDiagram accent={wf.accent} accentRgb={wf.accentRgb} />}
            </div>
          </div>

          {/* Content grid */}
          <div
            key={`content-${active}`}
            className="wf-content-enter"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 340px",
              gap: "1.25rem",
              alignItems: "start",
            }}
          >
            {/* Left: description + features */}
            <div>
              <p style={{
                fontSize: "0.9375rem",
                color: "var(--muted-foreground)",
                lineHeight: 1.75,
                fontWeight: 300,
                marginBottom: "1.75rem",
              }}>
                {wf.description}
              </p>

              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.5625rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: `rgba(${wf.accentRgb}, 0.55)`,
                marginBottom: "0.75rem",
              }}>
                Key characteristics
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {wf.features.map((f, i) => (
                  <div
                    key={i}
                    className="wf-feature-item"
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.625rem",
                      padding: "0.5rem 0.625rem",
                      borderRadius: 8,
                      transition: "background 0.15s",
                    }}
                  >
                    <Check size={13} style={{ color: wf.accent, marginTop: 2, flexShrink: 0 }} />
                    <span style={{
                      fontSize: "0.875rem",
                      color: "var(--muted-foreground)",
                      lineHeight: 1.5,
                      fontWeight: 300,
                    }}>
                      {f}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: best for card */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{
                background: `rgba(${wf.accentRgb}, 0.05)`,
                border: `1px solid rgba(${wf.accentRgb}, 0.2)`,
                borderRadius: "14px",
                padding: "1.375rem 1.5rem",
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.5625rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: wf.accent,
                  marginBottom: "0.875rem",
                }}>
                  Best for
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {wf.bestFor.map((b, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <ArrowRight size={11} style={{ color: `rgba(${wf.accentRgb}, 0.6)`, flexShrink: 0 }} />
                      <span style={{
                        fontSize: "0.875rem",
                        color: "var(--foreground)",
                        fontWeight: 300,
                      }}>
                        {b}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{
                background: "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: "14px",
                padding: "1.25rem 1.5rem",
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.5625rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--muted-foreground)",
                  marginBottom: "0.625rem",
                }}>
                  Not ideal for
                </div>
                <p style={{
                  fontSize: "0.8125rem",
                  color: "var(--muted-foreground)",
                  lineHeight: 1.6,
                  fontWeight: 300,
                }}>
                  {wf.notIdealFor}
                </p>
              </div>

              {/* Pagination dots */}
              <div style={{ display: "flex", gap: "0.375rem", justifyContent: "center", paddingTop: "0.25rem" }}>
                {WORKFLOWS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActive(i)}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      width: active === i ? 20 : 6,
                      height: 6,
                      borderRadius: 3,
                      background: active === i ? WORKFLOWS[i].accent : "var(--border)",
                      transition: "width 0.25s ease, background 0.25s ease",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
