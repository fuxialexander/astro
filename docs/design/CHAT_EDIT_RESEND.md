# Chat Edit & Resend — All Surfaces

## Problem

Across Astro's 4 chat surfaces, users cannot edit a previously sent message and resend it. This is a standard UX pattern in ChatGPT, Claude.ai, and other conversational AI products. When a follow-up question doesn't get the desired response, users must retype from scratch.

## Scope

All 4 chat surfaces in Astro:

| Surface | File | Context |
|---------|------|---------|
| **Playground** | `src/pages/playground.tsx` | Standalone coding sessions |
| **Plan Chat Phase** | `src/components/plan-generation/plan-generation.tsx` | Chat during/after plan generation |
| **Chat Panel** | `src/components/agent/chat-panel.tsx` | Plan chat sidebar |
| **Task Execution** | `src/components/task-detail/unified-activity-view.tsx` | Chat after task execution |

## Solution

### Shared Component: `ChatUserBlock.onEdit`

`ChatUserBlock` in `activity-blocks.tsx` gains an optional `onEdit` prop:

```tsx
onEdit?: (message: string) => void
```

When provided:
- A pencil icon (`Pencil` from lucide-react) appears on hover, positioned to the left of the message bubble
- Clicking it calls `onEdit(message)` with the original message text
- The parent component pre-fills the input bar with that text

### Per-Surface Wiring

Each surface passes `onEdit` to `ChatUserBlock` in its `renderBlock`/render function:

```tsx
case 'chat_user':
  return <ChatUserBlock
    onEdit={!isStreaming ? (msg) => { setInput(msg); inputRef.current?.focus() } : undefined}
  />
```

The `onEdit` prop is only passed when the session is **not actively streaming** — editing while streaming would be confusing.

| Surface | Guard condition | Focus behavior |
|---------|----------------|----------------|
| Playground | `!isRunning` | `inputRef.current?.focus()` |
| Plan Chat Phase | `!isRunning && !isChatStreaming` | `inputRef.current?.focus()` |
| Chat Panel | `!isStreaming` | `setInput(msg)` only (no inputRef) |
| Task Execution | `!isRunning && !isChatStreaming` | `setInput(msg)` only (no inputRef) |

### Playground-Specific: Edit & Retry

The Playground also gets:
1. **"Edit & Retry" button** in `PlaygroundHeader` for terminal states (stopped/error/completed)
2. **Original prompt bubble** at the top of the activity timeline with a pencil icon
3. Both trigger `handleRetry` which goes back to the landing form pre-populated with the session's prompt, machine, and working directory

## Interaction Model

**Edit a past message** (all surfaces):
1. Hover over any user message bubble → pencil icon appears on the left
2. Click pencil → message text is loaded into the input bar
3. User edits the text and presses Enter/Cmd+Enter to send
4. New message is sent as a follow-up in the same conversation

**Edit & retry original prompt** (Playground only):
1. Click "Edit & Retry" button in header, or pencil icon on original prompt
2. Returns to landing form with prompt/machine/directory pre-filled
3. User edits and clicks "Start Session" → new session starts

## Visibility Rules

The pencil icon is hidden when:
- The session is actively running/streaming (would be confusing to edit while output is flowing)
- The `onEdit` prop is not provided (component-level opt-out)

The pencil uses hover visibility: `opacity-0 group-hover:opacity-60 hover:opacity-100` — unobtrusive but discoverable.
