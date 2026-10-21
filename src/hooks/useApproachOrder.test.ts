import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import useApproachOrder from "./useApproachOrder"
import { fetchOsrmRoute } from "../lib/osrmRoute"
import type { OrderResponse } from "../api/client"
vi.mock("../lib/osrmRoute", () => ({ fetchOsrmRoute: vi.fn() }))
const makeOrder = (): OrderResponse => ({ id: "PM-1", status: "en_route", customerCoordinates: { lat: 48.62, lng: 22.28 }, assignedProvider: { id: "p1", name: "Partner", status: "busy", etaMinutes: 99, location: { lat: 48.63, lng: 22.29 }, lastSeenAt: new Date().toISOString(), lastLocationAt: new Date().toISOString() } })
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })
describe("approach ETA", () => {
  it("uses road duration rather than the straight line ETA and does not refetch on polling", async () => {
    vi.mocked(fetchOsrmRoute).mockResolvedValue({ coordinates: [], distanceMeters: 6200, durationSeconds: 600 })
    const order = makeOrder()
    const { result, rerender } = renderHook(({ value }) => useApproachOrder(value), { initialProps: { value: order } })
    await waitFor(() => expect(result.current.displayOrder?.assignedProvider?.etaMinutes).toBe(10))
    expect(result.current.displayOrder?.assignedProvider?.distanceKm).toBe(6.2)
    rerender({ value: { ...order } })
    expect(fetchOsrmRoute).toHaveBeenCalledTimes(1)
  })
  it("never falls back to a misleading straight line ETA when routing fails", async () => {
    vi.mocked(fetchOsrmRoute).mockResolvedValue(null)
    const { result } = renderHook(() => useApproachOrder(makeOrder()))
    await waitFor(() => expect(fetchOsrmRoute).toHaveBeenCalled())
    expect(result.current.displayOrder?.assignedProvider?.etaMinutes).toBeUndefined()
  })
  it("hides ETA when the GPS fix ages even if no server messages arrive", async () => {
    vi.useFakeTimers()
    vi.mocked(fetchOsrmRoute).mockResolvedValue({ coordinates: [], distanceMeters: 6200, durationSeconds: 600 })
    const order = makeOrder()
    const { result } = renderHook(() => useApproachOrder(order))
    await act(async () => { await Promise.resolve() })
    expect(result.current.displayOrder?.assignedProvider?.etaMinutes).toBe(10)
    await act(async () => { vi.advanceTimersByTime(65000) })
    expect(result.current.fresh).toBe(false)
    expect(result.current.displayOrder?.assignedProvider?.etaMinutes).toBeUndefined()
  })
})
