type TerminalPaneSplitIconProps = {
  className?: string
}

export function TerminalPaneSplitIcon({
  className
}: TerminalPaneSplitIconProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.5" y="3" width="11" height="10" rx="1.4" />
      {/* Why: keep the divider short of the frame so the strokes don't stack at the corners. */}
      <path d="M8 4.35v7.3" />
    </svg>
  )
}
