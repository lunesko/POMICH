import { act, renderHook } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { getNearbyMapOrders } from "../../../api/client"
import useProviderOfferFeed from "./useProviderOfferFeed"

const { stopRealtime } = vi.hoisted(() => ({ stopRealtime: vi.fn() }))
vi.mock("../../../api/client", () => ({
  getProviderOffers: vi.fn().mockResolvedValue([]),
  getNearbyMapOrders: vi.fn().mockResolvedValue([]),
}))
vi.mock("../../../lib/realtime", () => ({
  subscribeProviderEvents: () => stopRealtime,
}))
vi.mock("../../../lib/partnerDutyAlerts", () => ({
  alertPartnerNewRequest: vi.fn(),
  diffNewIds: () => [],
  ensurePartnerAlertPermission: vi.fn(),
}))
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it("keeps nearby polling stable across clock ticks and equal specialty arrays, then cleans up", async () => {
  vi.useFakeTimers()
  const position = { current: { lat: 50.45, lng: 30.52 } }
  const offers = { current: new Set<string>() }
  const orders = { current: new Set<string>() }
  const setOfferError = vi.fn()
  const { rerender, unmount } = renderHook(() =>
    useProviderOfferFeed({
      onDuty: true,
      providerAuthToken: "test",
      providerId: "p1",
      step: "duty",
      radiusKm: 20,
      providerSpecialties: ["tow"],
      providerLocationRef: position,
      dismissedOfferIdsRef: offers,
      dismissedOrderIdsRef: orders,
      setOfferError,
      webApp: undefined,
    }),
  )
  await act(async () => {
    await Promise.resolve()
  })
  expect(getNearbyMapOrders).toHaveBeenCalledTimes(1)
  rerender()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(getNearbyMapOrders).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7000)
  })
  expect(getNearbyMapOrders).toHaveBeenCalledTimes(2)
  unmount()
  expect(stopRealtime).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(20000)
  expect(getNearbyMapOrders).toHaveBeenCalledTimes(2)
})
