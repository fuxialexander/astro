import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Users, Plus, Check } from "lucide-react"
import { useTeamStore } from "@/stores/team-store"
import { useUserProfileStore } from "@/stores/user-profile-store"
import { cn } from "@/lib/utils"

interface TeamSelectorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectTeam: (teamId: string) => void
  title?: string
  description?: string
  allowNewTeam?: boolean
}

export function TeamSelectorDialog({
  open,
  onOpenChange,
  onSelectTeam,
  title = "Select Team",
  description = "Choose a team for this project",
  allowNewTeam = true,
}: TeamSelectorDialogProps) {
  const teams = useTeamStore((s) => s.teams)
  const teamMembers = useTeamStore((s) => s.teamMembers)
  const addTeam = useTeamStore((s) => s.addTeam)
  const loaded = useTeamStore((s) => s.loaded)
  const load = useTeamStore((s) => s.load)
  const profile = useUserProfileStore((s) => s.profile)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [showNewTeamForm, setShowNewTeamForm] = useState(false)
  const [newTeamName, setNewTeamName] = useState("")
  const [newTeamDescription, setNewTeamDescription] = useState("")

  useEffect(() => {
    if (!loaded) load()
  }, [loaded, load])

  // Filter teams where user is a member
  const userTeams = teams.filter((team) =>
    teamMembers[team.id]?.some((member) => member.userId === profile?.id)
  )

  const handleCreateTeam = () => {
    if (!newTeamName.trim() || !profile) return

    const teamId = crypto.randomUUID()
    const team = {
      id: teamId,
      name: newTeamName.trim(),
      description: newTeamDescription.trim(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    addTeam(team)

    // Auto-select the new team
    setSelectedTeamId(teamId)
    setShowNewTeamForm(false)
    setNewTeamName("")
    setNewTeamDescription("")
  }

  const handleConfirm = () => {
    if (selectedTeamId) {
      onSelectTeam(selectedTeamId)
      onOpenChange(false)
      setSelectedTeamId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {showNewTeamForm ? (
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="team-name">Team Name</Label>
              <Input
                id="team-name"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="e.g., Engineering, Research, Design"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="team-description">Description (optional)</Label>
              <Input
                id="team-description"
                value={newTeamDescription}
                onChange={(e) => setNewTeamDescription(e.target.value)}
                placeholder="What is this team working on?"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleCreateTeam}
                disabled={!newTeamName.trim()}
                className="flex-1"
              >
                <Plus className="h-4 w-4" />
                Create Team
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowNewTeamForm(false)}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-4">
            {userTeams.length > 0 ? (
              <div className="flex flex-col gap-2">
                {userTeams.map((team) => {
                  const members = teamMembers[team.id] || []
                  const isSelected = selectedTeamId === team.id
                  return (
                    <button
                      key={team.id}
                      onClick={() => setSelectedTeamId(team.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-all cursor-pointer",
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:border-primary/50"
                      )}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted shrink-0">
                        <Users className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{team.name}</div>
                        {team.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {team.description}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-[10px]">
                            {members.length} {members.length === 1 ? 'member' : 'members'}
                          </Badge>
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="h-5 w-5 text-primary shrink-0" />
                      )}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                <Users className="h-8 w-8 text-muted-foreground/50" />
                <p>You are not a member of any teams yet</p>
              </div>
            )}

            {allowNewTeam && (
              <Button
                variant="outline"
                onClick={() => setShowNewTeamForm(true)}
                className="w-full"
              >
                <Plus className="h-4 w-4" />
                Create New Team
              </Button>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={handleConfirm}
                disabled={!selectedTeamId}
                className="flex-1"
              >
                Confirm
              </Button>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
