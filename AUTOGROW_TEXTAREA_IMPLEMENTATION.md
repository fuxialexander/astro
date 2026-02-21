# Auto-Growing Textarea Implementation

## Summary
Implemented auto-growing textarea functionality for all chat input fields in Astro. The textarea now dynamically expands vertically as users type multi-line content, rather than cropping text with a scrollbar.

## Implementation Details

### Core Component: `FileCompletionTextarea`
Location: `src/components/ui/file-completion-textarea.tsx`

**Approach:**
- Uses a hidden div mirror technique to measure content height
- No external dependencies required (lightweight, pure React solution)
- Hidden div mirrors the textarea's content and styling
- Textarea height is dynamically updated based on hidden div's scrollHeight

**Key Changes:**
1. Added `hiddenDivRef` ref for the measurement div
2. Created `autoResize()` callback that:
   - Copies textarea value to hidden div (with zero-width space to preserve trailing newlines)
   - Measures hidden div's scrollHeight
   - Updates textarea height dynamically
3. Calls `autoResize()` on every input change and when value changes externally
4. Added hidden div to JSX with matching styles
5. Applied CSS constraints:
   - `max-height: 50vh` - limits growth to 50% of viewport height
   - `min-height: ${rows * 1.5}em` - preserves initial single-line height
   - `overflow-y: auto` - enables scrolling when max-height is reached

### Updated Components
Removed `resize-none` class from all chat input textareas to allow auto-growth:

1. **Plan Chat** - `src/components/agent/chat-panel.tsx:1163`
2. **Task Chat** - `src/components/task-detail/task-chat.tsx:276`
3. **Steer Chat** - `src/components/task-detail/steer-chat.tsx:284`
4. **Unified Activity View** - `src/components/task-detail/unified-activity-view.tsx:972`

## User Experience Benefits

1. **No cropping** - Users can see their full message as they type
2. **Smooth growth** - Textarea expands naturally with content
3. **Reasonable limits** - Max-height of 50vh prevents excessive growth
4. **Mobile-friendly** - Works well on small viewports
5. **Consistent behavior** - All chat inputs behave the same way

## Technical Notes

- The hidden div technique is more reliable than auto-resizing via scrollHeight directly on the textarea (avoids flicker)
- Zero-width space (`\u200b`) appended to content ensures trailing newlines are measured correctly
- The implementation is React 19 compatible and uses modern hooks patterns
- No layout shift occurs during growth (smooth expansion)
- Works with all existing features: mentions, file completion, slash commands

## Testing

A standalone test file is available at `test-autogrow.html` that demonstrates the core auto-grow logic in isolation.

To test in the app:
1. Navigate to any plan view chat panel
2. Type multi-line content (press Enter multiple times)
3. Observe the textarea growing vertically
4. Continue typing until max-height is reached (50vh)
5. Confirm scrollbar appears only after max-height

## Files Modified

- `src/components/ui/file-completion-textarea.tsx` - Core auto-grow implementation
- `src/components/agent/chat-panel.tsx` - Removed resize-none
- `src/components/task-detail/task-chat.tsx` - Removed resize-none
- `src/components/task-detail/steer-chat.tsx` - Removed resize-none
- `src/components/task-detail/unified-activity-view.tsx` - Removed resize-none
