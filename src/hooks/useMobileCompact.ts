import { useEffect } from "react"

import {
  BREAKPOINT_DESKTOP_MIN,
  BREAKPOINT_PHONE_MAX,
  BREAKPOINT_PHONE_SMALL_MAX,
  LANDSCAPE_PHONE_MAX_HEIGHT,
} from "../lib/breakpoints"

const COMPACT_CLASS = "mobile-compact"
const COMPACT_XS_CLASS = "mobile-compact-xs"
const LANDSCAPE_CLASS = "mobile-landscape"

function isLandscapePhone(width: number, height: number): boolean {
  return height <= LANDSCAPE_PHONE_MAX_HEIGHT && width > height && width < BREAKPOINT_DESKTOP_MIN
}

function syncMobileCompactClasses() {
  if (typeof window === "undefined") return

  const width = window.innerWidth
  const height = window.innerHeight
  const landscapePhone = isLandscapePhone(width, height)
  const root = document.documentElement

  // Phone portrait OR short landscape (e.g. 844×390) — never treat as tablet split.
  root.classList.toggle(COMPACT_CLASS, width <= BREAKPOINT_PHONE_MAX || landscapePhone)
  root.classList.toggle(COMPACT_XS_CLASS, width <= BREAKPOINT_PHONE_SMALL_MAX)
  root.classList.toggle(LANDSCAPE_CLASS, landscapePhone)
}

export function useMobileCompact() {
  useEffect(() => {
    syncMobileCompactClasses()
    window.addEventListener("resize", syncMobileCompactClasses)
    window.addEventListener("orientationchange", syncMobileCompactClasses)
    return () => {
      window.removeEventListener("resize", syncMobileCompactClasses)
      window.removeEventListener("orientationchange", syncMobileCompactClasses)
      rootCleanup()
    }
  }, [])
}

function rootCleanup() {
  document.documentElement.classList.remove(COMPACT_CLASS, COMPACT_XS_CLASS, LANDSCAPE_CLASS)
}

/** Apply compact classes before first React paint (mobile Safari). */
export function initMobileCompactClasses() {
  syncMobileCompactClasses()
}
