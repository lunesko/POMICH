import type { AuthSession } from "../api/client"

export function getStoredQueryToken(queryName: string, storageName: string) {
  if (typeof window === "undefined") return undefined
  const url = new URL(window.location.href)
  const queryToken = url.searchParams.get(queryName)
  const token = queryToken ?? window.sessionStorage.getItem(storageName)
  if (token) window.sessionStorage.setItem(storageName, token)
  if (queryToken) {
    url.searchParams.delete(queryName)
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
  }
  return token ?? undefined
}

export const AUTH_SESSION_PREFIX = "pomich_auth_v1."

export function isAuthSessionToken(token?: string) {
  return Boolean(token?.startsWith(AUTH_SESSION_PREFIX))
}

/** Decode `sub` from a pomich_auth_v1 token body (no signature check — client-side routing only). */
export function readAuthSessionSubject(token?: string): string | undefined {
  if (!isAuthSessionToken(token) || !token) return undefined
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4)
    const normalized = padded.replace(/-/g, "+").replace(/_/g, "/")
    const payload = JSON.parse(atob(normalized)) as { sub?: unknown; role?: unknown }
    const subject = String(payload.sub || "").trim()
    return subject || undefined
  } catch {
    return undefined
  }
}

type AuthRole = "admin" | "provider" | "customer"

export function authSessionStorageKey(role: AuthRole, subjectId: string) {
  return `pomichAuthSession:${role}:${subjectId}`
}

export function readStoredRoleAuthSessionPayload(storageKey: string, expectedRole: AuthRole): AuthSession | string | undefined {
  if (typeof window === "undefined") return undefined
  const rawValue = window.sessionStorage.getItem(storageKey)
  if (!rawValue) return undefined

  try {
    const session = JSON.parse(rawValue) as Partial<AuthSession>
    const expiresAt = Number(session.expiresAt ?? 0)
    if (session.role !== expectedRole || !isAuthSessionToken(session.accessToken) || expiresAt <= Math.floor(Date.now() / 1000) + 30) {
      window.sessionStorage.removeItem(storageKey)
      return undefined
    }
    return session as AuthSession
  } catch {
    if (isAuthSessionToken(rawValue)) return rawValue
    window.sessionStorage.removeItem(storageKey)
    return undefined
  }
}

export function readStoredAuthSessionPayload(storageKey: string, expectedRole: AuthRole, expectedSubjectId: string): AuthSession | string | undefined {
  const session = readStoredRoleAuthSessionPayload(storageKey, expectedRole)
  if (typeof session !== "object") return session
  if (session.subjectId !== expectedSubjectId) {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(storageKey)
    return undefined
  }
  return session
}

export function readStoredRoleAuthSession(storageKey: string, expectedRole: AuthRole) {
  const session = readStoredRoleAuthSessionPayload(storageKey, expectedRole)
  return typeof session === "string" ? session : session?.accessToken
}

export function readStoredAuthSession(storageKey: string, expectedRole: AuthRole, expectedSubjectId: string) {
  const session = readStoredAuthSessionPayload(storageKey, expectedRole, expectedSubjectId)
  return typeof session === "string" ? session : session?.accessToken
}

export const CUSTOMER_ID_STORAGE_KEY = "pomichCustomerId"
export const EXPLICIT_LOGOUT_STORAGE_KEY = "pomichExplicitLogout"
/** One-shot notice after an actual guest↔Telegram conflict was detected/purged. */
export const SESSION_MISMATCH_NOTICE_KEY = "pomichSessionMismatchNotice"
/** Persists dismiss («Зрозуміло») for the current customer id on this device. */
export const SESSION_MISMATCH_DISMISS_KEY = "pomichSessionMismatchDismissed"

export const TELEGRAM_STALE_WEB_MISMATCH_MESSAGE =
  "Знайдено застарілу web-сесію іншого користувача. Профіль оновлено через Telegram."

/** Set after user clicks «Вийти» — blocks Telegram initData auto-login until next explicit sign-in. */
export function markExplicitLogout(telegramChatId?: string) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(EXPLICIT_LOGOUT_STORAGE_KEY, telegramChatId ? `tg-${telegramChatId}` : "web")
}

export function clearExplicitLogout() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(EXPLICIT_LOGOUT_STORAGE_KEY)
}

export function isExplicitLogout(telegramChatId?: string): boolean {
  if (typeof window === "undefined") return false
  const flag = window.localStorage.getItem(EXPLICIT_LOGOUT_STORAGE_KEY)
  if (!flag) return false
  if (telegramChatId) return flag === `tg-${telegramChatId}`
  return flag === "web"
}

/** Only reuse a persisted guest-* id; never the shared customer-web singleton. */
export function guestSessionCustomerIdForRestore(customerId: string): string | undefined {
  return customerId.startsWith("guest-") ? customerId : undefined
}

export function readPersistedCustomerId(telegramChatId?: string): string {
  if (telegramChatId) return `tg-${telegramChatId}`
  if (typeof window === "undefined") return "customer-web"
  return (
    window.localStorage.getItem(CUSTOMER_ID_STORAGE_KEY) ||
    window.sessionStorage.getItem(CUSTOMER_ID_STORAGE_KEY) ||
    "customer-web"
  )
}

export function persistCustomerId(customerId: string) {
  if (typeof window === "undefined" || !customerId) return
  window.sessionStorage.setItem(CUSTOMER_ID_STORAGE_KEY, customerId)
  window.localStorage.setItem(CUSTOMER_ID_STORAGE_KEY, customerId)
}

export function readStoredCustomerAuthSession(options?: { telegramChatId?: string }): { customerId: string; token: string } | undefined {
  if (typeof window === "undefined") return undefined

  const tryCustomerId = (customerId: string) => {
    const token = readStoredAuthSession(authSessionStorageKey("customer", customerId), "customer", customerId)
    return token ? { customerId, token } : undefined
  }

  // In Telegram WebApp always bind to tg-{id}; never reuse a stale web guest token.
  if (options?.telegramChatId) {
    return tryCustomerId(`tg-${options.telegramChatId}`)
  }

  return tryCustomerId(readPersistedCustomerId())
}

/** Drop auth tokens and persisted ids that belong to another customer (e.g. stale web guest). */
export function purgeStaleCustomerSessions(activeCustomerId: string) {
  if (typeof window === "undefined" || !activeCustomerId) return

  const persistedLocal = window.localStorage.getItem(CUSTOMER_ID_STORAGE_KEY)
  const persistedSession = window.sessionStorage.getItem(CUSTOMER_ID_STORAGE_KEY)
  if (persistedLocal && persistedLocal !== activeCustomerId) {
    window.localStorage.removeItem(CUSTOMER_ID_STORAGE_KEY)
  }
  if (persistedSession && persistedSession !== activeCustomerId) {
    window.sessionStorage.removeItem(CUSTOMER_ID_STORAGE_KEY)
  }

  const keysToRemove: string[] = []
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index)
    if (!key?.startsWith("pomichAuthSession:customer:")) continue
    const customerId = key.slice("pomichAuthSession:customer:".length)
    if (customerId !== activeCustomerId) keysToRemove.push(key)
  }
  keysToRemove.forEach((key) => window.sessionStorage.removeItem(key))
}

/** True when browser persisted id differs from the Telegram user (stale desktop guest session). */
export function detectStoredCustomerMismatch(telegramChatId?: string): boolean {
  if (!telegramChatId || typeof window === "undefined") return false
  const expected = `tg-${telegramChatId}`
  const persistedLocal = window.localStorage.getItem(CUSTOMER_ID_STORAGE_KEY)
  const persistedSession = window.sessionStorage.getItem(CUSTOMER_ID_STORAGE_KEY)
  return Boolean((persistedLocal && persistedLocal !== expected) || (persistedSession && persistedSession !== expected))
}

export function markSessionMismatchNotice(kind: "telegram-stale-web" = "telegram-stale-web") {
  if (typeof window === "undefined") return
  window.sessionStorage.setItem(SESSION_MISMATCH_NOTICE_KEY, kind)
}

export function clearSessionMismatchNotice() {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(SESSION_MISMATCH_NOTICE_KEY)
}

export function dismissSessionMismatchNotice(customerId: string) {
  if (typeof window === "undefined" || !customerId) return
  clearSessionMismatchNotice()
  window.localStorage.setItem(SESSION_MISMATCH_DISMISS_KEY, customerId)
}

export function clearSessionMismatchDismiss() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(SESSION_MISMATCH_DISMISS_KEY)
}

export function isSessionMismatchDismissed(customerId: string): boolean {
  if (typeof window === "undefined" || !customerId) return false
  return window.localStorage.getItem(SESSION_MISMATCH_DISMISS_KEY) === customerId
}

/**
 * Banner text only for a real guest↔Telegram conflict (or a one-shot notice after purge).
 * Never show the old forever web “previous profile” warning after a normal login.
 */
export function resolveSessionMismatchWarning(customerId: string, telegramChatId?: string): string | undefined {
  if (!customerId || typeof window === "undefined") return undefined
  if (isSessionMismatchDismissed(customerId)) return undefined

  if (detectStoredCustomerMismatch(telegramChatId)) {
    return TELEGRAM_STALE_WEB_MISMATCH_MESSAGE
  }

  if (window.sessionStorage.getItem(SESSION_MISMATCH_NOTICE_KEY) === "telegram-stale-web") {
    return TELEGRAM_STALE_WEB_MISMATCH_MESSAGE
  }

  return undefined
}

/** Clear all customer auth state (e.g. when switching role or logging out). */
export function clearCustomerAuthStorage() {
  if (typeof window === "undefined") return

  window.localStorage.removeItem(CUSTOMER_ID_STORAGE_KEY)
  window.sessionStorage.removeItem(CUSTOMER_ID_STORAGE_KEY)
  window.sessionStorage.removeItem("pomichBootstrapProfile")
  window.localStorage.removeItem("pomichClientName")
  window.localStorage.removeItem("pomichClientVerification")

  const keysToRemove: string[] = []
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index)
    if (key?.startsWith("pomichAuthSession:customer:")) keysToRemove.push(key)
  }
  keysToRemove.forEach((key) => window.sessionStorage.removeItem(key))
}

/**
 * Drop provider (and optional admin) session tokens without touching the customer identity.
 * Used when switching role so the same account can reopen a linked partner profile.
 */
export function clearProviderAuthStorage(options?: { includeAdmin?: boolean }) {
  if (typeof window === "undefined") return

  window.sessionStorage.removeItem("pomichProviderToken")
  if (options?.includeAdmin) {
    window.sessionStorage.removeItem("pomichAdminToken")
  }

  const keysToRemove: string[] = []
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index)
    if (!key?.startsWith("pomichAuthSession:")) continue
    if (key.startsWith("pomichAuthSession:provider:")) {
      keysToRemove.push(key)
      continue
    }
    if (options?.includeAdmin && key.startsWith("pomichAuthSession:admin:")) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach((key) => window.sessionStorage.removeItem(key))
}

/** Clear every auth token and persisted session (logout only — not role switch). */
export function clearAllAuthStorage() {
  if (typeof window === "undefined") return

  clearCustomerAuthStorage()
  clearSessionMismatchNotice()
  clearSessionMismatchDismiss()
  window.sessionStorage.removeItem("pomichProviderToken")
  window.sessionStorage.removeItem("pomichAdminToken")
  window.sessionStorage.removeItem("pomichLinkedProviderId")
  // Leave active ride so logout from completion/review never restores the order UI.
  window.sessionStorage.removeItem("pomichActiveOrder")
  window.localStorage.removeItem("pomichActiveOrder")

  const keysToRemove: string[] = []
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index)
    if (key?.startsWith("pomichAuthSession:")) keysToRemove.push(key)
  }
  keysToRemove.forEach((key) => window.sessionStorage.removeItem(key))

  const localKeysToRemove: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith("pomichPartnerRegistered:")) localKeysToRemove.push(key)
  }
  localKeysToRemove.forEach((key) => window.localStorage.removeItem(key))
}

export function storeAuthSession(storageKey: string, session: AuthSession) {
  if (typeof window === "undefined") return
  window.sessionStorage.setItem(storageKey, JSON.stringify(session))
  if (session.role === "customer") {
    const customerId = session.customerId ?? session.subjectId
    if (customerId) persistCustomerId(customerId)
  }
}

export function parseApiDateMs(value?: string) {
  if (!value) return Number.NaN
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  return new Date(hasTimezone ? value : `${value}Z`).getTime()
}
