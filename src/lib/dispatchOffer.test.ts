import { describe, expect, it } from "vitest"

import type { DispatchOffer } from "../api/client"
import { filterActiveOffers, isOfferActive, offerSecondsLeft, pinFromOffer } from "./dispatchOffer"

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
      distanceKm: 4.2,
    })
  })

  it("filters expired offers out of polling results", () => {
    const offers = [
      baseOffer,
      { ...baseOffer, id: "OF-OLD", expiresAt: new Date(Date.now() - 1000).toISOString() },
    ]
    expect(filterActiveOffers(offers)).toHaveLength(1)
    expect(filterActiveOffers(offers)[0]?.id).toBe("OF-TEST")
  })
})
