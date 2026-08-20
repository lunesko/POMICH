import type { DispatchOffer, MapRequestPin } from "../api/client"
import { parseApiDateMs } from "./auth"
import { ACTIVE_ORDER_STATUSES, TERMINAL_ORDER_STATUSES as SESSION_TERMINAL_STATUSES } from "./customerSession"

/** Fallback when backend omits expiresAt — must stay >0 so UI does not treat offer as expired. */
export const DEFAULT_OFFER_SECONDS_LEFT = 90
/** Accepted order idle window before auto-cancel (must match backend ACCEPTED_IDLE_TIMEOUT_SECONDS). */
export const DEFAULT_ACCEPTED_IDLE_SECONDS = 900

const OFFER_CONFLICT_MESSAGES: Record<string, string> = {
  PRICE_REQUIRED: "Вкажіть вартість послуги в гривнях.",
  OFFER_EXPIRED: "Пропозиція вже завершилась. Очікуйте нову заявку.",
  OFFER_DECLINED: "Цю пропозицію вже пропущено.",
  OFFER_NOT_FOUND: "Пропозицію не знайдено. Оновіть список заявок.",
  ORDER_ALREADY_ACCEPTED: "Замовлення вже прийняв інший виконавець.",
  ORDER_NOT_FOUND: "Заявку не знайдено.",
  ORDER_ACCEPTED_TIMEOUT: "Заявку скасовано: не підтверджено протягом 15 хвилин.",
  PROVIDER_NOT_VERIFIED: "Підтвердіть телефон, щоб приймати заявки.",
  provider_identity_mismatch: "Акаунт партнера не збігається. Оновіть сторінку та спробуйте ще раз.",
  provider_session_required: "Потрібен вхід партнера. Оновіть сторінку.",
  provider_session_invalid: "Сесію партнера не відкрито. Оновіть сторінку.",
  provider_session_expired: "Сесія партнера закінчилась. Оновіть сторінку.",
}

const DISMISSED_OFFERS_STORAGE_PREFIX = "pomichDismissedOffers:"

export interface PersistedOfferDismissals {
  offerIds: string[]
  orderIds: string[]
}

export function dismissedOffersStorageKey(providerId: string): string {
  return `${DISMISSED_OFFERS_STORAGE_PREFIX}${providerId}`
}

export function readPersistedOfferDismissals(providerId: string): PersistedOfferDismissals {
  if (typeof window === "undefined" || !providerId) {
    return { offerIds: [], orderIds: [] }
  }
  try {
    const raw = window.localStorage.getItem(dismissedOffersStorageKey(providerId))
    if (!raw) return { offerIds: [], orderIds: [] }
    const parsed = JSON.parse(raw) as Partial<PersistedOfferDismissals>
    return {
      offerIds: Array.isArray(parsed.offerIds) ? parsed.offerIds.map(String) : [],
      orderIds: Array.isArray(parsed.orderIds) ? parsed.orderIds.map(String) : [],
    }
  } catch {
    return { offerIds: [], orderIds: [] }
  }
}

export function writePersistedOfferDismissals(providerId: string, offerIds: Iterable<string>, orderIds: Iterable<string>) {
  if (typeof window === "undefined" || !providerId) return
  const payload: PersistedOfferDismissals = {
    offerIds: [...new Set([...offerIds].map(String).filter(Boolean))].slice(-200),
    orderIds: [...new Set([...orderIds].map(String).filter(Boolean))].slice(-200),
  }
  window.localStorage.setItem(dismissedOffersStorageKey(providerId), JSON.stringify(payload))
}

export function isOfferActive(offer: DispatchOffer, nowMs = Date.now()): boolean {
  if (!offer.expiresAt) return true
  const expiresMs = parseApiDateMs(offer.expiresAt)
  if (!Number.isFinite(expiresMs)) return true
  return expiresMs > nowMs
}

const TERMINAL_ORDER_STATUSES = new Set(["completed", "cancelled", "expired", "draft", ...SESSION_TERMINAL_STATUSES])

export function isMapRequestPinActive(pin: Pick<MapRequestPin, "status">): boolean {
  const status = String(pin.status || "").trim().toLowerCase()
  if (!status) return true
  if (TERMINAL_ORDER_STATUSES.has(status) || status === "canceled") return false
  return ACTIVE_ORDER_STATUSES.has(status)
}

export const isOpenRequestPin = isMapRequestPinActive

export function filterActiveMapRequestPins(pins: MapRequestPin[]): MapRequestPin[] {
  return pins.filter((pin) => Boolean(pin.id && pin.customerCoordinates) && isMapRequestPinActive(pin))
}

/** Only pending, unexpired offers for still-searching orders belong in partner duty UI. */
export function isPresentableOffer(offer: DispatchOffer, nowMs = Date.now()): boolean {
  const status = String(offer.status || "pending").trim().toLowerCase()
  if (status !== "pending") return false
  const orderStatus = String(offer.orderStatus || "searching").trim().toLowerCase()
  if (TERMINAL_ORDER_STATUSES.has(orderStatus) || orderStatus !== "searching") return false
  return isOfferActive(offer, nowMs)
}

export function offerSecondsLeft(offer: DispatchOffer | undefined, nowMs = Date.now()): number {
  if (!offer) return 0
  if (!offer.expiresAt) return DEFAULT_OFFER_SECONDS_LEFT
  const expiresMs = parseApiDateMs(offer.expiresAt)
  if (!Number.isFinite(expiresMs)) return DEFAULT_OFFER_SECONDS_LEFT
  return Math.max(0, Math.ceil((expiresMs - nowMs) / 1000))
}

export function acceptedIdleSecondsLeft(
  order: { acceptedAt?: string; acceptedIdleExpiresAt?: string; acceptedIdleTimeoutSeconds?: number; status?: string } | undefined,
  nowMs = Date.now(),
): number {
  if (!order) return 0
  const status = String(order.status || "").trim().toLowerCase()
  if (status && status !== "accepted") return 0
  if (order.acceptedIdleExpiresAt) {
    const expiresMs = parseApiDateMs(order.acceptedIdleExpiresAt)
    if (Number.isFinite(expiresMs)) return Math.max(0, Math.ceil((expiresMs - nowMs) / 1000))
  }
  const acceptedMs = parseApiDateMs(order.acceptedAt)
  if (!Number.isFinite(acceptedMs)) return 0
  const timeoutSec = Number(order.acceptedIdleTimeoutSeconds)
  const windowSec = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : DEFAULT_ACCEPTED_IDLE_SECONDS
  return Math.max(0, Math.ceil((acceptedMs + windowSec * 1000 - nowMs) / 1000))
}

export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

export function pinFromOffer(offer: DispatchOffer): MapRequestPin {
  return {
    id: offer.orderId,
    offerId: offer.id,
    service: offer.service,
    status: offer.orderStatus || "searching",
    vehicleState: offer.vehicleState,
    customerComment: offer.customerComment,
    customerLocation: offer.approximateLocation,
    customerCoordinates: offer.customerCoordinates,
    distanceKm: offer.distanceKm,
    etaMinutes: offer.etaMinutes,
  }
}

export function filterActiveOffers(offers: DispatchOffer[], nowMs = Date.now()): DispatchOffer[] {
  return offers.filter((offer) => isPresentableOffer(offer, nowMs))
}

export type OfferDismissFilter = {
  dismissedOfferIds?: ReadonlySet<string>
  dismissedOrderIds?: ReadonlySet<string>
}

/** Hide skipped/declined/completed orders client-side until poll confirms removal. */
export function filterVisibleOffers(
  offers: DispatchOffer[],
  filter: OfferDismissFilter = {},
  nowMs = Date.now(),
): DispatchOffer[] {
  const { dismissedOfferIds, dismissedOrderIds } = filter
  return filterActiveOffers(offers, nowMs).filter((offer) => {
    if (dismissedOfferIds?.has(offer.id)) return false
    if (dismissedOrderIds?.has(offer.orderId)) return false
    return true
  })
}

/** Partner duty map: only active offers become request pins (expired/closed never appear). */
export function pinsFromActiveOffers(offers: DispatchOffer[], nowMs = Date.now()): MapRequestPin[] {
  return filterActiveOffers(offers, nowMs).map(pinFromOffer)
}

/** Merge dispatched offers with nearby searching orders (offers win on duplicate order ids). */
export function mergeRequestPins(
  offers: DispatchOffer[],
  nearbyOrders: MapRequestPin[],
  filter: OfferDismissFilter = {},
  nowMs = Date.now(),
): MapRequestPin[] {
  const fromOffers = pinsFromActiveOffers(filterVisibleOffers(offers, filter, nowMs), nowMs)
  const coveredOrderIds = new Set(fromOffers.map((pin) => pin.id))
  const extras = filterActiveMapRequestPins(nearbyOrders).filter((pin) => {
    if (coveredOrderIds.has(pin.id)) return false
    if (filter.dismissedOrderIds?.has(pin.id)) return false
    return true
  })
  return [...fromOffers, ...extras]
}

export function parseOfferPrice(value: string): number | undefined {
  const parsed = Number(value.replace(",", ".").trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

export function offerActionErrorMessage(error: unknown, fallback = "Не вдалося виконати дію. Спробуйте ще раз."): string {
  const detail = (error as { detail?: string | { code?: string; message?: string } }).detail
  if (typeof detail === "string") {
    return OFFER_CONFLICT_MESSAGES[detail] ?? detail
  }
  if (detail && typeof detail === "object") {
    const code = detail.code
    if (code && OFFER_CONFLICT_MESSAGES[code]) return OFFER_CONFLICT_MESSAGES[code]
    if (typeof detail.message === "string" && detail.message.trim()) return detail.message
    if (code) return OFFER_CONFLICT_MESSAGES[code] ?? code
  }
  if (error instanceof Error && error.message && !/failed with \d+/i.test(error.message)) {
    return error.message
  }
  return fallback
}
