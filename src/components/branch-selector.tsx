import { useState, useRef, useCallback } from 'react'
import { GitBranch, ChevronDown, Loader2, Check, Search, Plus } from 'lucide-react'
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
  /** When true, selecting a branch triggers git checkout on the machine */
  checkoutOnSelect?: boolean
  /** Callback after successful checkout (e.g., to re-run detection) */
  onCheckout?: (branch: string) => void
  /** Compact variant for inline use */
  compact?: boolean
}

export function BranchSelector({ value, onChange, path, machineId, repository, disabled, checkoutOnSelect, onCheckout, compact }: BranchSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutingBranch, setCheckoutingBranch] = useState<string | null>(null)
  const [pendingStashBranch, setPendingStashBranch] = useState<string | null>(null)
  const [creatingBranch, setCreatingBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const { branches, isLoading, error, fetchBranches, fetchGitHubBranches, checkoutBranch, createBranch, isCheckingOut } = useBranchList()
  const fetchedKeyRef = useRef<string>('')

  // Fetch on open, using a ref to track which source was fetched
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setCheckoutError(null)
      setPendingStashBranch(null)
      setCreatingBranch(false)
      setNewBranchName('')
    }
    if (nextOpen) {
      setCheckoutError(null)
      if (repository) {
        const key = `github:${repository}`
        if (fetchedKeyRef.current !== key) {
          fetchedKeyRef.current = key
          fetchGitHubBranches(repository)
        }
      } else if (path && machineId) {
        const key = `relay:${path}:${machineId}`
        // Always re-fetch when opening in checkout mode for fresh data
        if (fetchedKeyRef.current !== key || checkoutOnSelect) {
          fetchedKeyRef.current = key
          fetchBranches(path, machineId)
        }
      }
    }
  }, [path, machineId, repository, checkoutOnSelect, fetchBranches, fetchGitHubBranches])

  const isDirtyWorkdirError = (error: string) =>
    error.includes('local changes') || error.includes('would be overwritten') || error.includes('Please commit your changes or stash them')

  const handleSelectBranch = useCallback(async (branch: BranchInfo) => {
    if (checkoutOnSelect && path && machineId) {
      // Skip checkout if it's already the current branch
      if (branch.isCurrent) {
        setOpen(false)
        setSearch('')
        return
      }
      setCheckoutingBranch(branch.name)
      setCheckoutError(null)
      setPendingStashBranch(null)
      const result = await checkoutBranch(path, machineId, branch.name)
      setCheckoutingBranch(null)
      if (result.success) {
        onChange(branch.name)
        onCheckout?.(branch.name)
        setOpen(false)
        setSearch('')
      } else {
        const errMsg = result.error || 'Checkout failed'
        setCheckoutError(errMsg)
        if (isDirtyWorkdirError(errMsg)) {
          setPendingStashBranch(branch.name)
        }
      }
    } else {
      onChange(branch.name)
      setOpen(false)
      setSearch('')
    }
  }, [checkoutOnSelect, path, machineId, checkoutBranch, onChange, onCheckout])

  const handleStashAndSwitch = useCallback(async () => {
    if (!pendingStashBranch || !path || !machineId) return
    setCheckoutingBranch(pendingStashBranch)
    setCheckoutError(null)
    setPendingStashBranch(null)
    const result = await checkoutBranch(path, machineId, pendingStashBranch, true)
    setCheckoutingBranch(null)
    if (result.success) {
      onChange(pendingStashBranch)
      onCheckout?.(pendingStashBranch)
      setOpen(false)
      setSearch('')
    } else {
      setCheckoutError(result.error || 'Stash & switch failed')
    }
  }, [pendingStashBranch, path, machineId, checkoutBranch, onChange, onCheckout])

  const handleCreateBranch = useCallback(async () => {
    const name = newBranchName.trim()
    if (!name || !path || !machineId) return
    setCheckoutError(null)
    const result = await createBranch(path, machineId, name)
    if (result.success) {
      onChange(name)
      onCheckout?.(name)
      setOpen(false)
      setSearch('')
      setCreatingBranch(false)
      setNewBranchName('')
    } else {
      setCheckoutError(result.error || 'Create branch failed')
    }
  }, [newBranchName, path, machineId, createBranch, onChange, onCheckout])

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

  // Validate branch name: alphanumeric, /, -, _, .
  const isValidBranchName = /^[a-zA-Z0-9/_.-]+$/.test(newBranchName.trim())

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "shrink-0 flex items-center gap-1.5 rounded-md border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
            compact ? "h-7 px-2 text-[11px]" : "h-8 px-2.5 text-xs",
            "border-border hover:bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          <GitBranch className={cn("shrink-0", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
          <span className="truncate max-w-[120px]">{value || 'Select branch'}</span>
          <ChevronDown className={cn("shrink-0 opacity-50", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
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

        {/* Error message */}
        {checkoutError && (
          <div className="px-3 py-2 border-b border-border bg-destructive/5">
            <p className="text-xs text-destructive">{checkoutError}</p>
            {pendingStashBranch && (
              <button
                type="button"
                onClick={handleStashAndSwitch}
                disabled={isCheckingOut}
                className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 cursor-pointer disabled:opacity-50"
              >
                {isCheckingOut ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Stash changes &amp; switch to {pendingStashBranch}
              </button>
            )}
          </div>
        )}

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
                isCheckingOut={checkoutingBranch === branch.name}
                onSelect={() => handleSelectBranch(branch)}
              />
            ))
          )}
        </div>

        {/* Create new branch */}
        {checkoutOnSelect && path && machineId && !isLoading && (
          <div className="border-t border-border">
            {creatingBranch ? (
              <div className="flex items-center gap-2 px-3 py-2">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isValidBranchName) handleCreateBranch()
                    if (e.key === 'Escape') { setCreatingBranch(false); setNewBranchName('') }
                  }}
                  placeholder="new-branch-name"
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                  autoFocus
                />
                <button
                  type="button"
                  disabled={!isValidBranchName || isCheckingOut}
                  onClick={handleCreateBranch}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isCheckingOut ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreatingBranch(true)}
                className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent/50 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Create and checkout new branch...
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function BranchItem({
  branch,
  isSelected,
  isCheckingOut,
  onSelect,
}: {
  branch: BranchInfo
  isSelected: boolean
  isCheckingOut?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={isCheckingOut}
      className={cn(
        "flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm transition-colors",
        "hover:bg-accent/50 cursor-pointer",
        isSelected && "bg-accent/30",
        isCheckingOut && "opacity-60",
      )}
    >
      {isCheckingOut ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        <Check className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
      )}
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
