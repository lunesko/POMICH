import { describe, expect, it } from "vitest"

import type { MapSettlement } from "../api/client"
import type { ProviderAvailability } from "../api/client"
import { isDirectoryMapProvider } from "./constants"
import {
  directoryScopeMapTarget,
  nearestSettlementFromList,
  validateGeoForDirectory,
} from "./directoryScope"

const sampleSettlements: MapSettlement[] = [
  { id: "uzhhorod", name: "Ужгород", center: { lat: 48.6208, lng: 22.2879 } },
  { id: "kyiv", name: "Київ", center: { lat: 50.4501, lng: 30.5234 } },
]

describe("directoryScope", () => {
  it("picks nearest settlement by center distance", () => {
    const nearest = nearestSettlementFromList(sampleSettlements, 48.62, 22.29)
    expect(nearest?.name).toBe("Ужгород")
  })

  it("returns Ukraine-wide map target for all-ukraine scope", () => {
    expect(directoryScopeMapTarget("all-ukraine", null).zoom).toBe(6)
  })

  it("returns city zoom for my-city scope", () => {
    const target = directoryScopeMapTarget("my-city", { lat: 50.45, lng: 30.52 })
    expect(target.zoom).toBe(13)
    expect(target.lat).toBe(50.45)
  })

  it("blocks occupied coordinates for directory geo", () => {
    expect(validateGeoForDirectory(45.0, 34.0)).toBeTruthy()
    expect(validateGeoForDirectory(48.62, 22.29)).toBeUndefined()
  })

  it("treats legacy map rows as directory providers", () => {
    const legacy = {
      id: "legacy",
      name: "Legacy",
      status: "offline",
      address: "Some street",
      location: { lat: 50.45, lng: 30.52 },
    } satisfies ProviderAvailability
    expect(isDirectoryMapProvider(legacy)).toBe(true)
    expect(isDirectoryMapProvider({ ...legacy, providerKind: "dispatch" })).toBe(false)
  })
})
