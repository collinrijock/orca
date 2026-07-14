import { hostScreenChromeStyles } from './host-screen-chrome-styles'
import { hostScreenListStyles } from './host-screen-list-styles'

// Extracted from the host-screen route so the screen component stays within the
// mobile max-lines budget. Composed from two domain sheets (each also budgeted);
// key sets are disjoint, so the merge is unambiguous.
export const hostScreenStyles = {
  ...hostScreenChromeStyles,
  ...hostScreenListStyles
}
