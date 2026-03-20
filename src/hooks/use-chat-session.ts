/**
 * Hook: useChatSession
 *
 * Shared chat session setup logic for AI pathway components.
 * Handles session lookup, lazy creation, full-session loading,
 * and streaming state derivation.
 *
 * Used by plan-generation, unified-activity-view, and playground.
 * (chat-panel has its own multi-session switcher logic.)
 */

import { useMemo, useEffect, useRef } from "react"
import { useSessionStore } from "@/stores/session-store"
import type { SessionType } from "@/types"

interface UseChatSessionOptions {
  projectId: string
  /** Session type to look up / create */
  type: SessionType
  /** Node ID to filter by (for task-chat / playground). If omitted, matches by projectId only. */
  nodeId?: string
}

interface UseChatSessionReturn {
  chatSession: ReturnType<typeof useSessionStore.getState>["sessions"] extends Map<string, infer V> ? V | undefined : never
  isChatStreaming: boolean
  addMessage: ReturnType<typeof useSessionStore.getState>["addMessage"]
  sendChatMessage: ReturnType<typeof useSessionStore.getState>["sendChatMessage"]
  sendPlaygroundChat: ReturnType<typeof useSessionStore.getState>["sendPlaygroundChat"]
  abortChatStream: ReturnType<typeof useSessionStore.getState>["abortChatStream"]
}

export function useChatSession({ projectId, type, nodeId }: UseChatSessionOptions): UseChatSessionReturn {
  const sessionsLoaded = useSessionStore((s) => s.loaded)
  const getOrCreateSession = useSessionStore((s) => s.getOrCreateSession)
  const addMessage = useSessionStore((s) => s.addMessage)
  const sendChatMessage = useSessionStore((s) => s.sendChatMessage)
  const sendPlaygroundChat = useSessionStore((s) => s.sendPlaygroundChat)
  const abortChatStream = useSessionStore((s) => s.abortChatStream)
  const streamingSessions = useSessionStore((s) => s.streamingSessions)
  const ensureFullSession = useSessionStore((s) => s.ensureFullSession)

  // Find existing session — match by projectId + type, optionally by nodeId
  const allSessions = useSessionStore((s) => s.sessions)
  const chatSession = useMemo(() => {
    let latest: ReturnType<typeof allSessions.get> | undefined
    for (const session of allSessions.values()) {
      if (session.type !== type) continue
      if (nodeId) {
        // When nodeId is provided, match on nodeId (task-chat, playground)
        if (session.nodeId !== nodeId) continue
      } else {
        // When no nodeId, match on projectId (project-chat)
        if (session.projectId !== projectId) continue
      }
      if (!latest || session.createdAt > latest.createdAt) latest = session
    }
    return latest
  }, [allSessions, projectId, type, nodeId])

  // Create session if none exists (idempotent)
  useEffect(() => {
    if (sessionsLoaded && !chatSession) {
      getOrCreateSession({ type, projectId, nodeId })
    }
  }, [sessionsLoaded, chatSession, getOrCreateSession, type, projectId, nodeId])

  // Derive streaming state from store
  const isChatStreaming = chatSession ? streamingSessions.has(chatSession.id) : false

  // Lazy-load full session data (messages) after page refresh
  const ensuredSessionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const sid = chatSession?.id
    if (sid && sid !== ensuredSessionRef.current && chatSession.messages.length === 0 && !isChatStreaming) {
      ensuredSessionRef.current = sid
      ensureFullSession(sid)
    }
  }, [chatSession?.id, chatSession?.messages.length, isChatStreaming, ensureFullSession])

  return {
    chatSession,
    isChatStreaming,
    addMessage,
    sendChatMessage,
    sendPlaygroundChat,
    abortChatStream,
  }
}
