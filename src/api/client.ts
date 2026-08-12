const defaultBaseUrl = '/api'

const providerErrorMessages: Record<string, string> = {
  provider_credentials_invalid: 'Невірний логін або пароль партнера.',
  provider_token_invalid: 'Недійсний токен партнера.',
  provider_session_required: 'Потрібен вхід партнера.',
  customer_identity_mismatch: 'Сесія застаріла. Закрийте та відкрийте застосунок знову.',
  provider_identity_mismatch: 'Акаунт партнера не збігається.',
  rate_limit_exceeded: 'Забагато спроб. Спробуйте через 10 хвилин.',
  invalid_channel: 'Невірний канал підтвердження.',
  telegram_unavailable: 'Telegram недоступний. Спробуйте email.',
  email_missing: 'Введіть email для підтвердження.',
  invalid_phone: 'Невірний номер телефону.',
  code_not_found: 'Код не знайдено. Надішліть новий.',
  code_expired: 'Код прострочено. Надішліть новий.',
  code_invalid: 'Невірний код. Перевірте та спробуйте ще раз.',
  invalid_code_format: 'Код має містити 6 цифр.',
  telegram_send_failed: 'Не вдалося надіслати код у Telegram.',
}

/** Parse FastAPI error JSON with UTF-8 detail field. */
export async function parseApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json()
    const detail = body?.detail
    if (typeof detail === 'string') {
      return providerErrorMessages[detail] ?? detail
    }
    if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
      return detail.message
    }
  } catch {
    // Response body is not JSON.
  }
  return fallback
}

export const FETCH_NETWORK_ERROR_UA = "Не вдалося з'єднатися з сервером. Спробуйте ще раз."

export function messageFromFetchError(error: unknown, fallback = FETCH_NETWORK_ERROR_UA): string {
  if (error instanceof Error) {
    if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
      return FETCH_NETWORK_ERROR_UA
    }
    return error.message
  }
  return fallback
}

async function fetchApi(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    throw new Error(messageFromFetchError(error))
  }
}

export interface OrderResponse {
  id?: string
  createdAt?: string
  updatedAt?: string
  status?: string
  service?: string
  source?: string
  customerLocation?: string
  destination?: string
  distanceKm?: number
  chatId?: string
  telegramUsername?: string
  vehicleState?: string
  customerCoordinates?: {
    lat: number
    lng: number
  }
  destinationCoordinates?: {
    lat: number
    lng: number
  }
  assignedProviderId?: string
  assignedOfferId?: string
  assignedProvider?: ProviderAvailability & {
    distanceKm?: number
    etaMinutes?: number
  }
  dispatchState?: string
  dispatchInfo?: {
    eligibleProviders?: number
    offersSent?: number
    searchRadiusKm?: number
    offerTimeoutSeconds?: number
    lastDispatchAt?: string
  }
  offers?: DispatchOffer[]
  statusHistory?: Array<{ status: string; at: string }>
}

export interface TelegramSessionResponse {
  chatId?: string
  service?: string
  location?: {
    latitude: number
    longitude: number
  }
  customerId?: string
  profile?: CustomerProfile
  customerIdentity?: CustomerIdentity
  updatedAt?: string
}

export interface AuthSession {
  role: 'admin' | 'provider' | 'customer'
  subjectId: string
  providerId?: string
  customerId?: string
  username?: string
  tokenType: 'Bearer'
  accessToken: string
  expiresAt: number
  profile?: CustomerProfile
  customerIdentity?: CustomerIdentity
  account?: UserAccountStatus
}

export interface UserAccountStatus {
  customerId: string
  preferredRole: 'customer' | 'provider' | ''
  linkedProviderId: string
  rolesRegistered: Array<'customer' | 'provider'>
  clientRegistered: boolean
  providerRegistered: boolean
  needsOnboarding: boolean
  profile?: CustomerProfile
}

export type ProviderStatus = 'online' | 'busy' | 'offline'
export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'lost' | 'cancelled'
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected'

export interface VerificationDetails {
  phone?: boolean
  email?: boolean
  telegram?: boolean
  identityDocument?: boolean
  driverLicense?: boolean
  vehicleRegistration?: boolean
  serviceProof?: boolean
  selfieCheck?: boolean
  profilePhoto?: boolean
  trustedContacts?: boolean
  backgroundCheck?: string
  submittedAt?: string | null
  reviewedAt?: string | null
  reviewedBy?: string | null
  reviewNote?: string
  [key: string]: unknown
}

export interface CustomerProfile {
  id: string
  name: string
  phone?: string
  email?: string
  telegram?: string
  city?: string
  avatarUrl?: string
  bio?: string
  rating?: number
  ordersCompleted?: number
  verificationStatus?: VerificationStatus
  verification?: VerificationDetails
  trustedBadges?: string[]
  profileCompleteness?: number
  preferredRole?: 'customer' | 'provider' | ''
  linkedProviderId?: string
  rolesRegistered?: Array<'customer' | 'provider'>
  createdAt?: string
  updatedAt?: string
}

export interface CustomerIdentity {
  type: 'telegram' | 'guest'
  telegramUserId?: string
  username?: string
  firstName?: string
  lastName?: string
  customerId?: string
}

export interface DispatchOffer {
  id: string
  orderId: string
  providerId: string
  status: OfferStatus
  distanceKm?: number
  createdAt?: string
  expiresAt?: string
  respondedAt?: string
  service?: string
  vehicleState?: string
  approximateLocation?: string
  etaMinutes?: number
}

export interface ProviderAvailability {
  id: string
  name: string
  rating?: number
  vehicle?: string
  plate?: string
  phone?: string
  telegram?: string
  status: ProviderStatus
  etaMinutes?: number
  location?: {
    lat: number
    lng: number
  }
  address?: string
  city?: string
  website?: string
  openingHours?: string
  contactStatus?: 'phone' | 'directory_only'
  primarySpecialty?: string
  providerKind?: 'dispatch' | 'directory'
  source?: string
  specialties?: string[]
  serviceRadiusKm?: number
  registeredAt?: string
  profileUpdatedAt?: string
  lastSeenAt?: string
  lastLocationAt?: string
  assignedOrderId?: string
  verificationStatus?: VerificationStatus
  verification?: VerificationDetails
  trustedBadges?: string[]
  updatedAt?: string
}

export interface MapRequestPin {
  id: string
  offerId?: string
  service?: string
  status?: string
  customerLocation?: string
  vehicleState?: string
  customerCoordinates?: {
    lat: number
    lng: number
  }
  distanceKm?: number
  etaMinutes?: number
  phone?: string
}

function getBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || defaultBaseUrl
}

export async function createOrder(payload: Record<string, unknown>, customerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Order request failed with ${response.status}`)
  }

  return response.json() as Promise<OrderResponse>
}

function authHeaders(token: string | undefined): Record<string, string> | undefined {
  if (!token) return undefined
  return token.startsWith('pomich_auth_v1.') ? { Authorization: `Bearer ${token}` } : undefined
}

function adminHeaders(adminToken?: string) {
  return authHeaders(adminToken)
}

function providerHeaders(providerToken?: string) {
  return authHeaders(providerToken)
}

function providerJsonHeaders(providerToken?: string): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(providerHeaders(providerToken) ?? {}) }
}

export async function getOrders(adminToken?: string) {
  const response = await fetch(`${getBaseUrl()}/orders`, { headers: adminHeaders(adminToken) })

  if (!response.ok) {
    throw new Error(`Orders request failed with ${response.status}`)
  }

  return response.json() as Promise<OrderResponse[]>
}

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

export async function createTelegramCustomerSession(initData: string) {
  const response = await fetchApi(`${getBaseUrl()}/auth/customer/telegram/session`, {
    method: 'POST',
    headers: { 'X-Telegram-Init-Data': initData },
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, FETCH_NETWORK_ERROR_UA))
  }

  return response.json() as Promise<AuthSession>
}

export async function getOrder(orderId: string) {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}`)

  if (!response.ok) {
    throw new Error(`Order request failed with ${response.status}`)
  }

  return response.json() as Promise<OrderResponse>
}

export async function cancelOrder(orderId: string) {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Order cancel request failed with ${response.status}`)
  }

  return response.json() as Promise<OrderResponse>
}

export async function retryDispatch(orderId: string) {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}/dispatch/retry`, {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Dispatch retry request failed with ${response.status}`)
  }

  return response.json() as Promise<OrderResponse>
}

export async function getProviders() {
  const response = await fetch(`${getBaseUrl()}/providers`)

  if (!response.ok) {
    throw new Error(`Providers request failed with ${response.status}`)
  }

  return response.json() as Promise<ProviderAvailability[]>
}

export async function getMapProviders() {
  const response = await fetch(`${getBaseUrl()}/map/providers`)

  if (!response.ok) {
    throw new Error(`Map providers request failed with ${response.status}`)
  }

  return response.json() as Promise<ProviderAvailability[]>
}

export async function getNearbyMapOrders(lat: number, lng: number, radiusKm = 20, service?: string) {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius_km: String(radiusKm),
  })
  if (service) params.set('service', service)

  const response = await fetch(`${getBaseUrl()}/map/orders/nearby?${params.toString()}`)

  if (!response.ok) {
    throw new Error(`Nearby map orders request failed with ${response.status}`)
  }

  return response.json() as Promise<MapRequestPin[]>
}

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

export async function getCustomerProfile(customerId: string, customerToken?: string) {
  const response = await fetchApi(`${getBaseUrl()}/customers/${encodeURIComponent(customerId)}/profile`, {
    headers: authHeaders(customerToken),
  })

  if (!response.ok) {
    throw new Error(`Customer profile request failed with ${response.status}`)
  }

  return response.json() as Promise<CustomerProfile>
}

export async function updateCustomerProfile(customerId: string, payload: Partial<CustomerProfile>, customerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/customers/${encodeURIComponent(customerId)}/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, "Не вдалося зберегти профіль. Спробуйте ще раз."))
  }

  return response.json() as Promise<CustomerProfile>
}

export interface CustomerVerifySendResponse {
  ok: boolean
  channel: 'telegram' | 'email'
  expiresAt: string
  expiresInSeconds: number
  devCode?: string
}

export interface CustomerVerifyConfirmResponse {
  ok: boolean
  profile: CustomerProfile
}

export async function sendCustomerVerificationCode(
  payload: { channel: 'telegram' | 'email'; phone?: string; email?: string },
  customerToken?: string,
) {
  const response = await fetch(`${getBaseUrl()}/auth/customer/verify/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Не вдалося надіслати код підтвердження.'))
  }

  return response.json() as Promise<CustomerVerifySendResponse>
}

export async function confirmCustomerVerificationCode(payload: { code: string }, customerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/auth/customer/verify/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Не вдалося підтвердити код.'))
  }

  return response.json() as Promise<CustomerVerifyConfirmResponse>
}

export async function submitCustomerVerification(customerId: string, payload: Record<string, unknown>, customerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/customers/${encodeURIComponent(customerId)}/verification/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Customer verification request failed with ${response.status}`)
  }

  return response.json() as Promise<CustomerProfile>
}

export async function getProviderProfile(providerId: string, providerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/profile`, {
    headers: providerHeaders(providerToken),
  })

  if (!response.ok) {
    throw new Error(`Provider profile request failed with ${response.status}`)
  }

  return response.json() as Promise<ProviderAvailability>
}

export async function submitProviderVerification(providerId: string, payload: Record<string, unknown>, providerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/verification/submit`, {
    method: 'POST',
    headers: providerJsonHeaders(providerToken),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Provider verification request failed with ${response.status}`)
  }

  return response.json() as Promise<ProviderAvailability>
}

export async function reviewProviderVerification(providerId: string, payload: { status: 'verified' | 'rejected'; reviewNote?: string }, adminToken?: string) {
  const response = await fetch(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/verification/review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(adminHeaders(adminToken) ?? {}) },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Provider verification review failed with ${response.status}`)
  }

  return response.json() as Promise<ProviderAvailability>
}

export async function getProviderOffers(providerId: string, providerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/offers`, {
    headers: providerHeaders(providerToken),
  })

  if (!response.ok) {
    throw new Error(`Provider offers request failed with ${response.status}`)
  }

  return response.json() as Promise<DispatchOffer[]>
}

export async function acceptProviderOffer(providerId: string, offerId: string, providerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/offers/${encodeURIComponent(offerId)}/accept`, {
    method: 'POST',
    headers: providerHeaders(providerToken),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => undefined)
    throw Object.assign(new Error(`Offer accept request failed with ${response.status}`), { status: response.status, detail: error?.detail })
  }

  return response.json() as Promise<{ offer: DispatchOffer; order: OrderResponse; provider: ProviderAvailability }>
}

export async function declineProviderOffer(providerId: string, offerId: string, providerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/offers/${encodeURIComponent(offerId)}/decline`, {
    method: 'POST',
    headers: providerHeaders(providerToken),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => undefined)
    throw Object.assign(new Error(`Offer decline request failed with ${response.status}`), { status: response.status, detail: error?.detail })
  }

  return response.json() as Promise<DispatchOffer>
}

export async function updateProviderPresence(providerId: string, payload: { status: ProviderStatus; location?: { lat: number; lng: number }; etaMinutes?: number }, providerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/presence`, {
    method: 'PATCH',
    headers: providerJsonHeaders(providerToken),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Provider presence request failed with ${response.status}`)
  }

  return response.json() as Promise<ProviderAvailability>
}

export async function updateProviderOrderStatus(providerId: string, orderId: string, status: string, providerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'PATCH',
    headers: providerJsonHeaders(providerToken),
    body: JSON.stringify({ status }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => undefined)
    throw Object.assign(new Error(`Provider order status request failed with ${response.status}`), { status: response.status, detail: error?.detail })
  }

  return response.json() as Promise<OrderResponse>
}

export async function updateProviderProfile(providerId: string, payload: {
  name: string
  phone: string
  telegram?: string
  vehicle: string
  plate?: string
  city?: string
  specialties: string[]
  serviceRadiusKm: number
  location?: { lat: number; lng: number }
}, providerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/profile`, {
    method: 'PATCH',
    headers: providerJsonHeaders(providerToken),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Provider profile request failed with ${response.status}`)
  }

  return response.json() as Promise<ProviderAvailability>
}

export async function updateOrderStatus(orderId: string, status: string, adminToken?: string) {
  const response = await fetch(`${getBaseUrl()}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(adminHeaders(adminToken) ?? {}) },
    body: JSON.stringify({ status }),
  })

  if (!response.ok) {
    throw new Error(`Order status request failed with ${response.status}`)
  }

  return response.json() as Promise<OrderResponse>
}

export async function getTelegramSession(chatId: string, initData?: string) {
  const headers: Record<string, string> = {}
  if (initData) headers['X-Telegram-Init-Data'] = initData

  const response = await fetch(`${getBaseUrl()}/telegram/session/${encodeURIComponent(chatId)}`, {
    headers,
  })

  if (!response.ok) {
    throw new Error(`Telegram session request failed with ${response.status}`)
  }

  return response.json() as Promise<TelegramSessionResponse>
}

export async function getUserAccount(customerId: string, customerToken?: string, initData?: string) {
  const headers: Record<string, string> = { ...(authHeaders(customerToken) ?? {}) }
  if (initData) headers['X-Telegram-Init-Data'] = initData

  const response = await fetchApi(`${getBaseUrl()}/users/${encodeURIComponent(customerId)}/account`, { headers })

  if (!response.ok) {
    throw new Error(await parseApiError(response, FETCH_NETWORK_ERROR_UA))
  }

  return response.json() as Promise<UserAccountStatus>
}

export async function setUserPreferredRole(customerId: string, role: 'customer' | 'provider', customerToken?: string) {
  const response = await fetchApi(`${getBaseUrl()}/users/${encodeURIComponent(customerId)}/account/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify({ role }),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, "Не вдалося обрати роль. Спробуйте ще раз."))
  }

  return response.json() as Promise<UserAccountStatus>
}

export async function createSelfProviderSession(customerId: string, customerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/auth/provider/self/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify({ customerId }),
  })

  if (!response.ok) {
    throw new Error(`Self provider session request failed with ${response.status}`)
  }

  return response.json() as Promise<AuthSession>
}

export interface AdminStats {
  totals: {
    clients: number
    providers: number
    dispatchProviders: number
    directoryProviders: number
    orders: number
    activeOrders: number
    completedOrders: number
  }
  providers: {
    online: number
    busy: number
    offline: number
    verified: number
    pendingVerification: number
  }
  clients: {
    verified: number
    registered: number
    disabled: number
  }
  orders: {
    searching: number
    assigned: number
    enRoute: number
    inProgress: number
  }
  activity?: AdminActivityItem[]
}

export interface AdminActivityItem {
  type: string
  id?: string
  status?: string
  service?: string
  source?: string
  customerLocation?: string
  assignedProviderId?: string
  at?: string
}

export interface AdminSettings {
  runtime: string
  webAppUrl?: string | null
  corsOrigins: string[]
  encryptionEnabled: boolean
  databaseUrlConfigured: boolean
  telegramConfigured: boolean
  adminAccountsConfigured: boolean
  providerAccountsConfigured: boolean
  allowHttpPilot: boolean
  sessionTtlSeconds: number
}

export async function getAdminStats(adminToken?: string) {
  const response = await fetch(`${getBaseUrl()}/admin/stats`, { headers: adminHeaders(adminToken) })
  if (!response.ok) throw new Error(`Admin stats request failed with ${response.status}`)
  return response.json() as Promise<AdminStats>
}

export async function getAdminClients(adminToken?: string, query?: string) {
  const params = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''
  const response = await fetch(`${getBaseUrl()}/admin/clients${params}`, { headers: adminHeaders(adminToken) })
  if (!response.ok) throw new Error(`Admin clients request failed with ${response.status}`)
  return response.json() as Promise<CustomerProfile[]>
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
