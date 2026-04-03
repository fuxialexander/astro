/**
 * Telegram Command Registry
 *
 * Maps Telegram /commands to Astro operations using direct DB queries
 * and the dispatch engine. Follows the CommandRegistry pattern.
 *
 * Commands:
 *   /projects          — List all projects for the user
 *   /plan <id>         — Show plan tree for a project
 *   /task <id>         — Show task details
 *   /dispatch <id>     — Trigger execution of a task
 *   /status            — Show active executions
 *   /stop <id>         — Cancel an execution
 *   /approve <id>      — Approve a pending approval
 *   /help              — List available commands
 */

import { db } from '../../db/index.js'
import {
  projects,
  planNodes,
  taskExecutions,
  connectedAccounts,
  teamMembers,
} from '../../db/schema.js'
import { eq, and, inArray, isNull, or } from 'drizzle-orm'
import { dispatchEngine } from '../../dispatch/index.js'
import { serverSideDispatch } from '../../server-side-dispatch.js'
import { formatForChannel } from '../channel-formatter.js'
import { setDefaultProject, clearChatSession } from './telegram-chat.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context passed to every command handler */
export interface CommandContext {
  /** Telegram chat ID */
  chatId: string
  /** Astro user ID (resolved from connected account) */
  userId: string
  /** Raw argument string after the command */
  args: string
  /** Telegram Bot API token (for sending messages) */
  botToken: string
  /** Telegram message_thread_id — present when command is sent inside a forum topic */
  threadId?: string
  /** Set when command is in a group/supergroup chat (chatId is the group ID) */
  groupChatId?: string
}

/** A command handler function */
export type CommandHandler = (ctx: CommandContext) => Promise<string>

/** Telegram Bot API command description for setMyCommands */
interface BotCommand {
  command: string
  description: string
}

// ---------------------------------------------------------------------------
// Telegram Bot API helper (inlined to avoid circular import)
// ---------------------------------------------------------------------------

async function telegramApi(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; description?: string; result?: unknown }> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return (await response.json()) as { ok: boolean; description?: string; result?: unknown }
}

// ---------------------------------------------------------------------------
// Command Registry
// ---------------------------------------------------------------------------

export class CommandRegistry {
  private commands = new Map<string, { handler: CommandHandler; description: string }>()

  /** Register a command */
  register(name: string, description: string, handler: CommandHandler): void {
    this.commands.set(name.toLowerCase(), { handler, description })
  }

  /** Check if a command is registered */
  has(name: string): boolean {
    return this.commands.has(name.toLowerCase())
  }

  /** Execute a command */
  async execute(name: string, ctx: CommandContext): Promise<string> {
    const entry = this.commands.get(name.toLowerCase())
    if (!entry) {
      return `Unknown command: /${name}\n\nType /help for available commands.`
    }
    try {
      return await entry.handler(ctx)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[telegram-cmd] /${name} failed:`, msg)
      return `❌ Error: ${msg}`
    }
  }

  /** Get all commands as Telegram BotCommand array (for setMyCommands) */
  getBotCommands(): BotCommand[] {
    return Array.from(this.commands.entries()).map(([command, { description }]) => ({
      command,
      description,
    }))
  }

  /** Register commands with Telegram Bot API via setMyCommands */
  async registerWithTelegram(botToken: string): Promise<boolean> {
    const commands = this.getBotCommands()
    const result = await telegramApi(botToken, 'setMyCommands', { commands })
    if (!result.ok) {
      console.error('[telegram-cmd] setMyCommands failed:', result.description)
      return false
    }
    console.log(`[telegram-cmd] Registered ${commands.length} commands with Telegram`)
    return true
  }
}

// ---------------------------------------------------------------------------
// Helper: resolve userId from chatId
// ---------------------------------------------------------------------------

export async function resolveUserFromChat(chatId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: connectedAccounts.userId })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.channel, 'telegram'),
        eq(connectedAccounts.externalId, chatId),
        eq(connectedAccounts.enabled, true),
      ),
    )
    .limit(1)

  return row?.userId ?? null
}

/**
 * Resolve an Astro user ID from a Telegram user's numeric ID.
 * In personal (DM) chats the Telegram user ID equals the chat ID,
 * so this is equivalent to resolveUserFromChat for those chats.
 * For group messages we pass `from.id` (the sender's Telegram user ID)
 * to find the Astro user who connected that Telegram account.
 */
export async function resolveUserFromTelegramId(telegramUserId: string): Promise<string | null> {
  return resolveUserFromChat(telegramUserId)
}

// ---------------------------------------------------------------------------
// Helper: resolve user's team IDs
// ---------------------------------------------------------------------------

async function getUserTeamIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))

  return rows.map((r) => r.teamId)
}

// ---------------------------------------------------------------------------
// Helper: find node by partial clientId (prefix match)
// ---------------------------------------------------------------------------

async function resolveNode(
  partialId: string,
  teamIds: string[],
): Promise<{
  clientId: string
  projectId: string
  title: string
  status: string
  type: string
  description: string
  executionId: string | null
} | null> {
  // Guard: if teamIds is empty, the team filter would be dropped entirely,
  // exposing nodes from all teams. Return null instead.
  if (teamIds.length === 0) return null

  // First try exact match on clientId
  const rows = await db
    .select({
      clientId: planNodes.clientId,
      projectId: planNodes.projectId,
      title: planNodes.title,
      status: planNodes.status,
      type: planNodes.type,
      description: planNodes.description,
      executionId: planNodes.executionId,
    })
    .from(planNodes)
    .innerJoin(projects, eq(planNodes.projectId, projects.id))
    .where(
      and(
        eq(planNodes.clientId, partialId),
        isNull(planNodes.deletedAt),
        inArray(projects.teamId, teamIds),
      ),
    )
    .limit(1)

  if (rows.length > 0) return rows[0]

  // Try number match (e.g., /task 42 → node with number=42)
  const num = parseInt(partialId, 10)
  if (!isNaN(num)) {
    const byNumber = await db
      .select({
        clientId: planNodes.clientId,
        projectId: planNodes.projectId,
        title: planNodes.title,
        status: planNodes.status,
        type: planNodes.type,
        description: planNodes.description,
        executionId: planNodes.executionId,
      })
      .from(planNodes)
      .innerJoin(projects, eq(planNodes.projectId, projects.id))
      .where(
        and(
          eq(planNodes.number, num),
          isNull(planNodes.deletedAt),
          inArray(projects.teamId, teamIds),
        ),
      )
      .limit(1)

    if (byNumber.length > 0) return byNumber[0]
  }

  return null
}

// ---------------------------------------------------------------------------
// Status emoji helper
// ---------------------------------------------------------------------------

function statusEmoji(status: string): string {
  switch (status) {
    case 'planned':
      return '📋'
    case 'dispatched':
      return '🚀'
    case 'in_progress':
      return '⏳'
    case 'completed':
    case 'auto_verified':
      return '✅'
    case 'awaiting_approval':
    case 'awaiting_judgment':
      return '✋'
    case 'pruned':
      return '✂️'
    default:
      return '•'
  }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleProjects(ctx: CommandContext): Promise<string> {
  const teamIds = await getUserTeamIds(ctx.userId)
  if (teamIds.length === 0) {
    return 'You are not a member of any team.'
  }

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      progress: projects.progress,
      icon: projects.icon,
    })
    .from(projects)
    .where(
      and(
        inArray(projects.teamId, teamIds),
        eq(projects.status, 'active'),
      ),
    )
    .limit(25)

  if (rows.length === 0) {
    return 'No active projects found.'
  }

  const lines = rows.map((p) => {
    const progress = p.progress ?? 0
    const bar = '█'.repeat(Math.round(progress / 10)) + '░'.repeat(10 - Math.round(progress / 10))
    return `${p.icon ?? '📋'} <b>${escapeHtml(p.name)}</b>\n   ${bar} ${progress}%\n   <code>${p.id.slice(0, 8)}</code>`
  })

  return `<b>📂 Your Projects</b>\n\n${lines.join('\n\n')}`
}

async function handlePlan(ctx: CommandContext): Promise<string> {
  const projectIdOrName = ctx.args.trim()
  if (!projectIdOrName) {
    return 'Usage: /plan &lt;project-id&gt;\n\nTip: Use /projects to list your projects and get their IDs.'
  }

  const teamIds = await getUserTeamIds(ctx.userId)

  // Try to find the project by partial ID
  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      icon: projects.icon,
    })
    .from(projects)
    .where(
      and(
        inArray(projects.teamId, teamIds.length > 0 ? teamIds : ['']),
        eq(projects.status, 'active'),
      ),
    )
    .limit(100)

  const project = projectRows.find(
    (p) => p.id === projectIdOrName || p.id.startsWith(projectIdOrName),
  )

  if (!project) {
    return `Project not found: <code>${escapeHtml(projectIdOrName)}</code>\n\nUse /projects to list available projects.`
  }

  // Get plan nodes for this project
  const nodes = await db
    .select({
      clientId: planNodes.clientId,
      number: planNodes.number,
      title: planNodes.title,
      status: planNodes.status,
      type: planNodes.type,
      parentId: planNodes.parentId,
    })
    .from(planNodes)
    .where(
      and(
        eq(planNodes.projectId, project.id),
        isNull(planNodes.deletedAt),
      ),
    )
    .limit(50)

  if (nodes.length === 0) {
    return `${project.icon ?? '📋'} <b>${escapeHtml(project.name)}</b>\n\nNo plan nodes yet.`
  }

  // Build a simple tree view
  const milestones = nodes.filter((n) => n.type === 'milestone')
  const tasks = nodes.filter((n) => n.type !== 'milestone')

  const lines: string[] = []

  // Show milestones with their children
  for (const milestone of milestones) {
    lines.push(`\n📌 <b>${escapeHtml(milestone.title)}</b> ${statusEmoji(milestone.status)}`)
    const children = tasks.filter((t) => t.parentId === milestone.clientId)
    for (const child of children) {
      const num = child.number ? `#${child.number}` : child.clientId.slice(0, 6)
      lines.push(`  ${statusEmoji(child.status)} ${escapeHtml(child.title)} <code>${num}</code>`)
    }
  }

  // Show orphan tasks (no parent milestone)
  const milestoneIds = new Set(milestones.map((m) => m.clientId))
  const orphans = tasks.filter((t) => !t.parentId || !milestoneIds.has(t.parentId))
  if (orphans.length > 0 && milestones.length > 0) {
    lines.push('\n📋 <b>Other Tasks</b>')
  }
  for (const task of orphans) {
    const num = task.number ? `#${task.number}` : task.clientId.slice(0, 6)
    lines.push(`  ${statusEmoji(task.status)} ${escapeHtml(task.title)} <code>${num}</code>`)
  }

  const header = `${project.icon ?? '📋'} <b>${escapeHtml(project.name)}</b> — Plan (${nodes.length} nodes)`
  return `${header}\n${lines.join('\n')}`
}

async function handleTask(ctx: CommandContext): Promise<string> {
  const taskId = ctx.args.trim()
  if (!taskId) {
    return 'Usage: /task &lt;task-id-or-number&gt;'
  }

  const teamIds = await getUserTeamIds(ctx.userId)
  const node = await resolveNode(taskId, teamIds)

  if (!node) {
    return `Task not found: <code>${escapeHtml(taskId)}</code>`
  }

  // Get execution info if available
  let executionInfo = ''
  if (node.executionId) {
    const [exec] = await db
      .select({
        status: taskExecutions.status,
        startedAt: taskExecutions.startedAt,
        completedAt: taskExecutions.completedAt,
        durationMs: taskExecutions.durationMs,
        estimatedCostUsd: taskExecutions.estimatedCostUsd,
        model: taskExecutions.model,
        markdownSummary: taskExecutions.markdownSummary,
      })
      .from(taskExecutions)
      .where(eq(taskExecutions.executionId, node.executionId))
      .limit(1)

    if (exec) {
      const duration = exec.durationMs ? `${Math.round(exec.durationMs / 1000)}s` : 'n/a'
      const cost = exec.estimatedCostUsd ? `$${exec.estimatedCostUsd.toFixed(4)}` : 'n/a'
      executionInfo = `\n\n<b>Execution:</b>\n`
        + `  Status: ${exec.status}\n`
        + `  Duration: ${duration}\n`
        + `  Cost: ${cost}\n`
        + (exec.model ? `  Model: ${exec.model}\n` : '')
        + (exec.markdownSummary
          ? `\n<b>Summary:</b>\n${formatForChannel(exec.markdownSummary.slice(0, 800), 'telegram_html')}`
          : '')
    }
  }

  const desc = node.description
    ? `\n\n${formatForChannel(node.description.slice(0, 500), 'telegram_html')}`
    : ''

  return (
    `${statusEmoji(node.status)} <b>${escapeHtml(node.title)}</b>\n\n`
    + `Type: ${node.type}\n`
    + `Status: ${node.status}\n`
    + `ID: <code>${node.clientId}</code>`
    + desc
    + executionInfo
  )
}

async function handleDispatch(ctx: CommandContext): Promise<string> {
  const taskId = ctx.args.trim()
  if (!taskId) {
    return 'Usage: /dispatch &lt;task-id-or-number&gt;'
  }

  const teamIds = await getUserTeamIds(ctx.userId)
  const node = await resolveNode(taskId, teamIds)

  if (!node) {
    return `Task not found: <code>${escapeHtml(taskId)}</code>`
  }

  if (node.status !== 'planned') {
    return `Task <b>${escapeHtml(node.title)}</b> is already <b>${node.status}</b> and cannot be dispatched.`
  }

  // Fire server-side dispatch (non-blocking — the SSE stream handles persistence)
  try {
    // serverSideDispatch handles claiming, machine selection, and full dispatch flow
    serverSideDispatch(node.clientId, node.projectId).catch((err) => {
      console.error(`[telegram-cmd] dispatch failed for ${node.clientId}:`, err)
    })

    return `🚀 Dispatching <b>${escapeHtml(node.title)}</b>...\n\nUse /status to track progress.`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `❌ Failed to dispatch: ${msg}`
  }
}

async function handleStatus(ctx: CommandContext): Promise<string> {
  const teamIds = await getUserTeamIds(ctx.userId)
  if (teamIds.length === 0) {
    return 'You are not a member of any team.'
  }

  // Get active executions (running or pending)
  const activeExecs = await db
    .select({
      executionId: taskExecutions.executionId,
      nodeClientId: taskExecutions.nodeClientId,
      projectId: taskExecutions.projectId,
      status: taskExecutions.status,
      startedAt: taskExecutions.startedAt,
      model: taskExecutions.model,
    })
    .from(taskExecutions)
    .innerJoin(projects, eq(taskExecutions.projectId, projects.id))
    .where(
      and(
        inArray(projects.teamId, teamIds),
        or(
          eq(taskExecutions.status, 'running'),
          eq(taskExecutions.status, 'pending'),
        ),
        isNull(taskExecutions.deletedAt),
      ),
    )
    .limit(20)

  if (activeExecs.length === 0) {
    return '✨ No active executions. All quiet!'
  }

  // Get node titles for the active executions
  const nodeIds = activeExecs.map((e) => e.nodeClientId)
  const nodeRows = await db
    .select({
      clientId: planNodes.clientId,
      title: planNodes.title,
      number: planNodes.number,
    })
    .from(planNodes)
    .where(inArray(planNodes.clientId, nodeIds))

  const nodeMap = new Map(nodeRows.map((n) => [n.clientId, n]))

  const lines = activeExecs.map((exec) => {
    const node = nodeMap.get(exec.nodeClientId)
    const title = node ? escapeHtml(node.title) : exec.nodeClientId.slice(0, 8)
    const num = node?.number ? `#${node.number}` : ''
    const elapsed = exec.startedAt
      ? `${Math.round((Date.now() - new Date(exec.startedAt).getTime()) / 1000)}s`
      : ''
    const statusIcon = exec.status === 'running' ? '⏳' : '🔄'
    return `${statusIcon} <b>${title}</b> ${num}\n   ${exec.status} ${elapsed ? `• ${elapsed}` : ''} ${exec.model ? `• ${exec.model}` : ''}`
  })

  return `<b>⚡ Active Executions</b> (${activeExecs.length})\n\n${lines.join('\n\n')}`
}

async function handleStop(ctx: CommandContext): Promise<string> {
  const taskId = ctx.args.trim()
  if (!taskId) {
    return 'Usage: /stop &lt;task-id-or-number&gt;'
  }

  const teamIds = await getUserTeamIds(ctx.userId)
  const node = await resolveNode(taskId, teamIds)

  if (!node) {
    return `Task not found: <code>${escapeHtml(taskId)}</code>`
  }

  const cancelled = await dispatchEngine.cancel(node.clientId)

  if (cancelled) {
    return `🛑 Cancelled <b>${escapeHtml(node.title)}</b>`
  }

  // If dispatch engine didn't have it, check if there's a running execution we can mark
  if (node.executionId) {
    const [exec] = await db
      .select({ status: taskExecutions.status })
      .from(taskExecutions)
      .where(eq(taskExecutions.executionId, node.executionId))
      .limit(1)

    if (exec && (exec.status === 'running' || exec.status === 'pending')) {
      await db
        .update(taskExecutions)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(eq(taskExecutions.executionId, node.executionId))

      await db
        .update(planNodes)
        .set({ status: 'planned', updatedAt: new Date() })
        .where(eq(planNodes.clientId, node.clientId))

      return `🛑 Cancelled <b>${escapeHtml(node.title)}</b>`
    }
  }

  return `Task <b>${escapeHtml(node.title)}</b> has no active execution to stop.`
}

async function handleApprove(ctx: CommandContext): Promise<string> {
  const approvalId = ctx.args.trim()
  if (!approvalId) {
    return 'Usage: /approve &lt;approval-id&gt;\n\nApproval IDs are shown in approval request notifications.'
  }

  try {
    await dispatchEngine.respondToApproval(approvalId, true)
    return `✅ Approved: <code>${escapeHtml(approvalId)}</code>`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('No pending approval found')) {
      return `This approval has expired or was already handled.`
    }
    return `❌ Approval failed: ${msg}`
  }
}

// ---------------------------------------------------------------------------
// Forum topic helpers
// ---------------------------------------------------------------------------

/** Call createForumTopic on the Telegram Bot API. Returns the new thread ID or null on failure. */
async function createForumTopic(
  token: string,
  chatId: string,
  name: string,
): Promise<number | null> {
  const result = await telegramApi(token, 'createForumTopic', {
    chat_id: chatId,
    name: name.slice(0, 128), // Telegram limit
  })
  if (!result.ok || !result.result) return null
  const topic = result.result as { message_thread_id?: number }
  return topic.message_thread_id ?? null
}

/** Build the mapping key used in connected_accounts.mappings for a group topic. */
function topicMappingKey(groupChatId: string, threadId: string): string {
  return `${groupChatId}:topic:${threadId}`
}

// ---------------------------------------------------------------------------
// /bind — bind a forum topic to an Astro project
// ---------------------------------------------------------------------------

async function handleBind(ctx: CommandContext): Promise<string> {
  const { args, userId, botToken, threadId, groupChatId } = ctx

  const projectIdOrName = args.trim()

  if (!projectIdOrName) {
    return (
      '<b>/bind &lt;project-id&gt;</b>\n\n'
      + 'Binds the current forum topic to an Astro project.\n'
      + 'Messages sent in this topic will be routed to that project\'s chat session.\n\n'
      + 'Run /projects to find a project ID.'
    )
  }

  // Must be used in a group
  if (!groupChatId) {
    return (
      '❌ /bind must be used inside a Telegram group with Topics enabled.\n\n'
      + 'Add this bot to a supergroup, enable <b>Topics</b> in Group Settings, '
      + 'then run /bind inside a topic.'
    )
  }

  const teamIds = await getUserTeamIds(userId)
  if (teamIds.length === 0) {
    return 'You are not a member of any team.'
  }

  // Find the project
  const projectRows = await db
    .select({ id: projects.id, name: projects.name, icon: projects.icon })
    .from(projects)
    .where(
      and(
        inArray(projects.teamId, teamIds),
        eq(projects.status, 'active'),
      ),
    )
    .limit(100)

  const project = projectRows.find(
    (p) =>
      p.id === projectIdOrName ||
      p.id.startsWith(projectIdOrName) ||
      p.name.toLowerCase() === projectIdOrName.toLowerCase(),
  )

  if (!project) {
    return (
      `Project not found: <code>${escapeHtml(projectIdOrName)}</code>\n\n`
      + 'Use /projects to list available projects.'
    )
  }

  // Get the user's connected account
  const [account] = await db
    .select({ id: connectedAccounts.id, mappings: connectedAccounts.mappings })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.channel, 'telegram'),
        eq(connectedAccounts.enabled, true),
      ),
    )
    .limit(1)

  if (!account) {
    return 'Your Telegram is not connected to Astro. Please connect via Astro Settings first.'
  }

  // Determine the thread ID — either current topic or auto-create a new one
  let resolvedThreadId = threadId

  if (!resolvedThreadId) {
    // Not inside a topic: auto-create one named after the project
    const newThreadId = await createForumTopic(botToken, groupChatId, project.name)
    if (newThreadId === null) {
      return (
        '❌ Could not auto-create a topic (the group may not have Topics enabled, '
        + 'or the bot lacks admin rights).\n\n'
        + 'Please create a forum topic manually and run /bind inside it.'
      )
    }
    resolvedThreadId = String(newThreadId)
  }

  const mappingKey = topicMappingKey(groupChatId, resolvedThreadId)
  const currentMappings = ((account.mappings ?? {}) as Record<string, string>)
  const updatedMappings = { ...currentMappings, [mappingKey]: project.id }

  await db
    .update(connectedAccounts)
    .set({ mappings: updatedMappings, updatedAt: new Date() })
    .where(eq(connectedAccounts.id, account.id))

  const created = !threadId ? ' (new topic created)' : ''
  return (
    `✅ <b>Topic bound to project${created}!</b>\n\n`
    + `${project.icon ?? '📋'} <b>${escapeHtml(project.name)}</b>\n\n`
    + "Messages in this topic will be routed to this project's chat session.\n"
    + `Use /unbind to remove this binding.`
  )
}

// ---------------------------------------------------------------------------
// /unbind — remove a topic → project binding
// ---------------------------------------------------------------------------

async function handleUnbind(ctx: CommandContext): Promise<string> {
  const { userId, groupChatId, threadId } = ctx

  if (!groupChatId || !threadId) {
    return '❌ /unbind must be used inside a Telegram forum topic.'
  }

  const [account] = await db
    .select({ id: connectedAccounts.id, mappings: connectedAccounts.mappings })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.channel, 'telegram'),
        eq(connectedAccounts.enabled, true),
      ),
    )
    .limit(1)

  if (!account) {
    return 'Your Telegram is not connected to Astro.'
  }

  const mappingKey = topicMappingKey(groupChatId, threadId)
  const currentMappings = ((account.mappings ?? {}) as Record<string, string>)

  if (!currentMappings[mappingKey]) {
    return 'This topic is not bound to any Astro project.'
  }

  const projectId = currentMappings[mappingKey]
  const updatedMappings = Object.fromEntries(
    Object.entries(currentMappings).filter(([k]) => k !== mappingKey),
  )

  await db
    .update(connectedAccounts)
    .set({ mappings: updatedMappings, updatedAt: new Date() })
    .where(eq(connectedAccounts.id, account.id))

  // Fetch project name for the confirmation message
  const [project] = await db
    .select({ name: projects.name, icon: projects.icon })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  const projectLabel = project
    ? `${project.icon ?? '📋'} <b>${escapeHtml(project.name)}</b>`
    : `project <code>${projectId.slice(0, 8)}</code>`

  return `✅ Unbound from ${projectLabel}. Messages here will no longer be routed to Astro.`
}

// ---------------------------------------------------------------------------
// /topics — list topic bindings for the current group
// ---------------------------------------------------------------------------

async function handleTopics(ctx: CommandContext): Promise<string> {
  const { userId, groupChatId } = ctx

  if (!groupChatId) {
    return '❌ /topics must be used inside a Telegram group.'
  }

  const [account] = await db
    .select({ mappings: connectedAccounts.mappings })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.channel, 'telegram'),
        eq(connectedAccounts.enabled, true),
      ),
    )
    .limit(1)

  const mappings = ((account?.mappings ?? {}) as Record<string, string>)
  const prefix = `${groupChatId}:topic:`
  const groupMappings = Object.entries(mappings).filter(([k]) => k.startsWith(prefix))

  if (groupMappings.length === 0) {
    return (
      'No topic bindings for this group.\n\n'
      + 'Use /bind &lt;project-id&gt; inside a topic to create one.'
    )
  }

  // Fetch project names
  const projectIds = [...new Set(groupMappings.map(([, v]) => v))]
  const projectRows = await db
    .select({ id: projects.id, name: projects.name, icon: projects.icon })
    .from(projects)
    .where(inArray(projects.id, projectIds))

  const projectMap = new Map(projectRows.map((p) => [p.id, p]))

  const lines = groupMappings.map(([key, projectId]) => {
    const threadId = key.slice(prefix.length)
    const p = projectMap.get(projectId)
    const label = p
      ? `${p.icon ?? '📋'} ${escapeHtml(p.name)}`
      : `Unknown (${projectId.slice(0, 8)})`
    return `• Topic <code>${threadId}</code> → ${label}`
  })

  return `<b>📌 Topic Bindings</b>\n\n${lines.join('\n')}\n\nUse /bind or /unbind to manage bindings.`
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleHelp(_ctx: CommandContext): Promise<string> {
  return (
    '<b>🤖 Astro Bot Commands</b>\n\n'
    + '<b>Chat</b>\n'
    + '/bind &lt;project-id&gt; — Link a project for chat\n'
    + '/new — Start a fresh chat session\n'
    + '\n<b>Projects &amp; Tasks</b>\n'
    + '/projects — List your active projects\n'
    + '/plan &lt;id&gt; — Show plan tree for a project\n'
    + '/task &lt;id&gt; — Show task details\n'
    + '/dispatch &lt;id&gt; — Trigger execution of a task\n'
    + '/status — Show active executions\n'
    + '/stop &lt;id&gt; — Cancel an execution\n'
    + '/approve &lt;id&gt; — Approve a pending request\n'
    + '/help — Show this help message\n'
    + '\n<b>📌 Forum Topic Commands (group chats)</b>\n'
    + '/bind &lt;project-id&gt; — Bind this topic to a project\n'
    + '/unbind — Remove the binding for this topic\n'
    + '/topics — List all topic bindings in this group\n'
    + '\nTip: Use short IDs or task numbers (e.g., /task 42)\n'
    + '\n<i>Once bound to a project, just send any message to chat with the AI!</i>'
  )
}

async function handleBind(ctx: CommandContext): Promise<string> {
  const projectIdOrPrefix = ctx.args.trim()
  if (!projectIdOrPrefix) {
    return (
      'Usage: /bind &lt;project-id&gt;\n\n'
      + 'Use /projects to list your projects and get their IDs.\n'
      + 'Example: /bind abc12345'
    )
  }

  const teamIds = await getUserTeamIds(ctx.userId)
  if (teamIds.length === 0) {
    return 'You are not a member of any team.'
  }

  // Find matching project
  const allProjects = await db
    .select({ id: projects.id, name: projects.name, icon: projects.icon })
    .from(projects)
    .where(
      and(
        inArray(projects.teamId, teamIds),
        eq(projects.status, 'active'),
      ),
    )
    .limit(100)

  const match = allProjects.find(
    (p) => p.id === projectIdOrPrefix || p.id.startsWith(projectIdOrPrefix),
  )

  if (!match) {
    return (
      `Project not found: <code>${escapeHtml(projectIdOrPrefix)}</code>\n\n`
      + 'Use /projects to list available projects.'
    )
  }

  const ok = await setDefaultProject(ctx.chatId, match.id)
  if (!ok) {
    return 'Failed to update project binding. Make sure your Telegram is connected (use /status).'
  }

  return (
    `${match.icon ?? '📋'} Bound to <b>${escapeHtml(match.name)}</b>\n\n`
    + 'Now just send any message to chat with your AI assistant about this project.\n'
    + 'Use /new to start a fresh conversation.'
  )
}

async function handleNew(ctx: CommandContext): Promise<string> {
  const cleared = await clearChatSession(ctx.chatId)
  if (!cleared) {
    return 'No active session to clear, or your Telegram is not connected.'
  }
  return '🔄 Chat session cleared. Your next message will start a fresh conversation.'
}

// ---------------------------------------------------------------------------
// HTML escaping for Telegram
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// Singleton registry with all commands registered
// ---------------------------------------------------------------------------

export const commandRegistry = new CommandRegistry()

// Register all commands
commandRegistry.register('bind', 'Link a project for AI chat', handleBind)
commandRegistry.register('new', 'Start a fresh chat session', handleNew)
commandRegistry.register('projects', 'List your active projects', handleProjects)
commandRegistry.register('plan', 'Show plan tree for a project', handlePlan)
commandRegistry.register('task', 'Show task details', handleTask)
commandRegistry.register('dispatch', 'Trigger execution of a task', handleDispatch)
commandRegistry.register('status', 'Show active executions', handleStatus)
commandRegistry.register('stop', 'Cancel an execution', handleStop)
commandRegistry.register('approve', 'Approve a pending request', handleApprove)
commandRegistry.register('bind', 'Bind this topic to an Astro project', handleBind)
commandRegistry.register('unbind', 'Remove this topic\'s project binding', handleUnbind)
commandRegistry.register('topics', 'List topic bindings in this group', handleTopics)
commandRegistry.register('help', 'Show available commands', handleHelp)

// ---------------------------------------------------------------------------
// Parse and route a message to the command registry
// ---------------------------------------------------------------------------

/**
 * Try to handle a message as a slash command.
 * Returns the response text if it was a command, null otherwise.
 *
 * @param text        Raw message text starting with /
 * @param chatId      Telegram chat ID (personal chat or group ID)
 * @param botToken    Bot API token
 * @param options.fromId      Sender's Telegram user ID — used in group chats to look up the Astro user
 * @param options.threadId    Telegram message_thread_id — present inside a forum topic
 * @param options.isGroupChat Whether the message came from a group/supergroup
 */
export async function handleCommand(
  text: string,
  chatId: string,
  botToken: string,
  options?: { fromId?: string; threadId?: string; isGroupChat?: boolean },
): Promise<string | null> {
  // Must start with /
  if (!text.startsWith('/')) return null

  // Parse command: "/command@botname args" → { command, args }
  const match = text.match(/^\/(\w+)(?:@\w+)?\s*(.*)$/s)
  if (!match) return null

  const [, command, args] = match

  // Skip built-in commands handled by telegram-channel.ts
  if (command === 'start' || command === 'disconnect') return null

  // In group chats, use `fromId` (the Telegram user's numeric ID) to look up the Astro user.
  // In private chats, chatId === the Telegram user ID, so fromId is the same as chatId.
  const lookupId = options?.fromId ?? chatId
  const userId = await resolveUserFromChat(lookupId)

  if (!userId) {
    if (options?.isGroupChat) {
      // In group chats, silently ignore commands from users who haven't connected Astro.
      return null
    }
    return 'You need to connect your Telegram first. Use the link from Astro Settings.'
  }

  // Check if this is a registered command
  if (!commandRegistry.has(command)) {
    return null // Let the caller handle unknown messages
  }

  return commandRegistry.execute(command, {
    chatId,
    userId,
    args: args.trim(),
    botToken,
    threadId: options?.threadId,
    groupChatId: options?.isGroupChat ? chatId : undefined,
  })
}
