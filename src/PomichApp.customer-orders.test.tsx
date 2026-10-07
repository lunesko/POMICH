import {
  renderApp,
  mockRegisteredCustomerFetch,
  openCustomerHome,
} from "./testSupport/pomichFlows"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

describe("POMICH customer-orders", () => {
  it("opens incoming offer details and accepts with price", async () => {
    const user = userEvent.setup()
    const providerSessionToken = "pomich_auth_v1.provider-session"
    const watchPosition = vi.fn()
    const clearWatch = vi.fn()
    const navigatorStub = {
      ...navigator,
      geolocation: { getCurrentPosition: vi.fn(), watchPosition, clearWatch },
    }
    vi.stubGlobal("navigator", navigatorStub)
    const pendingOffer = {
      id: "OF-TEST-1",
      orderId: "ORD-TEST-1",
      providerId: "provider-oleksandr",
      status: "pending",
      service: "tow",
      distanceKm: 4.2,
      vehicleState: "Не заводиться",
      approximateLocation: "вул. Швабська, Ужгород",
      customerComment: "Потрібен евакуатор",
      customerCoordinates: { lat: 48.62, lng: 22.29 },
      expiresAt: new Date(Date.now() + 20000).toISOString(),
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
      if (url.includes("/users/") && url.includes("/account")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            customerId: "provider-oleksandr",
            preferredRole: "provider",
            linkedProviderId: "provider-oleksandr",
            rolesRegistered: ["provider"],
            clientRegistered: false,
            providerRegistered: true,
            needsOnboarding: false,
          }),
        })
      }
      if (
        url.includes("/providers/provider-oleksandr/presence") &&
        init?.method === "PATCH"
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "provider-oleksandr",
            name: "Олександр",
            status: "online",
            registeredAt: "2026-08-09T00:00:00",
            verificationStatus: "verified",
            specialties: ["tow", "fuel"],
            serviceRadiusKm: 9,
          }),
        })
      }
      if (
        url.includes("/providers/provider-oleksandr/offers") &&
        init?.method === "POST"
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            offer: { ...pendingOffer, status: "accepted" },
            order: {
              id: "ORD-TEST-1",
              status: "accepted",
              partnerProposedPrice: 1200,
            },
            provider: { id: "provider-oleksandr", status: "busy" },
          }),
        })
      }
      if (url.includes("/providers/provider-oleksandr/offers")) {
        return Promise.resolve({ ok: true, json: async () => [pendingOffer] })
      }
      if (url.includes("/providers/provider-oleksandr/profile")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "provider-oleksandr",
            name: "Олександр",
            phone: "+380671112233",
            city: "Ужгород",
            vehicle: "Volkswagen Crafter",
            plate: "BX5874HX",
            status: "online",
            registeredAt: "2026-08-09T00:00:00",
            verificationStatus: "verified",
            specialties: ["tow", "fuel"],
            serviceRadiusKm: 9,
          }),
        })
      }
      if (url.includes("/map/orders/nearby")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "ORD-TEST-1",
              service: "tow",
              customerLocation: "вул. Швабська, Ужгород",
              vehicleState: "Не заводиться",
              customerComment: "Потрібен евакуатор",
              customerCoordinates: { lat: 48.62, lng: 22.29 },
              distanceKm: 4.2,
            },
          ],
        })
      }
      if (url.endsWith("/providers") || /\/providers(\?|$)/.test(url)) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "provider-oleksandr",
              name: "Олександр",
              status: "online",
              registeredAt: "2026-08-09T00:00:00",
              verificationStatus: "verified",
              specialties: ["tow", "fuel"],
              serviceRadiusKm: 9,
            },
          ],
        })
      }
      if (url.includes("/map/providers")) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    vi.stubGlobal("fetch", fetchMock)
    window.history.pushState({}, "", "/?providerToken=partner-secret")

    renderApp()

    const openBtn = await screen.findByRole("button", {
      name: /Відкрити заявку/i,
    })
    await user.click(openBtn)

    await waitFor(
      () => {
        expect(
          screen.getByRole("dialog", { name: /Деталі заявки/i }),
        ).toBeInTheDocument()
      },
      { timeout: 5000 },
    )
    const inputs = screen.getAllByPlaceholderText("1200")
    await user.type(inputs[0], "1200")
    const acceptBtns = screen.getAllByRole("button", {
      name: /ПРИЙНЯТИ З ЦІНОЮ/i,
    })
    await user.click(acceptBtns[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "/providers/provider-oleksandr/offers/OF-TEST-1/accept",
        ),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"proposedPrice":1200'),
        }),
      )
    })
    expect(await screen.findByText("Очікуємо клієнта")).toBeInTheDocument()
  })

  it("moves from service selection to the tow flow", async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)

    await user.click(screen.getByRole("button", { name: /Евакуатор/i }))

    expect(screen.getByText("Де ви зараз?")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Підтвердити місце/i }))
    expect(screen.getByText("Куди доставити авто?")).toBeInTheDocument()

    await user.type(
      screen.getByPlaceholderText(/Київ/i),
      "Ужгород, СТО «Авторемонт»",
    )
    await user.click(screen.getByRole("button", { name: /Знайти адресу/i }))
    expect(
      await screen.findByText(/Точку доставки підтверджено/i),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^Далі$/i }))
    expect(screen.getByText("Підготуємо евакуатор")).toBeInTheDocument()
    await user.click(screen.getByRole("radio", { name: /Поломка/i }))
    await user.click(screen.getByRole("radio", { name: /колеса крутяться/i }))
    await user.click(screen.getByRole("button", { name: /^Далі$/i }))
    expect(screen.getByText("Перевірте заявку")).toBeInTheDocument()
  })

  it("skips destination for on-site battery help", async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)

    await user.click(screen.getByRole("button", { name: /Не заводиться/i }))
    expect(screen.getByText("Де ви зараз?")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Підтвердити місце/i }))
    expect(screen.getByText("Чому авто не заводиться?")).toBeInTheDocument()
    expect(screen.queryByText("Куди доставити авто?")).not.toBeInTheDocument()
    await user.click(screen.getByRole("radio", { name: /Стартер мовчить/i }))
    await user.click(
      screen.getByRole("radio", { name: /Запустити від іншого АКБ/i }),
    )
    await user.click(screen.getByRole("button", { name: /^Далі$/i }))
    expect(screen.getByText("Перевірте заявку")).toBeInTheDocument()
    expect(
      screen.getByText(/По місцю, нікуди їхати не потрібно/i),
    ).toBeInTheDocument()
  })

  it.each([
    ["Пробило колесо", "Що з колесом?", "Одне колесо", false],
    ["Закінчилось пальне", "Яке пальне потрібно?", "Дизель", false],
    [
      "Замкнулось авто",
      "Як відкрити авто?",
      "Ключі залишилися всередині",
      true,
    ],
    ["Інша допомога", "Що потрібно полагодити?", "Перегрів двигуна", true],
  ])(
    "shows service-specific details for %s",
    async (serviceName, heading, option, expandOther) => {
      const user = userEvent.setup()
      await openCustomerHome(user)
      if (expandOther)
        await user.click(screen.getByRole("button", { name: /Інша проблема/i }))
      await user.click(
        screen.getByRole("button", { name: new RegExp(serviceName, "i") }),
      )
      await user.click(
        screen.getByRole("button", { name: /Підтвердити місце/i }),
      )
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument()
      expect(
        screen.getByRole("radio", { name: new RegExp(option, "i") }),
      ).toBeInTheDocument()
      expect(screen.getByText(/Крок 3 з 4/i)).toBeInTheDocument()
    },
  )

  it("clears service answers when the customer changes the problem", async () => {
    const user = userEvent.setup()
    await openCustomerHome(user)
    await user.click(screen.getByRole("button", { name: /Не заводиться/i }))
    await user.click(screen.getByRole("button", { name: /Підтвердити місце/i }))
    await user.click(screen.getByRole("radio", { name: /Стартер мовчить/i }))
    await user.click(
      screen.getByRole("radio", { name: /Запустити від іншого АКБ/i }),
    )
    await user.click(screen.getByRole("button", { name: /Назад/i }))
    await user.click(screen.getByRole("button", { name: /Назад/i }))
    await user.click(
      screen.getByRole("button", { name: /Закінчилось пальне/i }),
    )
    await user.click(screen.getByRole("button", { name: /Підтвердити місце/i }))
    expect(screen.getByRole("radio", { name: /Дизель/i })).toHaveAttribute(
      "aria-checked",
      "false",
    )
    expect(screen.getByRole("button", { name: /^Далі$/i })).toBeDisabled()
  })

  it("submits an order and shows the success state", async () => {
    const user = userEvent.setup()
    const fetchMock = mockRegisteredCustomerFetch((url) => {
      if (url.includes("/orders/PM-123456")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "PM-123456",
            status: "searching",
            createdAt: "2026-08-09T00:00:00",
          }),
        })
      }
      if (url.includes("/orders")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "PM-123456",
            status: "searching",
            createdAt: "2026-08-09T00:00:00",
          }),
        })
      }
      return undefined
    })
    vi.stubGlobal("fetch", fetchMock)

    await openCustomerHome(user)

    await user.click(screen.getByRole("button", { name: /Не заводиться/i }))
    await user.click(screen.getByRole("button", { name: /Підтвердити місце/i }))
    await user.click(screen.getByRole("radio", { name: /Стартер мовчить/i }))
    await user.click(
      screen.getByRole("radio", { name: /Запустити від іншого АКБ/i }),
    )
    await user.click(screen.getByRole("button", { name: /^Далі$/i }))
    await user.click(screen.getByRole("button", { name: /Надіслати заявку/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    expect(await screen.findByText(/Заявку надіслано/i)).toBeInTheDocument()
    expect(await screen.findByText("Замовлення #PM-123456")).toBeInTheDocument()
  })
})
