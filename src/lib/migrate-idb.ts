/**
 * One-time migration from IndexedDB to the API server.
 * Reads all existing IndexedDB keys and POSTs to the data API.
 */
import { loadState, saveState } from "@/lib/db"
import { dataClient } from "@/lib/data-client"
import type { Project, PlanNode, PlanEdge, UserProfile } from "@/types"
import type { DisplaySettings, ViewKey } from "@/stores/display-settings-store"
import type { SessionMetrics } from "@/stores/usage-store"
import type { TaskChatSession } from "@/stores/task-chat-store"

const MIGRATION_FLAG = "nexus-idb-migrated"

export async function shouldMigrateFromIdb(): Promise<boolean> {
  const migrated = await loadState<boolean>(MIGRATION_FLAG)
  if (migrated) return false

  // Check if any data exists in IndexedDB
  const projects = await loadState<Project[]>("nexus-projects")
  const nodes = await loadState<PlanNode[]>("nexus-plan-nodes")
  const profile = await loadState<UserProfile>("nexus-user-profile")

  return !!(projects?.length || nodes?.length || profile?.name)
}

export async function migrateFromIndexedDB(): Promise<void> {
  console.log("[migrate] Starting IndexedDB → API migration...")

  try {
    // Migrate projects
    const projects = await loadState<Project[]>("nexus-projects")
    if (projects?.length) {
      console.log(`[migrate] Migrating ${projects.length} projects...`)
      for (const project of projects) {
        try {
          await dataClient.createProject(project)
        } catch (e) {
          console.warn(`[migrate] Failed to migrate project ${project.id}:`, e)
        }
      }
    }

    // Migrate plan nodes + edges
    const nodes = await loadState<PlanNode[]>("nexus-plan-nodes")
    const edges = await loadState<PlanEdge[]>("nexus-plan-edges")
    if (nodes?.length) {
      console.log(`[migrate] Migrating ${nodes.length} nodes and ${edges?.length ?? 0} edges...`)
      // Group by project and bulk-replace
      const projectIds = new Set(nodes.map((n) => n.projectId))
      for (const projectId of projectIds) {
        const projectNodes = nodes.filter((n) => n.projectId === projectId)
        const nodeIds = new Set(projectNodes.map((n) => n.id))
        const projectEdges = (edges ?? []).filter(
          (e) => nodeIds.has(e.source) || nodeIds.has(e.target)
        )
        try {
          await dataClient.setProjectPlan(projectId, projectNodes, projectEdges)
        } catch (e) {
          console.warn(`[migrate] Failed to migrate plan for project ${projectId}:`, e)
        }
      }
    }

    // Migrate user profile
    const profile = await loadState<UserProfile>("nexus-user-profile")
    if (profile?.name) {
      console.log("[migrate] Migrating user profile...")
      try {
        await dataClient.updateProfile(profile)
      } catch (e) {
        console.warn("[migrate] Failed to migrate profile:", e)
      }
    }

    // Migrate display settings
    const displaySettings = await loadState<Record<ViewKey, DisplaySettings>>("nexus-display-settings")
    if (displaySettings) {
      console.log("[migrate] Migrating display settings...")
      for (const [view, settings] of Object.entries(displaySettings)) {
        try {
          await dataClient.updateDisplaySetting(view as ViewKey, settings)
        } catch (e) {
          console.warn(`[migrate] Failed to migrate display settings for ${view}:`, e)
        }
      }
    }

    // Migrate usage metrics
    const usageMetrics = await loadState<SessionMetrics>("nexus-usage-metrics")
    if (usageMetrics && (usageMetrics.totalCostUsd > 0 || usageMetrics.tasksCompleted > 0)) {
      console.log("[migrate] Migrating usage metrics...")
      try {
        await dataClient.incrementUsage(usageMetrics)
      } catch (e) {
        console.warn("[migrate] Failed to migrate usage metrics:", e)
      }
    }

    // Migrate task chats
    const chats = await loadState<Record<string, TaskChatSession>>("nexus-task-chats")
    if (chats) {
      console.log("[migrate] Migrating task chats...")
      for (const [nodeId, session] of Object.entries(chats)) {
        try {
          await dataClient.createChatSession(nodeId, session.projectId, session.sessionId)
          for (const msg of session.messages) {
            await dataClient.addChatMessage(nodeId, msg)
          }
        } catch (e) {
          console.warn(`[migrate] Failed to migrate chat for ${nodeId}:`, e)
        }
      }
    }

    // Migrate settings
    const settings = await loadState<{ model: string }>("nexus-settings")
    if (settings?.model) {
      console.log("[migrate] Migrating app settings...")
      try {
        await dataClient.updateSettings({ model: settings.model })
      } catch (e) {
        console.warn("[migrate] Failed to migrate settings:", e)
      }
    }

    // Set migration flag
    await saveState(MIGRATION_FLAG, true)
    console.log("[migrate] IndexedDB → API migration complete!")
  } catch (e) {
    console.error("[migrate] Migration failed:", e)
  }
}
