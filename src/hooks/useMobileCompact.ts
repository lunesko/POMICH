import { useEffect } from "react"

import { BREAKPOINT_PHONE_MAX, BREAKPOINT_PHONE_SMALL_MAX } from "../lib/breakpoints"

const COMPACT_CLASS = "mobile-compact"
const COMPACT_XS_CLASS = "mobile-compact-xs"

function syncMobileCompactClasses() {
  if (typeof window === "undefined") return

  const width = window.innerWidth
  const root = document.documentElement

  root.classList.toggle(COMPACT_CLASS, width <= BREAKPOINT_PHONE_MAX)
  root.classList.toggle(COMPACT_XS_CLASS, width <= BREAKPOINT_PHONE_SMALL_MAX)
}

export function useMobileCompact() {
  useEffect(() => {
    syncMobileCompactClasses()
    window.addEventListener("resize", syncMobileCompactClasses)
    return () => {
      window.removeEventListener("resize", syncMobileCompactClasses)
      rootCleanup()
    }
  }, [])
}

function rootCleanup() {
  document.documentElement.classList.remove(COMPACT_CLASS, COMPACT_XS_CLASS)
}

/** Apply compact classes before first React paint (mobile Safari). */
export function initMobileCompactClasses() {
  syncMobileCompactClasses()
}
