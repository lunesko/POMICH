import { describe, expect, it } from "vitest"

import { distanceMeters, MAP_FLY_THRESHOLD_M, MAP_RECENTER_THRESHOLD_M, shouldRecenterMap } from "./mapGeo"

describe("mapGeo", () => {
  const uzhgorodCenter = { lat: 48.6208, lng: 22.2879 }

  it("computes distance in meters", () => {
    const nearby = { lat: 48.621, lng: 22.288 }
    expect(distanceMeters(uzhgorodCenter, nearby)).toBeGreaterThan(0)
    expect(distanceMeters(uzhgorodCenter, nearby)).toBeLessThan(MAP_RECENTER_THRESHOLD_M)
  })

  it("respects recenter threshold", () => {
    const tinyMove = { lat: 48.62081, lng: 22.28791 }
    const largeMove = { lat: 48.625, lng: 22.295 }

    expect(shouldRecenterMap(uzhgorodCenter, tinyMove)).toBe(false)
    expect(shouldRecenterMap(uzhgorodCenter, largeMove)).toBe(true)
  })

  it("defines fly threshold above recenter threshold", () => {
    expect(MAP_FLY_THRESHOLD_M).toBeGreaterThan(MAP_RECENTER_THRESHOLD_M)
  })
})
