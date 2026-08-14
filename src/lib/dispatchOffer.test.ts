import { describe, expect, it } from "vitest"

import type { DispatchOffer } from "../api/client"
import {
  filterActiveMapRequestPins,
  filterActiveOffers,
  filterVisibleOffers,
  isMapRequestPinActive,
  isOfferActive,
  isPresentableOffer,
  mergeRequestPins,
  offerActionErrorMessage,
  offerSecondsLeft,
  parseOfferPrice,
  pinFromOffer,
  pinsFromActiveOffers,
  readPersistedOfferDismissals,
  writePersistedOfferDismissals,
} from "./dispatchOffer"

const baseOffer: DispatchOffer = {
  id: "OF-TEST",
  orderId: "ORD-1",
  providerId: "provider-1",
  status: "pending",
  service: "tow",
  distanceKm: 4.2,
  expiresAt: new Date(Date.now() + 15000).toISOString(),
}

describe("dispatchOffer helpers", () => {
  it("detects active and expired offers", () => {
    expect(isOfferActive(baseOffer)).toBe(true)
    expect(isOfferActive({ ...baseOffer, expiresAt: new Date(Date.now() - 1000).toISOString() })).toBe(false)
    expect(offerSecondsLeft(baseOffer)).toBeGreaterThan(0)
    expect(offerSecondsLeft({ ...baseOffer, expiresAt: new Date(Date.now() - 1000).toISOString() })).toBe(0)
  })

  it("keeps offers without expiresAt acceptible (not auto-expired)", () => {
    const openEnded = { ...baseOffer, expiresAt: undefined }
    expect(isOfferActive(openEnded)).toBe(true)
    expect(offerSecondsLeft(openEnded)).toBeGreaterThan(0)
    expect(offerSecondsLeft({ ...baseOffer, expiresAt: "not-a-date" })).toBeGreaterThan(0)
  })

  it("builds a map pin from an offer", () => {
    expect(pinFromOffer(baseOffer)).toMatchObject({
      id: "ORD-1",
      offerId: "OF-TEST",
      service: "tow",
      status: "searching",
      distanceKm: 4.2,
    })
  })

  it("filters non-pending offers from partner queue", () => {
    const offers = [
      baseOffer,
      { ...baseOffer, id: "OF-ACCEPTED", status: "accepted" as const },
      { ...baseOffer, id: "OF-LOST", status: "lost" as const },
    ]
    expect(filterActiveOffers(offers)).toHaveLength(1)
    expect(filterActiveOffers(offers)[0]?.id).toBe("OF-TEST")
  })

  it("filters expired offers out of polling results", () => {
    const offers = [
      baseOffer,
      { ...baseOffer, id: "OF-OLD", expiresAt: new Date(Date.now() - 1000).toISOString() },
    ]
    expect(filterActiveOffers(offers)).toHaveLength(1)
    expect(filterActiveOffers(offers)[0]?.id).toBe("OF-TEST")
    expect(isPresentableOffer({ ...baseOffer, status: "declined" })).toBe(false)
  })

  it("hides offers for completed or cancelled parent orders", () => {
    expect(isPresentableOffer({ ...baseOffer, orderStatus: "completed" })).toBe(false)
    expect(isPresentableOffer({ ...baseOffer, orderStatus: "cancelled" })).toBe(false)
    expect(isPresentableOffer({ ...baseOffer, orderStatus: "searching" })).toBe(true)
    const offers = [
      baseOffer,
      { ...baseOffer, id: "OF-DONE", orderStatus: "completed" },
    ]
    expect(filterActiveOffers(offers)).toHaveLength(1)
  })

  it("builds map pins only from active offers", () => {
    const offers = [
      baseOffer,
      { ...baseOffer, id: "OF-OLD", orderId: "ORD-OLD", expiresAt: new Date(Date.now() - 1000).toISOString() },
    ]
    const pins = pinsFromActiveOffers(offers)
    expect(pins).toHaveLength(1)
    expect(pins[0]?.offerId).toBe("OF-TEST")
    expect(pins[0]?.id).toBe("ORD-1")
  })

  it("merges nearby searching orders with dispatched offers", () => {
    const nearby = [
      { id: "ORD-1", service: "tow", customerCoordinates: { lat: 48.62, lng: 22.28 }, distanceKm: 1.1 },
      { id: "ORD-NEAR", service: "battery", customerCoordinates: { lat: 48.63, lng: 22.27 }, distanceKm: 2.4 },
    ]
    const merged = mergeRequestPins([baseOffer], nearby)
    expect(merged).toHaveLength(2)
    expect(merged.find((pin) => pin.id === "ORD-1")?.offerId).toBe("OF-TEST")
    expect(merged.find((pin) => pin.id === "ORD-NEAR")?.offerId).toBeUndefined()
  })

  it("drops completed, cancelled, and other terminal nearby orders from map pins", () => {
    expect(isMapRequestPinActive({ status: "searching" })).toBe(true)
    expect(isMapRequestPinActive({ status: "accepted" })).toBe(true)
    expect(isMapRequestPinActive({ status: "en_route" })).toBe(true)
    expect(isMapRequestPinActive({ status: "completed" })).toBe(false)
    expect(isMapRequestPinActive({ status: "cancelled" })).toBe(false)
    expect(isMapRequestPinActive({ status: "canceled" })).toBe(false)
    expect(isMapRequestPinActive({ status: "expired" })).toBe(false)
    expect(isMapRequestPinActive({ status: "draft" })).toBe(false)

    const nearby = [
      { id: "ORD-LIVE", service: "tow", status: "searching", customerCoordinates: { lat: 48.62, lng: 22.28 } },
      { id: "ORD-DONE", service: "tow", status: "completed", customerCoordinates: { lat: 48.63, lng: 22.27 } },
      { id: "ORD-CANCEL", service: "tow", status: "cancelled", customerCoordinates: { lat: 48.61, lng: 22.29 } },
      { id: "ORD-OLD", service: "tow", status: "expired", customerCoordinates: { lat: 48.64, lng: 22.26 } },
    ]
    const merged = mergeRequestPins([], nearby)
    expect(merged.map((pin) => pin.id)).toEqual(["ORD-LIVE"])
    expect(filterActiveMapRequestPins(nearby).map((pin) => pin.id)).toEqual(["ORD-LIVE"])
  })

  it("hides dismissed offers and parses price", () => {
    expect(parseOfferPrice("15000")).toBe(15000)
    expect(parseOfferPrice("")).toBeUndefined()
    const visible = filterVisibleOffers(
      [baseOffer, { ...baseOffer, id: "OF-SKIP", orderId: "ORD-SKIP" }],
      { dismissedOfferIds: new Set(["OF-SKIP"]), dismissedOrderIds: new Set(["ORD-SKIP"]) },
    )
    expect(visible).toHaveLength(1)
    expect(visible[0]?.id).toBe("OF-TEST")
    expect(offerActionErrorMessage({ detail: { code: "OFFER_EXPIRED" } })).toMatch(/завершилась/i)
  })

  it("persists dismissed offer ids per provider", () => {
    writePersistedOfferDismissals("provider-1", ["OF-A"], ["ORD-A"])
    expect(readPersistedOfferDismissals("provider-1")).toEqual({ offerIds: ["OF-A"], orderIds: ["ORD-A"] })
  })
})
