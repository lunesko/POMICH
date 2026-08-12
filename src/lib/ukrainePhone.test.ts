import { describe, expect, it } from "vitest"

import {
  formatLocalPhoneDisplay,
  normalizeUkrainePhone,
  parseUkrainePhoneInput,
  toE164,
  validateUkraineMobilePhone,
} from "./ukrainePhone"

describe("ukrainePhone", () => {
  it("parses local 0XX format", () => {
    expect(parseUkrainePhoneInput("0661234567")).toBe("661234567")
    expect(parseUkrainePhoneInput("0501234567")).toBe("501234567")
  })

  it("parses national digits without leading zero", () => {
    expect(parseUkrainePhoneInput("661234567")).toBe("661234567")
  })

  it("parses full E.164 and strips spaces", () => {
    expect(parseUkrainePhoneInput("+380 66 123 45 67")).toBe("661234567")
    expect(parseUkrainePhoneInput("+380661234567")).toBe("661234567")
  })

  it("normalizes to E.164 on save", () => {
    expect(normalizeUkrainePhone("0661234567")).toBe("+380661234567")
    expect(normalizeUkrainePhone("661234567")).toBe("+380661234567")
    expect(normalizeUkrainePhone("+380661234567")).toBe("+380661234567")
  })

  it("formats display with spaces", () => {
    expect(formatLocalPhoneDisplay("661234567")).toBe("66 123 45 67")
    expect(formatLocalPhoneDisplay("66")).toBe("66")
  })

  it("validates complete mobile numbers", () => {
    expect(validateUkraineMobilePhone("0661234567")).toEqual({
      valid: true,
      e164: "+380661234567",
    })
    expect(validateUkraineMobilePhone("0971234567")).toEqual({
      valid: true,
      e164: "+380971234567",
    })
  })

  it("rejects incomplete or invalid operator codes", () => {
    expect(validateUkraineMobilePhone("66123456").valid).toBe(false)
    expect(validateUkraineMobilePhone("0112345678").valid).toBe(false)
    expect(validateUkraineMobilePhone("").valid).toBe(false)
  })

  it("builds partial E.164 while typing", () => {
    expect(toE164("66")).toBe("+38066")
  })
})
