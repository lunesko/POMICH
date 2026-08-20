const defaultBaseUrl = '/api'

const providerErrorMessages: Record<string, string> = {
  provider_credentials_invalid: 'Невірний логін або пароль партнера.',
  provider_token_invalid: 'Недійсний токен партнера.',
  provider_session_required: 'Потрібен вхід партнера.',
  provider_session_invalid: 'Сесію партнера не відкрито. Оновіть сторінку або увійдіть знову.',
  provider_session_expired: 'Сесія партнера закінчилась. Оновіть сторінку або увійдіть знову.',
  provider_session_missing: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  provider_not_linked: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  customer_session_required: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  customer_session_invalid: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  customer_session_expired: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  customer_session_missing: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  bearer_token_invalid: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  role_forbidden: 'Сесію не відкрито. Оновіть сторінку або увійдіть знову.',
  customer_identity_mismatch: 'Сесія застаріла. Закрийте та відкрийте застосунок знову.',
  provider_identity_mismatch: 'Акаунт партнера не збігається. Оновіть сторінку та спробуйте ще раз.',
  'provider verification must be approved before going online':
    'Підтвердіть телефон у Telegram, щоб вийти на лінію.',
  'provider profile must be registered before going online': 'Спочатку заповніть профіль партнера.',
  rate_limit_exceeded: 'Забагато спроб. Спробуйте через 10 хвилин.',
  send_cooldown: 'Код уже надіслано нещодавно. Зачекайте близько хвилини й спробуйте знову.',
  invalid_channel: 'Невірний канал підтвердження.',
  telegram_unavailable: 'Telegram недоступний. Спробуйте email.',
  telegram_not_linked:
    'Відкрийте @pomich_ua_bot або @pomich_help_bot, надішліть /start. Код прийде в той самий бот — це підтвердження телефону, не нова реєстрація.',
  email_missing: 'Введіть email для підтвердження.',
  invalid_phone: 'Невірний номер телефону.',
  customer_not_found: 'Акаунт з цим номером не знайдено. Зареєструйтеся або перевірте номер.',
  code_not_found: 'Код не знайдено. Надішліть новий.',
  code_expired: 'Код прострочено. Надішліть новий.',
  code_invalid: 'Невірний код. Перевірте та спробуйте ще раз.',
  invalid_code_format: 'Код має містити 6 цифр.',
  telegram_send_failed: 'Не вдалося надіслати код у Telegram. Спробуйте ще раз або напишіть /start у @pomich_ua_bot чи @pomich_help_bot.',
  phone_already_registered: 'Цей номер уже зареєстровано. Увійдіть за номером або використайте інший.',
  REVIEW_ALREADY_SUBMITTED: 'Оцінку вже збережено.',
  ORDER_NOT_COMPLETED: 'Оцінку можна залишити лише після завершення заявки.',
  REVIEW_FORBIDDEN: 'Немає доступу до оцінки цієї заявки.',
  ORDER_NOT_FOUND: 'Заявку не знайдено.',
  OFFER_EXPIRED: 'Пропозиція вже завершилась. Очікуйте нову заявку.',
  OFFER_NOT_FOUND: 'Пропозицію не знайдено.',
  OFFER_DECLINED: 'Цю пропозицію вже пропущено.',
  PRICE_REQUIRED: 'Вкажіть вартість послуги в гривнях.',
  ORDER_ALREADY_ACCEPTED: 'Замовлення вже прийняв інший виконавець.',
  PROVIDER_NOT_VERIFIED: 'Підтвердіть телефон, щоб приймати заявки.',
  'Internal Server Error': 'Помилка сервера. Спробуйте ще раз через хвилину.',
  service_unavailable: 'Сервер тимчасово недоступний (оновлення). Спробуйте через хвилину.',
}

export function formatOtpRetryWait(seconds: number, code?: string): string {
  const safe = Math.max(1, Math.floor(seconds))
  if (code === 'rate_limit_exceeded' || safe >= 60) {
    const mins = Math.max(1, Math.ceil(safe / 60))
    return `Забагато спроб. Спробуйте через ${mins} хв.`
  }
  return `Код уже надіслано. Зачекайте ${safe} с і спробуйте знову.`
}

export class ApiRequestError extends Error {
  status: number
  code?: string
  retryAfterSeconds?: number

  constructor(message: string, options?: { status?: number; code?: string; retryAfterSeconds?: number }) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = options?.status ?? 0
    this.code = options?.code
    this.retryAfterSeconds = options?.retryAfterSeconds
  }
}

function messageForErrorCode(code: string, retryAfterSeconds?: number): string {
  if (typeof retryAfterSeconds === 'number' && (code === 'rate_limit_exceeded' || code === 'send_cooldown')) {
    return formatOtpRetryWait(retryAfterSeconds, code)
  }
  return providerErrorMessages[code] ?? code
}

/** Parse FastAPI error JSON with UTF-8 detail field. */
export async function parseApiError(response: Response, fallback: string): Promise<string> {
  const parsed = await parseApiErrorDetails(response, fallback)
  return parsed.message
}

export async function parseApiErrorDetails(
  response: Response,
  fallback: string,
): Promise<{ message: string; code?: string; retryAfterSeconds?: number }> {
  try {
    const body = await response.json()
    const detail = body?.detail
    if (typeof detail === 'string') {
      return { message: messageForErrorCode(detail), code: detail }
    }
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const code = typeof detail.code === 'string' ? detail.code : undefined
      const retryAfterSeconds =
        typeof detail.retryAfterSeconds === 'number'
          ? detail.retryAfterSeconds
          : typeof detail.retry_after_seconds === 'number'
            ? detail.retry_after_seconds
            : undefined
      if (code) {
        return {
          message: messageForErrorCode(code, retryAfterSeconds),
          code,
          retryAfterSeconds,
        }
      }
      if (typeof detail.message === 'string') {
        return { message: detail.message, retryAfterSeconds }
      }
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0]
      if (typeof first === 'string') {
        return { message: messageForErrorCode(first), code: first }
      }
      if (first && typeof first === 'object') {
        const msg = typeof first.msg === 'string' ? first.msg : typeof first.message === 'string' ? first.message : null
        if (msg) return { message: msg }
      }
    }
  } catch {
    // Response body is not JSON.
  }
  if (response.status === 429) {
    return { message: providerErrorMessages.send_cooldown, code: 'send_cooldown' }
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return { message: providerErrorMessages.service_unavailable, code: 'service_unavailable' }
  }
  if (response.status >= 500) {
    return { message: providerErrorMessages['Internal Server Error'], code: 'Internal Server Error' }
  }
  return { message: fallback }
}

export const FETCH_NETWORK_ERROR_UA = "Не вдалося з'єднатися з сервером. Спробуйте ще раз."
export const FETCH_TIMEOUT_ERROR_UA = 'Запит перевищив час очікування. Спробуйте ще раз.'
export const DEFAULT_API_TIMEOUT_MS = 25_000

export function messageFromFetchError(error: unknown, fallback = FETCH_NETWORK_ERROR_UA): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || /aborted|timeout|timed out/i.test(error.message)) {
      return FETCH_TIMEOUT_ERROR_UA
    }
    if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
      return FETCH_NETWORK_ERROR_UA
    }
    return error.message
  }
  return fallback
}

async function fetchApi(input: RequestInfo | URL, init?: RequestInit, timeoutMs = DEFAULT_API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const upstreamSignal = init?.signal
  const onUpstreamAbort = () => controller.abort(upstreamSignal?.reason)
  upstreamSignal?.addEventListener('abort', onUpstreamAbort, { once: true })
  const timeoutId = window.setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    throw new Error(messageFromFetchError(error))
  } finally {
    window.clearTimeout(timeoutId)
    upstreamSignal?.removeEventListener('abort', onUpstreamAbort)
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
  customerComment?: string
  customerId?: string
  customerName?: string
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
  partnerId?: string
  partnerProposedPrice?: number
  partnerPriceNote?: string
  providerName?: string
  acceptedAt?: string
  acceptedIdleExpiresAt?: string
  acceptedIdleTimeoutSeconds?: number
  priceConfirmedAt?: string
  cancelReason?: string
  cancelledAt?: string
  assignedProvider?: ProviderAvailability & {
    distanceKm?: number
    etaMinutes?: number
  }
  customerReview?: OrderReview
  partnerReview?: OrderReview
  dispatchState?: string
  dispatchInfo?: {
    eligibleProviders?: number
    offersSent?: number
    searchRadiusKm?: number
    offerTimeoutSeconds?: number
    lastDispatchAt?: string
    autoRetryCount?: number
    lastAutoRetryAt?: string
    exhaustedAt?: string
  }
  offers?: DispatchOffer[]
  statusHistory?: Array<{ status: string; at: string }>
}

export interface OrderReview {
  rating: number
  comment?: string
  at?: string
  authorId?: string | null
  authorRole?: 'customer' | 'partner'
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
  preferredRole?: 'customer' | 'provider' | ''
  telegramBotKind?: 'customer' | 'provider'
  providerAccount?: {
    linked: boolean
    providerId?: string | null
    verificationStatus?: VerificationStatus | string
  }
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
  vehicle?: string
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
  displayName?: string
  clientRegistered?: boolean
  isGuestSession?: boolean
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
  /** Parent order status — used to hide stale offers for completed/cancelled orders. */
  orderStatus?: string
  distanceKm?: number
  createdAt?: string
  expiresAt?: string
  respondedAt?: string
  service?: string
  vehicleState?: string
  approximateLocation?: string
  customerComment?: string
  customerCoordinates?: {
    lat: number
    lng: number
  }
  etaMinutes?: number
}

export interface ProviderAvailability {
  id: string
  name: string
  rating?: number
  ratingCount?: number
  vehicle?: string
  vehicleMake?: string
  vehicleModel?: string
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
  distanceKm?: number
  ordersCompleted?: number
}

export interface ProviderPublicReview {
  rating: number
  comment?: string
  at?: string
  service?: string
}

export interface ProviderPublicProfile {
  id: string
  name: string
  rating?: number
  ratingCount?: number
  vehicle?: string
  specialties?: string[]
  status?: ProviderStatus
  etaMinutes?: number
  providerKind?: 'dispatch' | 'directory' | string
  city?: string
  address?: string
  phone?: string
  telegram?: string
  verificationStatus?: VerificationStatus
  openingHours?: string
  website?: string
  ordersCompleted?: number
  location?: {
    lat: number
    lng: number
  }
  reviews: ProviderPublicReview[]
}

export interface MapRequestPin {
  id: string
  offerId?: string
  service?: string
  status?: string
  customerLocation?: string
  vehicleState?: string
  customerComment?: string
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

export async function getOrder(orderId: string, accessToken?: string) {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}`, {
    cache: 'no-store',
    headers: authHeaders(accessToken) ?? {},
  })

  if (!response.ok) {
    throw new Error(`Order request failed with ${response.status}`)
  }

  return response.json() as Promise<OrderResponse>
}

export async function getCustomerOrders(customerId: string, customerToken?: string, limit = 50) {
  const response = await fetch(
    `${getBaseUrl()}/customers/${encodeURIComponent(customerId)}/orders?limit=${encodeURIComponent(String(limit))}`,
    {
      cache: 'no-store',
      headers: authHeaders(customerToken) ?? {},
    },
  )

  if (!response.ok) {
    throw new Error(await parseApiError(response, `Customer orders failed with ${response.status}`))
  }

  return response.json() as Promise<OrderResponse[]>
}

export async function getProviderOrders(providerId: string, providerToken?: string, limit = 50) {
  const response = await fetch(
    `${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/orders?limit=${encodeURIComponent(String(limit))}`,
    {
      cache: 'no-store',
      headers: authHeaders(providerToken) ?? {},
    },
  )

  if (!response.ok) {
    throw new Error(await parseApiError(response, `Provider orders failed with ${response.status}`))
  }

  return response.json() as Promise<OrderResponse[]>
}

export async function submitOrderReview(
  orderId: string,
  payload: { role: 'customer' | 'partner'; rating: number; comment?: string; authorId?: string; providerId?: string },
  token?: string,
) {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}/reviews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeaders(token) ?? {}),
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, `Order review failed with ${response.status}`))
  }

  return response.json() as Promise<OrderResponse>
}

export async function cancelOrder(orderId: string, authToken?: string) {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    headers: authHeaders(authToken) ?? {},
  })

  if (!response.ok) {
    throw new Error(`Order cancel request failed with ${response.status}`)
  }

  return response.json() as Promise<OrderResponse>
}

export async function confirmOrderPrice(orderId: string, customerToken?: string) {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}/confirm-price`, {
    method: 'POST',
    headers: authHeaders(customerToken) ?? {},
  })

  if (!response.ok) {
    const error = await response.json().catch(() => undefined)
    throw Object.assign(new Error(`Order price confirm failed with ${response.status}`), { status: response.status, detail: error?.detail })
  }

  return response.json() as Promise<OrderResponse>
}

export async function retryDispatch(orderId: string, authToken?: string) {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}/dispatch/retry`, {
    method: 'POST',
    headers: authHeaders(authToken) ?? {},
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

export async function getMapProviders(options?: {
  scope?: "all" | "city"
  city?: string
  lat?: number
  lng?: number
  radiusKm?: number
}) {
  const params = new URLSearchParams()
  if (options?.scope === "all") params.set("scope", "all")
  if (options?.city) params.set("city", options.city)
  if (options?.lat != null) params.set("lat", String(options.lat))
  if (options?.lng != null) params.set("lng", String(options.lng))
  if (options?.radiusKm != null) params.set("radius_km", String(options.radiusKm))
  const query = params.toString()
  const response = await fetch(`${getBaseUrl()}/map/providers${query ? `?${query}` : ""}`)

  if (!response.ok) {
    throw new Error(`Map providers request failed with ${response.status}`)
  }

  return response.json() as Promise<ProviderAvailability[]>
}

export interface MapSettlement {
  id: string
  name: string
  oblast?: string
  type?: string
  center?: { lat: number; lng: number }
  bbox?: [number, number, number, number]
}

const SETTLEMENTS_CACHE_KEY = "pomichMapSettlements"
const SETTLEMENTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

let settlementsMemoryCache: MapSettlement[] | null = null
let settlementsInflight: Promise<MapSettlement[]> | null = null

function readSettlementsCache(): MapSettlement[] | null {
  if (settlementsMemoryCache) return settlementsMemoryCache
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(SETTLEMENTS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { ts?: number; items?: MapSettlement[] }
    if (!parsed.ts || !Array.isArray(parsed.items)) return null
    if (Date.now() - parsed.ts > SETTLEMENTS_CACHE_TTL_MS) return null
    settlementsMemoryCache = parsed.items
    return parsed.items
  } catch {
    return null
  }
}

function writeSettlementsCache(items: MapSettlement[]): void {
  settlementsMemoryCache = items
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(
      SETTLEMENTS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), items }),
    )
  } catch {
    // Ignore quota errors — in-memory cache still helps within the session.
  }
}

export async function getMapSettlements() {
  const cached = readSettlementsCache()
  if (cached) return cached
  if (settlementsInflight) return settlementsInflight

  settlementsInflight = (async () => {
    const response = await fetch(`${getBaseUrl()}/map/settlements`)
    if (!response.ok) {
      throw new Error(`Map settlements request failed with ${response.status}`)
    }
    const items = (await response.json()) as MapSettlement[]
    writeSettlementsCache(Array.isArray(items) ? items : [])
    return Array.isArray(items) ? items : []
  })()

  try {
    return await settlementsInflight
  } finally {
    settlementsInflight = null
  }
}

export async function getNearestMapSettlement(lat: number, lng: number, maxKm = 80) {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    max_km: String(maxKm),
  })
  const response = await fetch(`${getBaseUrl()}/map/settlements/nearest?${params.toString()}`)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Nearest settlement request failed with ${response.status}`)
  }

  return response.json() as Promise<MapSettlement & { distanceKm?: number }>
}

export async function getNearbyMapOrders(
  lat: number,
  lng: number,
  radiusKm = 20,
  service?: string,
  providerToken?: string,
) {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius_km: String(radiusKm),
  })
  if (service) params.set('service', service)

  const response = await fetch(`${getBaseUrl()}/map/orders/nearby?${params.toString()}`, {
    headers: authHeaders(providerToken) ?? {},
  })

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

export async function importUkraineProviders(
  adminToken?: string,
  options?: {
    settlementIds?: string[]
    oblast?: string
    preferOsm?: boolean
    seedOnly?: boolean
    delaySeconds?: number
  },
) {
  const response = await fetch(`${getBaseUrl()}/admin/providers/import/ukraine`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(adminHeaders(adminToken) ?? {}) },
    body: JSON.stringify(options ?? {}),
  })

  if (!response.ok) {
    throw new Error(`Ukraine import request failed with ${response.status}`)
  }

  return response.json() as Promise<{
    counts: { total: number; withPhone: number; directoryOnly: number }
    perSettlement: Array<{
      settlementId: string
      city: string
      counts: { osm: number; seed: number; total: number; withPhone: number; directoryOnly: number }
      source: string
    }>
    merge: { added: number; updated: number; total: number; directory: number }
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
  cooldownSeconds?: number
  alreadySent?: boolean
  devCode?: string
}

export interface CustomerVerifyConfirmResponse {
  ok: boolean
  profile: CustomerProfile
}

export async function sendCustomerVerificationCode(
  payload: { channel: 'telegram' | 'email'; phone?: string; email?: string; telegramBotKind?: 'customer' | 'provider' },
  customerToken?: string,
) {
  const response = await fetch(`${getBaseUrl()}/auth/customer/verify/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeaders(customerToken) ?? {}) },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const details = await parseApiErrorDetails(response, 'Не вдалося надіслати код підтвердження.')
    throw new ApiRequestError(details.message, {
      status: response.status,
      code: details.code,
      retryAfterSeconds: details.retryAfterSeconds,
    })
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

export async function sendCustomerPhoneLoginCode(phone: string) {
  const response = await fetch(`${getBaseUrl()}/auth/customer/phone/login/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  })

  if (!response.ok) {
    const details = await parseApiErrorDetails(response, 'Не вдалося надіслати код для входу.')
    throw new ApiRequestError(details.message, {
      status: response.status,
      code: details.code,
      retryAfterSeconds: details.retryAfterSeconds,
    })
  }

  return response.json() as Promise<CustomerVerifySendResponse>
}

export async function confirmCustomerPhoneLoginCode(payload: { phone: string; code: string }) {
  const response = await fetch(`${getBaseUrl()}/auth/customer/phone/login/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Не вдалося увійти за кодом.'))
  }

  return response.json() as Promise<AuthSession>
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
  const response = await fetchApi(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/profile`, {
    headers: providerHeaders(providerToken),
  })

  if (!response.ok) {
    throw new ApiRequestError(await parseApiError(response, `Provider profile request failed with ${response.status}`), {
      status: response.status,
    })
  }

  return response.json() as Promise<ProviderAvailability>
}

export async function getProviderPublicProfile(providerId: string, limit = 20, signal?: AbortSignal) {
  const response = await fetch(
    `${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/public?limit=${encodeURIComponent(String(limit))}`,
    signal ? { signal } : undefined,
  )

  if (!response.ok) {
    throw new Error(await parseApiError(response, `Provider public profile failed with ${response.status}`))
  }

  return response.json() as Promise<ProviderPublicProfile>
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

export async function acceptProviderOffer(
  providerId: string,
  offerId: string,
  providerToken?: string,
  payload?: { proposedPrice: number; priceNote?: string },
) {
  const response = await fetchApi(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/offers/${encodeURIComponent(offerId)}/accept`, {
    method: 'POST',
    headers: providerJsonHeaders(providerToken),
    body: JSON.stringify({
      proposedPrice: payload?.proposedPrice,
      priceNote: payload?.priceNote,
    }),
  })

  if (!response.ok) {
    const parsed = await parseApiErrorDetails(response, 'Не вдалося прийняти заявку.')
    throw Object.assign(new Error(parsed.message), { status: response.status, detail: parsed.code ? { code: parsed.code, message: parsed.message } : parsed.message })
  }

  return response.json() as Promise<{ offer: DispatchOffer; order: OrderResponse; provider: ProviderAvailability }>
}

export async function declineProviderOffer(providerId: string, offerId: string, providerToken?: string) {
  const response = await fetchApi(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/offers/${encodeURIComponent(offerId)}/decline`, {
    method: 'POST',
    headers: providerHeaders(providerToken),
  })

  if (!response.ok) {
    const parsed = await parseApiErrorDetails(response, 'Не вдалося пропустити заявку.')
    throw Object.assign(new Error(parsed.message), { status: response.status, detail: parsed.code ? { code: parsed.code, message: parsed.message } : parsed.message })
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
    let detail: string | undefined
    try {
      const error = await response.json()
      detail = typeof error?.detail === 'string' ? error.detail : undefined
    } catch {
      detail = undefined
    }
    const message =
      (detail && providerErrorMessages[detail]) ||
      (detail && /[А-Яа-яІіЇїЄєҐґ]/.test(detail) ? detail : undefined) ||
      "Не вдалося оновити статус. Перевірте з'єднання."
    throw Object.assign(new Error(message), { status: response.status, detail })
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
  vehicleMake?: string
  vehicleModel?: string
  plate?: string
  city?: string
  specialties: string[]
  serviceRadiusKm: number
  location?: { lat: number; lng: number }
}, providerToken?: string) {
  const response = await fetchApi(`${getBaseUrl()}/providers/${encodeURIComponent(providerId)}/profile`, {
    method: 'PATCH',
    headers: providerJsonHeaders(providerToken),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const details = await parseApiErrorDetails(response, "Не вдалося зберегти профіль партнера.")
    throw new ApiRequestError(details.message, {
      status: response.status,
      code: details.code,
    })
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
