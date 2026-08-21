import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  clampSheetHeight,
  heightToSnap,
  useMobileSheetSnap,
  type SheetHeights,
} from "./useMobileSheetSnap"

describe("useMobileSheetSnap", () => {
  it("defaults to half on mobile sheets", () => {
    const { result } = renderHook(() => useMobileSheetSnap({ enabled: true }))
    expect(result.current.snap).toBe("half")
    expect(result.current.heightVh).toBe(54)
  })

  it("starts collapsed when mapFocus is enabled", () => {
    const { result } = renderHook(() => useMobileSheetSnap({ enabled: true, mapFocus: true }))
    expect(result.current.snap).toBe("collapsed")
    expect(result.current.heightVh).toBe(28)
  })

  it("starts expanded when expandedSheet is enabled", () => {
    const { result } = renderHook(() => useMobileSheetSnap({ enabled: true, expandedSheet: true }))
    expect(result.current.snap).toBe("expanded")
    expect(result.current.heightVh).toBe(74)
  })

  it("cycles snap states on cycleSnap", () => {
    const { result } = renderHook(() => useMobileSheetSnap({ enabled: true }))
    act(() => result.current.cycleSnap())
    expect(result.current.snap).toBe("expanded")
    expect(result.current.heightVh).toBe(74)
    act(() => result.current.cycleSnap())
    expect(result.current.snap).toBe("collapsed")
    expect(result.current.heightVh).toBe(28)
    act(() => result.current.cycleSnap())
    expect(result.current.snap).toBe("half")
    expect(result.current.heightVh).toBe(54)
  })

  it("setSnap updates both snap and height so expand is recoverable", () => {
    const { result } = renderHook(() => useMobileSheetSnap({ enabled: true, mapFocus: true }))
    expect(result.current.snap).toBe("collapsed")
    act(() => result.current.setSnap("half"))
    expect(result.current.snap).toBe("half")
    expect(result.current.heightVh).toBe(54)
    expect(result.current.sheetStyle).toEqual({ "--pomich-sheet-height": "54%" })
  })

  it("exposes sheet height style for drag resize", () => {
    const { result } = renderHook(() => useMobileSheetSnap({ enabled: true }))
    expect(result.current.sheetStyle).toEqual({ "--pomich-sheet-height": "54%" })
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
    expect(result.current.heightVh).toBeGreaterThan(60)

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
    expect(result.current.heightVh).toBe(74)
    vi.unstubAllGlobals()
  })
})

describe("sheet height helpers", () => {
  const heights: SheetHeights = { peek: 15, half: 44, expanded: 72, min: 14, max: 78 }

  it("clamps drag height between min and max", () => {
    expect(clampSheetHeight(5, heights)).toBe(14)
    expect(clampSheetHeight(99, heights)).toBe(78)
  })

  it("maps height to nearest snap", () => {
    expect(heightToSnap(16, heights)).toBe("collapsed")
    expect(heightToSnap(44, heights)).toBe("half")
    expect(heightToSnap(70, heights)).toBe("expanded")
  })
})
