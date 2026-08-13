import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render, waitFor } from "@testing-library/react"

import { MAP_RECENTER_THRESHOLD_M } from "../../lib/mapGeo"

const flyTo = vi.fn()
const panBy = vi.fn()
const getCenter = vi.fn(() => ({ lat: 48.62, lng: 22.28 }))
const getZoom = vi.fn(() => 13)
const project = vi.fn((coords: [number, number]) => ({ x: coords[0] * 1000, y: coords[1] * 1000 }))

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Polyline: () => null,
  Marker: () => null,
  Popup: () => null,
  useMapEvents: () => null,
  useMap: () => ({
    flyTo,
    panBy,
    getCenter,
    getZoom,
    getSize: () => ({ x: 390, y: 700 }),
    project,
    unproject: (coords: { x: number; y: number } | [number, number]) => {
      const x = Array.isArray(coords) ? coords[0] : coords.x
      const y = Array.isArray(coords) ? coords[1] : coords.y
      return { lat: y / 1000, lng: x / 1000 }
    },
    invalidateSize: vi.fn(),
    getContainer: () => document.createElement("div"),
    scrollWheelZoom: { enable: vi.fn(), disable: vi.fn() },
    dragging: {},
    touchZoom: {},
    doubleClickZoom: {},
    boxZoom: {},
    keyboard: {},
  }),
}))

vi.mock("leaflet", () => ({
  default: {
    divIcon: () => ({}),
    latLngBounds: () => ({}),
  },
  divIcon: () => ({}),
  latLngBounds: () => ({}),
}))

vi.mock("../../lib/osrmRoute", () => ({
  fetchOsrmRoute: vi.fn(async () => null),
  formatRouteDistance: () => "1 km",
  formatRouteDuration: () => "2 min",
  forwardGeocodeAddress: vi.fn(async () => null),
}))

import RouteMap from "./RouteMap"

describe("RouteMap recenter behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    flyTo.mockClear()
    panBy.mockClear()
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal("cancelAnimationFrame", () => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("does not fly on pickup change when recenter trigger stays the same", () => {
    const pickup = { lat: 48.6208, lng: 22.2879 }
    const { rerender } = render(
      <RouteMap pickup={pickup} recenterTrigger={1} onPick={(point) => point} />,
    )

    vi.runAllTimers()
    flyTo.mockClear()
    panBy.mockClear()

    rerender(
      <RouteMap pickup={{ lat: 48.621, lng: 22.288 }} recenterTrigger={1} onPick={(point) => point} />,
    )
    vi.runAllTimers()

    expect(flyTo).not.toHaveBeenCalled()
  })

  it("flies only when recenter trigger increments", () => {
    const pickup = { lat: 48.6208, lng: 22.2879 }
    const { rerender } = render(<RouteMap pickup={pickup} recenterTrigger={0} />)

    rerender(<RouteMap pickup={pickup} recenterTrigger={1} />)
    vi.runAllTimers()

    expect(flyTo).toHaveBeenCalledTimes(1)
  })

  it("renders my-location control under zoom and requests geolocation", async () => {
    vi.useRealTimers()
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 48.63,
          longitude: 22.3,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition)
    })
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: {
        getCurrentPosition,
        watchPosition: vi.fn(() => 1),
        clearWatch: vi.fn(),
      },
    })

    const onUserLocationChange = vi.fn()
    const { getByRole } = render(
      <RouteMap pickup={{ lat: 48.6208, lng: 22.2879 }} onUserLocationChange={onUserLocationChange} />,
    )

    const locate = getByRole("button", { name: /Моє місцезнаходження/i })
    locate.click()

    await waitFor(() => {
      expect(getCurrentPosition).toHaveBeenCalled()
      expect(onUserLocationChange).toHaveBeenCalledWith({ lat: 48.63, lng: 22.3 })
      expect(flyTo).toHaveBeenCalled()
    })
  })

  it("collapses directory tools to a chip so the panel does not cover pins by default", () => {
    const providers = [
      {
        id: "p1",
        name: "СТО",
        status: "online" as const,
        providerKind: "directory" as const,
        vehicle: "Van",
        rating: 4.9,
        etaMinutes: 10,
        location: { lat: 48.621, lng: 22.29 },
        specialties: ["tow"],
      },
    ]
    const { getByRole, queryByRole } = render(
      <RouteMap pickup={{ lat: 48.6208, lng: 22.2879 }} providers={providers} directoryOnly />,
    )

    expect(getByRole("button", { name: /Допомога поруч/i })).toBeTruthy()
    expect(queryByRole("dialog", { name: /Допомога поруч/i })).toBeNull()
  })

  it("toggles Допомога поруч filter open and closed on desktop ride maps", () => {
    const providers = [
      {
        id: "p1",
        name: "СТО",
        status: "online" as const,
        providerKind: "directory" as const,
        vehicle: "Van",
        rating: 4.9,
        etaMinutes: 10,
        location: { lat: 48.621, lng: 22.29 },
        specialties: ["tow"],
      },
    ]
    const { getByRole, queryByRole } = render(
      <RouteMap pickup={{ lat: 48.6208, lng: 22.2879 }} providers={providers} />,
    )

    expect(getByRole("button", { name: /Допомога поруч/i })).toBeTruthy()
    expect(queryByRole("dialog", { name: /Допомога поруч/i })).toBeNull()

    fireEvent.click(getByRole("button", { name: /Допомога поруч/i }))
    expect(getByRole("dialog", { name: /Допомога поруч/i })).toBeTruthy()

    fireEvent.click(getByRole("button", { name: /Закрити фільтр/i }))
    expect(queryByRole("dialog", { name: /Допомога поруч/i })).toBeNull()
    expect(getByRole("button", { name: /Допомога поруч/i })).toBeTruthy()
  })

  it("ignores passive geo jitter below recenter threshold", () => {
    const pickup = { lat: 48.6208, lng: 22.2879 }
    const { rerender } = render(<RouteMap pickup={pickup} />)

    vi.runAllTimers()
    flyTo.mockClear()
    panBy.mockClear()

    rerender(<RouteMap pickup={{ lat: 48.62081, lng: 22.28791 }} />)
    vi.runAllTimers()

    expect(flyTo).not.toHaveBeenCalled()
    expect(panBy).not.toHaveBeenCalled()
    expect(MAP_RECENTER_THRESHOLD_M).toBeGreaterThan(10)
  })
})
