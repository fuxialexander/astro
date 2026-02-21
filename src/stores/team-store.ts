import { create } from "zustand"
import type { Team, TeamMember } from "@/types"
import { loadState, saveState } from "@/lib/db"
import { dataClient } from "@/lib/data-client"

interface TeamState {
  teams: Team[]
  teamMembers: Record<string, TeamMember[]> // teamId -> members
  loaded: boolean
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

  load: async () => {
    try {
      const { teams, teamMembers } = await dataClient.listTeams()
      set({ teams, teamMembers, loaded: true })
      // Update IndexedDB cache
      saveState("astro-teams", teams)
      saveState("astro-team-members", teamMembers)
    } catch {
      // API unavailable — fall back to IndexedDB cache
      const savedTeams = await loadState<Team[]>("astro-teams")
      const savedMembers = await loadState<Record<string, TeamMember[]>>("astro-team-members")
      if (savedTeams) {
        set({
          teams: savedTeams.map(t => ({ ...t, createdAt: new Date(t.createdAt), updatedAt: new Date(t.updatedAt) })),
          teamMembers: savedMembers || {},
          loaded: true
        })
      } else {
        set({ teams: [], teamMembers: {}, loaded: true })
      }
    }
  },

  addTeam: (team) => {
    const next = [...get().teams, team]
    set({ teams: next })
    saveState("astro-teams", next)
    dataClient.createTeam(team).catch(() => {})
  },

  updateTeam: (id, updates) => {
    const next = get().teams.map((t) =>
      t.id === id ? { ...t, ...updates, updatedAt: new Date() } : t
    )
    set({ teams: next })
    saveState("astro-teams", next)
    dataClient.updateTeam(id, updates).catch(() => {})
  },

  deleteTeam: (id) => {
    const next = get().teams.filter((t) => t.id !== id)
    const nextMembers = { ...get().teamMembers }
    delete nextMembers[id]
    set({ teams: next, teamMembers: nextMembers })
    saveState("astro-teams", next)
    saveState("astro-team-members", nextMembers)
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
