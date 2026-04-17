/**
 * Import from history dialog.
 *
 * Lets the user bootstrap a new Astro project (or playground session) from
 * transcripts of prior coding-agent sessions — Claude Code, Codex, or Pi —
 * that already live on a connected machine.
 *
 * Scoping funnel: machine → working directory → sessions. The funnel is
 * deliberate because a single (machine, cwd) pair keeps the summarization
 * agent's work local (no transcript RPC needed) and maps cleanly to the
 * new project's workingDirectory.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import {
  BookOpen,
  FolderOpen,
  GitBranch,
  Laptop,
  Loader2,
  Terminal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useExternalSessionsStore } from "@/stores/claude-sessions-store"
import type {
  ClientImportManifest,
  ExternalAgentSession,
  ImportManifestSelection,
} from "@/types/imports"

type DateWindow = "24h" | "7d" | "30d" | "all"

const DATE_WINDOW_MS: Record<DateWindow, number | null> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: null,
}

interface ImportFromHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Seed state — selected machine from the inbox toolbar. Required before confirm. */
  seedMachineId?: string
  /** Seed state — current working directory from the inbox toolbar. Used as default cwd. */
  seedWorkingDir?: string
  /** Seed state — current free-text goal from the inbox. Prefills the goal textarea. */
  seedGoal?: string
  /** Seed state — planMode toggle from the inbox ('plan' if true, else 'playground'). */
  seedPlanMode?: boolean
  /**
   * Called when the user confirms. Consumers call `startSession(...)` with
   * `importManifest` set to the object returned here. The dialog also returns
   * the chosen `machineId`, `workingDirectory`, and `goal` so the inbox can
   * update its own state before dispatching.
   */
  onConfirm: (result: {
    machineId: string
    workingDirectory: string
    goal: string
    importManifest: ClientImportManifest
  }) => void
}

function sessionKey(s: ExternalAgentSession): string {
  return `${s.machineId}:${s.provider}:${s.sessionId}`
}

function bestTitle(s: ExternalAgentSession): string {
  for (const candidate of [s.customTitle, s.summary, s.firstPrompt]) {
    const t = candidate?.trim()
    if (t && t.length >= 5) return t
  }
  return s.sessionId.slice(0, 8)
}

function formatAge(lastModified: number): string {
  const diff = Date.now() - lastModified
  const s = Math.floor(diff / 1000)
  if (s < 60) return "just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(lastModified).toLocaleDateString()
}

const PROVIDER_BADGE: Record<ExternalAgentSession["provider"], string> = {
  claude: "claude",
  codex: "codex",
  pi: "pi",
}

export function ImportFromHistoryDialog({
  open,
  onOpenChange,
  seedMachineId,
  seedWorkingDir,
  seedGoal,
  seedPlanMode,
  onConfirm,
}: ImportFromHistoryDialogProps) {
  const sessions = useExternalSessionsStore((s) => s.sessions)
  const loading = useExternalSessionsStore((s) => s.loading)
  const error = useExternalSessionsStore((s) => s.error)
  const loadSessions = useExternalSessionsStore((s) => s.loadSessions)

  const [machineId, setMachineId] = useState<string | undefined>(seedMachineId)
  const [cwd, setCwd] = useState<string | undefined>(seedWorkingDir)
  const [dateWindow, setDateWindow] = useState<DateWindow>("7d")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<"plan" | "playground">(seedPlanMode ? "plan" : "playground")
  const [goal, setGoal] = useState<string>(seedGoal ?? "")
  /** Cutoff for the date filter. Refreshed whenever dateWindow changes or the
   *  dialog opens so the computation stays out of render (react-hooks/purity). */
  const [cutoff, setCutoff] = useState<number>(0)

  // Load sessions when the dialog opens; load all (no scoping) so the cwd
  // dropdown can show every cwd the walker found on the selected machine.
  useEffect(() => {
    if (open) void loadSessions()
  }, [open, loadSessions])

  // Reset seed-derived state when the dialog transitions from closed to open
  // so a freshly-seeded dialog never shows stale session/goal selection.
  const prevOpen = useRef(open)
  /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on open transition */
  useEffect(() => {
    if (open && !prevOpen.current) {
      setMachineId(seedMachineId)
      setCwd(seedWorkingDir)
      setGoal(seedGoal ?? "")
      setMode(seedPlanMode ? "plan" : "playground")
      setSelected(new Set())
      setDateWindow("7d")
      const defaultWindow = DATE_WINDOW_MS["7d"]
      setCutoff(defaultWindow ? Date.now() - defaultWindow : 0)
    }
    prevOpen.current = open
  }, [open, seedMachineId, seedWorkingDir, seedGoal, seedPlanMode])
  /* eslint-enable react-hooks/set-state-in-effect */

  /** Called when the user changes the date filter; reads the wall clock at
   *  event time to avoid impure reads during render. */
  const handleDateWindowChange = (v: DateWindow) => {
    setDateWindow(v)
    const window = DATE_WINDOW_MS[v]
    setCutoff(window ? Date.now() - window : 0)
  }

  const sessionsByMachine = useMemo(() => {
    const map = new Map<string, { name: string; sessions: ExternalAgentSession[] }>()
    for (const s of sessions) {
      const bucket = map.get(s.machineId)
      if (bucket) {
        bucket.sessions.push(s)
      } else {
        map.set(s.machineId, { name: s.machineName, sessions: [s] })
      }
    }
    return map
  }, [sessions])

  const availableCwds = useMemo(() => {
    if (!machineId) return [] as Array<{ cwd: string; count: number; lastModified: number }>
    const bucket = sessionsByMachine.get(machineId)
    if (!bucket) return []
    const acc = new Map<string, { count: number; lastModified: number }>()
    for (const s of bucket.sessions) {
      const key = s.cwd || "(unknown)"
      const prev = acc.get(key)
      if (prev) {
        prev.count += 1
        prev.lastModified = Math.max(prev.lastModified, s.lastModified)
      } else {
        acc.set(key, { count: 1, lastModified: s.lastModified })
      }
    }
    return Array.from(acc.entries())
      .map(([cwd, v]) => ({ cwd, ...v }))
      .sort((a, b) => b.lastModified - a.lastModified)
  }, [machineId, sessionsByMachine])

  const filteredSessions = useMemo(() => {
    if (!machineId || !cwd) return []
    const bucket = sessionsByMachine.get(machineId)
    if (!bucket) return []
    return bucket.sessions
      .filter((s) => (s.cwd || "(unknown)") === cwd)
      .filter((s) => !cutoff || s.lastModified >= cutoff)
      .sort((a, b) => b.lastModified - a.lastModified)
  }, [machineId, cwd, cutoff, sessionsByMachine])

  const selectAll = () => {
    const next = new Set<string>()
    for (const s of filteredSessions) next.add(sessionKey(s))
    setSelected(next)
  }
  const clearAll = () => setSelected(new Set())

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Count from the intersection with filteredSessions — the `selected` Set
  // retains keys across filter changes, so a raw `selected.size` can overstate
  // what the Import button will actually send (and bypass the zod .min(1)
  // check on the server).
  const visibleSelectedCount = useMemo(
    () => filteredSessions.reduce((n, s) => (selected.has(sessionKey(s)) ? n + 1 : n), 0),
    [filteredSessions, selected],
  )
  const canConfirm = Boolean(machineId && cwd && cwd !== "(unknown)" && visibleSelectedCount > 0)

  const handleConfirm = () => {
    if (!canConfirm || !machineId || !cwd) return
    const picks: ImportManifestSelection[] = filteredSessions
      .filter((s) => selected.has(sessionKey(s)))
      .map((s) => ({
        provider: s.provider,
        sessionId: s.sessionId,
        title: bestTitle(s),
        cwd: s.cwd,
        gitBranch: s.gitBranch,
        lastModified: s.lastModified,
      }))
    onConfirm({
      machineId,
      workingDirectory: cwd,
      goal: goal.trim(),
      importManifest: { mode, sessions: picks },
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Import from history
          </DialogTitle>
          <DialogDescription>
            Bootstrap a new Astro project from prior agent sessions. Pick a machine and
            working directory; Astro copies selected transcripts into{" "}
            <code className="text-xs">.astro/imports/</code> and summarizes them before
            planning.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Step 1 — machine */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Step 1 — Machine</Label>
            <Select
              value={machineId ?? ""}
              onValueChange={(v) => {
                setMachineId(v)
                setCwd(undefined)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={loading ? "Loading machines…" : "Select a machine"} />
              </SelectTrigger>
              <SelectContent>
                {Array.from(sessionsByMachine.entries()).map(([id, v]) => (
                  <SelectItem key={id} value={id}>
                    <span className="flex items-center gap-2">
                      <Laptop className="h-3.5 w-3.5 text-muted-foreground" />
                      {v.name}
                      <span className="text-[10px] text-muted-foreground">
                        ({v.sessions.length})
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Step 2 — cwd */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Step 2 — Working directory</Label>
            <Select
              value={cwd ?? ""}
              onValueChange={setCwd}
              disabled={!machineId}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={machineId ? "Select a directory" : "Choose a machine first"}
                />
              </SelectTrigger>
              <SelectContent>
                {availableCwds.map((c) => (
                  <SelectItem key={c.cwd} value={c.cwd} disabled={c.cwd === "(unknown)"}>
                    <span className="flex items-center gap-2">
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-mono text-xs truncate max-w-[380px]">{c.cwd}</span>
                      <span className="text-[10px] text-muted-foreground">
                        ({c.count} session{c.count === 1 ? "" : "s"})
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Step 3 — sessions */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Step 3 — Sessions ({visibleSelectedCount} selected)
              </Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={!machineId || !cwd || filteredSessions.length === 0}
                  onClick={visibleSelectedCount === filteredSessions.length && visibleSelectedCount > 0 ? clearAll : selectAll}
                >
                  {visibleSelectedCount === filteredSessions.length && visibleSelectedCount > 0 ? "Clear" : "Select all"}
                </Button>
                <Select value={dateWindow} onValueChange={(v) => handleDateWindowChange(v as DateWindow)}>
                  <SelectTrigger className="h-7 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">Last 24h</SelectItem>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/20 max-h-[220px] overflow-y-auto">
              {!machineId || !cwd ? (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                  Pick a machine and working directory first.
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-xs text-muted-foreground">
                  <Terminal className="h-4 w-4" />
                  No sessions in this window.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filteredSessions.map((s) => {
                    const key = sessionKey(s)
                    const isOn = selected.has(key)
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          className={cn(
                            "w-full flex items-start gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors",
                            isOn && "bg-accent/50",
                          )}
                        >
                          <Checkbox
                            checked={isOn}
                            className="mt-0.5 pointer-events-none"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                                {PROVIDER_BADGE[s.provider]}
                              </span>
                              <span className="truncate font-medium">{bestTitle(s)}</span>
                              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                                {formatAge(s.lastModified)}
                              </span>
                            </div>
                            {s.gitBranch && (
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <GitBranch className="h-2.5 w-2.5" />
                                {s.gitBranch}
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>

          {/* Mode */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Output</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as "plan" | "playground")}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="plan" id="import-mode-plan" />
                <Label htmlFor="import-mode-plan" className="text-sm cursor-pointer">
                  Bootstrap a plan
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="playground" id="import-mode-playground" />
                <Label htmlFor="import-mode-playground" className="text-sm cursor-pointer">
                  Playground session
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Goal */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">
              Goal (optional) — focuses the synthesis
            </Label>
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Pick up the auth refactor from where we left off."
              rows={2}
              className="text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            Import {visibleSelectedCount > 0 ? `${visibleSelectedCount} session${visibleSelectedCount === 1 ? "" : "s"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
