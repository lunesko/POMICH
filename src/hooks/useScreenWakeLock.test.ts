import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useScreenWakeLock } from "./useScreenWakeLock"

describe("useScreenWakeLock", () => {
  const release = vi.fn(async () => undefined)
  const request = vi.fn(async () => ({
    released: false,
    release,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))

  beforeEach(() => {
    release.mockClear()
    request.mockClear()
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    })
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    })
  })

  afterEach(() => {
    // @ts-expect-error cleanup test stub
    delete navigator.wakeLock
  })

  it("requests screen wake lock when enabled", async () => {
    renderHook(() => useScreenWakeLock(true))
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("screen"))
  })

  it("does not request when disabled", async () => {
    renderHook(() => useScreenWakeLock(false))
    await Promise.resolve()
    expect(request).not.toHaveBeenCalled()
  })
})
