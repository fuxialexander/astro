import { useState, useEffect, useMemo, useCallback } from "react"
import { Users, UserPlus, Trash2, Loader2, Shield, Eye, Pencil, Crown } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { dataClient } from "@/lib/data-client"
import { useTeamStore } from "@/stores/team-store"
import { useAuthStore } from "@/stores/auth-store"
import type { ProjectMember, ProjectMemberRole, TeamMember } from "@/types"

const roleConfig: Record<ProjectMemberRole, { label: string; icon: typeof Eye }> = {
  owner: { label: "Owner", icon: Crown },
  editor: { label: "Editor", icon: Pencil },
  viewer: { label: "Viewer", icon: Eye },
}

interface ProjectSharingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

export function ProjectSharingDialog({ open, onOpenChange, projectId }: ProjectSharingDialogProps) {
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [addingUserId, setAddingUserId] = useState<string | null>(null)
  const [removingUserId, setRemovingUserId] = useState<string | null>(null)
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Get team members for the "add" search
  const teams = useTeamStore((s) => s.teams)
  const currentUser = useAuthStore((s) => s.user)
  const [teamMembers, setTeamMembers] = useState<Array<TeamMember & { userName?: string; userEmail?: string }>>([])
  const activeTeamId = teams.length > 0 ? teams[0].id : undefined

  // Fetch project members and team members when dialog opens
  useEffect(() => {
    if (!open) return
    setError(null)
    setLoading(true)

    const loadData = async () => {
      try {
        const [projectData, teamMembersList] = await Promise.all([
          dataClient.getProjectMembers(projectId),
          activeTeamId ? dataClient.getTeamMembers(activeTeamId) : Promise.resolve([]),
        ])
        setMembers(projectData.members)
        setIsOwner(projectData.isOwner)
        setTeamMembers(teamMembersList)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load members")
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [open, projectId, activeTeamId])

  // Filter team members that aren't already project members
  const existingUserIds = useMemo(() => new Set(members.map((m) => m.userId)), [members])

  const availableToAdd = useMemo(() => {
    const filtered = teamMembers.filter((tm) => !existingUserIds.has(tm.userId))
    if (!search.trim()) return filtered
    const q = search.toLowerCase()
    return filtered.filter(
      (tm) =>
        (tm.userName?.toLowerCase().includes(q)) ||
        (tm.userEmail?.toLowerCase().includes(q))
    )
  }, [teamMembers, existingUserIds, search])

  const handleAddMember = useCallback(async (userId: string, role: ProjectMemberRole = "viewer") => {
    setAddingUserId(userId)
    setError(null)
    try {
      await dataClient.addProjectMember(projectId, userId, role)
      // Refresh member list
      const updated = await dataClient.getProjectMembers(projectId)
      setMembers(updated.members)
      setSearch("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member")
    } finally {
      setAddingUserId(null)
    }
  }, [projectId])

  const handleRemoveMember = useCallback(async (userId: string) => {
    setRemovingUserId(userId)
    setError(null)
    try {
      await dataClient.removeProjectMember(projectId, userId)
      setMembers((prev) => prev.filter((m) => m.userId !== userId))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member")
    } finally {
      setRemovingUserId(null)
    }
  }, [projectId])

  const handleRoleChange = useCallback(async (userId: string, newRole: ProjectMemberRole) => {
    setUpdatingUserId(userId)
    setError(null)
    try {
      await dataClient.updateProjectMemberRole(projectId, userId, newRole)
      setMembers((prev) => prev.map((m) => m.userId === userId ? { ...m, role: newRole } : m))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role")
    } finally {
      setUpdatingUserId(null)
    }
  }, [projectId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Project Members
          </DialogTitle>
          <DialogDescription>
            {isOwner
              ? "Manage who has access to this project."
              : "View who has access to this project."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Add member section (owner only) */}
        {isOwner && (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Add team member</label>
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9"
            />

            {/* Search results dropdown */}
            {search.trim() && availableToAdd.length > 0 && (
              <div className="rounded-lg border border-border bg-popover shadow-md max-h-[160px] overflow-auto">
                {availableToAdd.slice(0, 5).map((tm) => (
                  <div
                    key={tm.userId}
                    className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[10px]">
                          {(tm.userName ?? tm.userEmail ?? "?").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">{tm.userName || "Unknown"}</span>
                        {tm.userEmail && (
                          <span className="text-[11px] text-muted-foreground truncate">{tm.userEmail}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => handleAddMember(tm.userId)}
                      disabled={addingUserId === tm.userId}
                    >
                      {addingUserId === tm.userId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <UserPlus className="h-3 w-3 mr-1" />
                          Add
                        </>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {search.trim() && availableToAdd.length === 0 && (
              <p className="text-xs text-muted-foreground px-1">
                No matching team members found. Only team members can be added.
              </p>
            )}
          </div>
        )}

        <Separator />

        {/* Current members list */}
        <div className="flex flex-col gap-1 flex-1 overflow-auto">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-sm font-medium">
              Members ({members.length})
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Shield className="mb-2 h-8 w-8" />
              <span className="text-sm">No members yet</span>
              <span className="text-xs mt-1">Add team members to share this project</span>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card">
              {members.map((member, idx) => {
                const isCurrentUser = member.userId === currentUser?.id
                const RoleIcon = roleConfig[member.role]?.icon ?? Eye

                return (
                  <div
                    key={member.userId}
                    className={cn(
                      "flex items-center justify-between px-3 py-2.5",
                      idx !== members.length - 1 && "border-b border-border"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Avatar className="h-7 w-7">
                        {member.user?.avatarUrl && (
                          <AvatarImage src={member.user.avatarUrl} />
                        )}
                        <AvatarFallback className="text-[11px]">
                          {(member.user?.name ?? member.user?.email ?? "?").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">
                            {member.user?.name || "Unknown"}
                          </span>
                          {isCurrentUser && (
                            <Badge variant="secondary" className="text-[10px] h-4 px-1">you</Badge>
                          )}
                        </div>
                        {member.user?.email && (
                          <span className="text-[11px] text-muted-foreground truncate">
                            {member.user.email}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isOwner && !isCurrentUser ? (
                        <>
                          <Select
                            value={member.role}
                            onValueChange={(val) => handleRoleChange(member.userId, val as ProjectMemberRole)}
                            disabled={updatingUserId === member.userId}
                          >
                            <SelectTrigger className="h-7 w-[100px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="viewer">
                                <div className="flex items-center gap-1.5">
                                  <Eye className="h-3 w-3" />
                                  Viewer
                                </div>
                              </SelectItem>
                              <SelectItem value="editor">
                                <div className="flex items-center gap-1.5">
                                  <Pencil className="h-3 w-3" />
                                  Editor
                                </div>
                              </SelectItem>
                              <SelectItem value="owner">
                                <div className="flex items-center gap-1.5">
                                  <Crown className="h-3 w-3" />
                                  Owner
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveMember(member.userId)}
                            disabled={removingUserId === member.userId}
                          >
                            {removingUserId === member.userId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </>
                      ) : (
                        <Badge variant="secondary" className="text-xs h-6 gap-1">
                          <RoleIcon className="h-3 w-3" />
                          {roleConfig[member.role]?.label ?? member.role}
                        </Badge>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
