/**
 * Supabase Realtime Sync
 *
 * Handles real-time database subscriptions for collaborative multi-device sync.
 * Listens to changes in Supabase tables and updates Zustand stores accordingly.
 */

import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { getSupabase } from './supabase-client'
import { isLocalMode, isHipaaMode } from './app-mode'
import { useToastStore } from '@/stores/toast-store'
import { snakeToCamel } from './utils'
import { useProjectStore } from '@/stores/project-store'
import { usePlanStore } from '@/stores/plan-store'
import { useUserProfileStore } from '@/stores/user-profile-store'
import { useDisplaySettingsStore } from '@/stores/display-settings-store'
import { useTaskChatStore } from '@/stores/task-chat-store'
import { useSidebarStore, mergeWithDefaults } from '@/stores/sidebar-store'
import type { SidebarItem } from '@/stores/sidebar-store'
import type { Project, PlanNode, PlanEdge, UserProfile, ApiKey } from '@/types'
import type { DisplaySettings, ViewKey } from '@/stores/display-settings-store'
import type { TaskChatSession } from '@/stores/task-chat-store'

// Generate a unique client ID to filter out own updates
const CLIENT_ID = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// Track active subscriptions
let activeChannels: RealtimeChannel[] = []
let realtimeSyncEnabled = false
let hipaaToastShown = false

/**
 * Helper to normalize timestamps from Supabase
 */
function toDate(v: unknown): Date {
  if (v instanceof Date) return v
  if (typeof v === "string" || typeof v === "number") return new Date(v)
  return new Date()
}

/**
 * Map database row to Project type
 */
function mapProject(row: Record<string, unknown>): Project {
  const r = snakeToCamel(row)
  return {
    ...r,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
    labels: (r.labels as Project["labels"]) ?? [],
  } as unknown as Project
}

/**
 * Map database row to PlanNode type
 */
function mapNode(row: Record<string, unknown>): PlanNode {
  const r = snakeToCamel(row)
  return {
    ...r,
    id: (r.clientId ?? r.id) as string,
    dependencies: (r.dependencies as string[]) ?? [],
    position: r.positionX !== undefined && r.positionY !== undefined
      ? { x: r.positionX as number, y: r.positionY as number }
      : (r.position as { x: number; y: number }),
    executionStartedAt: r.executionStartedAt ? toDate(r.executionStartedAt) : undefined,
    executionCompletedAt: r.executionCompletedAt ? toDate(r.executionCompletedAt) : undefined,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  } as PlanNode
}

/**
 * Map database row to PlanEdge type
 */
function mapEdge(row: Record<string, unknown>): PlanEdge {
  const r = snakeToCamel(row)
  return {
    id: r.clientId as string,
    source: r.sourceClientId as string,
    target: r.targetClientId as string,
    type: (r.type as PlanEdge["type"]) ?? "dependency",
  }
}

/**
 * Map database row to ApiKey type
 */
function mapApiKey(row: Record<string, unknown>): ApiKey {
  const r = snakeToCamel(row)
  return {
    id: r.id as string,
    provider: r.provider as string,
    name: r.name as string,
    maskedKey: r.maskedKey as string,
    createdAt: toDate(r.createdAt),
  }
}

/**
 * Map database row to UserProfile type
 */
function mapProfile(row: Record<string, unknown>): UserProfile {
  const r = snakeToCamel(row)
  return {
    id: r.id as string,
    name: (r.name as string) ?? "",
    email: (r.email as string) ?? "",
    avatarUrl: r.avatarUrl as string | undefined,
    bio: (r.bio as string) ?? "",
    domains: (r.domains as UserProfile["domains"]) ?? [],
    experienceLevel: (r.experienceLevel ?? "intermediate") as UserProfile["experienceLevel"],
    preferredMachines: (r.preferredMachines ?? []) as UserProfile["preferredMachines"],
    notificationsEnabled: (r.notificationsEnabled ?? true) as boolean,
    emailNotifications: (r.emailNotifications ?? false) as boolean,
    apiKeys: ((r.apiKeys as Record<string, unknown>[]) ?? []).map(mapApiKey),
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  }
}

// Note: mapChatMessage currently unused but kept for future chat message sync implementation
// function mapChatMessage(row: Record<string, unknown>): TaskChatMessage {
//   return {
//     id: row.id as string,
//     role: row.role as "user" | "assistant",
//     content: row.content as string,
//     timestamp: toDate(row.created_at),
//   }
// }

/**
 * Subscribe to projects table changes.
 * Project reads are cross-team, so this subscription intentionally does not
 * scope to a single active workspace.
 */
function subscribeToProjects(supabase: ReturnType<typeof getSupabase>) {
  if (!supabase) return null

  const channel = supabase
    .channel('projects-changes')
    .on<Record<string, unknown>>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'projects' },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        console.log('[realtime-sync] projects change:', payload.eventType)

        // Skip if this change came from our own client (check via metadata if available)
        // Note: Supabase Realtime doesn't natively support client ID filtering,
        // so we rely on optimistic updates and reconciliation

        switch (payload.eventType) {
          case 'INSERT':
            if (payload.new) {
              const project = mapProject(payload.new)
              const store = useProjectStore.getState()
              // Only add if not already present (avoid duplicates from optimistic updates)
              if (!store.projects.some(p => p.id === project.id)) {
                // Directly update state without triggering API call
                store.projects.push(project)
                useProjectStore.setState({ projects: [...store.projects] })
              }
            }
            break
          case 'UPDATE':
            if (payload.new) {
              const incoming = mapProject(payload.new)
              const store = useProjectStore.getState()
              // Merge with existing state to preserve frontend-only fields (fileTree, etc.)
              const updated = store.projects.map(p =>
                p.id === incoming.id ? { ...p, ...incoming } : p
              )
              useProjectStore.setState({ projects: updated })
            }
            break
          case 'DELETE':
            if (payload.old) {
              const store = useProjectStore.getState()
              // Directly update state without triggering API call
              const filtered = store.projects.filter(p => p.id !== payload.old.id)
              useProjectStore.setState({ projects: filtered })
            }
            break
        }
      }
    )
    .subscribe((status) => {
      console.log('[realtime-sync] projects subscription status:', status)
    })

  return channel
}

/**
 * Subscribe to plan_nodes table changes
 */
function subscribeToPlanNodes(supabase: ReturnType<typeof getSupabase>) {
  if (!supabase) return null

  const channel = supabase
    .channel('plan-nodes-changes')
    .on<Record<string, unknown>>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'plan_nodes' },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        // Filter out events for projects not in our team
        const projectId = ((payload.new ?? payload.old) as Record<string, unknown> | undefined)?.project_id as string | undefined
        if (projectId) {
          const { projects } = useProjectStore.getState()
          if (!projects.some(p => p.id === projectId)) return
        }

        console.log('[realtime-sync] plan_nodes change:', payload.eventType)

        switch (payload.eventType) {
          case 'INSERT':
            if (payload.new) {
              // Skip soft-deleted nodes
              if (payload.new.deleted_at) break
              const node = mapNode(payload.new)
              const store = usePlanStore.getState()
              // Only add if not already present (avoid duplicates from optimistic updates)
              if (!store.nodes.some(n => n.id === node.id)) {
                // Directly update state without triggering API call
                store.nodes.push(node)
                usePlanStore.setState({ nodes: [...store.nodes] })
              }
            }
            break
          case 'UPDATE':
            if (payload.new) {
              // If the node was soft-deleted, remove it from the store
              if (payload.new.deleted_at) {
                const nodeId = payload.new.client_id as string
                const store = usePlanStore.getState()
                const filteredNodes = store.nodes.filter(n => n.id !== nodeId)
                const filteredEdges = store.edges.filter(e => e.source !== nodeId && e.target !== nodeId)
                usePlanStore.setState({ nodes: filteredNodes, edges: filteredEdges })
                break
              }
              const node = mapNode(payload.new)
              const store = usePlanStore.getState()
              // Directly update state without triggering API call
              const updated = store.nodes.map(n =>
                n.id === node.id ? { ...n, ...node } : n
              )
              usePlanStore.setState({ nodes: updated })
            }
            break
          case 'DELETE':
            if (payload.old) {
              const nodeId = payload.old.client_id as string
              const store = usePlanStore.getState()
              const idSet = new Set([nodeId])
              // Directly update state without triggering API call
              const filteredNodes = store.nodes.filter(n => !idSet.has(n.id))
              const filteredEdges = store.edges.filter(e => !idSet.has(e.source) && !idSet.has(e.target))
              usePlanStore.setState({ nodes: filteredNodes, edges: filteredEdges })
            }
            break
        }
      }
    )
    .subscribe((status) => {
      console.log('[realtime-sync] plan_nodes subscription status:', status)
    })

  return channel
}

/**
 * Subscribe to plan_edges table changes
 */
function subscribeToPlanEdges(supabase: ReturnType<typeof getSupabase>) {
  if (!supabase) return null

  const channel = supabase
    .channel('plan-edges-changes')
    .on<Record<string, unknown>>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'plan_edges' },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        // Filter out events for projects not in our team
        const projectId = ((payload.new ?? payload.old) as Record<string, unknown> | undefined)?.project_id as string | undefined
        if (projectId) {
          const { projects } = useProjectStore.getState()
          if (!projects.some(p => p.id === projectId)) return
        }

        console.log('[realtime-sync] plan_edges change:', payload.eventType)

        switch (payload.eventType) {
          case 'INSERT':
            if (payload.new) {
              // Skip soft-deleted edges
              if (payload.new.deleted_at) break
              const edge = mapEdge(payload.new)
              const store = usePlanStore.getState()
              // Only add if not already present (avoid duplicates from optimistic updates)
              const exists = store.edges.some(e => e.source === edge.source && e.target === edge.target)
              if (!exists) {
                // Directly update state without triggering API call
                store.edges.push(edge)
                usePlanStore.setState({ edges: [...store.edges] })
              }
            }
            break
          case 'UPDATE':
            if (payload.new) {
              // If the edge was soft-deleted, remove it from the store
              if (payload.new.deleted_at) {
                const source = payload.new.source_client_id as string
                const target = payload.new.target_client_id as string
                const store = usePlanStore.getState()
                const filtered = store.edges.filter(e => !(e.source === source && e.target === target))
                usePlanStore.setState({ edges: filtered })
                break
              }
              console.log('[realtime-sync] plan_edges UPDATE not implemented')
            }
            break
          case 'DELETE':
            if (payload.old) {
              const source = payload.old.source_client_id as string
              const target = payload.old.target_client_id as string
              const store = usePlanStore.getState()
              // Directly update state without triggering API call
              const filtered = store.edges.filter(e => !(e.source === source && e.target === target))
              usePlanStore.setState({ edges: filtered })
            }
            break
        }
      }
    )
    .subscribe((status) => {
      console.log('[realtime-sync] plan_edges subscription status:', status)
    })

  return channel
}

/**
 * Subscribe to user_profiles table changes
 */
function subscribeToUserProfiles(supabase: ReturnType<typeof getSupabase>) {
  if (!supabase) return null

  const channel = supabase
    .channel('user-profiles-changes')
    .on<Record<string, unknown>>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_profiles' },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        console.log('[realtime-sync] user_profiles change:', payload.eventType)

        switch (payload.eventType) {
          case 'INSERT':
          case 'UPDATE':
            if (payload.new) {
              const profile = mapProfile(payload.new)
              // Only update if it's the current user's profile
              const currentProfile = useUserProfileStore.getState().profile
              if (currentProfile.id === profile.id) {
                // Directly update state without triggering API call
                useUserProfileStore.setState({ profile })

                // Propagate sidebar config changes
                const sidebarConfig = snakeToCamel(payload.new).sidebarConfig as SidebarItem[] | null
                if (sidebarConfig) {
                  useSidebarStore.setState({ items: mergeWithDefaults(sidebarConfig) })
                }
              }
            }
            break
          // DELETE not applicable for user profiles
        }
      }
    )
    .subscribe((status) => {
      console.log('[realtime-sync] user_profiles subscription status:', status)
    })

  return channel
}

/**
 * Subscribe to display_settings table changes
 */
function subscribeToDisplaySettings(supabase: ReturnType<typeof getSupabase>) {
  if (!supabase) return null

  const channel = supabase
    .channel('display-settings-changes')
    .on<Record<string, unknown>>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'display_settings' },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        console.log('[realtime-sync] display_settings change:', payload.eventType)

        switch (payload.eventType) {
          case 'INSERT':
          case 'UPDATE':
            if (payload.new) {
              const r = snakeToCamel(payload.new)
              const viewKey = r.viewKey as ViewKey
              const settings = r.settings as DisplaySettings
              const store = useDisplaySettingsStore.getState()
              // Directly update state without triggering API call
              const updated = {
                ...store.settings,
                [viewKey]: settings,
              }
              useDisplaySettingsStore.setState({ settings: updated })
            }
            break
          // DELETE not typically applicable for display settings
        }
      }
    )
    .subscribe((status) => {
      console.log('[realtime-sync] display_settings subscription status:', status)
    })

  return channel
}

/**
 * Subscribe to task_chat_sessions table changes
 */
function subscribeToTaskChatSessions(supabase: ReturnType<typeof getSupabase>) {
  if (!supabase) return null

  const channel = supabase
    .channel('task-chat-sessions-changes')
    .on<Record<string, unknown>>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'task_chat_sessions' },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        // Filter out events for projects not in our team
        const chatProjectId = ((payload.new ?? payload.old) as Record<string, unknown> | undefined)?.project_id as string | undefined
        if (chatProjectId) {
          const { projects } = useProjectStore.getState()
          if (!projects.some(p => p.id === chatProjectId)) return
        }

        console.log('[realtime-sync] task_chat_sessions change:', payload.eventType)

        switch (payload.eventType) {
          case 'INSERT':
            if (payload.new) {
              const r = snakeToCamel(payload.new)
              const nodeId = r.nodeId as string
              const projectId = r.projectId as string
              const store = useTaskChatStore.getState()
              // Only create if not already present
              if (!store.sessions.has(nodeId)) {
                const session: TaskChatSession = {
                  nodeId,
                  projectId,
                  sessionId: r.sessionId as string | undefined,
                  messages: [],
                  createdAt: toDate(r.createdAt),
                  updatedAt: toDate(r.updatedAt),
                }
                const sessions = new Map(store.sessions)
                sessions.set(nodeId, session)
                useTaskChatStore.setState({ sessions })
              }
            }
            break
          case 'UPDATE':
            if (payload.new) {
              const r = snakeToCamel(payload.new)
              const nodeId = r.nodeId as string
              const store = useTaskChatStore.getState()
              const session = store.sessions.get(nodeId)
              if (session) {
                const sessionId = r.sessionId as string | undefined
                const updatedSession = {
                  ...session,
                  sessionId: sessionId ?? session.sessionId,
                  updatedAt: toDate(r.updatedAt),
                }
                const sessions = new Map(store.sessions)
                sessions.set(nodeId, updatedSession)
                useTaskChatStore.setState({ sessions })
              }
            }
            break
          case 'DELETE':
            if (payload.old) {
              const nodeId = snakeToCamel(payload.old).nodeId as string
              const store = useTaskChatStore.getState()
              const sessions = new Map(store.sessions)
              sessions.delete(nodeId)
              useTaskChatStore.setState({ sessions })
            }
            break
        }
      }
    )
    .subscribe((status) => {
      console.log('[realtime-sync] task_chat_sessions subscription status:', status)
    })

  return channel
}

/**
 * Subscribe to task_chat_messages table changes
 */
function subscribeToTaskChatMessages(supabase: ReturnType<typeof getSupabase>) {
  if (!supabase) return null

  const channel = supabase
    .channel('task-chat-messages-changes')
    .on<Record<string, unknown>>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'task_chat_messages' },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        console.log('[realtime-sync] task_chat_messages change:', payload.eventType)

        switch (payload.eventType) {
          case 'INSERT':
            if (payload.new) {
              // Get session to find nodeId
              const sessionId = payload.new.session_id as string
              // We need to look up the session to get nodeId
              // For now, we'll skip this as it requires a separate query
              // In production, you'd want to denormalize nodeId into task_chat_messages
              console.log('[realtime-sync] task_chat_messages INSERT - session lookup needed:', sessionId)
            }
            break
          case 'UPDATE':
            if (payload.new) {
              // Similar to INSERT, needs session lookup
              console.log('[realtime-sync] task_chat_messages UPDATE - session lookup needed')
            }
            break
          // DELETE not typically applicable for chat messages
        }
      }
    )
    .subscribe((status) => {
      console.log('[realtime-sync] task_chat_messages subscription status:', status)
    })

  return channel
}

/**
 * Setup all realtime subscriptions.
 */
export function setupRealtimeSync() {
  // In HIPAA mode, Supabase Realtime is forbidden (PHI exfiltration risk).
  // Skip all subscriptions and notify the user once per session.
  if (isHipaaMode()) {
    console.log('[realtime-sync] Skipping setup - HIPAA mode (multi-device sync disabled)')
    if (!hipaaToastShown) {
      hipaaToastShown = true
      try {
        useToastStore.getState().add({
          type: 'info',
          title: 'Multi-device sync disabled',
          description: 'Multi-device collaboration is disabled in HIPAA mode.',
          duration: 6000,
        })
      } catch {
        // Toast store may not be initialised during SSR/early boot
      }
    }
    return
  }
  // Only setup if Supabase is configured
  if (isLocalMode()) {
    console.log('[realtime-sync] Skipping setup - local mode')
    return
  }

  const supabase = getSupabase()
  if (!supabase) {
    console.log('[realtime-sync] Skipping setup - Supabase not configured')
    return
  }

  if (realtimeSyncEnabled) {
    console.log('[realtime-sync] Already enabled, skipping setup')
    return
  }

  console.log('[realtime-sync] Setting up subscriptions...')

  // Create all subscriptions
  const channels = [
    subscribeToProjects(supabase),
    subscribeToPlanNodes(supabase),
    subscribeToPlanEdges(supabase),
    subscribeToUserProfiles(supabase),
    subscribeToDisplaySettings(supabase),
    subscribeToTaskChatSessions(supabase),
    subscribeToTaskChatMessages(supabase),
  ].filter((ch): ch is RealtimeChannel => ch !== null)

  activeChannels = channels
  realtimeSyncEnabled = true

  console.log(`[realtime-sync] ${channels.length} subscriptions active`)
}

/**
 * Internal sync teardown.
 */
function teardownRealtimeSyncInternal(supabase: NonNullable<ReturnType<typeof getSupabase>>) {
  for (const channel of activeChannels) {
    supabase.removeChannel(channel)
  }
  activeChannels = []
  realtimeSyncEnabled = false
}

/**
 * Teardown all realtime subscriptions
 */
export async function teardownRealtimeSync() {
  if (!realtimeSyncEnabled) {
    console.log('[realtime-sync] Not enabled, nothing to teardown')
    return
  }

  console.log('[realtime-sync] Tearing down subscriptions...')

  const supabase = getSupabase()
  if (!supabase) {
    console.log('[realtime-sync] Supabase not available for teardown')
    return
  }

  teardownRealtimeSyncInternal(supabase)

  console.log('[realtime-sync] All subscriptions removed')
}

/**
 * Check if realtime sync is enabled
 */
export function isRealtimeSyncEnabled(): boolean {
  return realtimeSyncEnabled
}

/**
 * Get client ID (useful for debugging)
 */
export function getClientId(): string {
  return CLIENT_ID
}
