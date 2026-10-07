import { parseApiError, parseApiErrorDetails, FETCH_NETWORK_ERROR_UA, fetchApi, getBaseUrl, authHeaders } from "./transport"
import type { TelegramSessionResponse, AuthSession } from "./types"

export async function createAdminSession(adminToken: string) {
  const response = await fetch(`${getBaseUrl()}/auth/admin/session`, {
    method: 'POST',
    headers: { 'X-POMICH-Admin-Token': adminToken },
  })

  if (!response.ok) {
    throw new Error(`Admin session request failed with ${response.status}`)
  }

  return response.json() as Promise<AuthSession>
}

export async function restoreBrowserSession(role: 'customer' | 'provider' | 'admin'): Promise<AuthSession | undefined> {
  const response = await fetch(`${getBaseUrl()}/auth/browser/restore`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
  if (response.status === 401) return undefined
  if (!response.ok) throw new Error(`Session restore failed with ${response.status}`)
  const session = await response.json() as Partial<AuthSession>
  if (session.role !== role || typeof session.subjectId !== 'string' || !session.subjectId ||
      typeof session.accessToken !== 'string' || !session.accessToken.startsWith('pomich_auth_v1.') ||
      typeof session.expiresAt !== 'number' || session.expiresAt <= Date.now() / 1000) {
    throw new Error('Invalid browser session response')
  }
  return session as AuthSession
}

export async function logoutBrowserSessions(): Promise<void> {
  const response = await fetch(`${getBaseUrl()}/auth/browser/logout`, {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
  })
  if (!response.ok) throw new Error(`Browser logout failed with ${response.status}`)
}

export async function createAdminAccountSession(username: string, password: string) {
  const response = await fetch(`${getBaseUrl()}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  if (!response.ok) {
    throw new Error(`Admin login request failed with ${response.status}`)
  }

  return response.json() as Promise<AuthSession>
}

export async function createProviderSession(providerId: string, providerToken: string) {
  const response = await fetch(`${getBaseUrl()}/auth/provider/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-POMICH-Provider-Token': providerToken },
    body: JSON.stringify({ providerId }),
  })

  if (!response.ok) {
    throw new Error(`Provider session request failed with ${response.status}`)
  }

  return response.json() as Promise<AuthSession>
}

export async function createProviderAccountSession(providerId: string, login: string, password: string) {
  const response = await fetch(`${getBaseUrl()}/auth/provider/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, login, password }),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Не вдалося увійти в акаунт партнера.'))
  }

  return response.json() as Promise<AuthSession>
}

export async function createGuestCustomerSession(customerId?: string) {
  const response = await fetchApi(`${getBaseUrl()}/auth/customer/guest/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(customerId ? { customerId } : {}),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, FETCH_NETWORK_ERROR_UA))
  }

  return response.json() as Promise<AuthSession>
}

export async function createTelegramCustomerSession(
  initData: string,
  botKind?: 'customer' | 'provider' | null,
) {
  const headers: Record<string, string> = { 'X-Telegram-Init-Data': initData }
  if (botKind === 'customer' || botKind === 'provider') {
    headers['X-POMICH-Telegram-Bot'] = botKind
  }
  const response = await fetchApi(`${getBaseUrl()}/auth/customer/telegram/session`, {
    method: 'POST',
    headers,
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, FETCH_NETWORK_ERROR_UA))
  }

  return response.json() as Promise<AuthSession>
}

export async function getTelegramSession(
  chatId: string,
  initData?: string,
  botKind?: 'customer' | 'provider' | null,
) {
  const headers: Record<string, string> = {}
  if (initData) headers['X-Telegram-Init-Data'] = initData
  if (botKind === 'customer' || botKind === 'provider') headers['X-POMICH-Telegram-Bot'] = botKind

  const response = await fetch(`${getBaseUrl()}/telegram/session/${encodeURIComponent(chatId)}`, {
    headers,
  })

  if (!response.ok) {
    throw new Error(`Telegram session request failed with ${response.status}`)
  }

  return response.json() as Promise<TelegramSessionResponse>
}

export async function createSelfProviderSession(customerId: string, customerToken?: string) {
  const response = await fetchApi(`${getBaseUrl()}/auth/provider/self/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify({ customerId }),
  })

  if (!response.ok) {
    const parsed = await parseApiErrorDetails(response, 'Не вдалося відкрити сесію партнера.')
    throw Object.assign(new Error(parsed.message), {
      status: response.status,
      detail: parsed.code || parsed.message,
    })
  }

  return response.json() as Promise<AuthSession>
}
