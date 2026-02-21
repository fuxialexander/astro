/**
 * API Keys Store
 *
 * Manages encrypted API keys for external services (OpenAI Whisper, etc.)
 * Keys are encrypted client-side before storage using Web Crypto API.
 */

import { create } from "zustand"
import type { EncryptedApiKey, DecryptedApiKey } from "@/types"
import { encryptText, decryptText, getEncryptionPassword } from "@/lib/crypto-utils"
import { getSupabase } from "@/lib/supabase-client"
import { isServerMode } from "@/lib/app-mode"

interface ApiKeysState {
  // Encrypted keys loaded from database
  encryptedKeys: EncryptedApiKey[]

  // Decrypted keys (in-memory only, cleared on unmount)
  decryptedKeys: Map<string, string> // serviceName -> plainKey

  // Loading state
  loaded: boolean
  loading: boolean

  // Actions
  load: () => Promise<void>
  addKey: (serviceName: string, plainKey: string) => Promise<void>
  removeKey: (serviceName: string) => Promise<void>
  getDecryptedKey: (serviceName: string) => Promise<string | null>
  clearDecryptedKeys: () => void
}

export const useApiKeysStore = create<ApiKeysState>((set, get) => ({
  encryptedKeys: [],
  decryptedKeys: new Map(),
  loaded: false,
  loading: false,

  load: async () => {
    if (!isServerMode()) {
      // In local mode, API keys are not supported (no multi-user, no encryption needed)
      set({ loaded: true })
      return
    }

    set({ loading: true })
    try {
      const supabase = getSupabase()
      if (!supabase) {
        throw new Error("Supabase not configured")
      }

      const { data: session } = await supabase.auth.getSession()
      if (!session?.session?.user) {
        set({ loaded: true, loading: false })
        return
      }

      const { data, error } = await supabase
        .from("encrypted_api_keys")
        .select("*")
        .order("created_at", { ascending: false })

      if (error) throw error

      const encryptedKeys: EncryptedApiKey[] = (data || []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        serviceName: row.service_name,
        encryptedKey: row.encrypted_key,
        iv: row.iv,
        salt: row.salt || undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      }))

      set({ encryptedKeys, loaded: true, loading: false })
    } catch (error) {
      console.error("[api-keys-store] Failed to load encrypted keys:", error)
      set({ loaded: true, loading: false })
    }
  },

  addKey: async (serviceName: string, plainKey: string) => {
    if (!isServerMode()) {
      throw new Error("API key storage is only available in server mode")
    }

    const supabase = getSupabase()
    if (!supabase) {
      throw new Error("Supabase not configured")
    }

    const { data: session } = await supabase.auth.getSession()
    if (!session?.session?.user) {
      throw new Error("Not authenticated")
    }

    // Get encryption password (user's email)
    const password = await getEncryptionPassword(session.session.user.email || "")

    // Encrypt the key client-side
    const { encrypted, iv, salt } = await encryptText(plainKey, password)

    // Store in database
    const { data, error } = await supabase
      .from("encrypted_api_keys")
      .upsert(
        {
          user_id: session.session.user.id,
          service_name: serviceName,
          encrypted_key: encrypted,
          iv,
          salt, // Store salt for future decryption
        },
        {
          onConflict: "user_id,service_name",
        }
      )
      .select()
      .single()

    if (error) throw error

    // Update local state
    const newKey: EncryptedApiKey = {
      id: data.id,
      userId: data.user_id,
      serviceName: data.service_name,
      encryptedKey: data.encrypted_key,
      iv: data.iv,
      salt: data.salt,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    }

    set((state) => ({
      encryptedKeys: [
        newKey,
        ...state.encryptedKeys.filter((k) => k.serviceName !== serviceName),
      ],
    }))

    // Cache decrypted key in memory
    const decryptedKeys = new Map(get().decryptedKeys)
    decryptedKeys.set(serviceName, plainKey)
    set({ decryptedKeys })
  },

  removeKey: async (serviceName: string) => {
    if (!isServerMode()) {
      throw new Error("API key storage is only available in server mode")
    }

    const supabase = getSupabase()
    if (!supabase) {
      throw new Error("Supabase not configured")
    }

    const { data: session } = await supabase.auth.getSession()
    if (!session?.session?.user) {
      throw new Error("Not authenticated")
    }

    const { error } = await supabase
      .from("encrypted_api_keys")
      .delete()
      .eq("user_id", session.session.user.id)
      .eq("service_name", serviceName)

    if (error) throw error

    // Update local state
    set((state) => {
      const decryptedKeys = new Map(state.decryptedKeys)
      decryptedKeys.delete(serviceName)
      return {
        encryptedKeys: state.encryptedKeys.filter((k) => k.serviceName !== serviceName),
        decryptedKeys,
      }
    })
  },

  getDecryptedKey: async (serviceName: string): Promise<string | null> => {
    // Check in-memory cache first
    const cached = get().decryptedKeys.get(serviceName)
    if (cached) return cached

    // Find encrypted key
    const encryptedKey = get().encryptedKeys.find((k) => k.serviceName === serviceName)
    if (!encryptedKey) return null

    // Decrypt
    const supabase = getSupabase()
    if (!supabase) return null

    const { data: session } = await supabase.auth.getSession()
    if (!session?.session?.user) return null

    try {
      const password = await getEncryptionPassword(session.session.user.email || "")

      // Salt is required for decryption
      if (!encryptedKey.salt) {
        throw new Error("Missing salt for encrypted key - cannot decrypt")
      }

      const plainKey = await decryptText(
        encryptedKey.encryptedKey,
        encryptedKey.iv,
        encryptedKey.salt,
        password
      )

      // Cache in memory
      const decryptedKeys = new Map(get().decryptedKeys)
      decryptedKeys.set(serviceName, plainKey)
      set({ decryptedKeys })

      return plainKey
    } catch (error) {
      console.error(`[api-keys-store] Failed to decrypt key for ${serviceName}:`, error)
      return null
    }
  },

  clearDecryptedKeys: () => {
    set({ decryptedKeys: new Map() })
  },
}))
