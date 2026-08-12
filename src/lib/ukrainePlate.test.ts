import { describe, expect, it } from "vitest"

import {
  formatUkrainePlateInput,
  isValidUkrainePlate,
  normalizeUkrainePlate,
  parseUkrainePlateInput,
  plateInputValueFromStored,
  ukrainePlateDisplay,
  validateUkrainePlate,
} from "./ukrainePlate"

describe("ukrainePlate", () => {
  it("formats compact input as AA 0000 AA", () => {
    expect(formatUkrainePlateInput("BX5874HX")).toBe("BX 5874 HX")
    expect(formatUkrainePlateInput("bx 5874 hx")).toBe("BX 5874 HX")
  })

  it("accepts Cyrillic lookalikes and maps them to Latin", () => {
    expect(parseUkrainePlateInput("ВХ5874НХ")).toBe("BX5874HX")
    expect(formatUkrainePlateInput("ВХ5874НХ")).toBe("BX 5874 HX")
  })

  it("rejects Cyrillic nonsense that is not a plate letter", () => {
    expect(parseUkrainePlateInput("афыввфы")).toBe("AB")
    expect(isValidUkrainePlate("афыввфы")).toBe(false)
    expect(validateUkrainePlate("афыввфы").valid).toBe(false)
    expect(parseUkrainePlateInput("ыыыы")).toBe("")
    expect(parseUkrainePlateInput("фыва")).toBe("BA")
  })

  it("rejects partial input on isValid", () => {
    expect(isValidUkrainePlate("BX 5874")).toBe(false)
    expect(isValidUkrainePlate("BX")).toBe(false)
    expect(isValidUkrainePlate("")).toBe(false)
    expect(validateUkrainePlate("BX 5874").valid).toBe(false)
  })

  it("validates complete plates", () => {
    expect(isValidUkrainePlate("BX 5874 HX")).toBe(true)
    expect(validateUkrainePlate("BX5874HX")).toEqual({
      valid: true,
      plate: "BX 5874 HX",
    })
  })

  it("blocks invalid letters at each position while typing", () => {
    expect(parseUkrainePlateInput("BX5Z874HX")).toBe("BX5874HX")
    expect(parseUkrainePlateInput("BX58A74HX")).toBe("BX5874HX")
    expect(parseUkrainePlateInput("BX5874HZ")).toBe("BX5874H")
  })

  it("handles backspace and delete gracefully via reformat", () => {
    expect(formatUkrainePlateInput("BX 5874 H")).toBe("BX 5874 H")
    expect(formatUkrainePlateInput("BX 5874")).toBe("BX 5874")
    expect(formatUkrainePlateInput("BX 58")).toBe("BX 58")
    expect(formatUkrainePlateInput("B")).toBe("B")
  })

  it("normalizes stored values for display", () => {
    expect(plateInputValueFromStored("AO1248CH")).toBe("AO 1248 CH")
    expect(normalizeUkrainePlate("ao1248ch")).toBe("AO 1248 CH")
    expect(ukrainePlateDisplay("AO1248CH")).toBe("AO 1248 CH")
  })
})
