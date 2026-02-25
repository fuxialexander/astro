/**
 * Pure finite state machine for vim-style modal navigation.
 * No React/Ink dependencies — testable in isolation.
 */

export type VimMode = 'normal' | 'command' | 'search' | 'insert'

export interface VimState {
  mode: VimMode
  commandBuffer: string
  searchQuery: string
  pendingKeys: string  // for multi-key commands like 'gg'
}

export type VimAction =
  | { type: 'key'; key: string; ctrl?: boolean; meta?: boolean; shift?: boolean }
  | { type: 'set_mode'; mode: VimMode }
  | { type: 'clear_command' }
  | { type: 'clear_search' }
  | { type: 'submit_command' }
  | { type: 'submit_search' }

export interface VimEffect {
  type: 'navigate' | 'scroll' | 'select' | 'focus' | 'command' | 'search' | 'quit' | 'dispatch' | 'cancel' | 'refresh' | 'help' | 'none'
  direction?: 'up' | 'down' | 'left' | 'right' | 'top' | 'bottom' | 'page_up' | 'page_down'
  panel?: number
  value?: string
}

export function initialVimState(): VimState {
  return {
    mode: 'normal',
    commandBuffer: '',
    searchQuery: '',
    pendingKeys: '',
  }
}

export function vimReducer(state: VimState, action: VimAction): [VimState, VimEffect] {
  switch (action.type) {
    case 'set_mode':
      return [{ ...state, mode: action.mode, pendingKeys: '' }, { type: 'none' }]

    case 'clear_command':
      return [{ ...state, commandBuffer: '', mode: 'normal', pendingKeys: '' }, { type: 'none' }]

    case 'clear_search':
      return [{ ...state, searchQuery: '', mode: 'normal', pendingKeys: '' }, { type: 'none' }]

    case 'submit_command':
      return [
        { ...state, mode: 'normal', pendingKeys: '' },
        { type: 'command', value: state.commandBuffer },
      ]

    case 'submit_search':
      return [
        { ...state, mode: 'normal', pendingKeys: '' },
        { type: 'search', value: state.searchQuery },
      ]

    case 'key':
      return handleKey(state, action.key, action.ctrl)
  }
}

function handleKey(
  state: VimState,
  key: string,
  ctrl?: boolean,
): [VimState, VimEffect] {
  // Escape always returns to normal mode
  if (key === 'escape') {
    return [{ ...state, mode: 'normal', pendingKeys: '', commandBuffer: '', searchQuery: '' }, { type: 'none' }]
  }

  switch (state.mode) {
    case 'normal':
      return handleNormalMode(state, key, ctrl)
    case 'command':
      return handleCommandMode(state, key)
    case 'search':
      return handleSearchMode(state, key)
    case 'insert':
      return handleInsertMode(state, key)
  }
}

function handleNormalMode(
  state: VimState,
  key: string,
  ctrl?: boolean,
): [VimState, VimEffect] {
  // Ctrl combos
  if (ctrl) {
    if (key === 'u') return [state, { type: 'scroll', direction: 'page_up' }]
    if (key === 'd') return [state, { type: 'scroll', direction: 'page_down' }]
    if (key === 'c') return [state, { type: 'quit' }]
    return [state, { type: 'none' }]
  }

  // Multi-key: gg
  if (state.pendingKeys === 'g') {
    if (key === 'g') {
      return [{ ...state, pendingKeys: '' }, { type: 'scroll', direction: 'top' }]
    }
    // Invalid sequence, reset
    return [{ ...state, pendingKeys: '' }, { type: 'none' }]
  }

  // Single keys
  switch (key) {
    // Navigation
    case 'j': case 'return':
      if (key === 'j') return [state, { type: 'scroll', direction: 'down' }]
      return [state, { type: 'select' }]
    case 'k':
      return [state, { type: 'scroll', direction: 'up' }]
    case 'h':
      return [state, { type: 'focus', direction: 'left' }]
    case 'l':
      return [state, { type: 'focus', direction: 'right' }]

    // Panel jump
    case '1': return [state, { type: 'focus', panel: 0 }]
    case '2': return [state, { type: 'focus', panel: 1 }]
    case '3': return [state, { type: 'focus', panel: 2 }]
    case '4': return [state, { type: 'focus', panel: 3 }]
    case 'tab':
      return [state, { type: 'focus', direction: 'right' }]

    // Top/bottom
    case 'g':
      return [{ ...state, pendingKeys: 'g' }, { type: 'none' }]
    case 'G':
      return [state, { type: 'scroll', direction: 'bottom' }]

    // Mode switches
    case ':':
      return [{ ...state, mode: 'command', commandBuffer: '' }, { type: 'none' }]
    case '/':
      return [{ ...state, mode: 'search', searchQuery: '' }, { type: 'none' }]
    case 'i':
      return [{ ...state, mode: 'insert' }, { type: 'none' }]

    // Actions
    case 'd':
      return [state, { type: 'dispatch' }]
    case 'c':
      return [state, { type: 'cancel' }]
    case 'r':
      return [state, { type: 'refresh' }]
    case 'q':
      return [state, { type: 'quit' }]
    case '?':
      return [state, { type: 'help' }]

    default:
      return [state, { type: 'none' }]
  }
}

function handleCommandMode(state: VimState, key: string): [VimState, VimEffect] {
  if (key === 'return') {
    return [
      { ...state, mode: 'normal' },
      { type: 'command', value: state.commandBuffer },
    ]
  }
  if (key === 'backspace' || key === 'delete') {
    const newBuffer = state.commandBuffer.slice(0, -1)
    if (newBuffer.length === 0) {
      return [{ ...state, mode: 'normal', commandBuffer: '' }, { type: 'none' }]
    }
    return [{ ...state, commandBuffer: newBuffer }, { type: 'none' }]
  }
  if (key === 'tab') {
    // Tab for autocomplete — handled by the command parser hook
    return [state, { type: 'command', value: `__autocomplete__${state.commandBuffer}` }]
  }
  // Regular character
  if (key.length === 1) {
    return [{ ...state, commandBuffer: state.commandBuffer + key }, { type: 'none' }]
  }
  return [state, { type: 'none' }]
}

function handleSearchMode(state: VimState, key: string): [VimState, VimEffect] {
  if (key === 'return') {
    return [
      { ...state, mode: 'normal' },
      { type: 'search', value: state.searchQuery },
    ]
  }
  if (key === 'backspace' || key === 'delete') {
    const newQuery = state.searchQuery.slice(0, -1)
    if (newQuery.length === 0) {
      return [{ ...state, mode: 'normal', searchQuery: '' }, { type: 'none' }]
    }
    return [{ ...state, searchQuery: newQuery }, { type: 'search', value: newQuery }]
  }
  if (key.length === 1) {
    const newQuery = state.searchQuery + key
    return [{ ...state, searchQuery: newQuery }, { type: 'search', value: newQuery }]
  }
  return [state, { type: 'none' }]
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handleInsertMode(state: VimState, _: string): [VimState, VimEffect] {
  // Insert mode passes all keys through — handled by the component
  return [state, { type: 'none' }]
}
