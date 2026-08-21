import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"

import { useScreenWakeLock } from "./useScreenWakeLock"

describe("useScreenWakeLock", () => {
  const release = vi.fn(async () => undefined)
  const request = vi.fn(async () => ({
    released: false,
    release,
    addEventListener: vi.fn(),
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
    // @ts-expect-error cleanup
    delete navigator.wakeLock
  })

  it("requests a screen wake lock while enabled and releases on cleanup", async () => {
    const { unmount } = renderHook(({ enabled }) => useScreenWakeLock(enabled), {
      initialProps: { enabled: true },
    })
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("screen"))
    unmount()
    await vi.waitFor(() => expect(release).toHaveBeenCalled())
  })

  it("does nothing when disabled", async () => {
    renderHook(() => useScreenWakeLock(false))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(request).not.toHaveBeenCalled()
  })
})
