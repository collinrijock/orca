import { describe, expect, it } from 'vitest'
import {
  ACTIVE_TAB_INDICATOR_CLASSES,
  TAB_CLOSE_BUTTON_BASE_CLASSES,
  TAB_ROOT_BASE_CLASSES,
  getDropIndicatorClasses,
  getTabCloseButtonVisibilityClasses,
  getTabRootStateClasses,
  getTabStripBorderClasses
} from './drop-indicator'

describe('getDropIndicatorClasses', () => {
  it('returns left pseudo-element classes for "left" indicator', () => {
    const classes = getDropIndicatorClasses('left')
    expect(classes).toContain('before:left-0')
    expect(classes).toContain('before:bg-primary')
    expect(classes).toContain('before:w-[2px]')
    expect(classes).toContain('before:absolute')
    expect(classes).toContain('before:inset-y-0')
    expect(classes).toContain('before:z-10')
  })

  it('returns right pseudo-element classes for "right" indicator', () => {
    const classes = getDropIndicatorClasses('right')
    expect(classes).toContain('after:right-0')
    expect(classes).toContain('after:bg-primary')
    expect(classes).toContain('after:w-[2px]')
    expect(classes).toContain('after:absolute')
    expect(classes).toContain('after:inset-y-0')
    expect(classes).toContain('after:z-10')
  })

  it('returns an empty string for null indicator', () => {
    expect(getDropIndicatorClasses(null)).toBe('')
  })

  it('uses before pseudo-element for left and after for right', () => {
    const left = getDropIndicatorClasses('left')
    const right = getDropIndicatorClasses('right')
    // Left uses before: prefix, right uses after: prefix
    expect(left).toMatch(/^before:/)
    expect(right).toMatch(/^after:/)
    expect(left).not.toContain('after:')
    expect(right).not.toContain('before:')
  })
})

describe('ACTIVE_TAB_INDICATOR_CLASSES', () => {
  it('renders a token-driven 2px bottom-edge marker without shifting layout', () => {
    expect(ACTIVE_TAB_INDICATOR_CLASSES).toContain('absolute')
    expect(ACTIVE_TAB_INDICATOR_CLASSES).toContain('bottom-0')
    expect(ACTIVE_TAB_INDICATOR_CLASSES).toContain('h-[2px]')
    expect(ACTIVE_TAB_INDICATOR_CLASSES).toContain('bg-[var(--tab-accent,var(--primary))]')
    expect(ACTIVE_TAB_INDICATOR_CLASSES).toContain('pointer-events-none')
    expect(ACTIVE_TAB_INDICATOR_CLASSES).not.toContain('-top-px')
    expect(ACTIVE_TAB_INDICATOR_CLASSES).not.toContain('bg-[#1e3d9c]')
  })
})

describe('getTabStripBorderClasses', () => {
  it('includes top and right borders by default', () => {
    expect(getTabStripBorderClasses(true)).toBe('border-t border-r border-border/60')
    expect(getTabStripBorderClasses(false)).toBe('border-t border-border/60')
  })

  it('can omit the top border for rounded floating panel titlebars', () => {
    expect(getTabStripBorderClasses(true, { includeTopBorder: false })).toBe(
      'border-r border-border/60'
    )
    expect(getTabStripBorderClasses(false, { includeTopBorder: false })).toBe('border-border/60')
  })
})

describe('getTabRootStateClasses', () => {
  it('returns the shared selected-tab surface treatment', () => {
    const classes = getTabRootStateClasses(true)
    expect(classes).toContain(
      'bg-[color-mix(in_srgb,var(--tab-accent,var(--primary))_7%,var(--card))]'
    )
    expect(classes).toContain('text-foreground')
    expect(classes).not.toContain('hover:text-foreground')
  })

  it('returns the shared inactive-tab surface treatment', () => {
    const classes = getTabRootStateClasses(false)
    expect(classes).toContain('bg-card')
    expect(classes).toContain('text-muted-foreground')
    expect(classes).toContain('hover:bg-[color-mix(in_srgb,var(--primary)_4%,var(--card))]')
    expect(classes).toContain('hover:text-foreground')
  })
})

describe('shared tab utility chrome', () => {
  it('uses compact 12px typography with tight utility tracking', () => {
    expect(TAB_ROOT_BASE_CLASSES).toContain('text-[12px]')
    expect(TAB_ROOT_BASE_CLASSES).toContain('leading-none')
    expect(TAB_ROOT_BASE_CLASSES).toContain('tracking-[-0.01em]')
  })

  it('keeps active close controls visible and inactive controls focus-revealable', () => {
    expect(getTabCloseButtonVisibilityClasses(true)).toContain('opacity-100')

    const inactive = getTabCloseButtonVisibilityClasses(false)
    expect(inactive).toContain('can-hover:opacity-0')
    expect(inactive).toContain('group-hover:opacity-100')
    expect(inactive).toContain('group-focus-within:opacity-100')
    expect(inactive).toContain('focus-visible:opacity-100')
    expect(TAB_CLOSE_BUTTON_BASE_CLASSES).toContain('focus-visible:ring-1')
    expect(TAB_CLOSE_BUTTON_BASE_CLASSES).toContain('focus-visible:ring-ring')
  })
})
