import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render, waitFor } from "@testing-library/react"

import { MAP_RECENTER_THRESHOLD_M } from "../../lib/mapGeo"

const flyTo = vi.fn()
const panBy = vi.fn()
const fitBounds = vi.fn()
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
    getPane: vi.fn(() => undefined),
    createPane: vi.fn(),
    setMinZoom: vi.fn(),
    setMaxBounds: vi.fn(),
    fitBounds,
    scrollWheelZoom: { enable: vi.fn(), disable: vi.fn() },
    dragging: { enable: vi.fn(), disable: vi.fn() },
    touchZoom: { enable: vi.fn(), disable: vi.fn() },
    doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
    boxZoom: { enable: vi.fn(), disable: vi.fn() },
    keyboard: { enable: vi.fn(), disable: vi.fn() },
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
  }),
}))

vi.mock("leaflet", () => ({
  default: {
    divIcon: () => ({}),
    latLngBounds: () => ({}),
    tileLayer: vi.fn(() => ({
      addTo: vi.fn(),
      setUrl: vi.fn(),
      redraw: vi.fn(),
    })),
  },
  divIcon: () => ({}),
  latLngBounds: () => ({}),
  tileLayer: vi.fn(() => ({
    addTo: vi.fn(),
    setUrl: vi.fn(),
    redraw: vi.fn(),
  })),
}))

vi.mock("../../lib/osrmRoute", () => ({
  fetchOsrmRoute: vi.fn(async () => null),
  formatRouteDistance: () => "1 km",
  formatRouteDuration: () => "2 min",
  forwardGeocodeAddress: vi.fn(async () => null),
}))

import { fetchOsrmRoute } from "../../lib/osrmRoute"
import RouteMap from "./RouteMap"

describe("RouteMap recenter behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    flyTo.mockClear()
    panBy.mockClear()
    fitBounds.mockClear()
    vi.mocked(fetchOsrmRoute).mockReset()
    vi.mocked(fetchOsrmRoute).mockResolvedValue(null)
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

  it("does not fly on tiny pickup jitter when recenter trigger stays the same", () => {
    const pickup = { lat: 48.6208, lng: 22.2879 }
    const { rerender } = render(
      <RouteMap pickup={pickup} recenterTrigger={1} onPick={(point) => point} />,
    )

    vi.runAllTimers()
    flyTo.mockClear()
    panBy.mockClear()

    // Sub-live-follow threshold (~1m) must not yank the camera.
    rerender(
      <RouteMap pickup={{ lat: 48.620809, lng: 22.287909 }} recenterTrigger={1} onPick={(point) => point} />,
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

  it("adjusts follow zoom from ground speed without requiring a large move", () => {
    const pickup = { lat: 48.6208, lng: 22.2879 }
    const { rerender } = render(<RouteMap pickup={pickup} geoSpeedMps={0} />)
    vi.runAllTimers()
    flyTo.mockClear()

    rerender(<RouteMap pickup={pickup} geoSpeedMps={16} />)
    vi.runAllTimers()

    expect(flyTo).toHaveBeenCalled()
    const zoomArg = flyTo.mock.calls[0]?.[1]
    expect(zoomArg).toBe(14)
  })

  it("shows live speed HUD while following", () => {
    const { getByLabelText } = render(
      <RouteMap pickup={{ lat: 48.6208, lng: 22.2879 }} geoSpeedMps={8.5} />,
    )
    expect(getByLabelText(/Швидкість 31 кілометрів/i)).toBeTruthy()
  })

  it("shows zero speed HUD when standing still", () => {
    const { getByLabelText } = render(
      <RouteMap pickup={{ lat: 48.6208, lng: 22.2879 }} geoSpeedMps={0} />,
    )
    expect(getByLabelText(/Швидкість 0 кілометрів/i)).toBeTruthy()
  })

  it("shows dash in speed HUD when GPS speed is unknown", () => {
    const { getByLabelText } = render(
      <RouteMap pickup={{ lat: 48.6208, lng: 22.2879 }} geoSpeedMps={null} />,
    )
    expect(getByLabelText(/Швидкість — кілометрів/i)).toBeTruthy()
  })

  it("applies speed zoom on an open map with onPick and no route", () => {
    const pickup = { lat: 48.6208, lng: 22.2879 }
    const { rerender } = render(
      <RouteMap pickup={pickup} geoSpeedMps={0} onPick={(point) => point} />,
    )
    vi.runAllTimers()
    flyTo.mockClear()

    rerender(<RouteMap pickup={pickup} geoSpeedMps={3} onPick={(point) => point} />)
    vi.runAllTimers()

    expect(flyTo).toHaveBeenCalled()
    expect(flyTo.mock.calls[0]?.[1]).toBe(16)
  })

  it("renders my-location control beside zoom and requests geolocation", async () => {
    vi.useRealTimers()
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal("cancelAnimationFrame", () => undefined)
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

  it("hides directory markers when showDirectoryProviders is false", () => {
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
    const { queryByRole } = render(
      <RouteMap
        pickup={{ lat: 48.6208, lng: 22.2879 }}
        providers={providers}
        showDirectoryProviders={false}
      />,
    )

    expect(queryByRole("button", { name: /Допомога поруч/i })).toBeNull()
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

  it("fits Ukraine bounds when directory scope recenter trigger fires for all-ukraine", () => {
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
    const onDirectoryScopeChange = vi.fn()
    const { rerender } = render(
      <RouteMap
        pickup={{ lat: 48.6208, lng: 22.2879 }}
        providers={providers}
        directoryOnly
        showUkraineMask
        directoryScope="all-ukraine"
        onDirectoryScopeChange={onDirectoryScopeChange}
        directoryScopeRecenterTrigger={0}
      />,
    )

    rerender(
      <RouteMap
        pickup={{ lat: 48.6208, lng: 22.2879 }}
        providers={providers}
        directoryOnly
        showUkraineMask
        directoryScope="all-ukraine"
        onDirectoryScopeChange={onDirectoryScopeChange}
        directoryScopeRecenterTrigger={1}
      />,
    )
    vi.runAllTimers()

    expect(fitBounds).toHaveBeenCalled()
  })

  it("renders region scope toggles inside the filter panel", () => {
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
    const onDirectoryScopeChange = vi.fn()
    const { getByRole } = render(
      <RouteMap
        pickup={{ lat: 48.6208, lng: 22.2879 }}
        providers={providers}
        directoryOnly
        showUkraineMask
        directoryScope="my-city"
        onDirectoryScopeChange={onDirectoryScopeChange}
      />,
    )

    fireEvent.click(getByRole("button", { name: /Допомога поруч/i }))
    fireEvent.click(getByRole("button", { name: /Вся Україна/i }))
    expect(onDirectoryScopeChange).toHaveBeenCalledWith("all-ukraine")
  })

  it("toggles directory marker visibility from the categories panel", () => {
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
    const { getByRole } = render(
      <RouteMap
        pickup={{ lat: 48.6208, lng: 22.2879 }}
        providers={providers}
        directoryOnly
        showUkraineMask
      />,
    )

    fireEvent.click(getByRole("button", { name: /Допомога поруч/i }))
    fireEvent.click(getByRole("button", { name: /Сховати все/i }))
    expect(getByRole("button", { name: /Показати всі/i })).toBeTruthy()

    fireEvent.click(getByRole("button", { name: /Показати всі/i }))
    expect(getByRole("button", { name: /Сховати все/i })).toBeTruthy()
  })

  it("shows region scope toggles even when directory providers list is empty", () => {
    const onDirectoryScopeChange = vi.fn()
    const { getByRole, queryByText } = render(
      <RouteMap
        pickup={{ lat: 48.6208, lng: 22.2879 }}
        providers={[]}
        directoryOnly
        showUkraineMask
        directoryScope="all-ukraine"
        onDirectoryScopeChange={onDirectoryScopeChange}
      />,
    )

    expect(queryByText(/^Легенда$/i)).toBeNull()
    fireEvent.click(getByRole("button", { name: /Допомога поруч/i }))
    fireEvent.click(getByRole("button", { name: /Моє місто/i }))
    expect(onDirectoryScopeChange).toHaveBeenCalledWith("my-city")
  })

  it("includes legacy directory rows without providerKind on the map", () => {
    const providers = [
      {
        id: "legacy",
        name: "Legacy STO",
        status: "offline" as const,
        vehicle: "Van",
        rating: 4.5,
        location: { lat: 50.45, lng: 30.52 },
        address: "вул. Хрещатик",
        specialties: ["tow"],
      },
    ]
    const { getByRole } = render(
      <RouteMap pickup={{ lat: 48.6208, lng: 22.2879 }} providers={providers} directoryOnly showUkraineMask />,
    )

    fireEvent.click(getByRole("button", { name: /Допомога поруч/i }))
    expect(getByRole("button", { name: /Усі сервіси \(1\)/i })).toBeTruthy()
  })

  it("fetches partner→client OSRM once for GPS jitter and fits the route bounds", async () => {
    vi.useRealTimers()
    vi.mocked(fetchOsrmRoute).mockResolvedValue({
      coordinates: [
        [48.632, 22.271],
        [48.628, 22.28],
        [48.6208, 22.2879],
      ],
      distanceMeters: 2100,
      durationSeconds: 240,
    })

    const pickup = { lat: 48.6208, lng: 22.2879 }
    const { rerender } = render(
      <RouteMap pickup={pickup} providerPosition={{ lat: 48.63201, lng: 22.27102 }} />,
    )

    await waitFor(() => expect(fetchOsrmRoute).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(fitBounds).toHaveBeenCalled())

    // Sub-cell GPS noise must not cancel/refetch OSRM (was leaving the polyline empty).
    rerender(<RouteMap pickup={pickup} providerPosition={{ lat: 48.63209, lng: 22.27108 }} />)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(fetchOsrmRoute).toHaveBeenCalledTimes(1)

    // Crossing the ~100m rounding cell should refetch and re-fit.
    rerender(<RouteMap pickup={pickup} providerPosition={{ lat: 48.6345, lng: 22.275 }} />)
    await waitFor(() => expect(fetchOsrmRoute).toHaveBeenCalledTimes(2))
  })
})
