import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  clampSheetHeight,
  heightToSnap,
  useMobileSheetSnap,
} from "./useMobileSheetSnap"

describe("useMobileSheetSnap", () => {
  it("defaults to half on mobile sheets", () => {
    const { result } = renderHook(() => useMobileSheetSnap({ enabled: true }))
    expect(result.current.snap).toBe("half")
    expect(result.current.heightVh).toBe(52)
  })

  it("starts collapsed when mapFocus is enabled", () => {
    const { result } = renderHook(() => useMobileSheetSnap({ enabled: true, mapFocus: true }))
    expect(result.current.snap).toBe("collapsed")
    expect(result.current.heightVh).toBe(18)
  })

  it("starts expanded when expandedSheet is enabled", () => {
    const { result } = renderHook(() => useMobileSheetSnap({ enabled: true, expandedSheet: true }))
    expect(result.current.snap).toBe("expanded")
    expect(result.current.heightVh).toBe(88)
  })

  it("cycles snap states on cycleSnap", () => {
    const { result } = renderHook(() => useMobileSheetSnap({ enabled: true }))
    act(() => result.current.cycleSnap())
    expect(result.current.snap).toBe("expanded")
    expect(result.current.heightVh).toBe(88)
    act(() => result.current.cycleSnap())
    expect(result.current.snap).toBe("collapsed")
    expect(result.current.heightVh).toBe(18)
    act(() => result.current.cycleSnap())
    expect(result.current.snap).toBe("half")
    expect(result.current.heightVh).toBe(52)
  })

  it("exposes sheet height style for drag resize", () => {
    const { result } = renderHook(() => useMobileSheetSnap({ enabled: true }))
    expect(result.current.sheetStyle).toEqual({ "--pomich-sheet-height": "52vh" })
  })

  it("updates height while dragging via pointer events", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    const { result } = renderHook(() => useMobileSheetSnap({ enabled: true }))
    const handle = document.createElement("div")
    handle.setPointerCapture = () => undefined
    handle.releasePointerCapture = () => undefined
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 })

    act(() => {
      result.current.handleProps.onPointerDown({
        pointerId: 1,
        clientY: 400,
        currentTarget: handle,
        preventDefault: () => undefined,
      } as unknown as React.PointerEvent<HTMLElement>)
    })

    act(() => {
      result.current.handleProps.onPointerMove({
        pointerId: 1,
        clientY: 120,
        currentTarget: handle,
        preventDefault: () => undefined,
      } as unknown as React.PointerEvent<HTMLElement>)
    })

    expect(result.current.isDragging).toBe(true)
    expect(result.current.heightVh).toBeGreaterThan(70)

    act(() => {
      result.current.handleProps.onPointerUp({
        pointerId: 1,
        clientY: 120,
        currentTarget: handle,
        preventDefault: () => undefined,
      } as unknown as React.PointerEvent<HTMLElement>)
    })

    expect(result.current.isDragging).toBe(false)
    expect(result.current.snap).toBe("expanded")
    expect(result.current.heightVh).toBe(88)
    vi.unstubAllGlobals()
  })
})

describe("sheet height helpers", () => {
  const heights = { peek: 18, half: 52, expanded: 88, min: 15, max: 92 }

  it("clamps drag height between min and max", () => {
    expect(clampSheetHeight(5, heights)).toBe(15)
    expect(clampSheetHeight(99, heights)).toBe(92)
    expect(clampSheetHeight(40, heights)).toBe(40)
  })

  it("snaps to nearest preset on release", () => {
    expect(heightToSnap(20, heights)).toBe("collapsed")
    expect(heightToSnap(50, heights)).toBe("half")
    expect(heightToSnap(80, heights)).toBe("expanded")
  })
})
