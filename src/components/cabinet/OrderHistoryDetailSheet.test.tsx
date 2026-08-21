import { describe, expect, it } from "vitest"

import type { OrderResponse } from "../../api/client"
import {
  estimatePartnerApproachPoint,
  formatOrderDuration,
  resolveHistoryRoutePoints,
} from "./OrderHistoryDetailSheet"

function baseOrder(overrides: Partial<OrderResponse> = {}): OrderResponse {
  return {
    id: "ord_1",
    status: "completed",
    createdAt: "2026-08-21T07:09:00.000Z",
    service: "mechanic",
    ...overrides,
  }
}

describe("formatOrderDuration", () => {
  it("formats minutes between accepted and completed", () => {
    expect(
      formatOrderDuration({
        acceptedAt: "2026-08-21T10:00:00.000Z",
        statusHistory: [{ status: "completed", at: "2026-08-21T10:42:00.000Z" }],
        status: "completed",
      }),
    ).toBe("42 хв")
  })

  it("formats hours when longer than an hour", () => {
    expect(
      formatOrderDuration({
        createdAt: "2026-08-21T10:00:00.000Z",
        cancelledAt: "2026-08-21T12:15:00.000Z",
        status: "cancelled",
      }),
    ).toBe("2 год 15 хв")
  })

  it("returns undefined without usable timestamps", () => {
    expect(formatOrderDuration({ status: "completed" })).toBeUndefined()
  })
})

describe("resolveHistoryRoutePoints", () => {
  it("uses stored provider location as partner point A", () => {
    const points = resolveHistoryRoutePoints(
      baseOrder({
        customerCoordinates: { lat: 50.45, lng: 30.52 },
        assignedProvider: {
          id: "p1",
          name: "Partner",
          status: "online",
          location: { lat: 50.46, lng: 30.53 },
        },
      }),
    )
    expect(points.client).toEqual({ lat: 50.45, lng: 30.52 })
    expect(points.partner).toEqual({ lat: 50.46, lng: 30.53 })
    expect(points.partnerEstimated).toBe(false)
  })

  it("estimates partner approach from distanceKm when GPS missing", () => {
    const points = resolveHistoryRoutePoints(
      baseOrder({
        customerCoordinates: { lat: 50.45, lng: 30.52 },
        distanceKm: 0.5,
      }),
    )
    expect(points.client).toEqual({ lat: 50.45, lng: 30.52 })
    expect(points.partner).toEqual(estimatePartnerApproachPoint({ lat: 50.45, lng: 30.52 }, 0.5))
    expect(points.partnerEstimated).toBe(true)
  })

  it("prefers assignedProvider.distanceKm for estimation", () => {
    const points = resolveHistoryRoutePoints(
      baseOrder({
        customerCoordinates: { lat: 50.45, lng: 30.52 },
        distanceKm: 9,
        assignedProvider: { id: "p1", name: "Partner", status: "online", distanceKm: 0.5 },
      }),
    )
    expect(points.partner).toEqual(estimatePartnerApproachPoint({ lat: 50.45, lng: 30.52 }, 0.5))
    expect(points.partnerEstimated).toBe(true)
  })

  it("keeps destination when no partner point can be resolved", () => {
    const points = resolveHistoryRoutePoints(
      baseOrder({
        customerCoordinates: { lat: 50.45, lng: 30.52 },
        destinationCoordinates: { lat: 50.47, lng: 30.55 },
      }),
    )
    expect(points.partner).toBeUndefined()
    expect(points.destination).toEqual({ lat: 50.47, lng: 30.55 })
    expect(points.partnerEstimated).toBe(false)
  })
})
