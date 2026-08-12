import { afterEach, describe, expect, it } from "vitest"

import { BREAKPOINT_PHONE_MAX, BREAKPOINT_PHONE_SMALL_MAX } from "../lib/breakpoints"
import { initMobileCompactClasses } from "./useMobileCompact"

describe("initMobileCompactClasses", () => {
  afterEach(() => {
    document.documentElement.classList.remove("mobile-compact", "mobile-compact-xs")
  })

  it("adds mobile-compact for iPhone-width viewports", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 393 })
    initMobileCompactClasses()
    expect(document.documentElement.classList.contains("mobile-compact")).toBe(true)
    expect(document.documentElement.classList.contains("mobile-compact-xs")).toBe(false)
  })

  it("adds extra compact class for small phones", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: BREAKPOINT_PHONE_SMALL_MAX })
    initMobileCompactClasses()
    expect(document.documentElement.classList.contains("mobile-compact")).toBe(true)
    expect(document.documentElement.classList.contains("mobile-compact-xs")).toBe(true)
  })

  it("removes compact classes above phone breakpoint", () => {
    document.documentElement.classList.add("mobile-compact", "mobile-compact-xs")
    Object.defineProperty(window, "innerWidth", { configurable: true, value: BREAKPOINT_PHONE_MAX + 1 })
    initMobileCompactClasses()
    expect(document.documentElement.classList.contains("mobile-compact")).toBe(false)
    expect(document.documentElement.classList.contains("mobile-compact-xs")).toBe(false)
  })
})
