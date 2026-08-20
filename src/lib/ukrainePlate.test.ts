import { describe, expect, it } from "vitest"

import {
  appendUkrainePlateChar,
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
    expect(isValidUkrainePlate("АО 3422 ТЕ")).toBe(true)
    expect(validateUkrainePlate("АО3422ТЕ")).toEqual({
      valid: true,
      plate: "AO 3422 TE",
    })
  })

  it("accepts mixed Latin and Cyrillic in one plate", () => {
    expect(parseUkrainePlateInput("АO3422TЕ")).toBe("AO3422TE")
    expect(formatUkrainePlateInput("АO 3422 TЕ")).toBe("AO 3422 TE")
    expect(isValidUkrainePlate("АO 3422 TЕ")).toBe(true)
  })

  it("accepts lowercase Cyrillic and Latin interchangeably", () => {
    expect(parseUkrainePlateInput("ао3422те")).toBe("AO3422TE")
    expect(parseUkrainePlateInput("ao3422te")).toBe("AO3422TE")
    expect(isValidUkrainePlate("ао 3422 те")).toBe(true)
  })

  it("appends Cyrillic last letters after Latin prefix and digits", () => {
    let value = formatUkrainePlateInput("AO3422")
    expect(value).toBe("AO 3422")
    value = appendUkrainePlateChar(value, "Т")
    expect(value).toBe("AO 3422 T")
    value = appendUkrainePlateChar(value, "Е")
    expect(value).toBe("AO 3422 TE")
    expect(isValidUkrainePlate(value)).toBe(true)
  })

  it("types a full Cyrillic plate character by character", () => {
    let value = ""
    for (const char of "АО3422ТЕ") {
      value = appendUkrainePlateChar(value, char)
    }
    expect(value).toBe("AO 3422 TE")
    expect(isValidUkrainePlate(value)).toBe(true)
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
