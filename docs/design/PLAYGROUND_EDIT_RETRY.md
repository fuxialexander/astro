# Playground Edit & Retry

## Problem

When a Playground session fails, gets stopped, or completes, the user cannot edit the original prompt and re-run it. The only option is to go back to the landing page and type a new prompt from scratch. This is a standard UX pattern in conversational AI products (ChatGPT, Claude.ai) that Astro was missing.

## Solution

Add an **Edit & Retry** flow that lets users go back to the landing phase with the previous session's details pre-populated (prompt, machine, working directory), edit the prompt, and start a new session.

Additionally, display the original prompt as the first message in the activity timeline with an inline edit affordance, and make follow-up user messages (steer/chat) editable to re-fill the input bar.

## Design

### Components Changed

| File | Change |
|------|--------|
| `src/components/playground/playground-header.tsx` | New `onRetry` prop, "Edit & Retry" button for terminal states |
| `src/pages/playground.tsx` | `handleRetry` callback, original prompt bubble in timeline, wiring |
| `src/components/activity-blocks.tsx` | `ChatUserBlock` gains optional `onEdit` prop |

### User Flows

#### Flow 1: Header "Edit & Retry" Button

1. User views a stopped, failed, or completed session
2. Header shows "Edit & Retry" button (with `RotateCcw` icon)
3. Clicking it:
   - Pre-fills `description` state with `project.name` (the original prompt)
   - Pre-fills `workingDir` with `project.workingDirectory`
   - Re-selects the machine (`execution.machineId` → matched from `allMachines`)
   - Transitions to landing phase (clears `activeProjectId`, removes URL param)
4. User edits the prompt in the textarea and clicks "Start Session"

#### Flow 2: Pencil Icon on Original Prompt

1. The activity timeline renders the original prompt as the first `ChatUserBlock`-style bubble (right-aligned, primary color)
2. On hover, a pencil icon appears to the left of the bubble
3. Clicking it triggers the same `handleRetry` flow as Flow 1

#### Flow 3: Edit Past Chat/Steer Messages

1. After a session ends, user messages (steer during execution, chat after completion) render with a pencil icon on hover
2. Clicking the pencil pre-fills the **input bar** (not the landing form) with that message's text
3. The input bar is focused automatically so the user can edit and re-send
4. This is useful for refining follow-up questions without retyping

### State Management

No new state is introduced. `handleRetry` reuses existing state setters:

```
setDescription(project.name)
setWorkingDir(project.workingDirectory)
setSelectedMachine(matchedMachine)
backingRef.current = true   // prevent URL→state sync from re-entering activity
setActiveProjectId(null)
setSearchParams({})
```

### Visibility Rules

| Session Status | "Edit & Retry" Button | Prompt Pencil | Chat Pencil |
|---------------|----------------------|---------------|-------------|
| Running       | Hidden               | Hidden        | Hidden      |
| Waiting       | Hidden               | Hidden        | Hidden      |
| Stopped       | Visible              | Visible       | Visible     |
| Error         | Visible              | Visible       | Visible     |
| Completed     | Visible              | Visible       | Visible     |

### Responsiveness

- Desktop: Button shows "Edit & Retry" with icon
- Mobile: Button shows "Retry" (shorter label) with icon
- Pencil icons use hover visibility (`opacity-0 → group-hover:opacity-60`)

## Future Considerations

- **Conversation branching**: Full tree-based conversation branching (edit message N → fork the conversation from that point) would require a conversation tree data model. The current implementation is a pragmatic MVP that covers the most common case.
- **Session duplication**: A "Duplicate" action (copy all settings, start fresh) could reuse `handleRetry` with an empty description.
- **Prompt history**: Storing prompts separately from projects would enable a prompt library / quick-reuse feature.
