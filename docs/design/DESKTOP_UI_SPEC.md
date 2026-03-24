# Desktop UI Specification

> **Status: PROPOSED** -- Defines the Codex-like desktop frontend for the Tauri app. No desktop-specific frontend code exists yet. The current Tauri shell loads the web app in a webview.

> **See also:** [TAURI_APP.md](./TAURI_APP.md) for the full Tauri architecture and migration path. [COLOR_PALETTE.md](./COLOR_PALETTE.md) for the design system color tokens. [FRONTEND.md](./FRONTEND.md) for the existing web frontend architecture.

> **Reference:** [OpenAI Codex](https://developers.openai.com/codex/app) for the conversational coding UX pattern this spec draws from.

## Design Philosophy

The desktop app is not a port of the web app into a native window. It is a **purpose-built interface** for AI-assisted development, optimized for the keyboard-driven, conversation-centric workflow that desktop users expect.

**Principles:**
1. **Conversation-first** -- Every interaction flows through a chat thread. Planning, execution, review, and approval all happen in conversation context.
2. **Minimal chrome** -- Reduce visual noise. No unnecessary borders, badges, or navigation. Let content fill the space.
3. **Keyboard-native** -- Every action has a keyboard shortcut. Mouse is supported but never required.
4. **Smooth and responsive** -- Animations are fast and purposeful. No jank, no layout shifts, no loading spinners longer than 200ms for local operations.
5. **Information density** -- Show more, scroll less. Use the full screen. Respect the user's attention.

## Three-Panel Layout

The primary layout is three vertical panels. All panels are resizable via drag handles.

```
+------------------+----------------------------+--------------------+
|                  |                            |                    |
|  Sidebar         |  Thread Panel              |  Review Pane       |
|  280px default   |  flex (fills remaining)    |  400px default     |
|  200px min       |  400px min                 |  300px min         |
|  400px max       |  no max                    |  800px max         |
|                  |                            |                    |
+------------------+----------------------------+--------------------+
     Panel 1              Panel 2                    Panel 3
     Cmd+1                Cmd+2                      Cmd+3
```

### Panel Dimensions

| Panel | Default Width | Min Width | Max Width | Collapsible |
|-------|--------------|-----------|-----------|-------------|
| Sidebar | 280px | 200px | 400px | Yes (to 0px) |
| Thread Panel | flex (remaining space) | 400px | none | No |
| Review Pane | 400px | 300px | 800px | Yes (to 0px) |

**Collapse behavior:**
- Sidebar collapses to 0px with Cmd+B (toggle). A thin 4px reveal strip remains on hover.
- Review pane collapses to 0px with Cmd+/ (toggle). Opens automatically when there is content to review (diff, terminal output, file preview).
- When both side panels are collapsed, the thread panel fills the full window.

### Resize Handles

Drag handles are 6px wide, invisible by default, with a subtle border highlight on hover:

```css
.resize-handle {
  width: 6px;
  cursor: col-resize;
  background: transparent;
  transition: background 150ms ease;
}
.resize-handle:hover {
  background: var(--border);
}
.resize-handle:active {
  background: var(--primary);
}
```

Resize uses **spring-based animation** during snap-to-min/max, with a 200ms duration and slight overshoot for natural feel.

## Component Inventory

### 1. ProjectSidebar

The left panel. Shows projects, threads within the active project, and navigation.

```
+------------------+
| [icon] Astro     |  <-- App name + mode badge (Local/Dev/Prod)
+------------------+
| Search...    [K] |  <-- Cmd+K opens command palette
+------------------+
| PROJECTS         |
|  [P] astro-main  |  <-- Active project (highlighted)
|  [P] research    |
|  [P] cli-tools   |
+------------------+
| THREADS          |
|  > Auth module   |  <-- Active thread (highlighted)
|  > Bug fix #42   |
|  > Deploy prep   |
|  . . .           |
|  [+ New Thread]  |  <-- Cmd+T
+------------------+
| MACHINES         |
|  [*] MacBook Pro |  <-- Connected, healthy
|  [ ] HPC Cluster |  <-- Disconnected
+------------------+
|       [?] [S]    |  <-- Help, Settings
+------------------+
```

**Props / State:**
- `projects: Project[]` -- from project store
- `activeProjectId: string`
- `threads: Thread[]` -- chat threads for active project
- `activeThreadId: string`
- `machines: Machine[]` -- connected machines from machine store

**Interactions:**
- Click project -> load project, show its threads
- Click thread -> switch thread in center panel
- Click "+ New Thread" or Cmd+T -> create new thread, focus input
- Right-click project -> context menu (rename, archive, open in browser)
- Drag to reorder threads

### 2. ThreadPanel (Chat)

The center panel. Displays the conversation thread with interleaved user messages, AI responses, tool calls, and execution results.

```
+-------------------------------------------+
| [<] Auth Module           [*] [=] [...]   |  <-- Thread header
+-------------------------------------------+
|                                           |
| USER                          10:42 AM    |
| Build the auth module with passkeys.      |
| Use the WebAuthn API and store            |
| credentials in the users table.           |
|                                           |
| ASSISTANT                     10:42 AM    |
| I'll break this into 3 tasks:             |
|                                           |
| 1. Schema migration -- add webauthn       |
|    columns to users table                 |
| 2. AuthProvider class -- WebAuthn          |
|    registration and verification          |
| 3. UI components -- login form,           |
|    passkey prompt                          |
|                                           |
| [Plan Graph Preview]                      |
|                                           |
| Starting task 1: Schema migration...      |
|                                           |
| +---------------------------------------+ |
| | tool_use: execute_task                | |
| | Task: Schema migration               | |
| | Status: completed (12s)              | |
| | [View Diff] [View Output]            | |
| +---------------------------------------+ |
|                                           |
| ASSISTANT                     10:43 AM    |
| Schema migration complete. Added          |
| webauthn_credential_id and                |
| webauthn_public_key columns.              |
|                                           |
| Moving to task 2...                       |
|                                           |
+-------------------------------------------+
| [Attach] Type a message...     [Send]     |  <-- Input area
| Cmd+Enter to send                         |
+-------------------------------------------+
```

**Props / State:**
- `thread: Thread` -- the active thread
- `messages: Message[]` -- from streaming event store
- `isStreaming: boolean` -- whether AI is currently generating
- `inputValue: string` -- current input text

**Sub-components:**
- `MessageBubble` -- renders a single user or assistant message
- `ToolCallBlock` -- renders tool_use/tool_result with expandable details
- `PlanPreview` -- inline plan graph mini-view (click to expand in review pane)
- `ExecutionStatus` -- progress indicator for running tasks
- `ApprovalRequest` -- inline approval UI with Accept/Reject buttons
- `InputArea` -- multiline input with attach button and send

**Interactions:**
- Scroll to navigate history (auto-scroll to bottom when streaming)
- Click "[View Diff]" on a tool result -> show diff in review pane
- Click "[View Output]" -> show terminal output in review pane
- Click plan preview -> expand plan graph in review pane
- Cmd+Enter sends message, Enter creates newline
- Escape cancels current streaming response

### 3. ReviewPane

The right panel. Context-sensitive: shows whatever is relevant to the current thread state -- file diffs, terminal output, file browser, or plan graph.

The review pane has a **tab bar** at the top showing active review items. Tabs are added when the user clicks "View Diff" or "View Output" in the thread, or when a task produces reviewable output.

```
+--------------------------------------------+
| [Diff] [Terminal] [Files] [Plan]       [x] |  <-- Tab bar
+--------------------------------------------+
|                                            |
|  src/lib/auth-provider.ts                  |
|                                            |
|   1  | import { WebAuthn } from './web...' |
|   2  | import { db } from './db.js'        |
|   3  |                                     |
|   4  + export class AuthProvider {         |
|   5  +   private webauthn: WebAuthn        |
|   6  +                                     |
|   7  +   async register(userId: string) {  |
|   8  +     const credential = await        |
|   9  +       this.webauthn.create({        |
|  10  +         user: { id: userId }        |
|  11  +       })                            |
|  12  +     await db.insert(users).set({    |
|  13  +       webauthnCredentialId:          |
|  14  +         credential.id               |
|  15  +     })                              |
|  16  +   }                                 |
|  17  + }                                   |
|                                            |
+--------------------------------------------+
```

**Review Pane Tabs:**

| Tab | Component | Content |
|-----|-----------|---------|
| Diff | `DiffViewer` | Side-by-side or unified diff of file changes from a task |
| Terminal | `TerminalPanel` | Live PTY terminal connected to the working directory |
| Files | `FileBrowser` | File tree of the project working directory |
| Plan | `PlanGraph` | React Flow plan graph for the current project |
| File | `FileViewer` | Read-only file content with syntax highlighting |

### 4. DiffViewer

Renders file diffs with syntax highlighting. Supports unified and side-by-side modes.

**Props:**
- `diff: string` -- unified diff string
- `filePath: string` -- file being diffed
- `mode: 'unified' | 'split'` -- display mode (default: unified)

**Features:**
- Syntax highlighting per language (via Shiki or Prism)
- Line numbers with gutter
- Added lines in green (`--success` at 10% opacity background)
- Removed lines in red (`--error` at 10% opacity background)
- Collapse unchanged sections (show 3 lines of context, fold the rest)
- Click line number to copy line
- "Accept" / "Reject" buttons per hunk (for approval flow)

### 5. TerminalPanel

Embedded terminal emulator using xterm.js, connected to a Rust PTY via Tauri events.

**Props:**
- `workdir: string` -- working directory for the terminal session
- `terminalId: string | null` -- active PTY session ID

**Communication flow:**
```
xterm.js (browser)
    |  onData callback
    v
invoke('terminal_write', { id, data })
    |  Tauri IPC
    v
Rust: write to PTY fd
    |  PTY output
    v
Tauri event: 'terminal-output-{id}'
    |  Event listener
    v
xterm.js: terminal.write(data)
```

**Features:**
- Standard terminal emulator (256 colors, cursor positioning, scrollback)
- Configurable shell (defaults to user's `$SHELL`)
- Resize follows panel resize (Rust PTY gets resize signal)
- Multiple terminal sessions (tabbed within the terminal tab)
- Copy selection with Cmd+C (when text selected), paste with Cmd+V

### 6. FileBrowser

File tree panel showing the project's working directory contents. Uses `git ls-files` via Rust for git-tracked projects, falls back to recursive directory walk.

**Props:**
- `workdir: string` -- root directory
- `files: FileEntry[]` -- from Rust `list_files` command
- `selectedFile: string | null`

**Features:**
- Tree view with expand/collapse directories
- File icons by extension (using lucide-react or custom SVG set)
- Git status indicators (modified, added, untracked) per file
- Click file -> open in FileViewer tab in review pane
- Double-click file -> open in DiffViewer if modified
- Right-click -> context menu (copy path, open in terminal, reveal in Finder)
- Cmd+P -> quick file search (fuzzy match on file paths)
- File watcher integration: tree updates live when files change on disk

### 7. ActivityFeed

A compact stream of events shown in the thread panel (inline with chat messages). Reuses the existing `activity-blocks.tsx` grouping logic.

**Event types displayed:**
- `text` -- AI-generated text
- `tool_use` / `tool_result` -- collapsed by default, expandable
- `file_change` -- file path + change type (created/modified/deleted)
- `error` -- red-highlighted error messages
- `approval_request` -- interactive approve/reject inline
- `progress` -- task progress indicators

## Keyboard Shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| Cmd+1 | Focus sidebar |
| Cmd+2 | Focus thread panel (input area) |
| Cmd+3 | Focus review pane |
| Cmd+B | Toggle sidebar visibility |
| Cmd+/ | Toggle review pane visibility |
| Cmd+K | Open command palette |
| Cmd+T | New thread in current project |
| Cmd+W | Close current thread tab |
| Cmd+N | New project |
| Cmd+, | Open settings |
| Cmd+Q | Quit application |
| Cmd+R | Reload window (dev mode only) |

### Thread Panel

| Shortcut | Action |
|----------|--------|
| Cmd+Enter | Send message |
| Enter | Newline in input |
| Escape | Cancel streaming / clear input |
| Cmd+Up | Navigate to previous message |
| Cmd+Down | Navigate to next message |
| Cmd+Shift+C | Copy last assistant response |

### Review Pane

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+D | Toggle diff mode (unified/split) |
| Cmd+P | Quick file open (when Files tab active) |
| Cmd+` | Toggle terminal focus |
| Cmd+Shift+T | New terminal session |

### Navigation

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+P | Switch project (fuzzy search) |
| Cmd+[ | Previous thread |
| Cmd+] | Next thread |
| Cmd+Shift+[ | Previous review tab |
| Cmd+Shift+] | Next review tab |

## Command Palette

Opened with Cmd+K. Fuzzy search across all available actions.

**Command categories:**
- **Projects**: "Switch to project...", "New project", "Archive project"
- **Threads**: "Switch to thread...", "New thread", "Delete thread"
- **Files**: "Open file...", "Search in files..."
- **Actions**: "Run task", "Approve task", "Cancel execution"
- **View**: "Toggle sidebar", "Toggle review pane", "Toggle dark mode"
- **System**: "Restart sidecar", "Open settings", "Open logs", "Check for updates"

## Animation Specification

All animations use CSS transitions or Framer Motion. No animation should exceed 300ms.

### Panel Transitions

| Animation | Duration | Easing | Trigger |
|-----------|----------|--------|---------|
| Panel collapse/expand | 200ms | `ease-out` | Cmd+B, Cmd+/ |
| Panel resize (drag) | 0ms (real-time) | linear | Mouse drag |
| Panel resize (snap to min/max) | 200ms | `spring(1, 80, 10)` | Drag past boundary |
| Tab switch in review pane | 150ms | `ease-in-out` | Click tab / keyboard |

### Content Transitions

| Animation | Duration | Easing | Trigger |
|-----------|----------|--------|---------|
| Message appear (new) | 150ms | `ease-out` | New message received |
| Message appear (streaming) | 0ms | none | Token-by-token |
| Tool block expand/collapse | 200ms | `ease-in-out` | Click toggle |
| File tree expand/collapse | 150ms | `ease-out` | Click directory |
| Hover state (buttons, list items) | 150ms | `ease` | Mouse enter/leave |
| Focus ring | 100ms | `ease` | Keyboard focus |

### Scroll Behavior

- Auto-scroll to bottom during streaming: smooth scroll, 60fps
- Manual scroll interrupts auto-scroll (user takes control)
- Auto-scroll resumes when user scrolls back to bottom (within 50px)
- New message indicator when scrolled up: subtle "New messages" pill at bottom

### Loading States

- Local operations (file read, search): no loading state needed (<5ms)
- Sidecar operations (API calls): 200ms delay before showing skeleton
- AI streaming: show typing indicator for 500ms max, then stream tokens
- Sidecar startup: full-screen loading with status text ("Starting server...")

## Color System

The desktop app inherits the existing color palette from [COLOR_PALETTE.md](./COLOR_PALETTE.md). All colors use CSS custom properties -- no hardcoded values.

### Core Tokens (Inherited)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--background` | `#FFFFFF` | `#0C0C0E` | App background |
| `--foreground` | `#1A1A1A` | `#ECECEA` | Primary text |
| `--card` | `#FAFAFA` | `#151517` | Panel backgrounds |
| `--muted` | `#F4F4F5` | `#1C1C1F` | Sidebar background |
| `--muted-foreground` | `#71717A` | `#808085` | Secondary text |
| `--border` | `#E4E4E7` | `#262629` | Panel dividers, resize handles |
| `--primary` | `#4A6D8A` | `#7FA8C4` | Active items, links |
| `--success` | `#5F8D6B` | `#82B888` | Diff additions, healthy status |
| `--error` | `#B06060` | `#D08080` | Diff deletions, errors |

### Desktop-Specific Tokens

Additional tokens for desktop UI elements not present in the web app:

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--panel-bg` | `var(--card)` | `var(--card)` | Panel background (alias for clarity) |
| `--panel-header-bg` | `var(--muted)` | `var(--muted)` | Tab bar, thread header background |
| `--resize-handle` | `var(--border)` | `var(--border)` | Resize handle hover color |
| `--resize-handle-active` | `var(--primary)` | `var(--primary)` | Resize handle drag color |
| `--terminal-bg` | `#1E1E1E` | `#0A0A0C` | Terminal background (always dark) |
| `--terminal-fg` | `#D4D4D4` | `#D4D4D4` | Terminal text (always light) |
| `--terminal-cursor` | `var(--primary)` | `var(--primary)` | Terminal cursor color |
| `--diff-added-bg` | `rgba(95,141,107,0.1)` | `rgba(130,184,136,0.1)` | Diff added line background |
| `--diff-removed-bg` | `rgba(176,96,96,0.1)` | `rgba(208,128,128,0.1)` | Diff removed line background |
| `--diff-added-gutter` | `rgba(95,141,107,0.3)` | `rgba(130,184,136,0.3)` | Diff added gutter |
| `--diff-removed-gutter` | `rgba(176,96,96,0.3)` | `rgba(208,128,128,0.3)` | Diff removed gutter |
| `--sidebar-active` | `var(--accent)` | `var(--accent)` | Active sidebar item background |
| `--sidebar-hover` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.04)` | Sidebar item hover |
| `--input-bg` | `var(--background)` | `#111113` | Chat input background |
| `--input-border` | `var(--border)` | `#333336` | Chat input border |
| `--input-focus-border` | `var(--primary)` | `var(--primary)` | Chat input focused border |

### Typography

The desktop app uses the system font stack for maximum native feel:

```css
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono: "SF Mono", "Fira Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace;

  --text-xs: 11px;
  --text-sm: 13px;
  --text-base: 14px;    /* Desktop: slightly smaller than web (16px) */
  --text-lg: 16px;
  --text-xl: 18px;

  --leading-tight: 1.3;
  --leading-normal: 1.5;
  --leading-relaxed: 1.7;
}
```

## Project Structure

```
src-tauri/
  frontend/                    # Desktop-specific frontend (Phase 2)
    index.html
    src/
      main.tsx                 # Entry point
      App.tsx                  # Root layout (three-panel)
      components/
        layout/
          ThreePanel.tsx       # Main layout container
          ResizeHandle.tsx     # Draggable panel divider
          PanelHeader.tsx      # Shared panel header with tab bar
        sidebar/
          ProjectSidebar.tsx   # Left panel
          ProjectList.tsx      # Project list items
          ThreadList.tsx       # Thread list items
          MachineStatus.tsx    # Connected machine indicators
        thread/
          ThreadPanel.tsx      # Center panel
          MessageBubble.tsx    # User/assistant message
          ToolCallBlock.tsx    # Tool use/result display
          InputArea.tsx        # Chat input with send button
          PlanPreview.tsx      # Inline plan graph mini-view
          ApprovalInline.tsx   # Approve/reject inline widget
        review/
          ReviewPane.tsx       # Right panel with tabs
          DiffViewer.tsx       # Unified/split diff display
          TerminalPanel.tsx    # xterm.js terminal emulator
          FileBrowser.tsx      # File tree with git status
          FileViewer.tsx       # Read-only file viewer
          PlanGraph.tsx        # React Flow plan graph
        shared/
          CommandPalette.tsx   # Cmd+K command palette (cmdk)
          StatusBar.tsx        # Bottom status bar
          KeyboardShortcuts.tsx # Global shortcut handler
      hooks/
        use-panel-layout.ts   # Panel resize/collapse state
        use-terminal.ts       # PTY session management via Tauri IPC
        use-file-tree.ts      # File listing via Tauri IPC
        use-file-watcher.ts   # File change events via Tauri events
        use-tauri-invoke.ts   # Typed wrapper for Tauri invoke()
      lib/
        tauri-commands.ts     # Type-safe Tauri command wrappers
        panel-state.ts        # Panel dimensions persistence
    vite.config.ts            # Vite config for desktop frontend
    tailwind.config.ts        # Tailwind with desktop tokens
    tsconfig.json
```

### Shared Code

The desktop frontend shares code with the web app via imports from `@astro/core` and selected `src/` modules:

| What | Import From | Shared? |
|------|-------------|---------|
| DB schema, types | `@astro/core` | Yes |
| Zustand stores | `src/stores/` | Selective -- data stores yes, UI stores no |
| Activity block grouping | `src/components/activity-blocks.tsx` | Yes |
| Color/utility functions | `src/lib/utils.ts`, `src/lib/color-icon-utils.ts` | Yes |
| UI primitives (shadcn) | `src/components/ui/` | Yes |
| Layout components | N/A | No -- desktop has its own layout |
| Routing | N/A | No -- desktop uses custom panel navigation, not React Router |

## Responsive Behavior

The desktop app does **not** need mobile responsiveness. It targets desktop screens (min 800x600 per `tauri.conf.json`).

**Window size breakpoints:**

| Window Width | Behavior |
|-------------|----------|
| < 1000px | Auto-collapse sidebar, two-panel mode (thread + review) |
| 1000-1400px | All three panels, sidebar at minimum width (200px) |
| > 1400px | All three panels at default widths |

## Accessibility

- Full keyboard navigation (tab order: sidebar -> thread -> review)
- Focus visible indicators on all interactive elements
- ARIA labels on panels (`role="complementary"` for sidebar, `role="main"` for thread, `role="region"` for review)
- Screen reader announcements for streaming messages
- Reduced motion: respect `prefers-reduced-motion` (disable spring animations, use instant transitions)
- High contrast: all text meets WCAG AA contrast ratios (the COLOR_PALETTE.md values are chosen for this)
