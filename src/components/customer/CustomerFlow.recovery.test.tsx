import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import CustomerFlow from "./CustomerFlow"
import { cancelOrder, getOrder, getCustomerOrders } from "../../api/client"
import { persistActiveOrder, readActiveOrder } from "../../lib/customerSession"
import { requestCurrentPosition } from "../../lib/mapGeo"

vi.mock("../layout/RideScreen", async () => {
  const { createContext, useContext } = await import("react")
  const RideScreenFooterContext = createContext<ReactNode>(null)
  return { RideScreenFooterContext, RideScreen: ({ children, pickup, onPick, onRetryGeo }: { children: ReactNode; pickup: { lat: number; lng: number }; onPick?: (point: { lat: number; lng: number }) => void; onRetryGeo?: () => void }) => <div>
    <output data-testid="pickup">{pickup.lat},{pickup.lng}</output>
    {onPick ? <button onClick={() => onPick({ lat: 48.65, lng: 22.3 })}>Pick manual</button> : null}
    {onRetryGeo ? <button onClick={onRetryGeo}>Use GPS</button> : null}
    {children}{useContext(RideScreenFooterContext)}
  </div> }
})
vi.mock("../../hooks/useTelegramUx", () => ({ useTelegramUx: () => ({ isTelegram: false }), useTelegramMainButton: () => undefined, useTelegramBackButton: () => undefined }))
vi.mock("../ui/ConfirmDialog", () => ({ useConfirmDialog: () => async () => true }))
vi.mock("../../lib/realtime", () => ({ subscribeOrderEvents: () => () => undefined }))
vi.mock("../../lib/customerSession", async original => ({ ...await original<typeof import("../../lib/customerSession")>(), resolveCustomerAuthSession: async () => ({ customerId: "recovery-client", token: "test-token" }) }))
vi.mock("../../lib/reverseGeocode", () => ({ reverseGeocodeAddress: async () => "Ужгород", forwardGeocodeAddress: async () => null }))
vi.mock("../../lib/syncProfileCityFromGeo", () => ({ syncProfileCityFromGeo: async () => undefined }))
vi.mock("../../lib/mapGeo", async original => ({ ...await original<typeof import("../../lib/mapGeo")>(), canRequestGeoSilently: async () => true, requestCurrentPosition: vi.fn() }))
vi.mock("../../api/client", async original => ({ ...await original<typeof import("../../api/client")>(), getOrder: vi.fn(), cancelOrder: vi.fn(), getCustomerOrders: vi.fn().mockResolvedValue([]), getSupportCases: async () => [], getMapProviders: async () => [] }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCustomerOrders).mockResolvedValue([])
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem("pomichCustomerId", "recovery-client")
})

describe("customer failure recovery", () => {
  it("retains an active order after a failed restore, then refreshes it when online", async () => {
    persistActiveOrder("PM-RECOVERY", "searching")
    vi.mocked(getOrder).mockRejectedValue(new Error("Network unavailable"))
    render(<CustomerFlow />)
    expect(await screen.findByText(/Заявка збережена/)).toBeInTheDocument()
    expect(readActiveOrder()?.orderId).toBe("PM-RECOVERY")
    expect(screen.queryByText("Що сталося?")).not.toBeInTheDocument()
    vi.mocked(getOrder).mockResolvedValue({ id: "PM-RECOVERY", status: "en_route", customerCoordinates: { lat: 48.66, lng: 22.31 } })
    act(() => { window.dispatchEvent(new Event("online")) })
    expect(await screen.findByText("Партнер у дорозі")).toBeInTheDocument()
    expect(screen.getByTestId("pickup")).toHaveTextContent("48.66,22.31")
    expect(screen.queryByText(/Заявка збережена/)).not.toBeInTheDocument()
  })

  it("does not start a replacement until cancellation is confirmed by the server", async () => {
    persistActiveOrder("PM-REPLACE", "en_route")
    vi.mocked(getOrder).mockResolvedValue({ id: "PM-REPLACE", status: "en_route", service: "battery", customerCoordinates: { lat: 48.62, lng: 22.28 }, assignedProvider: { id: "p1", name: "Partner", status: "offline", stale: true } })
    vi.mocked(cancelOrder).mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce({ id: "PM-REPLACE", status: "cancelled" })
    render(<CustomerFlow />)
    fireEvent.click(await screen.findByRole("button", { name: "Знайти іншого партнера" }))
    expect(await screen.findByText(/Нову заявку не створено/)).toBeInTheDocument()
    expect(readActiveOrder()?.orderId).toBe("PM-REPLACE")
    fireEvent.click(screen.getByRole("button", { name: "Знайти іншого партнера" }))
    await waitFor(() => expect(readActiveOrder()).toBeUndefined())
    expect(await screen.findByText("Перевірте заявку")).toBeInTheDocument()
    expect(screen.queryByText("Партнер у дорозі")).not.toBeInTheDocument()
  })

  it("does not overwrite a manual pickup with a late GPS response or live watch", async () => {
    sessionStorage.setItem("pomichDraft:recovery-client", JSON.stringify({ savedAt: Date.now(), screen: "location", selectedService: "battery", pickup: { lat: 48.62, lng: 22.28 } }))
    let watched: PositionCallback | undefined
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition: vi.fn((callback: PositionCallback) => { watched = callback; return 1 }), clearWatch: vi.fn() } })
    const callbacks: Array<(point: { lat: number; lng: number }) => void> = []
    vi.mocked(requestCurrentPosition).mockImplementation(success => { callbacks.push(success) })
    render(<CustomerFlow />)
    fireEvent.click(screen.getByRole("button", { name: "Use GPS" }))
    expect(callbacks.length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("button", { name: "Pick manual" }))
    await waitFor(() => expect(watched).toBeDefined())
    act(() => {
      callbacks[0]({ lat: 50.45, lng: 30.52 })
      watched?.({ coords: { latitude: 50.45, longitude: 30.52, accuracy: 10 }, timestamp: Date.now() } as GeolocationPosition)
    })
    expect(screen.getByTestId("pickup")).toHaveTextContent("48.65,22.3")
    expect(JSON.parse(sessionStorage.getItem("pomichDraft:recovery-client")!).manualPickup).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Use GPS" }))
    act(() => callbacks.at(-1)!({ lat: 48.67, lng: 22.32 }))
    expect(screen.getByTestId("pickup")).toHaveTextContent("48.67,22.32")
  })
})

it.each([403, 404])("clears permanently inaccessible restored orders (%s)", async status => {
  persistActiveOrder("PM-OLD-SESSION", "searching")
  vi.mocked(getOrder).mockRejectedValue(Object.assign(new Error("Unavailable"), { status }))
  render(<CustomerFlow />)
  await waitFor(() => expect(readActiveOrder()).toBeUndefined())
  expect(screen.queryByText(/Заявка збережена/)).not.toBeInTheDocument()
  expect(await screen.findByRole("heading", { name: "Що сталося?" })).toBeInTheDocument()
})

it("restores a newer active order when the local order finished on another device", async () => {
  persistActiveOrder("PM-OLD-COMPLETE", "searching")
  vi.mocked(getOrder).mockImplementation(async id => id === "PM-OLD-COMPLETE"
    ? { id, status: "completed" }
    : { id, status: "en_route", customerCoordinates: { lat: 48.66, lng: 22.31 } })
  vi.mocked(getCustomerOrders).mockResolvedValue([{ id: "PM-NEW-ACTIVE", status: "en_route", customerCoordinates: { lat: 48.66, lng: 22.31 } }])
  render(<CustomerFlow />)
  expect(await screen.findByText("Партнер у дорозі")).toBeInTheDocument()
  expect(readActiveOrder()?.orderId).toBe("PM-NEW-ACTIVE")
})
