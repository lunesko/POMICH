import { describe, expect, it } from "vitest"

import {
  PARTNER_VEHICLE_MAKE_OTHER,
  composePartnerVehicle,
  hydratePartnerVehicleFromProfile,
  isProviderAvailable,
  normalizeTelegramHref,
  partnerVehicleMakes,
  partnerVehicleSelectionIsComplete,
  resolvePartnerVehicleMake,
} from "./constants"
import type { ProviderAvailability } from "../api/client"

describe("partnerVehicleMakes", () => {
  it("lists common roadside brands alphabetically with Інше last", () => {
    expect(partnerVehicleMakes.length).toBeGreaterThanOrEqual(25)
    expect(partnerVehicleMakes.at(-1)).toBe(PARTNER_VEHICLE_MAKE_OTHER)
    expect(partnerVehicleMakes).toContain("Volkswagen")
    expect(partnerVehicleMakes).toContain("Mercedes Sprinter")
    expect(partnerVehicleMakes).toContain("Renault Master")
    expect(partnerVehicleMakes).toContain("Scania")
  })
})

describe("composePartnerVehicle", () => {
  it("combines known make and optional model", () => {
    expect(composePartnerVehicle("Volkswagen", "Transporter")).toBe("Volkswagen Transporter")
    expect(composePartnerVehicle("Ford", "")).toBe("Ford")
  })

  it("uses custom make when Інше is selected", () => {
    expect(composePartnerVehicle(PARTNER_VEHICLE_MAKE_OTHER, "Sens", "ZAZ")).toBe("ZAZ Sens")
    expect(resolvePartnerVehicleMake(PARTNER_VEHICLE_MAKE_OTHER, "ГАЗ")).toBe("ГАЗ")
  })
})

describe("partnerVehicleSelectionIsComplete", () => {
  it("requires custom make for Інше", () => {
    expect(partnerVehicleSelectionIsComplete("Volkswagen")).toBe(true)
    expect(partnerVehicleSelectionIsComplete(PARTNER_VEHICLE_MAKE_OTHER)).toBe(false)
    expect(partnerVehicleSelectionIsComplete(PARTNER_VEHICLE_MAKE_OTHER, "ZAZ")).toBe(true)
  })
})

describe("hydratePartnerVehicleFromProfile", () => {
  it("restores known make and model from profile fields", () => {
    expect(hydratePartnerVehicleFromProfile({
      vehicle: "Volkswagen Transporter",
      vehicleMake: "Volkswagen",
      vehicleModel: "Transporter",
    })).toEqual({
      vehicleMake: "Volkswagen",
      vehicleMakeOther: "",
      vehicleModel: "Transporter",
      vehicle: "Volkswagen Transporter",
    })
  })

  it("maps custom stored make to Інше input", () => {
    expect(hydratePartnerVehicleFromProfile({
      vehicle: "KrAZ 6510",
      vehicleMake: "KrAZ",
      vehicleModel: "6510",
    })).toEqual({
      vehicleMake: PARTNER_VEHICLE_MAKE_OTHER,
      vehicleMakeOther: "KrAZ",
      vehicleModel: "6510",
      vehicle: "KrAZ 6510",
    })
  })
})

describe("isProviderAvailable", () => {
  it("treats phone-verified partners as map-visible when online", () => {
    const provider = {
      id: "provider-1",
      status: "online",
      verificationStatus: "unverified",
      verification: { phone: true },
      location: { lat: 48.62, lng: 22.29 },
    } as ProviderAvailability

    expect(isProviderAvailable(provider)).toBe(true)
  })

  it("hides offline partners even when verified", () => {
    const provider = {
      id: "provider-1",
      status: "offline",
      verificationStatus: "verified",
      location: { lat: 48.62, lng: 22.29 },
    } as ProviderAvailability

    expect(isProviderAvailable(provider)).toBe(false)
  })
})

describe("normalizeTelegramHref", () => {
  it("builds t.me link from @username", () => {
    expect(normalizeTelegramHref("@pomich_partner")).toBe("https://t.me/pomich_partner")
  })
})
