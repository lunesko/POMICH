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

import {
  authSessionStorageKey,
  EXPLICIT_LOGOUT_STORAGE_KEY,
  storeAuthSession,
} from "./lib/auth"

describe("POMICH accounts", () => {
  it("shows stale web session on registration and allows logout", async () => {
    const user = userEvent.setup()
    storeAuthSession(authSessionStorageKey("customer", "guest-roman"), {
      role: "customer",
      subjectId: "guest-roman",
      customerId: "guest-roman",
      tokenType: "Bearer",
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: {
        id: "guest-roman",
        name: "Roman",
        phone: "+380671112233",
        verificationStatus: "verified",
      },
    })
    window.localStorage.setItem("pomichCustomerId", "guest-roman")
    window.sessionStorage.setItem(
      "pomichBootstrapProfile",
      JSON.stringify({
        id: "guest-roman",
        name: "Roman",
        phone: "+380671112233",
      }),
    )

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url) => {
        if (url.includes("/users/") && url.includes("/account")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-roman",
              preferredRole: "",
              linkedProviderId: "",
              rolesRegistered: [],
              clientRegistered: false,
              providerRegistered: false,
              needsOnboarding: true,
              profile: {
                id: "guest-roman",
                name: "Roman",
                phone: "+380671112233",
                verificationStatus: "verified",
              },
            }),
          })
        }
        return undefined
      }),
    )

    renderApp()
    await user.click(
      await screen.findByRole("button", { name: /Зареєструватися/i }),
    )
    await user.click(await screen.findByRole("button", { name: /Я клієнт/i }))

    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()
    expect(screen.getByText(/Ви увійшли як:.*Roman/i)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^Вийти$/i }))

    expect(
      await screen.findByText(/Допомога на дорозі за хвилини/i),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem("pomichCustomerId")).toBeNull()
  })

  it("opens client registration directly from role deep link", async () => {
    window.history.pushState({}, "", "/?role=customer")
    renderApp()

    expect(await screen.findByText("Реєстрація клієнта")).toBeInTheDocument()
    expect(
      screen.queryByText(/Допомога на дорозі за хвилини/i),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(window.location.search).not.toContain("role=")
    })
  })

  it("restores verified web session from landing login without OTP", async () => {
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

    renderApp()
    await user.click(await screen.findByRole("button", { name: /^Увійти$/i }))

    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()
    expect(
      screen.queryByText(/Код надійде у Telegram/i),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Реєстрація клієнта")).not.toBeInTheDocument()
    expect(
      window.sessionStorage.getItem(
        authSessionStorageKey("customer", "guest-test"),
      ),
    ).not.toBeNull()
  })

  it("preserves session when logged-in customer opens Меню then Увійти", async () => {
    const user = userEvent.setup()
    const romanProfile = {
      ...verifiedTestProfile,
      id: "guest-roman",
      name: "Roman",
      phone: "+380935718207",
    }
    window.localStorage.setItem("pomichCustomerId", "guest-roman")
    window.sessionStorage.setItem("pomichCustomerId", "guest-roman")
    window.sessionStorage.setItem(
      "pomichBootstrapProfile",
      JSON.stringify(romanProfile),
    )
    storeAuthSession(authSessionStorageKey("customer", "guest-roman"), {
      role: "customer",
      subjectId: "guest-roman",
      customerId: "guest-roman",
      tokenType: "Bearer",
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: romanProfile,
    })

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url) => {
        if (url.includes("/users/") && url.includes("/account")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-roman",
              preferredRole: "customer",
              linkedProviderId: "",
              rolesRegistered: ["customer"],
              clientRegistered: true,
              providerRegistered: false,
              needsOnboarding: false,
              profile: romanProfile,
            }),
          })
        }
        if (url.includes("/customers/") && url.includes("/profile")) {
          return Promise.resolve({ ok: true, json: async () => romanProfile })
        }
        return undefined
      }),
    )

    window.history.pushState({}, "", "/?role=customer")
    renderApp()
    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()
    expect(screen.getByText(/Ви увійшли як:.*Roman/i)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /^POMICH$/i }))
    expect(
      await screen.findByText(/Допомога на дорозі за хвилини/i),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem("pomichCustomerId")).toBe("guest-roman")
    expect(
      window.sessionStorage.getItem(
        authSessionStorageKey("customer", "guest-roman"),
      ),
    ).not.toBeNull()

    await user.click(await screen.findByRole("button", { name: /^Увійти$/i }))
    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()
    expect(screen.getByText(/Ви увійшли як:.*Roman/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/Код надійде у Telegram/i),
    ).not.toBeInTheDocument()
  })

  it("shows phone login instead of registration when browser login has no stored session", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url, init) => {
        if (url.includes("/auth/customer/guest/session")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              role: "customer",
              subjectId: "guest-fresh",
              customerId: "guest-fresh",
              accessToken: TEST_CUSTOMER_TOKEN,
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              profile: {
                id: "guest-fresh",
                name: "Клієнт POMICH",
                phone: "",
                verificationStatus: "unverified",
              },
              account: {
                customerId: "guest-fresh",
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
        if (url.includes("/users/") && url.includes("/account")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-fresh",
              preferredRole: "",
              linkedProviderId: "",
              rolesRegistered: [],
              clientRegistered: false,
              providerRegistered: false,
              needsOnboarding: true,
            }),
          })
        }
        return undefined
      }),
    )

    renderApp()
    await user.click(await screen.findByRole("button", { name: /^Увійти$/i }))

    expect(
      await screen.findByText(/Код надійде у Telegram/i),
    ).toBeInTheDocument()
    expect(screen.queryByText("Реєстрація клієнта")).not.toBeInTheDocument()
  })

  it("shows phone login when login boot cannot restore stale web session", async () => {
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

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url) => {
        if (url.includes("/users/") && url.includes("/account")) {
          return Promise.reject(new Error("stale_session"))
        }
        if (url.includes("/auth/customer/guest/session")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              role: "customer",
              subjectId: "guest-fresh",
              customerId: "guest-fresh",
              accessToken: TEST_CUSTOMER_TOKEN,
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              profile: {
                id: "guest-fresh",
                name: "Клієнт POMICH",
                phone: "",
                verificationStatus: "unverified",
              },
              account: {
                customerId: "guest-fresh",
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
        return undefined
      }),
    )

    renderApp()
    await user.click(await screen.findByRole("button", { name: /^Увійти$/i }))

    expect(
      await screen.findByText(/Код надійде у Telegram/i),
    ).toBeInTheDocument()
    expect(screen.queryByText("Реєстрація клієнта")).not.toBeInTheDocument()
  })

  it("skips registration for returning client opened via role deep link", async () => {
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
    expect(screen.queryByText("Реєстрація клієнта")).not.toBeInTheDocument()
  })

  it("shows client registration for new Telegram user instead of phone login", async () => {
    window.history.pushState({}, "", "/?role=customer")
    window.Telegram = {
      WebApp: {
        initData: "telegram-init-data-stub",
        initDataUnsafe: {
          user: { id: 829741830, first_name: "Vitaliy", last_name: "Test" },
        },
        isVersionAtLeast: (version: string) =>
          Number(version.split(".")[0]) <= 8,
        requestContact: vi.fn(),
      },
    }

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/auth/customer/telegram/session")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: "customer",
            subjectId: "tg-829741830",
            customerId: "tg-829741830",
            accessToken: TEST_CUSTOMER_TOKEN,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: {
              id: "tg-829741830",
              name: "Vitaliy Test",
              phone: "",
              verificationStatus: "unverified",
            },
            account: {
              customerId: "tg-829741830",
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
      if (url.includes("/map/providers") || url.endsWith("/providers")) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal("fetch", fetchMock)

    renderApp()

    expect(await screen.findByText("Реєстрація клієнта")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Vitaliy Test")).toBeInTheDocument()
    expect(
      screen.queryByText(/Код надійде у Telegram/i),
    ).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/customer/telegram/session"),
      expect.any(Object),
    )
  })

  it("prefers telegram session over stale web guest token in Telegram WebApp", async () => {
    const tgProfile = { ...verifiedTestProfile, id: "tg-42" }
    window.Telegram = {
      WebApp: {
        initData: "telegram-init-data-stub",
        initDataUnsafe: { user: { id: 42, first_name: "Vitaliy" } },
      },
    }
    storeAuthSession(authSessionStorageKey("customer", "guest-stale"), {
      role: "customer",
      subjectId: "guest-stale",
      customerId: "guest-stale",
      tokenType: "Bearer",
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/auth/customer/telegram/session")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: "customer",
            subjectId: "tg-42",
            customerId: "tg-42",
            accessToken: TEST_CUSTOMER_TOKEN,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: tgProfile,
            account: {
              customerId: "tg-42",
              preferredRole: "customer",
              linkedProviderId: "",
              rolesRegistered: ["customer"],
              clientRegistered: true,
              providerRegistered: false,
              needsOnboarding: false,
              profile: tgProfile,
            },
          }),
        })
      }
      if (url.includes("/map/providers") || url.endsWith("/providers")) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal("fetch", fetchMock)

    renderApp()

    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()
    expect(screen.queryByText("Реєстрація клієнта")).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/customer/telegram/session"),
      expect.any(Object),
    )
  })

  it("logs out in Telegram WebApp and stays on landing after reload", async () => {
    const user = userEvent.setup()
    const tgProfile = { ...verifiedTestProfile, id: "tg-42", name: "Vitaliy" }
    window.Telegram = {
      WebApp: {
        initData: "telegram-init-data-stub",
        initDataUnsafe: { user: { id: 42, first_name: "Vitaliy" } },
      },
    }

    const telegramSessionCalls: string[] = []
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/auth/customer/telegram/session")) {
        telegramSessionCalls.push(url)
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: "customer",
            subjectId: "tg-42",
            customerId: "tg-42",
            accessToken: TEST_CUSTOMER_TOKEN,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: tgProfile,
            account: {
              customerId: "tg-42",
              preferredRole: "customer",
              linkedProviderId: "",
              rolesRegistered: ["customer"],
              clientRegistered: true,
              providerRegistered: false,
              needsOnboarding: false,
              profile: tgProfile,
            },
          }),
        })
      }
      if (url.includes("/map/providers") || url.endsWith("/providers")) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal("fetch", fetchMock)

    const view = renderApp()

    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()
    expect(telegramSessionCalls.length).toBeGreaterThan(0)

    // Telegram chrome hides header «Вийти» — logout lives in cabinet.
    await user.click(screen.getByRole("button", { name: /^Кабінет$/i }))
    expect(await screen.findByText("Особистий кабінет")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^Вийти$/i }))

    expect(
      await screen.findByText(/Допомога на дорозі за хвилини/i),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem(EXPLICIT_LOGOUT_STORAGE_KEY)).toBe(
      "tg-42",
    )
    expect(screen.queryByText("Що сталося?")).not.toBeInTheDocument()

    view.unmount()
    telegramSessionCalls.length = 0
    renderApp()

    expect(
      await screen.findByText(/Допомога на дорозі за хвилини/i),
    ).toBeInTheDocument()
    expect(screen.queryByText("Що сталося?")).not.toBeInTheDocument()
    await waitFor(() => {
      expect(telegramSessionCalls).toHaveLength(0)
    })
  })

  it("restores registered Telegram client after logout when clicking login", async () => {
    const user = userEvent.setup()
    const tgProfile = {
      ...verifiedTestProfile,
      id: "tg-829741830",
      name: "Vitaliy",
      phone: "+380661007434",
    }
    window.Telegram = {
      WebApp: {
        initData: "telegram-init-data-stub",
        initDataUnsafe: { user: { id: 829741830, first_name: "Vitaliy" } },
      },
    }

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/auth/customer/telegram/session")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: "customer",
            subjectId: "tg-829741830",
            customerId: "tg-829741830",
            accessToken: TEST_CUSTOMER_TOKEN,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            profile: tgProfile,
            account: {
              customerId: "tg-829741830",
              preferredRole: "customer",
              linkedProviderId: "",
              rolesRegistered: ["customer"],
              clientRegistered: true,
              providerRegistered: false,
              needsOnboarding: false,
              profile: tgProfile,
            },
          }),
        })
      }
      if (url.includes("/map/providers") || url.endsWith("/providers")) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal("fetch", fetchMock)

    renderApp()
    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()

    // Telegram chrome hides header «Вийти» — logout lives in cabinet.
    await user.click(screen.getByRole("button", { name: /^Кабінет$/i }))
    expect(await screen.findByText("Особистий кабінет")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^Вийти$/i }))
    expect(
      await screen.findByText(/Допомога на дорозі за хвилини/i),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem(EXPLICIT_LOGOUT_STORAGE_KEY)).toBe(
      "tg-829741830",
    )

    await user.click(screen.getByRole("button", { name: /^Меню$/i }))
    await user.click(screen.getByRole("button", { name: /^Увійти$/i }))

    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()
    expect(screen.queryByText("Реєстрація клієнта")).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/customer/telegram/session"),
      expect.any(Object),
    )
  })

  it("opens role selection from register and enters the customer flow", async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)

    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Евакуатор/i }),
    ).toBeInTheDocument()
  })

  it("returns to role selection when switching role from the header", async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)

    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Змінити роль/i }))

    expect(await screen.findByText(/Оберіть вашу роль/i)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Я клієнт/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Я партнер/i }),
    ).toBeInTheDocument()
    // Role switch must keep the signed-in customer identity (not wipe like logout).
    expect(window.localStorage.getItem("pomichCustomerId")).toBe("guest-test")
    expect(
      window.sessionStorage.getItem(
        authSessionStorageKey("customer", "guest-test"),
      ),
    ).not.toBeNull()
  })

  it("phone_already_registered shows restore CTA and opens phone login", async () => {
    const user = userEvent.setup()
    window.history.pushState({}, "", "/?role=provider")

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url, init) => {
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
        if (
          url.includes("/providers/") &&
          url.includes("/profile") &&
          init?.method === "PATCH"
        ) {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({ detail: "phone_already_registered" }),
          })
        }
        if (url.includes("/users/") && url.includes("/account")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-test",
              preferredRole: "provider",
              linkedProviderId: "",
              rolesRegistered: [],
              clientRegistered: false,
              providerRegistered: false,
              needsOnboarding: true,
            }),
          })
        }
        if (url.endsWith("/providers") || url.includes("/map/providers")) {
          return Promise.resolve({ ok: true, json: async () => [] })
        }
        return undefined
      }),
    )

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

    renderApp()
    expect(await screen.findByText("Реєстрація партнера")).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/Ваше ім'я/i), "Віталій")
    const phoneInput = document.querySelector(
      'input[type="tel"]',
    ) as HTMLInputElement
    await user.clear(phoneInput)
    await user.type(phoneInput, "661007434")
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Марка авто/i }),
      "Volkswagen",
    )
    await user.selectOptions(
      screen.getByRole("combobox", { name: /^Модель$/i }),
      "Crafter",
    )

    const plateInput = screen.getByPlaceholderText(/AA 0000 AA/i)
    await user.clear(plateInput)
    await user.type(plateInput, "BX5874HX")

    await user.click(screen.getByRole("button", { name: /Евакуатор/i }))
    await user.click(screen.getByRole("button", { name: /Зареєструватись/i }))

    expect(
      await screen.findByRole("button", { name: /Увійти за цим номером/i }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: /Увійти за цим номером/i }),
    )

    expect(await screen.findByText("Увійти")).toBeInTheDocument()
    expect(document.querySelector('input[type="tel"]')).toBeTruthy()
    expect(screen.queryByText("Вхід партнера")).not.toBeInTheDocument()
  })

  it("starts fresh registration after logout then login instead of reusing customer-web profile", async () => {
    const user = userEvent.setup()
    const romanProfile = {
      id: "guest-roman",
      name: "Roman",
      phone: "+380935718207",
      verificationStatus: "verified" as const,
    }

    storeAuthSession(authSessionStorageKey("customer", "guest-roman"), {
      role: "customer",
      subjectId: "guest-roman",
      customerId: "guest-roman",
      tokenType: "Bearer",
      accessToken: TEST_CUSTOMER_TOKEN,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      profile: romanProfile,
    })
    window.localStorage.setItem("pomichCustomerId", "guest-roman")
    window.sessionStorage.setItem(
      "pomichBootstrapProfile",
      JSON.stringify(romanProfile),
    )

    const guestSessionCalls: Array<string | undefined> = []
    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url, init) => {
        if (url.includes("/auth/customer/guest/session")) {
          const body = init?.body
            ? JSON.parse(String(init.body)) as { customerId?: string }
            : {}
          guestSessionCalls.push(body.customerId)
          return Promise.resolve({
            ok: true,
            json: async () => ({
              role: "customer",
              subjectId: "guest-fresh",
              customerId: "guest-fresh",
              accessToken: TEST_CUSTOMER_TOKEN,
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              profile: {
                id: "guest-fresh",
                name: "Клієнт POMICH",
                phone: "",
                verificationStatus: "unverified",
              },
              account: {
                customerId: "guest-fresh",
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
        return undefined
      }),
    )

    await openCustomerHome(user)
    expect(await screen.findByText("Що сталося?")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /^Вийти$/i }))
    expect(
      await screen.findByText(/Допомога на дорозі за хвилини/i),
    ).toBeInTheDocument()

    await user.click(await screen.findByRole("button", { name: /^Увійти$/i }))

    expect(
      guestSessionCalls.some((customerId) => customerId === "customer-web"),
    ).toBe(false)
    expect(guestSessionCalls.length).toBeGreaterThan(0)
    expect(screen.queryByText("Roman")).not.toBeInTheDocument()
    expect(screen.queryByText(/Ви увійшли як:.*Roman/i)).not.toBeInTheDocument()
  })

  it("shows logout button in client cabinet", async () => {
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

    await user.click(screen.getByRole("button", { name: /^Кабінет$/i }))
    expect(await screen.findByText("Особистий кабінет")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Вийти$/i })).toBeInTheDocument()
  })

  it("shows registration for stale bootstrap without matching auth session", async () => {
    window.sessionStorage.setItem(
      "pomichBootstrapProfile",
      JSON.stringify({ ...verifiedTestProfile, id: "guest-other-device" }),
    )
    window.history.pushState({}, "", "/?role=customer")

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url) => {
        if (url.includes("/users/") && url.includes("/account")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-test",
              preferredRole: "",
              linkedProviderId: "",
              rolesRegistered: [],
              clientRegistered: false,
              providerRegistered: false,
              needsOnboarding: true,
            }),
          })
        }
        return undefined
      }),
    )

    renderApp()

    expect(await screen.findByText("Реєстрація клієнта")).toBeInTheDocument()
    expect(screen.queryByText("Що сталося?")).not.toBeInTheDocument()
  })

  it("shows OTP verification after client registration instead of entering app", async () => {
    const user = userEvent.setup()
    const unverifiedProfile = {
      id: "guest-test",
      name: "PowerGear",
      phone: "+380635236801",
      verificationStatus: "unverified" as const,
    }

    vi.stubGlobal(
      "fetch",
      mockRegisteredCustomerFetch((url, init) => {
        if (url.includes("/users/") && url.includes("/account/role")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              customerId: "guest-test",
              preferredRole: "customer",
              linkedProviderId: "",
              rolesRegistered: [],
              clientRegistered: false,
              providerRegistered: false,
              needsOnboarding: true,
              profile: {
                id: "guest-test",
                name: "Клієнт POMICH",
                phone: "",
                verificationStatus: "unverified",
              },
            }),
          })
        }
        if (
          url.includes("/customers/") &&
          url.includes("/profile") &&
          init?.method === "PATCH"
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => unverifiedProfile,
          })
        }
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
              profile: unverifiedProfile,
            }),
          })
        }
        if (url.includes("/auth/customer/verify/send")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              channel: "telegram",
              expiresAt: new Date(Date.now() + 600000).toISOString(),
            }),
          })
        }
        return undefined
      }),
    )

    renderApp()
    await user.click(
      await screen.findByRole("button", { name: /Зареєструватися/i }),
    )
    await user.click(await screen.findByRole("button", { name: /Я клієнт/i }))
    expect(await screen.findByText("Реєстрація клієнта")).toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText(/Ваше ім'я/i))
    await user.type(screen.getByPlaceholderText(/Ваше ім'я/i), "PowerGear")
    await user.type(screen.getByPlaceholderText(/66 123 45 67/i), "635236801")
    await user.click(screen.getByRole("button", { name: /Продовжити/i }))

    expect(
      (await screen.findAllByText("Підтвердження телефону")).length,
    ).toBeGreaterThan(0)
    await user.click(
      screen.getByRole("button", { name: /Надіслати код у Telegram/i }),
    )
    expect(await screen.findByPlaceholderText(/6 цифр/i)).toBeInTheDocument()
    expect(screen.queryByText("Що сталося?")).not.toBeInTheDocument()
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      expect(
        calls.some((call) =>
          String(call[0]).includes("/auth/customer/verify/send"),
        ),
      ).toBe(true)
    })
  })
})
