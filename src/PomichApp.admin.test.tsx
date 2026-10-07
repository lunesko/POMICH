import { renderApp } from "./testSupport/pomichFlows"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

describe("POMICH admin", () => {
  it("opens the admin panel and updates an order status", async () => {
    const user = userEvent.setup()
    const adminSessionToken = "pomich_auth_v1.admin-session"
    const adminPayload = {
      totals: {
        clients: 1,
        providers: 1,
        dispatchProviders: 1,
        directoryProviders: 0,
        orders: 1,
        activeOrders: 1,
        completedOrders: 0,
      },
      providers: {
        online: 1,
        busy: 0,
        offline: 0,
        verified: 1,
        pendingVerification: 0,
      },
      clients: { verified: 1, registered: 1, disabled: 0 },
      orders: { searching: 1, assigned: 0, enRoute: 0, inProgress: 0 },
      activity: [
        {
          type: "order",
          id: "PM-1",
          status: "searching",
          service: "tow",
          source: "telegram",
          at: "2026-08-09T00:00:00",
        },
      ],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/auth/admin/session")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: "admin",
            subjectId: "admin",
            tokenType: "Bearer",
            accessToken: adminSessionToken,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.includes("/admin/stats"))
        return Promise.resolve({ ok: true, json: async () => adminPayload })
      if (url.includes("/admin/ops-log")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            events: [],
            counts: { error: 0, warn: 0, info: 0, total: 0 },
            limit: 100,
          }),
        })
      }
      if (url.includes("/admin/clients"))
        return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes("/admin/providers"))
        return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes("/admin/settings"))
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runtime: "dev",
            corsOrigins: ["*"],
            encryptionEnabled: false,
            databaseUrlConfigured: false,
            telegramConfigured: false,
            adminAccountsConfigured: true,
            providerAccountsConfigured: false,
            allowHttpPilot: false,
            sessionTtlSeconds: 86400,
          }),
        })
      if (url.includes("/map/providers"))
        return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes("/orders/PM-1/status")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "PM-1",
            status: "en_route",
            updatedAt: "2026-08-09T00:05:00",
          }),
        })
      }
      if (url.includes("/admin/orders") || url.endsWith("/orders")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "PM-1",
              status: "assigned",
              service: "tow",
              source: "telegram",
              customerLocation: "вул. Собранецька",
              destination: "СТО",
              vehicleState: "Авто не заводиться",
              chatId: "42",
              telegramUsername: "driver_help",
              createdAt: "2026-08-09T00:00:00",
              statusHistory: [
                { status: "matching", at: "2026-08-09T00:00:00" },
              ],
            },
          ],
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal("fetch", fetchMock)
    window.history.pushState({}, "", "/?role=admin&adminToken=test-admin")

    renderApp()

    expect(await screen.findByText("POMICH Admin")).toBeInTheDocument()
    expect(window.location.search).not.toContain("adminToken")
    await user.click(screen.getByRole("button", { name: /Заявки/i }))
    const enRouteButtons = await screen.findAllByRole("button", {
      name: /Виконавець у дорозі/i,
    })
    await user.click(enRouteButtons[enRouteButtons.length - 1])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/orders/PM-1/status"),
        expect.objectContaining({
          method: "PATCH",
          headers: expect.objectContaining({
            Authorization: `Bearer ${adminSessionToken}`,
          }),
        }),
      )
    })
  })

  it("opens admin login from #admin hash on initial load", async () => {
    window.history.pushState({}, "", "/#admin")

    renderApp()

    expect(await screen.findByText("Захищена адмін-панель")).toBeInTheDocument()
    expect(
      screen.queryByText(/Допомога на дорозі за хвилини/i),
    ).not.toBeInTheDocument()
    expect(window.location.search).toBe("?role=admin")
    expect(window.location.hash).toBe("")
  })

  it("opens admin login when hash changes to #admin", async () => {
    renderApp()
    expect(
      await screen.findByText(/Допомога на дорозі за хвилини/i),
    ).toBeInTheDocument()

    window.location.hash = "#admin"
    window.dispatchEvent(new HashChangeEvent("hashchange"))

    expect(await screen.findByText("Захищена адмін-панель")).toBeInTheDocument()
    expect(window.location.search).toBe("?role=admin")
  })

  it("lets an admin sign in with an account without a bootstrap token", async () => {
    const user = userEvent.setup()
    const adminSessionToken = "pomich_auth_v1.admin-account-session"
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/auth/admin/login")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            role: "admin",
            subjectId: "dispatcher",
            username: "dispatcher",
            tokenType: "Bearer",
            accessToken: adminSessionToken,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          }),
        })
      }
      if (url.includes("/admin/stats")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            totals: {
              clients: 0,
              providers: 0,
              dispatchProviders: 0,
              directoryProviders: 0,
              orders: 0,
              activeOrders: 0,
              completedOrders: 0,
            },
            providers: {
              online: 0,
              busy: 0,
              offline: 0,
              verified: 0,
              pendingVerification: 0,
            },
            clients: { verified: 0, registered: 0, disabled: 0 },
            orders: { searching: 0, assigned: 0, enRoute: 0, inProgress: 0 },
            activity: [],
          }),
        })
      }
      if (url.includes("/admin/ops-log")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            events: [],
            counts: { error: 0, warn: 0, info: 0, total: 0 },
            limit: 100,
          }),
        })
      }
      if (url.includes("/admin/clients"))
        return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes("/admin/providers"))
        return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes("/admin/orders"))
        return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes("/admin/settings"))
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runtime: "dev",
            corsOrigins: ["*"],
            encryptionEnabled: false,
            databaseUrlConfigured: false,
            telegramConfigured: false,
            adminAccountsConfigured: true,
            providerAccountsConfigured: false,
            allowHttpPilot: false,
            sessionTtlSeconds: 86400,
          }),
        })
      if (url.includes("/map/providers"))
        return Promise.resolve({ ok: true, json: async () => [] })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal("fetch", fetchMock)
    window.history.pushState({}, "", "/?role=admin")

    renderApp()

    expect(await screen.findByText("Захищена адмін-панель")).toBeInTheDocument()
    await user.type(screen.getByLabelText("Пароль"), "admin-pass")
    await user.click(screen.getByRole("button", { name: /Увійти/i }))

    expect(await screen.findByText("POMICH Admin")).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/auth/admin/login"),
        expect.objectContaining({
          method: "POST",
          headers: expect.not.objectContaining({
            "X-POMICH-Admin-Token": expect.any(String),
          }),
        }),
      )
    })
  })
})
