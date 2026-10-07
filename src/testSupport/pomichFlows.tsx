import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, beforeEach, vi } from "vitest"

import CustomerApp from "../CustomerApp"
import { PomichThemeProvider } from "../context/PomichThemeProvider"

export function renderApp() {
  return render(
    <PomichThemeProvider>
      <CustomerApp />
    </PomichThemeProvider>,
  )
}

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map">{children}</div>
  ),
  TileLayer: () => <div />,
  Polyline: () => <div />,
  GeoJSON: () => <div />,
  Marker: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => {
    const noop = () => undefined
    const handler = { enable: noop, disable: noop }
    return {
      invalidateSize: noop,
      removeLayer: noop,
      getPane: () => document.createElement("div"),
      createPane: noop,
      setMinZoom: noop,
      setMaxBounds: noop,
      getContainer: () => document.createElement("div"),
      getSize: () => ({ x: 390, y: 700 }),
      getZoom: () => 13,
      getCenter: () => ({ lat: 48.62, lng: 22.28 }),
      flyTo: noop,
      fitBounds: noop,
      project: (coords: [number, number]) => ({
        x: coords[0] * 1000,
        y: coords[1] * 1000,
      }),
      unproject: (coords: { x: number; y: number } | [number, number]) => {
        const x = Array.isArray(coords) ? coords[0] : coords.x
        const y = Array.isArray(coords) ? coords[1] : coords.y
        return { lat: y / 1000, lng: x / 1000 }
      },
      scrollWheelZoom: handler,
      dragging: handler,
      touchZoom: handler,
      doubleClickZoom: handler,
      boxZoom: handler,
      keyboard: handler,
    }
  },
  useMapEvents: () => null,
}))

vi.mock("leaflet", () => ({
  default: {
    divIcon: () => ({}),
    latLngBounds: () => ({ pad: () => ({}) }),
    tileLayer: () => ({
      addTo: () => ({}),
      setUrl: () => undefined,
    }),
  },
  divIcon: () => ({}),
  latLngBounds: () => ({ pad: () => ({}) }),
  tileLayer: () => ({
    addTo: () => ({}),
    setUrl: () => undefined,
  }),
}))

beforeAll(async () => {
  await Promise.all([
    import("../components/customer/CustomerFlow"),
    import("../components/provider/ProviderFlow"),
    import("../components/onboarding/OnboardingGate"),
    import("../components/cabinet/ClientCabinet"),
    import("../components/cabinet/ProviderCabinet"),
    import("../components/admin/AdminFlow"),
    import("../components/map/RouteMap"),
  ])
})

export const TEST_CUSTOMER_TOKEN = "pomich_auth_v1.test-customer-session"

export const verifiedTestProfile = {
  id: "guest-test",
  name: "Тест",
  phone: "+380671112233",
  verificationStatus: "verified" as const,
  verification: { phone: true, email: false, telegram: false },
}

export function mockRegisteredCustomerFetch(
  extra?: (
    url: string,
    init?: RequestInit,
  ) => Promise<{ ok: boolean; json: () => Promise<unknown> }> | undefined,
) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const fromExtra = extra?.(url, init)
    if (fromExtra) return fromExtra
    if (url.includes("nominatim.openstreetmap.org/search")) {
      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            lat: "48.6175",
            lon: "22.3056",
            display_name: "СТО Авторемонт, Ужгород, Україна",
            address: {
              road: "вул. Автомобільна",
              house_number: "10",
              city: "Ужгород",
            },
          },
        ],
      })
    }
    if (url.includes("/auth/customer/guest/session")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          role: "customer",
          subjectId: "guest-test",
          customerId: "guest-test",
          accessToken: TEST_CUSTOMER_TOKEN,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          profile: {
            id: "guest-test",
            name: "Клієнт POMICH",
            phone: "",
            verificationStatus: "unverified",
          },
          account: {
            customerId: "guest-test",
            preferredRole: "",
            linkedProviderId: "",
            rolesRegistered: [],
            clientRegistered: false,
            providerRegistered: false,
            needsOnboarding: true,
          },
        }),
      })
    }
    if (url.includes("/customers/") && url.includes("/profile")) {
      return Promise.resolve({
        ok: true,
        json: async () => verifiedTestProfile,
      })
    }
    if (url.includes("/auth/customer/verify/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          profile: verifiedTestProfile,
          channel: "email",
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        }),
      })
    }
    if (url.includes("/users/") && url.includes("/account/role")) {
      const body = init?.body
        ? JSON.parse(String(init.body)) as { role?: string }
        : {}
      const role = body.role === "provider" ? "provider" : "customer"
      return Promise.resolve({
        ok: true,
        json: async () => ({
          customerId: "guest-test",
          preferredRole: role,
          linkedProviderId: "",
          rolesRegistered: role === "customer" ? ["customer"] : [],
          clientRegistered: role === "customer",
          providerRegistered: false,
          needsOnboarding: true,
          profile: verifiedTestProfile,
        }),
      })
    }
    if (url.includes("/users/") && url.includes("/account")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          customerId: "guest-test",
          preferredRole: "customer",
          linkedProviderId: "",
          rolesRegistered: ["customer"],
          clientRegistered: true,
          providerRegistered: false,
          needsOnboarding: false,
          profile: verifiedTestProfile,
        }),
      })
    }
    if (url.endsWith("/providers")) {
      return Promise.resolve({ ok: true, json: async () => [] })
    }
    if (url.includes("/map/providers")) {
      return Promise.resolve({ ok: true, json: async () => [] })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.pushState({}, "", "/")
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete (window as Window & { Telegram?: unknown }).Telegram
  vi.stubGlobal("fetch", mockRegisteredCustomerFetch())
})

export async function openCustomerHome(
  user: ReturnType<typeof userEvent.setup>,
) {
  renderApp()
  await user.click(
    await screen.findByRole("button", { name: /Зареєструватися/i }),
  )
  await user.click(await screen.findByRole("button", { name: /Я клієнт/i }))
  if (screen.queryByText("Реєстрація клієнта")) {
    await user.click(screen.getByRole("button", { name: /Продовжити/i }))
  }
  // Full + peek sheets both render tow cards — take the first match.
  await screen.findAllByRole("button", { name: /Евакуатор/i })
}
