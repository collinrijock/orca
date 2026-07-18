import type { CSSProperties } from 'react'

export type DropIndicator = 'left' | 'right' | null

// Why: pseudo-elements keep the insertion cue out of layout while the semantic
// primary token gives drag/drop the same identity as active tabs in both themes.
export function getDropIndicatorClasses(dropIndicator: DropIndicator): string {
  if (dropIndicator === 'left') {
    return "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-primary before:z-10 before:content-['']"
  }
  if (dropIndicator === 'right') {
    return "after:absolute after:inset-y-0 after:right-0 after:w-[2px] after:bg-primary after:z-10 after:content-['']"
  }
  return ''
}

// Why: a 2px bar on the active tab's bottom edge bridges the tab into the panel
// it owns. `--tab-accent` is set only for a custom-colored terminal profile;
// every other tab falls back to the semantic primary token. z-10 keeps it above
// the surface lift and unread wash. Horizontal inset is 0 (not -1px): negative
// insets on the
// last tab bleed into the strip's scrollWidth, so clicking between active tabs
// flips the strip between "fits exactly" and "overflows by 1px", which jitters
// every tab by 1px because the browser preserves scrollLeft near the end.
export const ACTIVE_TAB_INDICATOR_CLASSES =
  'pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[2px] bg-[var(--tab-accent,var(--primary))]'

export const TAB_ROOT_BASE_CLASSES =
  'group relative flex h-full items-center px-2 text-[12px] font-normal leading-none tracking-[-0.01em] cursor-pointer select-none outline-none focus:outline-none focus-visible:outline-none transition-[background-color,color] duration-100'

export const TAB_CLOSE_BUTTON_BASE_CLASSES =
  'relative z-10 flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-[opacity,color,background-color,box-shadow] duration-100 hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card'

export function getTabCloseButtonVisibilityClasses(isActive: boolean): string {
  return isActive
    ? 'opacity-100'
    : 'opacity-100 can-hover:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
}

export function getTabAccentStyle(color: string | null | undefined): CSSProperties | undefined {
  return color ? ({ '--tab-accent': color } as CSSProperties) : undefined
}

export function getTabRootStateClasses(isActive: boolean): string {
  return isActive
    ? 'bg-[color-mix(in_srgb,var(--tab-accent,var(--primary))_7%,var(--card))] text-foreground'
    : 'bg-card text-muted-foreground hover:bg-[color-mix(in_srgb,var(--primary)_4%,var(--card))] hover:text-foreground'
}

export function getTabStripBorderClasses(
  hasTabsToRight: boolean,
  options?: { includeTopBorder?: boolean }
): string {
  const includeTopBorder = options?.includeTopBorder ?? true
  return [includeTopBorder ? 'border-t' : '', hasTabsToRight ? 'border-r' : '', 'border-border/60']
    .filter(Boolean)
    .join(' ')
}
