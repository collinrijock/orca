import React from 'react'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { useDocumentVisible } from '@/hooks/useDocumentVisible'
import { sharedStepPhaseDelayMs } from './working-ring-phase'

// Why: virtualized worktree rows stay mounted as overscan for smooth
// scrolling, but overscan rows are outside the real viewport and cannot be
// seen. The list provides `true` here for overscan-only rows so their rings
// pause; everything outside a provider (terminal tabs, dashboard rows) is
// treated as visible.
export const WorkingRingOffscreenContext = React.createContext(false)

/**
 * Decide whether a working ring should animate and, if so, its shared phase
 * anchor. A ring animates only when it can actually be seen: not reduced-motion
 * (an explicit accessibility opt-out), not while the document is hidden, and
 * not while parked as virtualizer overscan. `paused` lets a caller force the
 * static state directly.
 */
export function useWorkingRingAnimation(paused?: boolean): {
  animate: boolean
  style: React.CSSProperties | undefined
} {
  const reducedMotion = usePrefersReducedMotion()
  const documentVisible = useDocumentVisible()
  const offscreen = React.useContext(WorkingRingOffscreenContext)
  const animate = !reducedMotion && documentVisible && !offscreen && !paused

  // Recompute the phase anchor only when (re)entering the animating state so
  // rings that resume together — e.g. on visibility restore — re-lock to the
  // shared timeline origin. A stable animating ring keeps its cached delay and
  // never re-anchors, so unrelated re-renders cannot cause a visible jump.
  const style = React.useMemo<React.CSSProperties | undefined>(
    () => (animate ? { animationDelay: `${sharedStepPhaseDelayMs()}ms` } : undefined),
    [animate]
  )

  return { animate, style }
}

type WorkingRingProps = {
  /** Sizing/box classes for the ring element itself (e.g. `size-2`). */
  className?: string
  /** Force the static (non-animating) ring regardless of visibility. */
  paused?: boolean
}

/**
 * The shared stepped "working" ring used by the aggregate StatusIndicator,
 * AgentStateDot, and terminal tabs. Renders the inner ring element only;
 * callers own the surrounding box and accessible label.
 */
export const WorkingRing = React.memo(function WorkingRing({
  className,
  paused
}: WorkingRingProps): React.JSX.Element {
  const { animate, style } = useWorkingRingAnimation(paused)
  return (
    <span
      className={cn(
        'block rounded-full border-2 border-yellow-500 border-t-transparent',
        // Why: the stepped cadence + shared phase anchor live in
        // `.working-ring-spin` (main.css). Omitting it leaves a static ring,
        // which is the correct paused/reduced-motion presentation.
        animate && 'working-ring-spin',
        className
      )}
      style={style}
    />
  )
})
