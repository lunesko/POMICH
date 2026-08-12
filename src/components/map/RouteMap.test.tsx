import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render } from "@testing-library/react"

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
    project,
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
  })

  afterEach(() => {
    vi.useRealTimers()
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
