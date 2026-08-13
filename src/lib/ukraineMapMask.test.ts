import { describe, expect, it } from "vitest"

import { collectExteriorRings, UKRAINE_MAP_STYLES } from "./ukraineMapMask"

describe("ukraineMapMask", () => {
  it("collects exterior rings from polygon geometry", () => {
    const border = {
      type: "Feature" as const,
      properties: { name: "Ukraine" },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [22, 48],
            [23, 48],
            [23, 49],
            [22, 49],
            [22, 48],
          ],
        ],
      },
    }
    const rings = collectExteriorRings(border.geometry)
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(5)
  })

  it("keeps only subtle occupied overlay styles", () => {
    expect(UKRAINE_MAP_STYLES.occupied.fillColor).toBe("#9A5050")
    expect(UKRAINE_MAP_STYLES.occupied.fillOpacity).toBeLessThanOrEqual(0.2)
    expect(UKRAINE_MAP_STYLES.occupied.weight).toBe(0)
  })
})
