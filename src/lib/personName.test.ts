import { describe, expect, it } from "vitest"

import { normalizePersonName, validatePersonName } from "./personName"

describe("validatePersonName", () => {
  it("rejects empty and single-letter names", () => {
    expect(validatePersonName("").valid).toBe(false)
    expect(validatePersonName("q").valid).toBe(false)
    expect(validatePersonName("Я").valid).toBe(false)
  })

  it("rejects nonsense repeated letters", () => {
    expect(validatePersonName("qq").valid).toBe(false)
    expect(validatePersonName("аа").valid).toBe(false)
  })

  it("accepts UA/RU/Latin names with spaces and hyphens", () => {
    expect(validatePersonName("Іван").valid).toBe(true)
    expect(validatePersonName("Анна-Марія").valid).toBe(true)
    expect(validatePersonName("Олександр Петренко").valid).toBe(true)
    expect(validatePersonName("PowerGear").valid).toBe(true)
    expect(validatePersonName("  Марія  ").value).toBe("Марія")
  })

  it("rejects digits and symbols", () => {
    expect(validatePersonName("Ivan123").valid).toBe(false)
    expect(validatePersonName("@@@").valid).toBe(false)
  })

  it("normalizes whitespace", () => {
    expect(normalizePersonName("  Олег   Іванов ")).toBe("Олег Іванов")
  })
})
