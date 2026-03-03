import { useMemo, useState, useCallback } from "react"
import {
  Wrench,
  ListFilter,
  Plus,
  Trash2,
  Search,
  LayoutGrid,
  List,
  ToggleLeft,
  ToggleRight,
  ChevronRight,
  Tag,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterSelect } from "@/components/views/filter-select"
import {
  ItemListView,
  type ListColumn,
  type ListGroup,
  type BatchAction,
} from "@/components/views/item-list-view"
import { DisplayPopover, type DisplayPopoverConfig } from "@/components/display-popover"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useSkillStore, type SkillRow } from "@/stores/skill-store"
import { useDisplaySettingsStore } from "@/stores/display-settings-store"
import { cn } from "@/lib/utils"

// --- Source badge styling ---
const sourceConfig: Record<string, { label: string; className: string }> = {
  builtin: { label: "Built-in", className: "bg-primary/10 text-primary" },
  workspace: { label: "Workspace", className: "bg-info/10 text-info" },
  clawhub: { label: "ClawHub", className: "bg-warning/10 text-warning" },
  plugin: { label: "Plugin", className: "bg-success/10 text-success" },
  user: { label: "User", className: "bg-accent text-accent-foreground" },
}

// --- Display config for skills list ---
const skillsDisplayConfig: DisplayPopoverConfig = {
  viewKey: "skills" as never,
  groupByOptions: [
    { value: "none", label: "No grouping" },
    { value: "source", label: "Source" },
    { value: "category", label: "Category" },
  ],
  orderByOptions: [
    { value: "name", label: "Name" },
    { value: "source", label: "Source" },
    { value: "category", label: "Category" },
  ],
  propertyOptions: [
    { value: "enabled", label: "Enabled" },
    { value: "category", label: "Category" },
    { value: "source", label: "Source" },
    { value: "tags", label: "Tags" },
  ],
}

type ViewMode = "list" | "grid"

// --- Column definitions for skills list ---
function getSkillColumns(
  onToggle: (id: string) => void,
): ListColumn<SkillRow>[] {
  return [
    {
      id: "name",
      label: "Name",
      width: "flex-1",
      sortKey: "name",
      render: (skill) => (
        <div className="flex items-center gap-2.5 min-w-0 w-full">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted shrink-0">
            <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">{skill.name}</span>
            {skill.description && (
              <span className="text-[11px] text-muted-foreground truncate max-w-[300px]">
                {skill.description}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "category",
      label: "Category",
      width: "w-[120px]",
      sortKey: "category",
      render: (skill) =>
        skill.category ? (
          <Badge variant="outline" className="text-xs">
            {skill.category}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">&mdash;</span>
        ),
    },
    {
      id: "source",
      label: "Source",
      width: "w-[100px]",
      sortKey: "source",
      render: (skill) => {
        const config = sourceConfig[skill.source] ?? sourceConfig.user
        return (
          <Badge className={cn("text-xs border-0", config.className)}>
            {config.label}
          </Badge>
        )
      },
    },
    {
      id: "tags",
      label: "Tags",
      width: "w-[150px]",
      render: (skill) =>
        skill.tags && skill.tags.length > 0 ? (
          <div className="flex items-center gap-1 flex-wrap">
            {skill.tags.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
            {skill.tags.length > 2 && (
              <span className="text-[10px] text-muted-foreground">
                +{skill.tags.length - 2}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">&mdash;</span>
        ),
    },
    {
      id: "enabled",
      label: "Enabled",
      width: "w-[80px]",
      render: (skill) => (
        <div
          onClick={(e) => {
            e.stopPropagation()
            onToggle(skill.id)
          }}
        >
          <Switch
            checked={skill.enabled}
            aria-label={`Toggle ${skill.name}`}
          />
        </div>
      ),
    },
  ]
}

// --- New Skill Dialog ---
function NewSkillDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (skill: {
    name: string
    description: string
    instructions: string
    category: string
  }) => void
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [instructions, setInstructions] = useState("")
  const [category, setCategory] = useState("")

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!name.trim()) return
      onSubmit({
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        category: category.trim(),
      })
      // Reset form
      setName("")
      setDescription("")
      setInstructions("")
      setCategory("")
      onOpenChange(false)
    },
    [name, description, instructions, category, onSubmit, onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>New Skill</DialogTitle>
          <DialogDescription>
            Create a custom skill that injects instructions into agent prompts
            during task execution.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="skill-name" className="text-sm font-medium">
              Name <span className="text-destructive">*</span>
            </label>
            <Input
              id="skill-name"
              placeholder="e.g. code-review"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="skill-description" className="text-sm font-medium">
              Description
            </label>
            <Input
              id="skill-description"
              placeholder="Brief description of what this skill does"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="skill-category" className="text-sm font-medium">
              Category
            </label>
            <Input
              id="skill-category"
              placeholder="e.g. Development, Research, Testing"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="skill-instructions" className="text-sm font-medium">
              Instructions
            </label>
            <Textarea
              id="skill-instructions"
              placeholder="Markdown instructions injected into the agent prompt..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={6}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create Skill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// --- Skill Card (for grid view) ---
function SkillCard({
  skill,
  onToggle,
}: {
  skill: SkillRow
  onToggle: (id: string) => void
}) {
  const config = sourceConfig[skill.source] ?? sourceConfig.user
  return (
    <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{skill.name}</h3>
            <Badge className={cn("text-[10px] border-0 mt-0.5", config.className)}>
              {config.label}
            </Badge>
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={skill.enabled}
            onCheckedChange={() => onToggle(skill.id)}
            aria-label={`Toggle ${skill.name}`}
          />
        </div>
      </div>

      {/* Description */}
      {skill.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {skill.description}
        </p>
      )}

      {/* Footer: category + tags */}
      <div className="flex items-center gap-2 flex-wrap mt-auto">
        {skill.category && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
            <Tag className="h-2.5 w-2.5" />
            {skill.category}
          </Badge>
        )}
        {skill.tags?.slice(0, 2).map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="text-[10px] px-1.5 py-0"
          >
            {tag}
          </Badge>
        ))}
        {(skill.tags?.length ?? 0) > 2 && (
          <span className="text-[10px] text-muted-foreground">
            +{(skill.tags?.length ?? 0) - 2}
          </span>
        )}
      </div>
    </div>
  )
}

// --- Main Skills Page ---
export function Skills() {
  const skillsMap = useSkillStore((s) => s.skills)
  const addSkill = useSkillStore((s) => s.addSkill)
  const removeSkill = useSkillStore((s) => s.removeSkill)
  const rawToggleSkill = useSkillStore((s) => s.toggleSkill)

  const toggleSkill = useCallback((id: string) => {
    const skill = skillsMap.get(id)
    if (skill?.source === 'builtin') {
      const action = skill.enabled ? 'disable' : 'enable'
      if (!window.confirm(`Are you sure you want to ${action} the built-in skill "${skill.name}"? This may affect default agent behavior.`)) {
        return
      }
    }
    rawToggleSkill(id)
  }, [skillsMap, rawToggleSkill])
  const displaySettings = useDisplaySettingsStore((s) =>
    s.get("skills" as never),
  )
  const updateDisplaySettings = useDisplaySettingsStore((s) => s.update)

  const [viewMode, setViewMode] = useState<ViewMode>("list")
  const [searchQuery, setSearchQuery] = useState("")
  const [sourceFilter, setSourceFilter] = useState("all")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [enabledFilter, setEnabledFilter] = useState("all")
  const [newSkillOpen, setNewSkillOpen] = useState(false)

  // Convert skills map to array
  const allSkills = useMemo(
    () => Array.from(skillsMap.values()),
    [skillsMap],
  )

  // Derive unique categories
  const categories = useMemo(() => {
    const cats = new Set<string>()
    for (const skill of allSkills) {
      if (skill.category) cats.add(skill.category)
    }
    return Array.from(cats).sort()
  }, [allSkills])

  // Derive unique sources
  const sources = useMemo(() => {
    const srcs = new Set<string>()
    for (const skill of allSkills) {
      if (skill.source) srcs.add(skill.source)
    }
    return Array.from(srcs).sort()
  }, [allSkills])

  // Filter and sort skills
  const filteredSkills = useMemo(() => {
    let result = allSkills

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q) ||
          s.category?.toLowerCase().includes(q) ||
          s.tags?.some((t) => t.toLowerCase().includes(q)),
      )
    }

    // Source filter
    if (sourceFilter !== "all") {
      result = result.filter((s) => s.source === sourceFilter)
    }

    // Category filter
    if (categoryFilter !== "all") {
      result = result.filter((s) => s.category === categoryFilter)
    }

    // Enabled filter
    if (enabledFilter !== "all") {
      const isEnabled = enabledFilter === "enabled"
      result = result.filter((s) => s.enabled === isEnabled)
    }

    // Sort
    const sorted = [...result]
    const dir = displaySettings.orderDirection === "asc" ? 1 : -1
    sorted.sort((a, b) => {
      switch (displaySettings.orderBy) {
        case "name":
          return dir * a.name.localeCompare(b.name)
        case "source":
          return dir * (a.source ?? "").localeCompare(b.source ?? "")
        case "category":
          return dir * (a.category ?? "").localeCompare(b.category ?? "")
        default:
          return dir * a.name.localeCompare(b.name)
      }
    })

    return sorted
  }, [
    allSkills,
    searchQuery,
    sourceFilter,
    categoryFilter,
    enabledFilter,
    displaySettings.orderBy,
    displaySettings.orderDirection,
  ])

  // Group skills for list view
  const listGroups = useMemo((): ListGroup<SkillRow>[] => {
    if (displaySettings.groupBy === "none") {
      return [{ key: "all", label: "All Skills", items: filteredSkills }]
    }
    const grouped = filteredSkills.reduce<Record<string, SkillRow[]>>(
      (acc, skill) => {
        let group: string
        switch (displaySettings.groupBy) {
          case "source": {
            const config = sourceConfig[skill.source]
            group = config?.label ?? "Other"
            break
          }
          case "category":
            group = skill.category || "Uncategorized"
            break
          default:
            group = "All Skills"
        }
        ;(acc[group] ??= []).push(skill)
        return acc
      },
      {},
    )
    return Object.entries(grouped).map(([label, items]) => ({
      key: label,
      label,
      icon: <Wrench className="h-4 w-4 text-muted-foreground" />,
      items,
    }))
  }, [filteredSkills, displaySettings.groupBy])

  // Batch actions
  const batchActions: BatchAction[] = useMemo(
    () => [
      {
        id: "enable",
        label: "Enable",
        icon: <ToggleRight className="h-3.5 w-3.5" />,
        onAction: (ids) => {
          for (const skill of allSkills) {
            if (ids.includes(skill.id) && !skill.enabled) {
              toggleSkill(skill.id)
            }
          }
        },
      },
      {
        id: "disable",
        label: "Disable",
        icon: <ToggleLeft className="h-3.5 w-3.5" />,
        onAction: (ids) => {
          for (const skill of allSkills) {
            if (ids.includes(skill.id) && skill.enabled) {
              toggleSkill(skill.id)
            }
          }
        },
      },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-3.5 w-3.5" />,
        variant: "destructive",
        onAction: (ids) => {
          for (const skill of allSkills) {
            if (ids.includes(skill.id) && skill.source !== 'builtin') {
              removeSkill(skill.id)
            }
          }
        },
      },
    ],
    [allSkills, toggleSkill, removeSkill],
  )

  const handleSort = useCallback(
    (sortKey: string) => {
      if (displaySettings.orderBy === sortKey) {
        updateDisplaySettings("skills" as never, {
          orderDirection:
            displaySettings.orderDirection === "asc" ? "desc" : "asc",
        })
      } else {
        updateDisplaySettings("skills" as never, {
          orderBy: sortKey,
          orderDirection: "asc",
        })
      }
    },
    [
      displaySettings.orderBy,
      displaySettings.orderDirection,
      updateDisplaySettings,
    ],
  )

  const handleCreateSkill = useCallback(
    (data: {
      name: string
      description: string
      instructions: string
      category: string
    }) => {
      addSkill({
        name: data.name,
        description: data.description,
        instructions: data.instructions,
        source: "workspace",
        enabled: true,
        config: {},
        ...(data.category ? { category: data.category } : {}),
      } as never)
    },
    [addSkill],
  )

  const columns = useMemo(
    () => getSkillColumns(toggleSkill),
    [toggleSkill],
  )

  const viewAsOptions = [
    { value: "list", label: "List" },
    { value: "grid", label: "Grid" },
  ]

  return (
    <div className="flex flex-1 flex-col min-w-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-primary font-semibold">Skills</h1>
          <span className="text-sm text-muted-foreground">
            {filteredSkills.length}
            {filteredSkills.length !== allSkills.length && ` of ${allSkills.length}`}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setNewSkillOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden md:inline">New Skill</span>
          </Button>
          <DisplayPopover
            config={{
              ...skillsDisplayConfig,
              viewAsOptions,
              activeViewAs: viewMode,
              onViewAsChange: (v) => setViewMode(v as ViewMode),
            }}
          />
        </div>
      </div>

      {/* New Skill Dialog */}
      <NewSkillDialog
        open={newSkillOpen}
        onOpenChange={setNewSkillOpen}
        onSubmit={handleCreateSkill}
      />

      {/* Filter Bar */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent pl-8 pr-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <ListFilter className="h-4 w-4 text-muted-foreground" />
            <FilterSelect
              label="Source"
              value={sourceFilter}
              options={[
                { value: "all", label: "All sources" },
                ...sources.map((s) => ({
                  value: s,
                  label: sourceConfig[s]?.label ?? s,
                })),
              ]}
              onChange={setSourceFilter}
            />
            <FilterSelect
              label="Category"
              value={categoryFilter}
              options={[
                { value: "all", label: "All categories" },
                ...categories.map((c) => ({ value: c, label: c })),
              ]}
              onChange={setCategoryFilter}
            />
            <FilterSelect
              label="Status"
              value={enabledFilter}
              options={[
                { value: "all", label: "All statuses" },
                { value: "enabled", label: "Enabled" },
                { value: "disabled", label: "Disabled" },
              ]}
              onChange={setEnabledFilter}
            />
          </div>
        </div>
        {/* Mobile: view mode toggle */}
        <div className="flex items-center gap-1 sm:hidden">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              viewMode === "list"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              viewMode === "grid"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      {allSkills.length === 0 ? (
        <div className="flex-1 overflow-auto">
          <EmptyState
            icon={Wrench}
            title="No skills yet"
            description="Skills inject instructions into agent prompts during task execution. Create your first skill or install one from ClawHub."
            action={{
              label: "Create Skill",
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
            description="Try adjusting your search or filters to find what you're looking for."
            className="h-full"
          />
        </div>
      ) : viewMode === "list" ? (
        <ItemListView
          columns={columns}
          groups={listGroups}
          visibleColumns={displaySettings.visibleProperties ?? ["category", "source", "enabled"]}
          getItemId={(s) => s.id}
          batchActions={batchActions}
          sortColumn={displaySettings.orderBy}
          sortDirection={displaySettings.orderDirection}
          onSort={handleSort}
          renderMobileItem={(skill) => {
            const config = sourceConfig[skill.source] ?? sourceConfig.user
            return (
              <div className="w-full flex items-center gap-3.5 rounded-2xl bg-card p-4 transition-all shadow-sm hover:shadow-md border border-border text-left">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted shrink-0">
                  <Wrench className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-base truncate">
                      {skill.name}
                    </h3>
                    <Badge
                      className={cn("text-[10px] border-0 shrink-0", config.className)}
                    >
                      {config.label}
                    </Badge>
                  </div>
                  {skill.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {skill.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {skill.category && (
                      <>
                        <span>{skill.category}</span>
                        <span className="text-muted-foreground/40">&middot;</span>
                      </>
                    )}
                    <span>{skill.enabled ? "Enabled" : "Disabled"}</span>
                  </div>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={() => toggleSkill(skill.id)}
                  />
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              </div>
            )
          }}
        />
      ) : (
        /* Grid View */
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onToggle={toggleSkill}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
