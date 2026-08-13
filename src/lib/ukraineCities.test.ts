import { describe, expect, it } from "vitest"

import {
  DEFAULT_SERVICE_CITY,
  isUkraineServiceCity,
  ukraineCityOptions,
  validateServiceCity,
} from "./ukraineCities"

describe("ukraineCities", () => {
  it("puts Ужгород first in options", () => {
    const options = ukraineCityOptions()
    expect(options[0]).toBe(DEFAULT_SERVICE_CITY)
    expect(options).toContain("Київ")
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
})
