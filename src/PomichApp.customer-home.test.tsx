import {
  renderApp,
  TEST_CUSTOMER_TOKEN,
  verifiedTestProfile,
  mockRegisteredCustomerFetch,
  openCustomerHome,
} from "./testSupport/pomichFlows"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { authSessionStorageKey, storeAuthSession } from "./lib/auth"

describe("POMICH customer-home", () => {
  it("starts with public landing browse mode", async () => {
    renderApp()

    expect(
      await screen.findByText(/Допомога на дорозі за хвилини/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Зареєструватися/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Послуги" })).toBeInTheDocument()
  })

  it("switches customer home to dark theme when toggled", async () => {
    const user = userEvent.setup()
    window.localStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem("pomichCustomerId", "guest-test")
    storeAuthSession(authSessionStorageKey("customer", "guest-test"), {
      role: "customer",
      subjectId: "guest-test",
      customerId: "guest-test",
      tokenType: "Bearer",
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: verifiedTestProfile,
    })
    window.history.pushState({}, "", "/?role=customer")

    renderApp()
    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()
    expect(document.documentElement.dataset.pomichTheme).not.toBe("dark")

    await user.click(
      screen.getByRole("switch", { name: /Увімкнено світлу тему/i }),
    )

    expect(document.documentElement.dataset.pomichTheme).toBe("dark")
    expect(window.localStorage.getItem("pomichLandingTheme")).toBe("dark")
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--pomich-bg")
        .trim(),
    ).toBe("#090B0E")
  })

  it("shows refresh geolocation control on customer home and requests location again", async () => {
    const user = userEvent.setup()
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 48.6208,
          longitude: 22.2879,
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

    await openCustomerHome(user)

    expect(await screen.findByText("Поточне місце")).toBeInTheDocument()
    const refreshButton = screen.getByRole("button", {
      name: /Оновити геолокацію/i,
    })
    expect(refreshButton).toBeInTheDocument()

    const initialCalls = getCurrentPosition.mock.calls.length
    await user.click(refreshButton)

    await waitFor(() => {
      expect(getCurrentPosition.mock.calls.length).toBeGreaterThan(initialCalls)
    })
    expect(refreshButton).toHaveTextContent("Оновити")
  })

  it("logs out from header and clears stored auth", async () => {
    const user = userEvent.setup()
    window.localStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem("pomichCustomerId", "guest-test")
    storeAuthSession(authSessionStorageKey("customer", "guest-test"), {
      role: "customer",
      subjectId: "guest-test",
      customerId: "guest-test",
      tokenType: "Bearer",
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: verifiedTestProfile,
    })

    await openCustomerHome(user)
    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /^Вийти$/i }))

    expect(
      await screen.findByText(/Допомога на дорозі за хвилини/i),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem("pomichCustomerId")).toBeNull()
    expect(
      window.sessionStorage.getItem(
        authSessionStorageKey("customer", "guest-test"),
      ),
    ).toBeNull()
  })

  it("enters customer flow when stored profile is complete but OTP is pending", async () => {
    const pendingProfile = {
      ...verifiedTestProfile,
      verificationStatus: "pending" as const,
    }
    window.localStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem(
      "pomichBootstrapProfile",
      JSON.stringify(pendingProfile),
    )
    storeAuthSession(authSessionStorageKey("customer", "guest-test"), {
      role: "customer",
      subjectId: "guest-test",
      customerId: "guest-test",
      tokenType: "Bearer",
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: pendingProfile,
    })
    window.history.pushState({}, "", "/?role=customer")

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url) => {
        if (
          url.includes("/users/") &&
          url.includes("/account") &&
          !url.includes("/role")
        ) {
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
              profile: pendingProfile,
            }),
          })
        }
        return undefined
      }),
    )

    renderApp()

    expect(
      (await screen.findAllByText("Підтвердження телефону")).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText("Що сталося?")).not.toBeInTheDocument()
    expect(screen.queryByText("Реєстрація клієнта")).not.toBeInTheDocument()
  })

  it("hides profile form on home when customer profile is verified", async () => {
    const user = userEvent.setup()
    window.localStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem(
      "pomichBootstrapProfile",
      JSON.stringify(verifiedTestProfile),
    )
    storeAuthSession(authSessionStorageKey("customer", "guest-test"), {
      role: "customer",
      subjectId: "guest-test",
      customerId: "guest-test",
      tokenType: "Bearer",
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: verifiedTestProfile,
    })
    window.history.pushState({}, "", "/?role=customer")

    renderApp()

    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()
    expect(screen.queryByText("Ваш профіль")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Зберегти профіль/i }),
    ).not.toBeInTheDocument()
  })

  it("shows ukrainian toast when go-online fails", async () => {
    const user = userEvent.setup()
    const providerSessionToken = "pomich_auth_v1.provider-session"
    const completedProvider = {
      id: "provider-oleksandr",
      name: "Олександр",
      phone: "+380671112233",
      city: "Ужгород",
      vehicle: "Volkswagen Crafter",
      plate: "BX5874HX",
      status: "offline",
      registeredAt: "2026-08-09T00:00:00",
      verificationStatus: "verified",
      specialties: ["tow"],
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/auth/provider/session")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              role: "provider",
              subjectId: "provider-oleksandr",
              providerId: "provider-oleksandr",
              tokenType: "Bearer",
              accessToken: providerSessionToken,
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            }),
          })
        }
        if (url.endsWith("/providers")) {
          return Promise.resolve({
            ok: true,
            json: async () => [completedProvider],
          })
        }
        if (url.includes("/map/providers")) {
          return Promise.resolve({ ok: true, json: async () => [] })
        }
        if (url.includes("/providers/provider-oleksandr/profile")) {
          return Promise.resolve({
            ok: true,
            json: async () => completedProvider,
          })
        }
        if (url.includes("/presence")) {
          return Promise.resolve({
            ok: false,
            json: async () => ({
              detail:
                "provider verification must be approved before going online",
            }),
          })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }),
    )
    window.history.pushState({}, "", "/?providerToken=partner-secret")

    renderApp()

    expect(await screen.findByText("Партнер POMICH")).toBeInTheDocument()
    // Offline go-online is the status toggle (no duplicate primary CTA).
    await user.click(screen.getByRole("switch", { name: /вийти на лінію/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Підтвердіть телефон/i,
    )
  })
})
