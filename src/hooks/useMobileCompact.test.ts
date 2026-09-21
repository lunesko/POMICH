import { afterEach, describe, expect, it } from "vitest"

import { BREAKPOINT_PHONE_MAX, BREAKPOINT_PHONE_SMALL_MAX } from "../lib/breakpoints"
import { initMobileCompactClasses } from "./useMobileCompact"

describe("initMobileCompactClasses", () => {
  afterEach(() => {
    document.documentElement.classList.remove("mobile-compact", "mobile-compact-xs", "mobile-landscape")
  })

  it("adds mobile-compact for iPhone-width viewports", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 393 })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 852 })
    initMobileCompactClasses()
    expect(document.documentElement.classList.contains("mobile-compact")).toBe(true)
    expect(document.documentElement.classList.contains("mobile-compact-xs")).toBe(false)
    expect(document.documentElement.classList.contains("mobile-landscape")).toBe(false)
  })

  it("adds extra compact class for small phones", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: BREAKPOINT_PHONE_SMALL_MAX })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 })
    initMobileCompactClasses()
    expect(document.documentElement.classList.contains("mobile-compact")).toBe(true)
    expect(document.documentElement.classList.contains("mobile-compact-xs")).toBe(true)
  })

  it("removes compact classes above phone breakpoint in portrait", () => {
    document.documentElement.classList.add("mobile-compact", "mobile-compact-xs", "mobile-landscape")
    Object.defineProperty(window, "innerWidth", { configurable: true, value: BREAKPOINT_PHONE_MAX + 1 })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 })
    initMobileCompactClasses()
    expect(document.documentElement.classList.contains("mobile-compact")).toBe(false)
    expect(document.documentElement.classList.contains("mobile-compact-xs")).toBe(false)
    expect(document.documentElement.classList.contains("mobile-landscape")).toBe(false)
  })

  it("treats phone landscape (844×390) as compact, not tablet", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 844 })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 390 })
    initMobileCompactClasses()
    expect(document.documentElement.classList.contains("mobile-compact")).toBe(true)
    expect(document.documentElement.classList.contains("mobile-landscape")).toBe(true)
  })

  it("updates classes across portrait → landscape → portrait", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 })
    initMobileCompactClasses()
    expect(document.documentElement.classList.contains("mobile-compact")).toBe(true)
    expect(document.documentElement.classList.contains("mobile-landscape")).toBe(false)

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 844 })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 390 })
    initMobileCompactClasses()
    expect(document.documentElement.classList.contains("mobile-compact")).toBe(true)
    expect(document.documentElement.classList.contains("mobile-landscape")).toBe(true)

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 })
    initMobileCompactClasses()
    expect(document.documentElement.classList.contains("mobile-compact")).toBe(true)
    expect(document.documentElement.classList.contains("mobile-landscape")).toBe(false)
  })
})
