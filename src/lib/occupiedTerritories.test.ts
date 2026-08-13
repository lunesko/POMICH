import { describe, expect, it } from "vitest"

import { isOccupiedCoordinates, occupiedZoneName } from "./occupiedTerritories"

describe("occupiedTerritories", () => {
  it("flags Simferopol (Crimea) as occupied", () => {
    expect(isOccupiedCoordinates(44.95, 34.1)).toBe(true)
    expect(occupiedZoneName(44.95, 34.1)).toBe("crimea")
  })

  it("allows Kyiv and Uzhhorod", () => {
    expect(isOccupiedCoordinates(50.45, 30.52)).toBe(false)
    expect(isOccupiedCoordinates(48.62, 22.29)).toBe(false)
  })

  it("allows government-controlled Zaporizhzhia city", () => {
    expect(isOccupiedCoordinates(47.84, 35.14)).toBe(false)
  })
})
