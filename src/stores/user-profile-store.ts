import { create } from "zustand"
import { loadState, saveState } from "@/lib/db"
import { dataClient } from "@/lib/data-client"
import type { UserProfile, DomainExpertise, ExperienceLevel, PreferredEnvironment, ApiKey } from "@/types"

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

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  profile: defaultProfile,
  loaded: false,

  load: async () => {
    try {
      console.log('[user-profile-store] Loading profile from API...')
      const profile = await dataClient.getProfile()
      if (profile) {
        console.log('[user-profile-store] Profile loaded from API')
        set({ profile, loaded: true })
        saveState("astro-user-profile", profile)
        return
      }
    } catch (error) {
      console.debug('[user-profile-store] API unavailable, will use IndexedDB:', (error as Error).message)
      // API unavailable - fall back to IndexedDB
    }

    // Fallback to IndexedDB
    console.log('[user-profile-store] Falling back to IndexedDB...')
    const saved = await loadState<UserProfile>("astro-user-profile")
    if (saved) {
      console.log('[user-profile-store] Profile loaded from IndexedDB')
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
      console.log('[user-profile-store] No profile found, using default')
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
    saveState("astro-user-profile", profile)
    dataClient.updateProfile(profile).catch(() => {})
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
