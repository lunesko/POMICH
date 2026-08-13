import type { DispatchOffer, MapRequestPin } from "../api/client"
import { parseApiDateMs } from "./auth"

/** Fallback when backend omits expiresAt — must stay >0 so UI does not treat offer as expired. */
export const DEFAULT_OFFER_SECONDS_LEFT = 90

export function isOfferActive(offer: DispatchOffer, nowMs = Date.now()): boolean {
  if (!offer.expiresAt) return true
  const expiresMs = parseApiDateMs(offer.expiresAt)
  if (!Number.isFinite(expiresMs)) return true
  return expiresMs > nowMs
}

export function offerSecondsLeft(offer: DispatchOffer | undefined, nowMs = Date.now()): number {
  if (!offer) return 0
  if (!offer.expiresAt) return DEFAULT_OFFER_SECONDS_LEFT
  const expiresMs = parseApiDateMs(offer.expiresAt)
  if (!Number.isFinite(expiresMs)) return DEFAULT_OFFER_SECONDS_LEFT
  return Math.max(0, Math.ceil((expiresMs - nowMs) / 1000))
}

export function pinFromOffer(offer: DispatchOffer): MapRequestPin {
  return {
    id: offer.orderId,
    offerId: offer.id,
    service: offer.service,
    vehicleState: offer.vehicleState,
    customerComment: offer.customerComment,
    customerLocation: offer.approximateLocation,
    customerCoordinates: offer.customerCoordinates,
    distanceKm: offer.distanceKm,
    etaMinutes: offer.etaMinutes,
  }
}

export function filterActiveOffers(offers: DispatchOffer[], nowMs = Date.now()): DispatchOffer[] {
  return offers.filter((offer) => isOfferActive(offer, nowMs))
}
