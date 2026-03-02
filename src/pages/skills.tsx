import { useMemo, useState, useCallback } from "react"
import {
  Zap,
  Search,
  Plus,
  ListFilter,
  LayoutGrid,
  List,
  Trash2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { FilterSelect } from "@/components/views/filter-select"
import { useSkillStore } from "@/stores/skill-store"
import { parseSkillMd } from "@/lib/skill-loader"
import { cn } from "@/lib/utils"
import type { OpenClawSkill } from "@/types/skill"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const sourceColors: Record<OpenClawSkill["source"], string> = {
  builtin: "bg-info/10 text-info",
  workspace: "bg-success/10 text-success",
  clawhub: "bg-primary/10 text-primary",
  plugin: "bg-warning/10 text-warning",
}

type ViewMode = "grid" | "list"

// ---------------------------------------------------------------------------
// SkillGridCard — card for grid view
// ---------------------------------------------------------------------------

function SkillGridCard({ skill }: { skill: OpenClawSkill }) {
  const enableSkill = useSkillStore((s) => s.enableSkill)
  const disableSkill = useSkillStore((s) => s.disableSkill)
  const removeSkill = useSkillStore((s) => s.removeSkill)
  const [expanded, setExpanded] = useState(false)

  const emoji = skill.metadata?.openclaw?.emoji || ""

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {emoji && <span className="text-lg shrink-0">{emoji}</span>}
          <h3 className="text-sm font-medium truncate">{skill.name}</h3>
        </div>
        <Switch
          checked={skill.enabled}
          onCheckedChange={(checked) =>
            checked ? enableSkill(skill.name) : disableSkill(skill.name)
          }
        />
      </div>

      {/* Source badge */}
      <div className="flex items-center gap-2 mb-2">
        <Badge
          className={cn(
            "text-[10px] py-0 h-4 border-0",
            sourceColors[skill.source]
          )}
        >
          {skill.source}
        </Badge>
        {skill.userInvocable && (
          <Badge variant="outline" className="text-[10px] py-0 h-4">
            slash command
          </Badge>
        )}
      </div>

      {/* Description */}
      {skill.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3 flex-1">
          {skill.description}
        </p>
      )}

      {/* Expandable instructions preview */}
      <div className="mt-auto">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Instructions
        </button>
        {expanded && (
          <pre className="mt-2 rounded-md bg-muted/30 p-2.5 text-[11px] text-muted-foreground whitespace-pre-wrap max-h-28 overflow-y-auto">
            {skill.instructions.length > 400
              ? skill.instructions.slice(0, 400) + "..."
              : skill.instructions}
          </pre>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        {skill.homepage ? (
          <a
            href={skill.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Homepage
          </a>
        ) : (
          <span />
        )}
        {skill.source !== "builtin" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeSkill(skill.name)}
            className="text-destructive hover:text-destructive h-7 w-7 p-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SkillListRow — row for list view
// ---------------------------------------------------------------------------

function SkillListRow({ skill }: { skill: OpenClawSkill }) {
  const enableSkill = useSkillStore((s) => s.enableSkill)
  const disableSkill = useSkillStore((s) => s.disableSkill)
  const removeSkill = useSkillStore((s) => s.removeSkill)
  const [expanded, setExpanded] = useState(false)

  const emoji = skill.metadata?.openclaw?.emoji || ""

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 hover:bg-muted/50 rounded cursor-pointer"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {emoji && <span className="text-sm">{emoji}</span>}
              <span className="text-sm font-medium truncate">{skill.name}</span>
              <Badge
                className={cn(
                  "text-[10px] py-0 h-4 border-0 shrink-0",
                  sourceColors[skill.source]
                )}
              >
                {skill.source}
              </Badge>
              {skill.userInvocable && (
                <Badge variant="outline" className="text-[10px] py-0 h-4 shrink-0">
                  slash command
                </Badge>
              )}
            </div>
            {skill.description && (
              <span className="text-[12px] text-muted-foreground truncate">
                {skill.description}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <Switch
            checked={skill.enabled}
            onCheckedChange={(checked) =>
              checked ? enableSkill(skill.name) : disableSkill(skill.name)
            }
          />
          {skill.source !== "builtin" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeSkill(skill.name)}
              className="text-destructive hover:text-destructive h-8 w-8 p-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-6 pb-3.5 pl-14">
          {/* Instruction preview */}
          <div className="rounded-md bg-muted/30 p-3 mb-3">
            <span className="text-[11px] font-medium text-muted-foreground mb-1 block">
              Instructions (preview)
            </span>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">
              {skill.instructions.length > 500
                ? skill.instructions.slice(0, 500) + "..."
                : skill.instructions}
            </pre>
          </div>

          {/* Requirements */}
          {skill.metadata?.openclaw?.requires && (
            <div className="mt-2">
              <span className="text-[11px] font-medium text-muted-foreground block mb-1">
                Requirements
              </span>
              <div className="flex flex-wrap gap-1">
                {skill.metadata.openclaw.requires.bins?.map((bin) => (
                  <Badge key={bin} variant="outline" className="text-[10px]">
                    {bin}
                  </Badge>
                ))}
                {skill.metadata.openclaw.requires.env?.map((env) => (
                  <Badge key={env} variant="outline" className="text-[10px]">
                    ${env}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Homepage link */}
          {skill.homepage && (
            <div className="mt-2">
              <a
                href={skill.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Visit homepage
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// NewSkillDialog — form dialog for adding skills
// ---------------------------------------------------------------------------

function NewSkillDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const addSkill = useSkillStore((s) => s.addSkill)
  const [mode, setMode] = useState<"form" | "paste">("form")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [instructions, setInstructions] = useState("")
  const [source, setSource] = useState<OpenClawSkill["source"]>("workspace")
  const [pasteContent, setPasteContent] = useState("")
  const [error, setError] = useState<string | null>(null)

  const resetForm = useCallback(() => {
    setName("")
    setDescription("")
    setInstructions("")
    setSource("workspace")
    setPasteContent("")
    setError(null)
    setMode("form")
  }, [])

  const handleCreate = useCallback(() => {
    setError(null)
    if (mode === "paste") {
      if (!pasteContent.trim()) {
        setError("SKILL.md content cannot be empty")
        return
      }
      try {
        const skill = parseSkillMd(pasteContent.trim(), "workspace")
        addSkill(skill)
        resetForm()
        onOpenChange(false)
      } catch (err) {
        setError(`Failed to parse SKILL.md: ${err instanceof Error ? err.message : "Unknown error"}`)
      }
      return
    }

    // Form mode
    if (!name.trim()) {
      setError("Skill name is required")
      return
    }
    const skill: OpenClawSkill = {
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      source,
      enabled: true,
      userInvocable: true,
      config: {},
    }
    addSkill(skill)
    resetForm()
    onOpenChange(false)
  }, [mode, name, description, instructions, source, pasteContent, addSkill, onOpenChange, resetForm])

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New Skill</DialogTitle>
          <DialogDescription>
            Add a custom skill that injects instructions into AI agent prompts.
          </DialogDescription>
        </DialogHeader>

        {/* Mode tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5 w-fit">
          <button
            onClick={() => setMode("form")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              mode === "form"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Manual
          </button>
          <button
            onClick={() => setMode("paste")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              mode === "paste"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Paste SKILL.md
          </button>
        </div>

        {mode === "form" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-custom-skill"
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this skill does..."
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <div className="flex items-center gap-2">
                {(["workspace", "builtin", "clawhub", "plugin"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSource(s)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer border",
                      source === s
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Instructions</label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Instructions injected into the agent prompt..."
                className="h-[120px] w-full resize-none rounded-md border border-border bg-background p-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">SKILL.md Content</label>
            <textarea
              value={pasteContent}
              onChange={(e) => setPasteContent(e.target.value)}
              placeholder={"---\nname: my-skill\ndescription: A custom skill\n---\n\nInstructions for the agent..."}
              className="h-[200px] w-full resize-none rounded-md border border-border bg-background p-2.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { resetForm(); onOpenChange(false) }}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreate}>
            Add Skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Skills Page
// ---------------------------------------------------------------------------

export function Skills() {
  const skills = useSkillStore((s) => s.skills)
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [searchQuery, setSearchQuery] = useState("")
  const [sourceFilter, setSourceFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [newSkillOpen, setNewSkillOpen] = useState(false)

  const skillEntries = useMemo(
    () => Array.from(skills.values()),
    [skills]
  )

  // Unique sources for filter
  const availableSources = useMemo(() => {
    const sources = new Set(skillEntries.map((s) => s.source))
    return Array.from(sources).sort()
  }, [skillEntries])

  // Filter and search
  const filteredSkills = useMemo(() => {
    let result = skillEntries

    // Search by name or description
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      )
    }

    // Filter by source
    if (sourceFilter !== "all") {
      result = result.filter((s) => s.source === sourceFilter)
    }

    // Filter by enabled/disabled
    if (statusFilter !== "all") {
      const enabled = statusFilter === "enabled"
      result = result.filter((s) => s.enabled === enabled)
    }

    // Sort: enabled first, then alphabetical
    result.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return result
  }, [skillEntries, searchQuery, sourceFilter, statusFilter])

  // Counts
  const enabledCount = useMemo(
    () => skillEntries.filter((s) => s.enabled).length,
    [skillEntries]
  )

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-primary font-semibold">Skills</h1>
          <span className="text-xs text-muted-foreground">
            {enabledCount} enabled · {skillEntries.length} total
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={cn(
                "flex items-center justify-center h-8 w-8 transition-colors cursor-pointer",
                viewMode === "grid"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
              )}
              title="Grid view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <div className="w-px h-5 bg-border" />
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "flex items-center justify-center h-8 w-8 transition-colors cursor-pointer",
                viewMode === "list"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
              )}
              title="List view"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>

          <Button size="sm" className="gap-1.5" onClick={() => setNewSkillOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden md:inline">New Skill</span>
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <ListFilter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Filter</span>
        </div>
        <div className="flex items-center gap-3">
          <FilterSelect
            label="Source"
            value={sourceFilter}
            options={[
              { value: "all", label: "All sources" },
              ...availableSources.map((s) => ({ value: s, label: s })),
            ]}
            onChange={setSourceFilter}
          />
          <FilterSelect
            label="Status"
            value={statusFilter}
            options={[
              { value: "all", label: "All statuses" },
              { value: "enabled", label: "Enabled" },
              { value: "disabled", label: "Disabled" },
            ]}
            onChange={setStatusFilter}
          />
        </div>
        {/* Search */}
        <div className="ml-auto relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search skills..."
            className="h-8 w-[200px] pl-8 text-xs"
          />
        </div>
      </div>

      {/* Content */}
      {skillEntries.length === 0 ? (
        <div className="flex-1 overflow-auto">
          <EmptyState
            icon={Zap}
            title="No skills installed"
            description="Skills inject custom instructions into AI agent prompts. Add one manually or paste a SKILL.md file."
            action={{
              label: "New Skill",
              onClick: () => setNewSkillOpen(true),
            }}
            className="h-full"
          />
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="flex-1 overflow-auto">
          <EmptyState
            icon={Search}
            title="No matching skills"
            description="Try adjusting your search or filters."
            className="h-full"
          />
        </div>
      ) : viewMode === "grid" ? (
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredSkills.map((skill) => (
              <SkillGridCard key={skill.name} skill={skill} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="rounded-xl border border-border bg-card mx-6 mt-4">
            {filteredSkills.map((skill) => (
              <SkillListRow key={skill.name} skill={skill} />
            ))}
          </div>
        </div>
      )}

      {/* New Skill Dialog */}
      <NewSkillDialog open={newSkillOpen} onOpenChange={setNewSkillOpen} />
    </div>
  )
}
