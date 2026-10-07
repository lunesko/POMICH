import { parseApiError, getBaseUrl, adminHeaders } from "./transport"
import type { OrderResponse, CustomerProfile, ProviderAvailability, AdminStats, AdminOpsLog, AdminSettings } from "./types"

export async function importUzhgorodProviders(adminToken?: string, options?: { seedOnly?: boolean; preferOsm?: boolean }) {
  const response = await fetch(`${getBaseUrl()}/admin/providers/import/uzhgorod`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(adminHeaders(adminToken) ?? {}) },
    body: JSON.stringify(options ?? {}),
  })

  if (!response.ok) {
    throw new Error(`Uzhgorod import request failed with ${response.status}`)
  }

  return response.json() as Promise<{
    source: string
    counts: { osm: number; seed: number; total: number }
    merge: { added: number; updated: number; total: number; directory: number }
    center: { lat: number; lng: number }
  }>
}

export async function getAdminStats(adminToken?: string) {
  const response = await fetch(`${getBaseUrl()}/admin/stats`, { headers: adminHeaders(adminToken) })
  if (!response.ok) throw new Error(`Admin stats request failed with ${response.status}`)
  return response.json() as Promise<AdminStats>
}

export async function getAdminOpsLog(
  adminToken?: string,
  options?: { limit?: number; severity?: string; orderId?: string },
): Promise<AdminOpsLog> {
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.severity && options.severity !== 'all') params.set('severity', options.severity)
  if (options?.orderId?.trim()) params.set('orderId', options.orderId.trim())
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const response = await fetch(`${getBaseUrl()}/admin/ops-log${suffix}`, { headers: adminHeaders(adminToken) })
  if (!response.ok) throw new Error(`Admin ops log request failed with ${response.status}`)
  const payload = (await response.json()) as Partial<AdminOpsLog> | null
  const events = Array.isArray(payload?.events) ? payload.events : []
  const counts = payload?.counts
  return {
    events,
    counts: {
      error: Number(counts?.error ?? 0) || 0,
      warn: Number(counts?.warn ?? 0) || 0,
      info: Number(counts?.info ?? 0) || 0,
      total: Number(counts?.total ?? events.length) || 0,
    },
    limit: Number(payload?.limit ?? options?.limit ?? 100) || 100,
  }
}

export async function getAdminClients(adminToken?: string, query?: string, includeGuests = false) {
  const params = new URLSearchParams()
  if (query?.trim()) params.set('q', query.trim())
  if (includeGuests) params.set('includeGuests', 'true')
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const response = await fetch(`${getBaseUrl()}/admin/clients${suffix}`, { headers: adminHeaders(adminToken) })
  if (!response.ok) throw new Error(`Admin clients request failed with ${response.status}`)
  return response.json() as Promise<CustomerProfile[]>
}

export async function purgeStaleGuestClients(adminToken?: string, days = 7) {
  const response = await fetch(`${getBaseUrl()}/admin/clients/purge-guests?days=${encodeURIComponent(String(days))}`, {
    method: 'POST',
    headers: adminHeaders(adminToken),
  })
  if (!response.ok) throw new Error(await parseApiError(response, 'Не вдалося очистити guest-сесії.'))
  return response.json() as Promise<{ deleted: number; customerIds: string[]; remaining: number }>
}

export async function getAdminProviders(adminToken?: string, query?: string, kind?: string) {
  const params = new URLSearchParams()
  if (query?.trim()) params.set('q', query.trim())
  if (kind?.trim()) params.set('kind', kind.trim())
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const response = await fetch(`${getBaseUrl()}/admin/providers${suffix}`, { headers: adminHeaders(adminToken) })
  if (!response.ok) throw new Error(`Admin providers request failed with ${response.status}`)
  return response.json() as Promise<ProviderAvailability[]>
}

export async function getAdminOrders(adminToken?: string, status?: string) {
  const params = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''
  const response = await fetch(`${getBaseUrl()}/admin/orders${params}`, { headers: adminHeaders(adminToken) })
  if (!response.ok) throw new Error(`Admin orders request failed with ${response.status}`)
  return response.json() as Promise<OrderResponse[]>
}

export async function getAdminSettings(adminToken?: string) {
  const response = await fetch(`${getBaseUrl()}/admin/settings`, { headers: adminHeaders(adminToken) })
  if (!response.ok) throw new Error(`Admin settings request failed with ${response.status}`)
  return response.json() as Promise<AdminSettings>
}

export async function adminUpdateClient(customerId: string, payload: Partial<CustomerProfile> & { accountStatus?: string }, adminToken?: string) {
  const response = await fetch(`${getBaseUrl()}/admin/clients/${encodeURIComponent(customerId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(adminHeaders(adminToken) ?? {}) },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(await parseApiError(response, 'Не вдалося оновити клієнта.'))
  return response.json() as Promise<CustomerProfile>
}

export async function adminUpdateProvider(providerId: string, payload: Partial<ProviderAvailability> & { accountStatus?: string }, adminToken?: string) {
  const response = await fetch(`${getBaseUrl()}/admin/providers/${encodeURIComponent(providerId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(adminHeaders(adminToken) ?? {}) },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(await parseApiError(response, 'Не вдалося оновити партнера.'))
  return response.json() as Promise<ProviderAvailability>
}

export async function adminDeleteProvider(providerId: string, adminToken?: string) {
  const response = await fetch(`${getBaseUrl()}/admin/providers/${encodeURIComponent(providerId)}`, {
    method: 'DELETE',
    headers: adminHeaders(adminToken),
  })
  if (!response.ok) throw new Error(await parseApiError(response, 'Не вдалося видалити партнера.'))
  return response.json() as Promise<{ deleted: boolean; providerId: string }>
}
