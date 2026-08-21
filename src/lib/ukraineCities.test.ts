import { describe, expect, it } from "vitest"

import {
  DEFAULT_SERVICE_CITY,
  isUkraineServiceCity,
  nearestServiceCity,
  resolveServiceCityFromGeo,
  ukraineCityOptions,
  validateServiceCity,
  serviceCityCenter,
} from "./ukraineCities"

describe("ukraineCities", () => {
  it("puts Kyiv first in options", () => {
    const options = ukraineCityOptions()
    expect(options[0]).toBe(DEFAULT_SERVICE_CITY)
    expect(options[0]).toBe("Київ")
    expect(options).toContain("Ужгород")
    expect(options).toContain("Львів")
    expect(options.length).toBeGreaterThanOrEqual(15)
  })

  it("validates dropdown selection only", () => {
    expect(validateServiceCity("").valid).toBe(false)
    expect(validateServiceCity("q").valid).toBe(false)
    expect(validateServiceCity("Gotham").valid).toBe(false)
    expect(validateServiceCity("Ужгород")).toEqual({ valid: true, value: "Ужгород" })
    expect(isUkraineServiceCity("Одеса")).toBe(true)
  })

  it("returns map center for known service cities", () => {
    const kyiv = serviceCityCenter("Київ")
    expect(kyiv.lat).toBeGreaterThan(49)
    expect(kyiv.lng).toBeGreaterThan(29)
    expect(serviceCityCenter("unknown")).toEqual(serviceCityCenter(DEFAULT_SERVICE_CITY))
  })

  it("snaps Perechyn GPS to nearest service city (Uzhhorod), not Kyiv", () => {
    const perechyn = { lat: 48.73242, lng: 22.47778 }
    const nearest = nearestServiceCity(perechyn)
    expect(nearest?.city).toBe("Ужгород")
    expect(nearest!.distanceKm).toBeLessThan(40)
    expect(resolveServiceCityFromGeo(perechyn, "Перечин")).toBe("Ужгород")
    expect(resolveServiceCityFromGeo(perechyn, "Ужгород")).toBe("Ужгород")
  })
})
