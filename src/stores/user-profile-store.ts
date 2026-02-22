import { create } from "zustand"
import { dataClient } from "@/lib/data-client"
import type { UserProfile, DomainExpertise, ExperienceLevel, ApiKey } from "@/types"

interface UserProfileState {
  profile: UserProfile
  loaded: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
  updateProfile: (updates: Partial<UserProfile>) => void
  setName: (name: string) => void
  setEmail: (email: string) => void
  setBio: (bio: string) => void
  setAvatarUrl: (avatarUrl: string | undefined) => void
  setDomains: (domains: DomainExpertise[]) => void
  toggleDomain: (domain: DomainExpertise) => void
  setExperienceLevel: (level: ExperienceLevel) => void
  setPreferredMachines: (machines: string[]) => void
  togglePreferredMachine: (machineId: string) => void
  setNotificationsEnabled: (enabled: boolean) => void
  setEmailNotifications: (enabled: boolean) => void
  setDefaultMachineId: (machineId: string | undefined) => void
  setDefaultProvider: (provider: string | undefined) => void
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
  preferredMachines: [],
  notificationsEnabled: true,
  emailNotifications: false,
  apiKeys: [],
  createdAt: new Date(),
  updatedAt: new Date(),
}

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  profile: defaultProfile,
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    console.log('[user-profile-store] load() called')
    set({ loading: true, error: null })

    // Retry up to 2 times with a short delay — the first call after registration
    // can fail if the Supabase session hasn't fully propagated yet.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log('[user-profile-store] Attempt', attempt + 1, 'calling dataClient.getProfile()...')
        const profile = await dataClient.getProfile()
        console.log('[user-profile-store] Attempt', attempt + 1, 'result:', profile ? { id: profile.id, name: profile.name, email: profile.email } : null)
        if (profile) {
          set({ profile, loaded: true, loading: false })
          console.log('[user-profile-store] Profile loaded successfully:', { name: profile.name, email: profile.email })
          return
        }
        console.warn('[user-profile-store] Attempt', attempt + 1, 'returned null profile')
      } catch (error) {
        console.warn('[user-profile-store] Profile load attempt', attempt + 1, 'failed:', (error as Error).message)
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
        }
      }
    }

    console.warn('[user-profile-store] All profile load attempts failed, using default')
    set({ loaded: true, loading: false })
  },

  updateProfile: (updates) => {
    const profile = {
      ...get().profile,
      ...updates,
      updatedAt: new Date(),
    }
    set({ profile })
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

  setPreferredMachines: (preferredMachines) => get().updateProfile({ preferredMachines }),

  togglePreferredMachine: (machineId) => {
    const current = get().profile.preferredMachines
    const updated = current.includes(machineId)
      ? current.filter((id) => id !== machineId)
      : [...current, machineId]
    get().updateProfile({ preferredMachines: updated })
  },

  setNotificationsEnabled: (notificationsEnabled) => get().updateProfile({ notificationsEnabled }),
  setEmailNotifications: (emailNotifications) => get().updateProfile({ emailNotifications }),

  setDefaultMachineId: (defaultMachineId) => get().updateProfile({ defaultMachineId }),
  setDefaultProvider: (defaultProvider) => get().updateProfile({ defaultProvider }),

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
