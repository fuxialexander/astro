import { create } from "zustand"
import type { Team, TeamMember } from "@/types"
import { dataClient, setActiveTeamId } from "@/lib/data-client"
import { setActiveTeamId as setApiActiveTeamId } from "@/lib/api-client"

interface TeamState {
  teams: Team[]
  teamMembers: Record<string, TeamMember[]> // teamId -> members
  loaded: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
  addTeam: (team: Team) => void
  updateTeam: (id: string, updates: Partial<Team>) => void
  deleteTeam: (id: string) => void
  getTeamMembers: (teamId: string) => TeamMember[]
  getUserTeams: (userId: string) => Team[]
  isTeamMember: (teamId: string, userId: string) => boolean
  getTeamMemberRole: (teamId: string, userId: string) => TeamMember['role'] | null
}

export const useTeamStore = create<TeamState>((set, get) => ({
  teams: [],
  teamMembers: {},
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const { teams, teamMembers } = await dataClient.listTeams()
      set({ teams, teamMembers, loaded: true, loading: false })
      // Sync active team ID to API clients
      const activeId = teams.length > 0 ? teams[0].id : undefined
      setActiveTeamId(activeId)
      setApiActiveTeamId(activeId)
    } catch (err) {
      set({ teams: [], teamMembers: {}, loaded: true, loading: false, error: err instanceof Error ? err.message : 'Failed to load teams' })
    }
  },

  addTeam: (team) => {
    const next = [...get().teams, team]
    set({ teams: next })
    dataClient.createTeam(team).catch(() => {})
  },

  updateTeam: (id, updates) => {
    const next = get().teams.map((t) =>
      t.id === id ? { ...t, ...updates, updatedAt: new Date() } : t
    )
    set({ teams: next })
    dataClient.updateTeam(id, updates).catch(() => {})
  },

  deleteTeam: (id) => {
    const next = get().teams.filter((t) => t.id !== id)
    const nextMembers = { ...get().teamMembers }
    delete nextMembers[id]
    set({ teams: next, teamMembers: nextMembers })
    dataClient.deleteTeam(id).catch(() => {})
  },

  getTeamMembers: (teamId) => {
    return get().teamMembers[teamId] || []
  },

  getUserTeams: (userId) => {
    const { teams, teamMembers } = get()
    return teams.filter((team) =>
      teamMembers[team.id]?.some((member) => member.userId === userId)
    )
  },

  isTeamMember: (teamId, userId) => {
    const members = get().teamMembers[teamId] || []
    return members.some((member) => member.userId === userId)
  },

  getTeamMemberRole: (teamId, userId) => {
    const members = get().teamMembers[teamId] || []
    const member = members.find((m) => m.userId === userId)
    return member?.role || null
  },
}))
