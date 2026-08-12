/**
 * Hidden admin entry points (not shown in public UI):
 * 1. URL hash: /#admin
 * 2. Long-press POMICH logo on landing page (~3s)
 * 3. Direct URL: /?role=admin (login gate required)
 * 4. Bootstrap token: /?role=admin&adminToken=... (legacy ops access)
 */
export const ADMIN_HASH = "#admin"
export const ADMIN_LOGO_HOLD_MS = 3000

export function isHiddenAdminHash(): boolean {
  if (typeof window === "undefined") return false
  return window.location.hash === ADMIN_HASH
}

export function clearHiddenAdminHash() {
  if (typeof window === "undefined") return
  if (window.location.hash !== ADMIN_HASH) return
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`)
}

/** Persist hidden admin entry as ?role=admin and drop the hash from the address bar. */
export function applyHiddenAdminEntry() {
  if (typeof window === "undefined") return
  const url = new URL(window.location.href)
  url.searchParams.set("role", "admin")
  url.hash = ""
  window.history.replaceState({}, "", `${url.pathname}${url.search}`)
}

export function isAdminEntryLocation(search = typeof window !== "undefined" ? window.location.search : "", hash = typeof window !== "undefined" ? window.location.hash : ""): boolean {
  if (new URLSearchParams(search).get("role") === "admin") return true
  return hash === ADMIN_HASH
}
