import { create } from "zustand"
import type { Team, TeamMember } from "@/types"
import { dataClient, setActiveTeamId } from "@/lib/data-client"
import { setActiveTeamId as setApiActiveTeamId } from "@/lib/api-client"

const ACTIVE_TEAM_KEY = "astro-active-team-id"

interface TeamState {
  teams: Team[]
  activeTeamId: string | undefined
  teamMembers: Record<string, TeamMember[]> // teamId -> members
  loaded: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
  setActiveTeam: (teamId: string) => void
  addTeam: (team: Team) => void
  updateTeam: (id: string, updates: Partial<Team>) => void
  deleteTeam: (id: string) => void
  getTeamMembers: (teamId: string) => TeamMember[]
  getUserTeams: (userId: string) => Team[]
  isTeamMember: (teamId: string, userId: string) => boolean
  getTeamMemberRole: (teamId: string, userId: string) => TeamMember['role'] | null
  /** Returns the user's personal workspace team ID (falls back to first team). */
  getPersonalTeamId: () => string | undefined
  /** Returns the current default team context for team-owned writes. */
  getDefaultTeamId: () => string | undefined
}

export const useTeamStore = create<TeamState>((set, get) => ({
  teams: [],
  activeTeamId: undefined,
  teamMembers: {},
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const { teams, teamMembers } = await dataClient.listTeams()

      // Check localStorage for persisted team preference
      const persistedTeamId = localStorage.getItem(ACTIVE_TEAM_KEY)
      const isPersistedValid = persistedTeamId && teams.some((t) => t.id === persistedTeamId)
      const activeId = isPersistedValid ? persistedTeamId : (teams.length > 0 ? teams[0].id : undefined)

      set({ teams, teamMembers, activeTeamId: activeId, loaded: true, loading: false })

      // Sync active team ID to API clients
      setActiveTeamId(activeId)
      setApiActiveTeamId(activeId)

      // Persist the resolved team ID
      if (activeId) {
        localStorage.setItem(ACTIVE_TEAM_KEY, activeId)
      }
    } catch (err) {
      set({ teams: [], teamMembers: {}, loaded: true, loading: false, error: err instanceof Error ? err.message : 'Failed to load teams' })
    }
  },

  setActiveTeam: (teamId: string) => {
    const { teams } = get()
    if (!teams.some((t) => t.id === teamId)) return

    set({ activeTeamId: teamId })
    setActiveTeamId(teamId)
    setApiActiveTeamId(teamId)
    localStorage.setItem(ACTIVE_TEAM_KEY, teamId)
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

  getPersonalTeamId: () => {
    const { teams } = get()
    const personal = teams.find((t) =>
      t.isPersonal
      || t.description === 'Personal workspace'
      || t.description === 'Auto-created personal workspace'
    )
    return personal?.id ?? teams[0]?.id
  },

  getDefaultTeamId: () => {
    const { activeTeamId, getPersonalTeamId } = get()
    return activeTeamId ?? getPersonalTeamId()
  },
}))
