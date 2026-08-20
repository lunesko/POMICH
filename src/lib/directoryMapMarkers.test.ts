import { describe, expect, it } from "vitest"

import type { ProviderAvailability } from "../api/client"
import {
  directoryMaxMarkersForZoom,
  selectDirectoryProvidersForRender,
} from "../components/map/RouteMap"

function mockProvider(id: string, lat: number, lng: number): ProviderAvailability {
  return {
    id,
    name: `Provider ${id}`,
    providerKind: "directory",
    contactStatus: "directory_only",
    location: { lat, lng },
    specialties: ["mechanic"],
    status: "offline",
  }
}

function mockMap(zoom: number, south: number, west: number, north: number, east: number) {
  const bounds = {
    getSouth: () => south,
    getWest: () => west,
    getNorth: () => north,
    getEast: () => east,
    pad: () => bounds,
    contains: ([lat, lng]: [number, number]) => lat >= south && lat <= north && lng >= west && lng <= east,
  }
  return {
    getZoom: () => zoom,
    getBounds: () => bounds,
  }
}

describe("directoryMaxMarkersForZoom", () => {
  it("allows more markers at city zoom than country zoom", () => {
    expect(directoryMaxMarkersForZoom(6)).toBeLessThan(directoryMaxMarkersForZoom(12))
  })

  it("uses regional and city caps", () => {
    expect(directoryMaxMarkersForZoom(7)).toBe(80)
    expect(directoryMaxMarkersForZoom(9)).toBe(100)
    expect(directoryMaxMarkersForZoom(12)).toBe(140)
  })
})

describe("selectDirectoryProvidersForRender", () => {
  it("keeps all viewport providers at city zoom when under cap", () => {
    const providers = Array.from({ length: 90 }, (_, index) =>
      mockProvider(String(index), 48.62 + index * 0.001, 22.28),
    )
    const map = mockMap(12, 48.5, 22.0, 48.8, 22.5)
    const visible = selectDirectoryProvidersForRender(providers, map as never)
    expect(visible.length).toBe(90)
  })

  it("samples only within viewport at regional zoom, not globally", () => {
    const westUkraine = Array.from({ length: 300 }, (_, index) =>
      mockProvider(`w-${index}`, 48.6 + (index % 20) * 0.002, 22.2 + Math.floor(index / 20) * 0.01),
    )
    const eastUkraine = Array.from({ length: 300 }, (_, index) =>
      mockProvider(`e-${index}`, 48.6 + (index % 20) * 0.002, 36.2 + Math.floor(index / 20) * 0.01),
    )
    const providers = [...westUkraine, ...eastUkraine]
    const map = mockMap(9, 48.4, 22.0, 48.9, 22.6)
    const visible = selectDirectoryProvidersForRender(providers, map as never)
    expect(visible.length).toBeLessThanOrEqual(100)
    expect(visible.every((item) => String(item.id).startsWith("w-"))).toBe(true)
  })
})
