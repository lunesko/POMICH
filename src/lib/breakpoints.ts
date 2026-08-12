/** Responsive breakpoints: mobile <760, tablet 760–1023, desktop ≥1024 */
export const BREAKPOINT_MOBILE_MAX = 759
export const BREAKPOINT_TABLET_MIN = 760
export const BREAKPOINT_DESKTOP_MIN = 1024

export const mediaQueries = {
  mobile: `(max-width: ${BREAKPOINT_MOBILE_MAX}px)`,
  tablet: `(min-width: ${BREAKPOINT_TABLET_MIN}px) and (max-width: ${BREAKPOINT_DESKTOP_MIN - 1}px)`,
  desktop: `(min-width: ${BREAKPOINT_DESKTOP_MIN}px)`,
  tabletUp: `(min-width: ${BREAKPOINT_TABLET_MIN}px)`,
} as const
