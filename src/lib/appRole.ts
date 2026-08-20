/** Persist last active app role so clean URLs (pomich.help) survive refresh mid-session. */

const ACTIVE_APP_ROLE_KEY = "pomichActiveAppRole"
const PENDING_PARTNER_REVIEW_KEY = "pomichPendingPartnerReview"

export type ActiveAppRole = "customer" | "provider"

export function persistActiveAppRole(role: ActiveAppRole) {
  if (typeof window === "undefined") return
  window.sessionStorage.setItem(ACTIVE_APP_ROLE_KEY, role)
  window.localStorage.setItem(ACTIVE_APP_ROLE_KEY, role)
}

export function readActiveAppRole(): ActiveAppRole | null {
  if (typeof window === "undefined") return null
  const raw =
    window.sessionStorage.getItem(ACTIVE_APP_ROLE_KEY) ||
    window.localStorage.getItem(ACTIVE_APP_ROLE_KEY)
  if (raw === "customer" || raw === "provider") return raw
  return null
}

export function clearActiveAppRole() {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(ACTIVE_APP_ROLE_KEY)
  window.localStorage.removeItem(ACTIVE_APP_ROLE_KEY)
}

export function persistPendingPartnerReview(orderId: string) {
  if (typeof window === "undefined" || !orderId) return
  const raw = JSON.stringify({ orderId, updatedAt: Date.now() })
  window.sessionStorage.setItem(PENDING_PARTNER_REVIEW_KEY, raw)
  window.localStorage.setItem(PENDING_PARTNER_REVIEW_KEY, raw)
}

export function readPendingPartnerReview(): { orderId: string; updatedAt: number } | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw =
      window.localStorage.getItem(PENDING_PARTNER_REVIEW_KEY) ||
      window.sessionStorage.getItem(PENDING_PARTNER_REVIEW_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { orderId?: string; updatedAt?: number }
    const orderId = String(parsed?.orderId || "").trim()
    if (!orderId) return undefined
    const updatedAt = Number(parsed?.updatedAt) || Date.now()
    // Drop stale review prompts after 7 days.
    if (Date.now() - updatedAt > 7 * 24 * 60 * 60 * 1000) {
      clearPendingPartnerReview()
      return undefined
    }
    return { orderId, updatedAt }
  } catch {
    clearPendingPartnerReview()
    return undefined
  }
}

export function clearPendingPartnerReview() {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(PENDING_PARTNER_REVIEW_KEY)
  window.localStorage.removeItem(PENDING_PARTNER_REVIEW_KEY)
}
