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

export function authSessionStorageKey(role: "admin" | "provider" | "customer", subjectId: string) {
  return `pomichAuthSession:${role}:${subjectId}`
}

export function readStoredAuthSession(storageKey: string, expectedRole: "admin" | "provider" | "customer", expectedSubjectId: string) {
  if (typeof window === "undefined") return undefined
  const rawValue = window.sessionStorage.getItem(storageKey)
  if (!rawValue) return undefined

  try {
    const session = JSON.parse(rawValue) as Partial<AuthSession>
    const expiresAt = Number(session.expiresAt ?? 0)
    if (session.role !== expectedRole || session.subjectId !== expectedSubjectId || !isAuthSessionToken(session.accessToken) || expiresAt <= Math.floor(Date.now() / 1000) + 30) {
      window.sessionStorage.removeItem(storageKey)
      return undefined
    }
    return session.accessToken
  } catch {
    if (isAuthSessionToken(rawValue)) return rawValue
    window.sessionStorage.removeItem(storageKey)
    return undefined
  }
}

export const CUSTOMER_ID_STORAGE_KEY = "pomichCustomerId"

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

  const persisted = tryCustomerId(readPersistedCustomerId())
  if (persisted) return persisted

  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index)
    if (!key?.startsWith("pomichAuthSession:customer:")) continue
    const customerId = key.slice("pomichAuthSession:customer:".length)
    const restored = tryCustomerId(customerId)
    if (restored) return restored
  }

  return undefined
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
