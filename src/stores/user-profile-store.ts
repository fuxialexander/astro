import { create } from "zustand"
import { loadState, saveState } from "@/lib/db"
import type { UserProfile, DomainExpertise, ExperienceLevel, PreferredEnvironment, ApiKey } from "@/types"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase-client"

interface UserProfileState {
  profile: UserProfile
  loaded: boolean
  load: () => Promise<void>
  updateProfile: (updates: Partial<UserProfile>) => void
  setName: (name: string) => void
  setEmail: (email: string) => void
  setBio: (bio: string) => void
  setAvatarUrl: (avatarUrl: string | undefined) => void
  setDomains: (domains: DomainExpertise[]) => void
  toggleDomain: (domain: DomainExpertise) => void
  setExperienceLevel: (level: ExperienceLevel) => void
  setPreferredEnvironments: (environments: PreferredEnvironment[]) => void
  togglePreferredEnvironment: (environment: PreferredEnvironment) => void
  setNotificationsEnabled: (enabled: boolean) => void
  setEmailNotifications: (enabled: boolean) => void
  addApiKey: (provider: string, name: string, maskedKey: string) => void
  removeApiKey: (id: string) => void
}

const defaultProfile: UserProfile = {
  id: "user-1",
  name: "",
  email: "",
  avatarUrl: undefined,
  bio: "",
  domains: [],
  experienceLevel: "intermediate",
  preferredEnvironments: ["local"],
  notificationsEnabled: true,
  emailNotifications: false,
  apiKeys: [],
  createdAt: new Date(),
  updatedAt: new Date(),
}

function mapRow(row: Record<string, unknown>): UserProfile {
  return {
    id: row.id as string,
    name: (row.name as string) || "",
    email: (row.email as string) || "",
    avatarUrl: row.avatar_url as string | undefined,
    bio: (row.bio as string) || "",
    domains: (row.domains as DomainExpertise[]) || [],
    experienceLevel: (row.experience_level as ExperienceLevel) || "intermediate",
    preferredEnvironments: (row.preferred_environments as PreferredEnvironment[]) || ["local"],
    notificationsEnabled: row.notifications_enabled as boolean ?? true,
    emailNotifications: row.email_notifications as boolean ?? false,
    apiKeys: (row.api_keys as ApiKey[]) || [],
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  profile: defaultProfile,
  loaded: false,

  load: async () => {
    const supabase = getSupabase()

    if (supabase && isSupabaseConfigured()) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from("user_profiles")
          .select("*")
          .eq("id", user.id)
          .single()

        if (data) {
          const profile = mapRow(data)
          set({ profile, loaded: true })
          await saveState("nexus-user-profile", profile)
          return
        }
      }
    }

    // Fallback to IndexedDB
    const saved = await loadState<UserProfile>("nexus-user-profile")
    if (saved) {
      set({
        profile: {
          ...saved,
          createdAt: new Date(saved.createdAt),
          updatedAt: new Date(saved.updatedAt),
          apiKeys: saved.apiKeys.map((key) => ({
            ...key,
            createdAt: new Date(key.createdAt),
          })),
        },
        loaded: true,
      })
    } else {
      set({ loaded: true })
    }
  },

  updateProfile: (updates) => {
    const profile = {
      ...get().profile,
      ...updates,
      updatedAt: new Date(),
    }
    set({ profile })
    saveState("nexus-user-profile", profile)

    // Sync to Supabase
    const supabase = getSupabase()
    if (supabase && isSupabaseConfigured()) {
      const row: Record<string, unknown> = {}
      if (updates.name !== undefined) row.name = updates.name
      if (updates.email !== undefined) row.email = updates.email
      if (updates.avatarUrl !== undefined) row.avatar_url = updates.avatarUrl || null
      if (updates.bio !== undefined) row.bio = updates.bio
      if (updates.domains !== undefined) row.domains = updates.domains
      if (updates.experienceLevel !== undefined) row.experience_level = updates.experienceLevel
      if (updates.preferredEnvironments !== undefined) row.preferred_environments = updates.preferredEnvironments
      if (updates.notificationsEnabled !== undefined) row.notifications_enabled = updates.notificationsEnabled
      if (updates.emailNotifications !== undefined) row.email_notifications = updates.emailNotifications
      if (updates.apiKeys !== undefined) row.api_keys = updates.apiKeys

      if (Object.keys(row).length > 0) {
        supabase.from("user_profiles").update(row).eq("id", profile.id).then()
      }
    }
  },

  setName: (name) => get().updateProfile({ name }),
  setEmail: (email) => get().updateProfile({ email }),
  setBio: (bio) => get().updateProfile({ bio }),
  setAvatarUrl: (avatarUrl) => get().updateProfile({ avatarUrl }),

  setDomains: (domains) => get().updateProfile({ domains }),

  toggleDomain: (domain) => {
    const currentDomains = get().profile.domains
    const newDomains = currentDomains.includes(domain)
      ? currentDomains.filter((d) => d !== domain)
      : [...currentDomains, domain]
    get().updateProfile({ domains: newDomains })
  },

  setExperienceLevel: (experienceLevel) => get().updateProfile({ experienceLevel }),

  setPreferredEnvironments: (preferredEnvironments) => get().updateProfile({ preferredEnvironments }),

  togglePreferredEnvironment: (environment) => {
    const current = get().profile.preferredEnvironments
    const updated = current.includes(environment)
      ? current.filter((e) => e !== environment)
      : [...current, environment]
    get().updateProfile({ preferredEnvironments: updated })
  },

  setNotificationsEnabled: (notificationsEnabled) => get().updateProfile({ notificationsEnabled }),
  setEmailNotifications: (emailNotifications) => get().updateProfile({ emailNotifications }),

  addApiKey: (provider, name, maskedKey) => {
    const newKey: ApiKey = {
      id: `key-${Date.now()}`,
      provider,
      name,
      maskedKey,
      createdAt: new Date(),
    }
    const apiKeys = [...get().profile.apiKeys, newKey]
    get().updateProfile({ apiKeys })
  },

  removeApiKey: (id) => {
    const apiKeys = get().profile.apiKeys.filter((key) => key.id !== id)
    get().updateProfile({ apiKeys })
  },
}))
