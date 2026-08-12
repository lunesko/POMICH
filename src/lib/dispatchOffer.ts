import type { DispatchOffer, MapRequestPin } from "../api/client"
import { parseApiDateMs } from "./auth"

export function isOfferActive(offer: DispatchOffer, nowMs = Date.now()): boolean {
  if (!offer.expiresAt) return true
  const expiresMs = parseApiDateMs(offer.expiresAt)
  return Number.isFinite(expiresMs) && expiresMs > nowMs
}

export function offerSecondsLeft(offer: DispatchOffer | undefined, nowMs = Date.now()): number {
  if (!offer?.expiresAt) return 0
  const expiresMs = parseApiDateMs(offer.expiresAt)
  if (!Number.isFinite(expiresMs)) return 0
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
