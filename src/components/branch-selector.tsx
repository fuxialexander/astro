import { useState, useRef, useCallback } from 'react'
import { GitBranch, ChevronDown, Loader2, Check, Search } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useBranchList, type BranchInfo } from '@/hooks/use-branch-list'
import { cn } from '@/lib/utils'

interface BranchSelectorProps {
  /** Currently selected branch */
  value?: string
  /** Callback when branch changes */
  onChange: (branch: string) => void
  /** Directory path on the remote machine (relay mode) */
  path?: string
  /** Machine ID for relay (relay mode) */
  machineId?: string
  /** GitHub repo full name e.g. "owner/repo" (GitHub API mode) */
  repository?: string
  /** Whether the selector is disabled */
  disabled?: boolean
}

export function BranchSelector({ value, onChange, path, machineId, repository, disabled }: BranchSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { branches, isLoading, error, fetchBranches, fetchGitHubBranches } = useBranchList()
  const fetchedKeyRef = useRef<string>('')

  // Fetch on open, using a ref to track which source was fetched
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      if (repository) {
        const key = `github:${repository}`
        if (fetchedKeyRef.current !== key) {
          fetchedKeyRef.current = key
          fetchGitHubBranches(repository)
        }
      } else if (path && machineId) {
        const key = `relay:${path}:${machineId}`
        if (fetchedKeyRef.current !== key) {
          fetchedKeyRef.current = key
          fetchBranches(path, machineId)
        }
      }
    }
  }, [path, machineId, repository, fetchBranches, fetchGitHubBranches])

  const filtered = branches.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  )

  // Sort: remote branches first, then local-only; default/current badges at top
  const sorted = [...filtered].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1
    if (!a.isDefault && b.isDefault) return 1
    if (a.isCurrent && !b.isCurrent) return -1
    if (!a.isCurrent && b.isCurrent) return 1
    if (a.isRemote && !b.isRemote) return -1
    if (!a.isRemote && b.isRemote) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex items-center gap-2 h-9 rounded-lg border border-border bg-card px-3 text-sm transition-colors hover:bg-accent/50",
            "focus:outline-none focus:ring-1 focus:ring-ring",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate max-w-[200px]">{value || 'Select branch'}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-auto" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search branches..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            autoFocus
          />
        </div>

        {/* Branch list */}
        <div className="max-h-60 overflow-y-auto py-1">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading branches...
            </div>
          ) : error ? (
            <div className="px-3 py-4 text-sm text-destructive">{error}</div>
          ) : sorted.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              {search ? 'No matching branches' : 'No branches found'}
            </div>
          ) : (
            sorted.map((branch) => (
              <BranchItem
                key={`${branch.name}-${branch.isRemote}`}
                branch={branch}
                isSelected={value === branch.name}
                onSelect={() => {
                  onChange(branch.name)
                  setOpen(false)
                  setSearch('')
                }}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function BranchItem({
  branch,
  isSelected,
  onSelect,
}: {
  branch: BranchInfo
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm transition-colors",
        "hover:bg-accent/50 cursor-pointer",
        isSelected && "bg-accent/30",
      )}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
      <span className="truncate flex-1">{branch.name}</span>
      <div className="flex items-center gap-1 shrink-0">
        {branch.isDefault && (
          <span className="text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
            default
          </span>
        )}
        {branch.isCurrent && (
          <span className="text-[10px] font-medium bg-warning/10 text-warning px-1.5 py-0.5 rounded">
            current
          </span>
        )}
      </div>
    </button>
  )
}
