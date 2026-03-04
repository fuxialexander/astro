import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { Github, GitFork, Lock, Loader2 } from "lucide-react"
import Fuse from "fuse.js"
import { useGitHubStore } from "@/stores/github-store"
import { useProjectStore } from "@/stores/project-store"
import { usePlanStore } from "@/stores/plan-store"
import { useToastStore } from "@/stores/toast-store"
import { apiUrl } from "@/lib/api-url"
import { getAccessToken } from "@/lib/supabase-client"
import { cn } from "@/lib/utils"
import type { GitHubRepo } from "@/types"

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {}
  const token = await getAccessToken()
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }
  return headers
}

interface GitHubRepoPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When provided, selecting a repo calls this callback instead of POSTing to create a project */
  onSelect?: (repo: GitHubRepo) => void
}

export function GitHubRepoPickerDialog({ open, onOpenChange, onSelect }: GitHubRepoPickerDialogProps) {
  const repos = useGitHubStore((s) => s.repos)
  const loading = useGitHubStore((s) => s.loading)
  const projects = useProjectStore((s) => s.projects)
  const addToast = useToastStore((s) => s.add)

  const [search, setSearch] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [linking, setLinking] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Already-linked repo keys to exclude
  const linkedRepoKeys = useMemo(
    () =>
      new Set(
        projects
          .filter((p) => p.projectType === "github" && p.githubOwner && p.githubRepo)
          .map((p) => `${p.githubOwner}/${p.githubRepo}`)
      ),
    [projects]
  )

  // Available repos (not already linked)
  const availableRepos = useMemo(
    () => repos.filter((r) => !linkedRepoKeys.has(r.fullName)),
    [repos, linkedRepoKeys]
  )

  // Fuse.js for fuzzy search
  const fuse = useMemo(
    () =>
      new Fuse(availableRepos, {
        keys: [
          { name: "fullName", weight: 2 },
          { name: "description", weight: 1 },
          { name: "language", weight: 0.5 },
        ],
        threshold: 0.35,
        includeScore: true,
      }),
    [availableRepos]
  )

  // Filtered results
  const filteredRepos = useMemo(() => {
    if (!search.trim()) return availableRepos.slice(0, 50)
    return fuse.search(search).map((r) => r.item)
  }, [search, availableRepos, fuse])

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setSearch("")
      setSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= filteredRepos.length) {
      setSelectedIndex(Math.max(0, filteredRepos.length - 1))
    }
  }, [filteredRepos.length, selectedIndex])

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`)
    if (selected) {
      selected.scrollIntoView({ block: "nearest" })
    }
  }, [selectedIndex])

  const handleLink = useCallback(
    async (repo: GitHubRepo) => {
      // In onSelect mode, just return the repo without creating a project
      if (onSelect) {
        onSelect(repo)
        onOpenChange(false)
        return
      }

      setLinking(repo.id)
      try {
        const hdrs = await authHeaders()
        const res = await fetch(apiUrl("/api/github/projects"), {
          method: "POST",
          headers: { ...hdrs, "Content-Type": "application/json" },
          body: JSON.stringify({
            repoId: repo.id,
            owner: repo.owner.login,
            repo: repo.name,
          }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || "Failed to link repository")
        }
        const data = await res.json()
        await useProjectStore.getState().load()
        await usePlanStore.getState().load()
        addToast({
          type: "success",
          title: "Repository imported",
          description: `${repo.fullName} synced ${data.sync?.total ?? 0} issues`,
        })
        onOpenChange(false)
      } catch (err) {
        addToast({
          type: "error",
          title: "Failed to import repository",
          description: err instanceof Error ? err.message : "Unknown error",
        })
      } finally {
        setLinking(null)
      }
    },
    [addToast, onOpenChange, onSelect]
  )

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filteredRepos.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === "Enter") {
        e.preventDefault()
        const repo = filteredRepos[selectedIndex]
        if (repo && !linking) handleLink(repo)
      } else if (e.key === "Escape") {
        e.preventDefault()
        onOpenChange(false)
      }
    },
    [filteredRepos, selectedIndex, linking, handleLink, onOpenChange]
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60"
        onClick={() => onOpenChange(false)}
      />

      {/* Picker panel */}
      <div className="fixed left-1/2 top-[15vh] w-full max-w-[540px] -translate-x-1/2 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Github className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search repositories..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-[400px] overflow-y-auto">
          {filteredRepos.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {loading
                ? "Loading repositories..."
                : search
                  ? "No matching repositories"
                  : "No available repositories"}
            </div>
          ) : (
            filteredRepos.map((repo, index) => (
              <button
                key={repo.id}
                data-index={index}
                type="button"
                onClick={() => handleLink(repo)}
                disabled={linking === repo.id}
                className={cn(
                  "flex items-start gap-3 w-full px-4 py-2.5 text-left transition-colors cursor-pointer",
                  index === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/50"
                )}
              >
                <Github className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {repo.fullName}
                    </span>
                    {repo.private && (
                      <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                  </div>
                  {repo.description && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {repo.description}
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {repo.language && (
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        {repo.language}
                      </span>
                    )}
                    {repo.fork && (
                      <span className="flex items-center gap-1">
                        <GitFork className="h-3 w-3" />
                        Fork
                      </span>
                    )}
                  </div>
                </div>
                {linking === repo.id && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0 mt-0.5" />
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground">
          <span>{availableRepos.length} repositories available</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">↵</kbd>
              {onSelect ? "select" : "import"}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">esc</kbd>
              close
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
