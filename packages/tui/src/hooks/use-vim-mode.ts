/**
 * Hook that connects Ink's useInput to the vim state machine.
 * Dispatches effects to TUI store actions.
 */
import { useCallback, useRef } from 'react'
import { useInput, useApp } from 'ink'
import { initialVimState, vimReducer, type VimState, type VimEffect } from '../lib/vim-state-machine.js'
import { useTuiStore } from '../stores/tui-store.js'

export interface VimModeCallbacks {
  onCommand?: (command: string) => void
  onSearch?: (query: string) => void
  onSelect?: () => void
  onDispatch?: () => void
  onCancel?: () => void
  onRefresh?: () => void
}

export function useVimMode(callbacks: VimModeCallbacks = {}) {
  const { exit } = useApp()
  const vimState = useRef<VimState>(initialVimState())

  const store = useTuiStore()

  const handleEffect = useCallback(
    (effect: VimEffect) => {
      switch (effect.type) {
        case 'scroll':
          switch (effect.direction) {
            case 'up': store.scrollUp(); break
            case 'down': store.scrollDown(); break
            case 'top': store.scrollToTop(); break
            case 'bottom': store.scrollToBottom(); break
            case 'page_up': store.pageUp(); break
            case 'page_down': store.pageDown(); break
          }
          break

        case 'focus':
          if (effect.panel != null) {
            store.focusByIndex(effect.panel)
          } else if (effect.direction === 'left') {
            store.focusPrev()
          } else if (effect.direction === 'right') {
            store.focusNext()
          }
          break

        case 'select':
          callbacks.onSelect?.()
          break

        case 'command':
          if (effect.value?.startsWith('__autocomplete__')) {
            // Autocomplete handled by command-line component
          } else if (effect.value) {
            callbacks.onCommand?.(effect.value)
          }
          break

        case 'search':
          if (effect.value) {
            callbacks.onSearch?.(effect.value)
          }
          break

        case 'dispatch':
          callbacks.onDispatch?.()
          break

        case 'cancel':
          callbacks.onCancel?.()
          break

        case 'refresh':
          callbacks.onRefresh?.()
          break

        case 'quit':
          exit()
          break

        case 'help':
          store.toggleHelp()
          break

        case 'none':
          break
      }
    },
    [store, callbacks, exit],
  )

  useInput((input, key) => {
    // Don't handle input when overlays are open (except Escape)
    if (store.showHelp || store.showSearch || store.showDetail) {
      if (key.escape) {
        store.closeOverlays()
        vimState.current = initialVimState()
        store.setMode('normal')
        store.setCommandBuffer('')
        store.setSearchQuery('')
        store.setPendingKeys('')
      }
      return
    }

    // Map Ink key to vim key string
    let keyStr = input
    if (key.escape) keyStr = 'escape'
    else if (key.return) keyStr = 'return'
    else if (key.backspace || key.delete) keyStr = 'backspace'
    else if (key.tab) keyStr = 'tab'
    else if (key.upArrow) keyStr = 'k'  // Map arrows to vim keys in normal mode
    else if (key.downArrow) keyStr = 'j'
    else if (key.leftArrow) keyStr = 'h'
    else if (key.rightArrow) keyStr = 'l'

    const [nextState, effect] = vimReducer(vimState.current, {
      type: 'key',
      key: keyStr,
      ctrl: key.ctrl,
      shift: key.shift,
    })

    vimState.current = nextState

    // Sync to store
    store.setMode(nextState.mode)
    store.setCommandBuffer(nextState.commandBuffer)
    store.setSearchQuery(nextState.searchQuery)
    store.setPendingKeys(nextState.pendingKeys)

    handleEffect(effect)
  })
}
