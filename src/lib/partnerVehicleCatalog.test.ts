import { describe, expect, it } from "vitest"

import { partnerVehicleMakes, PARTNER_VEHICLE_MAKE_OTHER } from "./constants"
import {
  PARTNER_VEHICLE_MODEL_OTHER,
  getModelsForMake,
  isKnownPartnerVehicleModel,
  partnerVehicleCatalog,
  partnerVehicleCatalogCoversKnownMakes,
  partnerVehicleCatalogStats,
  resolvePartnerVehicleModelSelectValue,
} from "./partnerVehicleCatalog"

describe("partnerVehicleCatalog", () => {
  it("covers every known make except «Інше»", () => {
    expect(partnerVehicleCatalogCoversKnownMakes()).toBe(true)
  })

  it("has 25+ makes with multiple models each", () => {
    const { makes, models } = partnerVehicleCatalogStats()
    expect(makes).toBeGreaterThanOrEqual(25)
    expect(models).toBeGreaterThanOrEqual(150)
    for (const list of Object.values(partnerVehicleCatalog)) {
      expect(list.length).toBeGreaterThanOrEqual(5)
    }
  })

  it("returns models for Volkswagen and empty for «Інше»", () => {
    expect(getModelsForMake("Volkswagen")).toContain("Transporter")
    expect(getModelsForMake(PARTNER_VEHICLE_MAKE_OTHER)).toEqual([])
    expect(getModelsForMake("")).toEqual([])
  })

  it("recognizes catalog models and resolves select value", () => {
    expect(isKnownPartnerVehicleModel("Ford", "Transit")).toBe(true)
    expect(isKnownPartnerVehicleModel("Ford", "Custom Van")).toBe(false)
    expect(resolvePartnerVehicleModelSelectValue("Ford", "Transit")).toBe("Transit")
    expect(resolvePartnerVehicleModelSelectValue("Ford", "Custom Van")).toBe(PARTNER_VEHICLE_MODEL_OTHER)
    expect(resolvePartnerVehicleModelSelectValue("Ford", "")).toBe("")
  })

  it("aligns catalog keys with partnerVehicleMakes", () => {
    const catalogMakes = new Set(Object.keys(partnerVehicleCatalog))
    const knownMakes = partnerVehicleMakes.filter((make) => make !== PARTNER_VEHICLE_MAKE_OTHER)
    expect(knownMakes.every((make) => catalogMakes.has(make))).toBe(true)
  })
})
