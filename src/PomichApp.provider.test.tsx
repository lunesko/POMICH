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
import { applyPomichThemeToDocument } from "./lib/theme"

describe("POMICH provider", () => {
  it("opens provider flow directly from role deep link", async () => {
    window.history.pushState({}, "", "/?role=provider")
    renderApp()

    expect(await screen.findByText("Реєстрація партнера")).toBeInTheDocument()
    expect(
      screen.queryByText(/Допомога на дорозі за хвилини/i),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(window.location.search).not.toContain("role=")
    })
  })

  it("styles partner vehicle make select for dark theme", async () => {
    window.history.pushState({}, "", "/?role=provider")
    renderApp()

    expect(await screen.findByText("Реєстрація партнера")).toBeInTheDocument()
    applyPomichThemeToDocument("dark")
    expect(document.documentElement.dataset.pomichTheme).toBe("dark")

    const vehicleMakeSelect = screen.getByRole("combobox", {
      name: /Марка авто/i,
    })
    expect(vehicleMakeSelect).toHaveClass("pomich-form-input")
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--pomich-text")
        .trim(),
    ).toBe("#FFFFFF")
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--pomich-surface")
        .trim(),
    ).toBe("#12151A")
    expect(vehicleMakeSelect.querySelectorAll("option").length).toBeGreaterThan(
      1,
    )
  })

  it("shows custom make input when partner selects Інше", async () => {
    const user = userEvent.setup()
    window.history.pushState({}, "", "/?role=provider")
    renderApp()

    expect(await screen.findByText("Реєстрація партнера")).toBeInTheDocument()

    const vehicleMakeSelect = screen.getByRole("combobox", {
      name: /Марка авто/i,
    })
    expect(screen.getByRole("option", { name: "Scania" })).toBeInTheDocument()
    expect(
      screen.getByRole("option", { name: "Mercedes-Benz" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("option", { name: "Mercedes Sprinter" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: /^Модель$/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: /Вкажіть марку/i }),
    ).not.toBeInTheDocument()

    await user.selectOptions(vehicleMakeSelect, "Інше")

    const customMakeInput = screen.getByRole("textbox", {
      name: /Вкажіть марку/i,
    })
    expect(customMakeInput).toBeInTheDocument()
    await user.type(customMakeInput, "ZAZ")
    expect(customMakeInput).toHaveValue("ZAZ")
    expect(
      screen.getByRole("textbox", { name: /^Модель$/i }),
    ).toBeInTheDocument()
  })

  it("shows dependent model dropdown after make selection", async () => {
    const user = userEvent.setup()
    window.history.pushState({}, "", "/?role=provider")
    renderApp()

    expect(await screen.findByText("Реєстрація партнера")).toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: /^Модель$/i }),
    ).not.toBeInTheDocument()

    const vehicleMakeSelect = screen.getByRole("combobox", {
      name: /Марка авто/i,
    })
    await user.selectOptions(vehicleMakeSelect, "Volkswagen")

    const vehicleModelSelect = screen.getByRole("combobox", {
      name: /^Модель$/i,
    })
    expect(vehicleModelSelect).toBeEnabled()
    expect(vehicleModelSelect).toHaveClass("pomich-form-input")
    expect(
      screen.getByRole("option", { name: "Transporter" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Crafter" })).toBeInTheDocument()
    expect(
      screen.getByRole("option", { name: "Інша модель" }),
    ).toBeInTheDocument()

    await user.selectOptions(vehicleModelSelect, "Transporter")
    expect(vehicleModelSelect).toHaveValue("Transporter")

    await user.selectOptions(vehicleMakeSelect, "Ford")
    expect(screen.getByRole("combobox", { name: /^Модель$/i })).toHaveValue("")
    expect(screen.getByRole("option", { name: "Transit" })).toBeInTheDocument()
  })

  it("shows custom model input when partner selects Інша модель", async () => {
    const user = userEvent.setup()
    window.history.pushState({}, "", "/?role=provider")
    renderApp()

    expect(await screen.findByText("Реєстрація партнера")).toBeInTheDocument()

    const vehicleMakeSelect = screen.getByRole("combobox", {
      name: /Марка авто/i,
    })
    await user.selectOptions(vehicleMakeSelect, "Mercedes-Benz")

    const vehicleModelSelect = screen.getByRole("combobox", {
      name: /^Модель$/i,
    })
    await user.selectOptions(vehicleModelSelect, "Інша модель")

    const customModelInput = screen.getByRole("textbox", {
      name: /Вкажіть модель/i,
    })
    expect(customModelInput).toBeInTheDocument()
    await user.type(customModelInput, "Sprinter 316")
    expect(customModelInput).toHaveValue("Sprinter 316")
  })

  it("reopens registered partner flow after role switch without asking to register again", async () => {
    const user = userEvent.setup()
    const providerRecord = {
      id: "provider-guest-test",
      name: "Партнер Тест",
      phone: "+380671112233",
      city: "Ужгород",
      vehicle: "Volkswagen Crafter",
      plate: "BX5874HX",
      registeredAt: "2026-08-09T00:00:00",
      verificationStatus: "verified",
      verification: { phone: true },
      specialties: ["tow", "fuel"],
      serviceRadiusKm: 15,
      status: "offline",
    }

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url, init) => {
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
              linkedProviderId: "provider-guest-test",
              rolesRegistered: ["customer", "provider"],
              clientRegistered: true,
              providerRegistered: true,
              needsOnboarding: false,
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
              linkedProviderId: "provider-guest-test",
              rolesRegistered: ["customer", "provider"],
              clientRegistered: true,
              providerRegistered: true,
              needsOnboarding: false,
              profile: verifiedTestProfile,
            }),
          })
        }
        if (url.includes("/auth/provider/self/session")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              role: "provider",
              subjectId: "provider-guest-test",
              providerId: "provider-guest-test",
              tokenType: "Bearer",
              accessToken: "pomich_auth_v1.provider-self",
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            }),
          })
        }
        if (url.includes("/providers/provider-guest-test/offers")) {
          return Promise.resolve({ ok: true, json: async () => [] })
        }
        if (url.includes("/providers/provider-guest-test/presence")) {
          return Promise.resolve({ ok: true, json: async () => providerRecord })
        }
        if (url.endsWith("/providers") || url.includes("/map/providers")) {
          return Promise.resolve({
            ok: true,
            json: async () => [providerRecord],
          })
        }
        return undefined
      }),
    )

    window.localStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem(
      "pomichLinkedProviderId",
      "provider-guest-test",
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

    await openCustomerHome(user)
    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Змінити роль/i }))
    expect(await screen.findByText(/Оберіть вашу роль/i)).toBeInTheDocument()
    expect(
      window.sessionStorage.getItem(
        authSessionStorageKey("customer", "guest-test"),
      ),
    ).not.toBeNull()

    await user.click(screen.getByRole("button", { name: /Я партнер/i }))

    expect(
      await screen.findByText("Партнер POMICH", {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()
  })

  it("keeps registered partner after role switch when account API briefly omits providerRegistered", async () => {
    const user = userEvent.setup()
    const providerRecord = {
      id: "provider-guest-test",
      name: "Партнер Тест",
      phone: "+380671112233",
      city: "Ужгород",
      vehicle: "Volkswagen Crafter",
      plate: "BX5874HX",
      registeredAt: "2026-08-09T00:00:00",
      verificationStatus: "verified",
      verification: { phone: true },
      specialties: ["tow", "fuel"],
      serviceRadiusKm: 15,
      status: "offline",
    }

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url, init) => {
        if (url.includes("/users/") && url.includes("/account/role")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-test",
              preferredRole: "provider",
              linkedProviderId: "",
              rolesRegistered: ["customer"],
              clientRegistered: true,
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
              linkedProviderId: "provider-guest-test",
              rolesRegistered: ["customer", "provider"],
              clientRegistered: true,
              providerRegistered: true,
              needsOnboarding: false,
              profile: verifiedTestProfile,
            }),
          })
        }
        if (url.includes("/auth/provider/self/session")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              role: "provider",
              subjectId: "provider-guest-test",
              providerId: "provider-guest-test",
              tokenType: "Bearer",
              accessToken: "pomich_auth_v1.provider-self",
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            }),
          })
        }
        if (url.includes("/providers/provider-guest-test/")) {
          return Promise.resolve({ ok: true, json: async () => providerRecord })
        }
        if (url.endsWith("/providers") || url.includes("/map/providers")) {
          return Promise.resolve({
            ok: true,
            json: async () => [providerRecord],
          })
        }
        return undefined
      }),
    )

    window.localStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem(
      "pomichLinkedProviderId",
      "provider-guest-test",
    )
    window.localStorage.setItem(
      "pomichPartnerRegistered:provider-guest-test",
      "1",
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

    await openCustomerHome(user)
    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Змінити роль/i }))
    expect(await screen.findByText(/Оберіть вашу роль/i)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Я партнер/i }))

    expect(
      await screen.findByText("Партнер POMICH", {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()
  })

  it("switches partner role to client without asking for client registration again", async () => {
    const user = userEvent.setup()
    const partnerProfile = {
      id: "guest-test",
      name: "Партнер Іван",
      phone: "+380671112233",
      city: "Ужгород",
      verificationStatus: "verified" as const,
      verification: { phone: true, email: false },
    }
    const providerRecord = {
      id: "provider-guest-test",
      name: "Партнер Іван",
      phone: "+380671112233",
      city: "Ужгород",
      vehicle: "Volkswagen Crafter",
      plate: "BX5874HX",
      registeredAt: "2026-08-09T00:00:00",
      verificationStatus: "verified",
      verification: { phone: true },
      specialties: ["tow", "fuel"],
      serviceRadiusKm: 15,
      status: "offline",
    }

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url) => {
        if (url.includes("/users/") && url.includes("/account/role")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-test",
              preferredRole: "customer",
              linkedProviderId: "provider-guest-test",
              rolesRegistered: ["provider", "customer"],
              clientRegistered: true,
              providerRegistered: true,
              needsOnboarding: false,
              profile: partnerProfile,
            }),
          })
        }
        if (url.includes("/users/") && url.includes("/account")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-test",
              preferredRole: "provider",
              linkedProviderId: "provider-guest-test",
              rolesRegistered: ["provider"],
              clientRegistered: false,
              providerRegistered: true,
              needsOnboarding: false,
              profile: partnerProfile,
            }),
          })
        }
        if (url.includes("/auth/provider/self/session")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              role: "provider",
              subjectId: "provider-guest-test",
              providerId: "provider-guest-test",
              tokenType: "Bearer",
              accessToken: "pomich_auth_v1.provider-self",
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            }),
          })
        }
        if (url.includes("/providers/provider-guest-test/")) {
          return Promise.resolve({ ok: true, json: async () => providerRecord })
        }
        if (url.endsWith("/providers") || url.includes("/map/providers")) {
          return Promise.resolve({
            ok: true,
            json: async () => [providerRecord],
          })
        }
        return undefined
      }),
    )

    window.localStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem(
      "pomichLinkedProviderId",
      "provider-guest-test",
    )
    window.localStorage.setItem(
      "pomichPartnerRegistered:provider-guest-test",
      "1",
    )
    window.sessionStorage.setItem(
      "pomichBootstrapProfile",
      JSON.stringify(partnerProfile),
    )
    storeAuthSession(authSessionStorageKey("customer", "guest-test"), {
      role: "customer",
      subjectId: "guest-test",
      customerId: "guest-test",
      tokenType: "Bearer",
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: partnerProfile,
    })
    storeAuthSession(authSessionStorageKey("provider", "provider-guest-test"), {
      role: "provider",
      subjectId: "provider-guest-test",
      providerId: "provider-guest-test",
      tokenType: "Bearer",
      accessToken: "pomich_auth_v1.provider-self",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })

    window.history.replaceState({}, "", "/?role=provider")
    renderApp()
    expect(
      await screen.findByText("Партнер POMICH", {}, { timeout: 8000 }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Змінити роль/i }))
    expect(await screen.findByText(/Оберіть вашу роль/i)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Я клієнт/i }))

    expect(
      await screen.findByText("Що сталося?", {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація клієнта/i)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Потрібно завершити реєстрацію клієнта/i),
    ).not.toBeInTheDocument()
  })

  it("role switch with linked provider and missing SQL row stays on duty and prefills completion form", async () => {
    const user = userEvent.setup()
    const linkedProfile = {
      ...verifiedTestProfile,
      name: "Віталій",
      phone: "+380661007434",
      city: "Ужгород",
    }
    const emptyProviderShell = {
      id: "provider-guest-test",
      name: "Віталій",
      phone: "+380661007434",
      city: "Ужгород",
      vehicle: "",
      plate: "",
      status: "offline",
      verificationStatus: "verified",
      verification: { phone: true },
      specialties: [],
      serviceRadiusKm: 15,
    }

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url, init) => {
        if (url.includes("/users/") && url.includes("/account/role")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-test",
              preferredRole: "provider",
              linkedProviderId: "provider-guest-test",
              rolesRegistered: ["customer"],
              clientRegistered: true,
              // SQL provider row missing → API reports not registered.
              providerRegistered: false,
              needsOnboarding: false,
              profile: linkedProfile,
            }),
          })
        }
        if (url.includes("/users/") && url.includes("/account")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-test",
              preferredRole: "customer",
              linkedProviderId: "provider-guest-test",
              rolesRegistered: ["customer"],
              clientRegistered: true,
              providerRegistered: false,
              needsOnboarding: false,
              profile: linkedProfile,
            }),
          })
        }
        if (url.includes("/auth/provider/self/session")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              role: "provider",
              subjectId: "provider-guest-test",
              providerId: "provider-guest-test",
              tokenType: "Bearer",
              accessToken: "pomich_auth_v1.provider-self",
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            }),
          })
        }
        if (url.includes("/providers/provider-guest-test/")) {
          return Promise.resolve({
            ok: true,
            json: async () => emptyProviderShell,
          })
        }
        if (url.includes("/customers/") && url.includes("/profile")) {
          return Promise.resolve({ ok: true, json: async () => linkedProfile })
        }
        if (url.endsWith("/providers") || url.includes("/map/providers")) {
          return Promise.resolve({ ok: true, json: async () => [] })
        }
        return undefined
      }),
    )

    window.localStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem(
      "pomichLinkedProviderId",
      "provider-guest-test",
    )
    window.sessionStorage.setItem(
      "pomichBootstrapProfile",
      JSON.stringify(linkedProfile),
    )
    storeAuthSession(authSessionStorageKey("customer", "guest-test"), {
      role: "customer",
      subjectId: "guest-test",
      customerId: "guest-test",
      tokenType: "Bearer",
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: linkedProfile,
    })

    await openCustomerHome(user)
    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Змінити роль/i }))
    expect(await screen.findByText(/Оберіть вашу роль/i)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Я партнер/i }))

    // Linked returning partner must not land on blank first-time registration.
    expect(
      await screen.findByText("Партнер POMICH", {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Завершити профіль/i }))
    expect(await screen.findByText(/Профіль партнера/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue("Віталій")).toBeInTheDocument()
    expect(screen.getByDisplayValue("66 100 74 34")).toBeInTheDocument()
    // Form plate must stay mounted (not a blank map-only shell).
    expect(
      screen.getByRole("button", { name: /Зберегти профіль/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Назад/i })).toBeInTheDocument()
    expect(document.querySelector(".pomich-screen-layout--form")).not.toBeNull()
  })

  it("opens partner duty go-online UI from ?screen=duty deep link", async () => {
    const user = userEvent.setup()
    const providerRecord = {
      id: "provider-guest-test",
      name: "Партнер Тест",
      phone: "+380671112233",
      city: "Ужгород",
      vehicle: "Volkswagen Crafter",
      plate: "BX5874HX",
      registeredAt: "2026-08-09T00:00:00",
      verificationStatus: "verified",
      verification: { phone: true },
      specialties: ["tow", "fuel"],
      serviceRadiusKm: 15,
      status: "offline",
    }

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url) => {
        if (url.includes("/users/") && url.includes("/account")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-test",
              preferredRole: "provider",
              linkedProviderId: "provider-guest-test",
              rolesRegistered: ["customer", "provider"],
              clientRegistered: true,
              providerRegistered: true,
              needsOnboarding: false,
              profile: verifiedTestProfile,
            }),
          })
        }
        if (url.includes("/auth/provider/self/session")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              role: "provider",
              subjectId: "provider-guest-test",
              providerId: "provider-guest-test",
              tokenType: "Bearer",
              accessToken: "pomich_auth_v1.provider-self",
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            }),
          })
        }
        if (url.includes("/providers/provider-guest-test/presence")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ ...providerRecord, status: "online" }),
          })
        }
        if (url.includes("/providers/provider-guest-test/")) {
          return Promise.resolve({ ok: true, json: async () => providerRecord })
        }
        if (url.endsWith("/providers") || url.includes("/map/providers")) {
          return Promise.resolve({
            ok: true,
            json: async () => [providerRecord],
          })
        }
        return undefined
      }),
    )

    window.localStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem(
      "pomichLinkedProviderId",
      "provider-guest-test",
    )
    window.localStorage.setItem(
      "pomichPartnerRegistered:provider-guest-test",
      "1",
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

    window.history.pushState(
      {},
      "",
      "/?role=provider&tgBot=provider&screen=duty",
    )
    renderApp()

    expect(
      await screen.findByText("Партнер POMICH", {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()
    // Deep link auto-attempts go-online once session is ready.
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/providers/provider-guest-test/presence"),
        expect.objectContaining({ method: "PATCH" }),
      )
    })
    expect(await screen.findAllByText("На лінії")).not.toHaveLength(0)
  })

  it("opens partner cabinet from ?screen=cabinet deep link", async () => {
    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url) => {
        if (url.includes("/users/") && url.includes("/account")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-test",
              preferredRole: "provider",
              linkedProviderId: "provider-guest-test",
              rolesRegistered: ["customer", "provider"],
              clientRegistered: true,
              providerRegistered: true,
              needsOnboarding: false,
              profile: verifiedTestProfile,
            }),
          })
        }
        if (url.includes("/auth/provider/self/session")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              role: "provider",
              subjectId: "provider-guest-test",
              providerId: "provider-guest-test",
              tokenType: "Bearer",
              accessToken: "pomich_auth_v1.provider-self",
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            }),
          })
        }
        if (url.includes("/providers/provider-guest-test/")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: "provider-guest-test",
              name: "Партнер Тест",
              phone: "+380671112233",
              registeredAt: "2026-08-09T00:00:00",
              verificationStatus: "verified",
              verification: { phone: true },
              specialties: ["tow"],
              status: "offline",
            }),
          })
        }
        return undefined
      }),
    )

    window.localStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem(
      "pomichLinkedProviderId",
      "provider-guest-test",
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

    window.history.pushState(
      {},
      "",
      "/?role=provider&tgBot=provider&screen=cabinet",
    )
    renderApp()

    expect(
      await screen.findByText("Кабінет партнера", {}, { timeout: 8000 }),
    ).toBeInTheDocument()
  })

  it("after logout, choosing partner opens phone login and restores registered partner", async () => {
    const user = userEvent.setup()
    const partnerProfile = {
      ...verifiedTestProfile,
      id: "guest-vitaliy",
      name: "Віталій",
      phone: "+380661007434",
    }
    const providerRecord = {
      id: "provider-guest-vitaliy",
      name: "Віталій",
      phone: "+380661007434",
      city: "Ужгород",
      vehicle: "Volkswagen Crafter",
      plate: "BX5874HX",
      registeredAt: "2026-08-09T00:00:00",
      verificationStatus: "verified",
      verification: { phone: true },
      specialties: ["tow", "fuel"],
      serviceRadiusKm: 15,
      status: "offline",
    }

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url, init) => {
        if (url.includes("/auth/customer/phone/login/send")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              channel: "telegram",
              expiresAt: new Date(Date.now() + 600000).toISOString(),
            }),
          })
        }
        if (url.includes("/auth/customer/phone/login/confirm")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              role: "customer",
              subjectId: "guest-vitaliy",
              customerId: "guest-vitaliy",
              accessToken: TEST_CUSTOMER_TOKEN,
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              profile: partnerProfile,
              account: {
                customerId: "guest-vitaliy",
                preferredRole: "provider",
                linkedProviderId: "provider-guest-vitaliy",
                rolesRegistered: ["customer", "provider"],
                clientRegistered: true,
                providerRegistered: true,
                needsOnboarding: false,
                profile: partnerProfile,
              },
            }),
          })
        }
        if (url.includes("/users/") && url.includes("/account/role")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-vitaliy",
              preferredRole: "provider",
              linkedProviderId: "provider-guest-vitaliy",
              rolesRegistered: ["customer", "provider"],
              clientRegistered: true,
              providerRegistered: true,
              needsOnboarding: false,
              profile: partnerProfile,
            }),
          })
        }
        if (url.includes("/users/") && url.includes("/account")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-vitaliy",
              preferredRole: "provider",
              linkedProviderId: "provider-guest-vitaliy",
              rolesRegistered: ["customer", "provider"],
              clientRegistered: true,
              providerRegistered: true,
              needsOnboarding: false,
              profile: partnerProfile,
            }),
          })
        }
        if (url.includes("/auth/provider/self/session")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              role: "provider",
              subjectId: "provider-guest-vitaliy",
              providerId: "provider-guest-vitaliy",
              tokenType: "Bearer",
              accessToken: "pomich_auth_v1.provider-self",
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            }),
          })
        }
        if (url.includes("/providers/provider-guest-vitaliy/")) {
          return Promise.resolve({ ok: true, json: async () => providerRecord })
        }
        if (url.endsWith("/providers") || url.includes("/map/providers")) {
          return Promise.resolve({
            ok: true,
            json: async () => [providerRecord],
          })
        }
        return undefined
      }),
    )

    renderApp()
    expect(
      await screen.findByText(/Допомога на дорозі за хвилини/i),
    ).toBeInTheDocument()

    // Landing «Партнер» must open phone login (not blank registration).
    await user.click(
      screen.getAllByRole("button", { name: /Надаю послуги/i })[0],
    )
    expect(await screen.findByText("Увійти")).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()

    const phoneInput = document.querySelector(
      'input[type="tel"]',
    ) as HTMLInputElement
    expect(phoneInput).toBeTruthy()
    await user.clear(phoneInput)
    await user.type(phoneInput, "661007434")
    await user.click(screen.getByRole("button", { name: /Надіслати код/i }))

    const codeInput = await screen.findByPlaceholderText(/6 цифр/i)
    await user.type(codeInput, "123456")
    await user.click(screen.getByRole("button", { name: /Підтвердити/i }))

    expect(
      await screen.findByText("Партнер POMICH", {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()
  })

  it("partner registration login CTA opens phone restore, not password dead-end", async () => {
    const user = userEvent.setup()
    window.history.pushState({}, "", "/?role=provider")
    renderApp()

    expect(await screen.findByText("Реєстрація партнера")).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: /Вже маєте акаунт\? Увійти/i }),
    )

    expect(await screen.findByText("Увійти")).toBeInTheDocument()
    expect(screen.getByText(/Код надійде у Telegram/i)).toBeInTheDocument()
    expect(document.querySelector('input[type="tel"]')).toBeTruthy()
    expect(screen.queryByText("Вхід партнера")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Логін")).not.toBeInTheDocument()
  })

  it("shows nearby providers before a customer creates an order", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url) => {
        if (url.includes("/providers")) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: "provider-oleksandr",
                name: "Олександр",
                status: "online",
                verificationStatus: "verified",
                vehicle: "Volkswagen Transporter",
                etaMinutes: 12,
                location: { lat: 50.452, lng: 30.525 },
              },
              {
                id: "provider-mykhailo",
                name: "Михайло",
                status: "online",
                verificationStatus: "verified",
                vehicle: "Renault Master",
                etaMinutes: 18,
                location: { lat: 50.448, lng: 30.521 },
              },
            ],
          })
        }
        return undefined
      }),
    )

    await openCustomerHome(user)

    expect(await screen.findByText("2 на лінії поруч")).toBeInTheDocument()
    // Subtitle uses a middle-dot separator; match name from the live availability list.
    expect(
      await screen.findByText(/Олександр · Volkswagen Transporter/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/Михайло · Renault Master/i)).toBeInTheDocument()
  })

  it("lets a provider go on duty before seeing offers", async () => {
    const user = userEvent.setup()
    const providerSessionToken = "pomich_auth_v1.provider-session"
    const completedProvider = {
      id: "provider-oleksandr",
      name: "Олександр",
      phone: "+380671112233",
      city: "Ужгород",
      vehicle: "Volkswagen Crafter",
      plate: "BX5874HX",
      registeredAt: "2026-08-09T00:00:00",
      verificationStatus: "verified",
      specialties: ["tow", "fuel"],
      serviceRadiusKm: 9,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
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
          json: async () => [{ ...completedProvider, status: "offline" }],
        })
      }
      if (url.includes("/providers/provider-oleksandr/profile")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...completedProvider, status: "offline" }),
        })
      }
      if (url.includes("/map/providers")) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...completedProvider, status: "online" }),
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    window.history.pushState({}, "", "/?providerToken=partner-secret")

    renderApp()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/auth/provider/session"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-POMICH-Provider-Token": "partner-secret",
          }),
        }),
      )
    })
    expect(window.location.search).not.toContain("providerToken")

    expect(await screen.findByText("Партнер POMICH")).toBeInTheDocument()
    expect(screen.getByText("Поза лінією")).toBeInTheDocument()

    await user.click(screen.getByRole("switch", { name: /Поза лінією/i }))

    expect(await screen.findAllByText("На лінії")).not.toHaveLength(0)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/providers/provider-oleksandr/presence"),
        expect.objectContaining({
          method: "PATCH",
          headers: expect.objectContaining({
            Authorization: `Bearer ${providerSessionToken}`,
          }),
        }),
      )
    })
  })

  it("shows partner name and proposed price after accept polling", async () => {
    window.localStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem("pomichCustomerId", "guest-test")
    window.sessionStorage.setItem(
      "pomichBootstrapProfile",
      JSON.stringify(verifiedTestProfile),
    )
    window.sessionStorage.setItem(
      "pomichActiveOrder",
      JSON.stringify({
        orderId: "ORD-PRICE-1",
        status: "accepted",
        updatedAt: Date.now(),
      }),
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
              profile: verifiedTestProfile,
            }),
          })
        }
        if (url.includes("/orders/ORD-PRICE-1")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: "ORD-PRICE-1",
              status: "accepted",
              partnerProposedPrice: 1500,
              providerName: "Віталій",
              assignedProvider: {
                id: "provider-vitaliy",
                name: "Віталій",
                vehicle: "Ford Transit",
                plate: "AO1234CH",
                etaMinutes: 8,
              },
            }),
          })
        }
        return undefined
      }),
    )

    renderApp()

    expect(
      await screen.findByText("Партнер прийняв заявку", {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    expect(screen.getByText("Віталій")).toBeInTheDocument()
    expect(screen.getAllByText(/1[\s\u00a0]?500\s*₴/).length).toBeGreaterThan(0)
    expect(
      screen.getByRole("button", { name: /Підтвердити ціну/i }),
    ).toBeInTheDocument()
  }, 15000)

  it("shows provider cabinet with synced online status and editable profile", async () => {
    const user = userEvent.setup()
    const providerSessionToken = "pomich_auth_v1.provider-session"
    let providerStatus = "offline"
    const providerRecord = {
      id: "provider-oleksandr",
      name: "Олександр",
      phone: "+380671112233",
      city: "Ужгород",
      vehicle: "Volkswagen Crafter",
      plate: "BX5874HX",
      registeredAt: "2026-08-09T00:00:00",
      verificationStatus: "verified",
      specialties: ["tow", "fuel"],
      serviceRadiusKm: 9,
      get status() {
        return providerStatus
      },
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
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
      if (
        url.includes("/providers/provider-oleksandr/profile") &&
        init?.method === "PATCH"
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...providerRecord, name: "Михайло" }),
        })
      }
      if (url.includes("/providers/provider-oleksandr/profile")) {
        return Promise.resolve({ ok: true, json: async () => providerRecord })
      }
      if (
        url.includes("/providers/provider-oleksandr/presence") &&
        init?.method === "PATCH"
      ) {
        providerStatus = "online"
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...providerRecord, status: "online" }),
        })
      }
      if (url.includes("/providers/provider-oleksandr/offers")) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      if (url.endsWith("/providers")) {
        return Promise.resolve({ ok: true, json: async () => [providerRecord] })
      }
      if (url.includes("/map/providers")) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => providerRecord })
    })
    vi.stubGlobal("fetch", fetchMock)
    window.history.pushState({}, "", "/?providerToken=partner-secret")

    renderApp()

    expect(await screen.findByText("Партнер POMICH")).toBeInTheDocument()
    await user.click(screen.getByRole("switch", { name: /Поза лінією/i }))
    expect(await screen.findAllByText("На лінії")).not.toHaveLength(0)

    await user.click(screen.getByRole("button", { name: /^Кабінет$/i }))
    expect(await screen.findByText("Кабінет партнера")).toBeInTheDocument()
    expect(screen.getByText("Олександр")).toBeInTheDocument()
    expect(screen.getAllByText("На лінії").length).toBeGreaterThan(0)
    expect(screen.queryByText("Не перевірено")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /^Редагувати$/i }))
    const nameInput = screen.getByPlaceholderText("Ваше ім'я")
    await user.clear(nameInput)
    await user.type(nameInput, "Михайло")
    await user.click(screen.getAllByRole("button", { name: /^Зберегти$/i })[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/providers/provider-oleksandr/profile"),
        expect.objectContaining({ method: "PATCH" }),
      )
    })
  })

  it("shows clear toast when go-online hits provider identity mismatch", async () => {
    const user = userEvent.setup()
    const providerSessionToken = "pomich_auth_v1.provider-session"
    const completedProvider = {
      id: "provider-tg-829741830",
      name: "Віталій",
      phone: "+380671112233",
      city: "Ужгород",
      vehicle: "Ford Transit",
      plate: "AO1234CH",
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
              subjectId: "provider-tg-829741830",
              providerId: "provider-tg-829741830",
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
        if (url.includes("/providers/provider-tg-829741830/profile")) {
          return Promise.resolve({
            ok: true,
            json: async () => completedProvider,
          })
        }
        if (url.includes("/presence")) {
          return Promise.resolve({
            ok: false,
            status: 403,
            json: async () => ({ detail: "provider_identity_mismatch" }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => completedProvider,
        })
      }),
    )
    window.history.pushState(
      {},
      "",
      "/?providerToken=partner-secret&providerId=provider-tg-829741830",
    )

    renderApp()

    expect(await screen.findByText("Партнер POMICH")).toBeInTheDocument()
    await user.click(screen.getByRole("switch", { name: /вийти на лінію/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Акаунт партнера не збігається",
    )
  })

  it("lets a provider open phone restore from registration instead of password dead-end", async () => {
    const user = userEvent.setup()
    renderApp()

    const partnerButtons = await screen.findAllByRole("button", {
      name: /Надаю послуги/i,
    })
    await user.click(partnerButtons[0]!)
    // Landing partner entry is phone login for returning partners.
    expect(await screen.findByText("Увійти")).toBeInTheDocument()
    expect(screen.queryByText(/Реєстрація партнера/i)).not.toBeInTheDocument()
    expect(document.querySelector('input[type="tel"]')).toBeTruthy()
  })
})
