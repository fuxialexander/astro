# Color Palette — Design System

Astro uses a **low-saturation** color palette: gray-mixed tones that convey quiet sophistication. Every color is a CSS custom property — components use semantic Tailwind classes (`text-info`, `bg-success`, etc.) and never reference raw hex values.

## Design Principles

1. **Gray-mixed saturation** — All hues are blended with gray, keeping the palette harmonious. No pure or vivid colors.
2. **Cool temperature** — Neutral grays lean cool (no yellow tint), giving a modern, tech-forward feel.
3. **High contrast** — Near-black foreground (#1A1A1A light / #ECECEA dark) on white/deep backgrounds for readability.
4. **Semantic mapping** — Colors carry meaning (info, success, warning, error) rather than visual decoration.
5. **Single source of truth** — All values defined in `src/globals.css` `:root` and `.dark` blocks. Dark mode is handled entirely by CSS variables — no `dark:` prefix overrides in component code.

## Light Mode (`:root`)

| Token | Hex | Role |
|-------|-----|------|
| `--background` | `#FFFFFF` | Page background |
| `--foreground` | `#1A1A1A` | Primary text |
| `--card` | `#FAFAFA` | Card/surface background |
| `--muted` | `#F4F4F5` | Subtle background fill |
| `--muted-foreground` | `#71717A` | Secondary text, labels |
| `--border` | `#E4E4E7` | Borders, dividers |
| `--primary` | `#4A6D8A` | Brand accent — steel blue |
| `--secondary` | `#71717A` | Neutral secondary actions |
| `--accent` | `#F0F0F2` | Hover/focus backgrounds |
| `--destructive` | `#B06060` | Destructive actions, same as `--error` |

### Semantic Colors (Light)

| Token | Hex | Swatch | Usage |
|-------|-----|--------|-------|
| `--success` | `#5F8D6B` | Sage green | Completed, passing, healthy |
| `--warning` | `#A07D4F` | Bronze gold | Attention, pending, caution |
| `--error` | `#B06060` | Dusty rose | Failed, error, destructive |
| `--info` | `#5B7F9A` | Teal sky | Informational, links, status |
| `--primary` | `#4A6D8A` | Steel blue | Brand, active selection |

## Dark Mode (`.dark`)

| Token | Hex | Role |
|-------|-----|------|
| `--background` | `#0C0C0E` | Deep near-black background |
| `--foreground` | `#ECECEA` | Primary text |
| `--card` | `#151517` | Elevated surface |
| `--muted` | `#1C1C1F` | Subtle background fill |
| `--muted-foreground` | `#808085` | Secondary text (tuned for readability) |
| `--border` | `#262629` | Borders, dividers |
| `--primary` | `#7FA8C4` | Lightened steel blue |
| `--secondary` | `#7A7A7E` | Neutral secondary |
| `--accent` | `rgba(127,168,196,0.08)` | Translucent blue tint |
| `--destructive` | `#D08080` | Lightened rose |

### Semantic Colors (Dark)

| Token | Hex | Swatch | Usage |
|-------|-----|--------|-------|
| `--success` | `#82B888` | Light sage | Completed, passing, healthy |
| `--warning` | `#CDB47A` | Light gold | Attention, pending, caution |
| `--error` | `#D08080` | Light rose | Failed, error, destructive |
| `--info` | `#8AAEC4` | Light sky | Informational, links, status |
| `--primary` | `#7FA8C4` | Light steel | Brand, active selection |

## Project & Label Colors

Used for project icons, labels, and category badges. Defined in `src/lib/color-icon-utils.ts`:

| Hex | Name |
|-----|------|
| `#4A6D8A` | Steel blue |
| `#5F8D6B` | Sage green |
| `#A07D4F` | Bronze gold |
| `#7B6B9A` | Dusty lavender |
| `#9A6878` | Dusty rose |
| `#A8785E` | Terracotta |
| `#5B7F9A` | Teal sky |
| `#8A7A6E` | Cool taupe |
| `#71717A` | Neutral gray |

## Tailwind Usage

Tailwind v4 maps CSS variables to utility classes via the `@theme` block in `globals.css`:

```css
@theme {
  --color-primary: var(--primary);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-error: var(--error);
  --color-info: var(--info);
  /* ... */
}
```

This enables standard Tailwind classes:

```tsx
// Text
<span className="text-info">Informational</span>
<span className="text-success">Passed</span>
<span className="text-warning">Pending</span>
<span className="text-error">Failed</span>

// Backgrounds
<div className="bg-success/10">Light green tint</div>
<Badge className="bg-warning text-warning-foreground">Caution</Badge>

// Borders
<div className="border-error">Error outline</div>
```

### Migration from Hardcoded Colors

All hardcoded Tailwind color classes have been replaced:

| Before | After |
|--------|-------|
| `text-blue-500`, `text-blue-400` | `text-info` |
| `text-green-500`, `text-green-400` | `text-success` |
| `text-red-500`, `text-red-400` | `text-error` |
| `text-amber-500`, `text-yellow-500`, `text-orange-500` | `text-warning` |
| `text-purple-500`, `text-purple-400` | `text-primary` |
| `dark:text-blue-300`, `dark:text-green-300`, etc. | *(removed — CSS variables handle dark mode)* |

## Typography

| Variable | Value |
|----------|-------|
| `--font-primary` | `"DM Sans", "Noto Sans SC", sans-serif` |
| `--font-secondary` | `"Cormorant Garamond", "Noto Serif SC", serif` |

## Files

| File | Role |
|------|------|
| `src/globals.css` | CSS variable definitions (`:root`, `.dark`) and `@theme` block |
| `src/components/theme-provider.tsx` | Two-mode toggle (light/dark), legacy "bright" → "light" migration |
| `src/lib/color-icon-utils.ts` | `COLOR_PALETTE` array for projects/labels |
| `src/lib/constants.ts` | `DEFAULT_LABELS` with assigned palette colors |
| `src/lib/status-config.ts` | Task status → semantic color mapping |
