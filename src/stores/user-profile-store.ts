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
    set({ loading: true, error: null })
    try {
      console.log('[user-profile-store] Loading profile from API...')
      const profile = await dataClient.getProfile()
      if (profile) {
        console.log('[user-profile-store] Profile loaded from API')
        set({ profile, loaded: true, loading: false })
        return
      }
    } catch (error) {
      console.debug('[user-profile-store] API unavailable:', (error as Error).message)
      set({ loading: false, error: (error as Error).message })
    }

    console.log('[user-profile-store] No profile found, using default')
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
