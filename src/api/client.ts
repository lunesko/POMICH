const defaultBaseUrl = '/api'

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
  updatedAt?: string
}

export interface AuthSession {
  role: 'admin' | 'provider'
  subjectId: string
  providerId?: string
  tokenType: 'Bearer'
  accessToken: string
  expiresAt: number
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
  createdAt?: string
  updatedAt?: string
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

function getBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || defaultBaseUrl
}

export async function createOrder(payload: Record<string, unknown>) {
  const response = await fetch(`${getBaseUrl()}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function getCustomerProfile(customerId: string) {
  const response = await fetch(`${getBaseUrl()}/customers/${encodeURIComponent(customerId)}/profile`)

  if (!response.ok) {
    throw new Error(`Customer profile request failed with ${response.status}`)
  }

  return response.json() as Promise<CustomerProfile>
}

export async function updateCustomerProfile(customerId: string, payload: Partial<CustomerProfile>) {
  const response = await fetch(`${getBaseUrl()}/customers/${encodeURIComponent(customerId)}/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Customer profile update failed with ${response.status}`)
  }

  return response.json() as Promise<CustomerProfile>
}

export async function submitCustomerVerification(customerId: string, payload: Record<string, unknown>) {
  const response = await fetch(`${getBaseUrl()}/customers/${encodeURIComponent(customerId)}/verification/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
