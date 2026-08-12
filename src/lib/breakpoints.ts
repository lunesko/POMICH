/** Responsive breakpoints: phone ≤430, mobile <760, tablet 760–1023, desktop ≥1024 */
export const BREAKPOINT_PHONE_SMALL_MAX = 389
export const BREAKPOINT_PHONE_MAX = 430
export const BREAKPOINT_MOBILE_MAX = 759
export const BREAKPOINT_TABLET_MIN = 760
export const BREAKPOINT_DESKTOP_MIN = 1024

export const mediaQueries = {
  phoneXs: `(max-width: ${BREAKPOINT_PHONE_SMALL_MAX}px)`,
  phone: `(max-width: ${BREAKPOINT_PHONE_MAX}px)`,
  mobile: `(max-width: ${BREAKPOINT_MOBILE_MAX}px)`,
  tablet: `(min-width: ${BREAKPOINT_TABLET_MIN}px) and (max-width: ${BREAKPOINT_DESKTOP_MIN - 1}px)`,
  desktop: `(min-width: ${BREAKPOINT_DESKTOP_MIN}px)`,
  tabletUp: `(min-width: ${BREAKPOINT_TABLET_MIN}px)`,
} as const
