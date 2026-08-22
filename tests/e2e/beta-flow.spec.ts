import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test"

const env = {
  baseUrl: process.env.POMICH_E2E_BASE_URL || process.env.PUBLIC_URL || "",
  providerAId: process.env.POMICH_E2E_PROVIDER_A_ID || "",
  providerALogin: process.env.POMICH_E2E_PROVIDER_A_LOGIN || "",
  providerAPassword: process.env.POMICH_E2E_PROVIDER_A_PASSWORD || "",
  providerBId: process.env.POMICH_E2E_PROVIDER_B_ID || "",
  providerBLogin: process.env.POMICH_E2E_PROVIDER_B_LOGIN || "",
  providerBPassword: process.env.POMICH_E2E_PROVIDER_B_PASSWORD || "",
}

const missingEnv = Object.entries(env)
  .filter(([key, value]) => key !== "baseUrl" ? !value : !value || /localhost|127\.0\.0\.1/i.test(value))
  .map(([key]) => key)

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function expectJson(response: APIResponse, expectedStatus: number | number[]) {
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus]
  const body = await response.text()
  expect(expected, body).toContain(response.status())
  return body ? JSON.parse(body) : null
}

async function providerSession(request: APIRequestContext, providerId: string, login: string, password: string) {
  const session = await expectJson(
    await request.post("/api/auth/provider/login", {
      data: { providerId, login, password },
    }),
    200,
  )
  expect(session.accessToken).toBeTruthy()
  return bearer(session.accessToken)
}

async function customerSession(request: APIRequestContext) {
  const session = await expectJson(
    await request.post("/api/auth/customer/guest/session", {
      data: { customerId: `guest-playwright-${Date.now()}` },
    }),
    200,
  )
  expect(session.accessToken).toBeTruthy()
  return bearer(session.accessToken)
}

async function waitForOffer(request: APIRequestContext, providerId: string, headers: Record<string, string>, orderId: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const offers = await expectJson(await request.get(`/api/providers/${providerId}/offers`, { headers }), 200)
    const offer = Array.isArray(offers) ? offers.find((item) => item.orderId === orderId) : undefined
    if (offer) return offer
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Provider ${providerId} did not receive offer for order ${orderId}`)
}

test.describe("POMICH beta release gate", () => {
  test.skip(missingEnv.length > 0, `Set staging env before running beta gate: ${missingEnv.join(", ")}`)

  test("public browser and same-origin API complete customer/provider dispatch lifecycle", async ({ page, request }) => {
    const browserRequests: string[] = []
    page.on("request", (req) => browserRequests.push(req.url()))

    await page.goto("/interface", { waitUntil: "domcontentloaded" })
    await expect(page.locator("body")).toContainText(/POMICH|Потрібна допомога|Партнер/i)
    await page.waitForTimeout(1000)

    const browserApiRequests = browserRequests.filter((url) => url.includes("/api/"))
    await test.info().attach("browser-api-requests.txt", {
      body: browserApiRequests.length > 0 ? browserApiRequests.join("\n") : "(no browser api requests during initial load)",
      contentType: "text/plain",
    })
    expect(browserApiRequests.filter((url) => /https?:\/\/(?:localhost|127\.0\.0\.1)(?::8000)?/i.test(url))).toEqual([])

    const providers = await expectJson(await request.get("/api/providers"), 200)
    expect(Array.isArray(providers)).toBe(true)

    const providerAHeaders = await providerSession(request, env.providerAId, env.providerALogin, env.providerAPassword)
    const providerBHeaders = await providerSession(request, env.providerBId, env.providerBLogin, env.providerBPassword)
    const customerHeaders = await customerSession(request)

    await expectJson(
      await request.patch(`/api/providers/${env.providerAId}/presence`, {
        headers: providerAHeaders,
        data: { status: "online", location: { lat: 50.4501, lng: 30.5234 }, etaMinutes: 8 },
      }),
      200,
    )
    await expectJson(
      await request.patch(`/api/providers/${env.providerBId}/presence`, {
        headers: providerBHeaders,
        data: { status: "online", location: { lat: 50.4503, lng: 30.5236 }, etaMinutes: 8 },
      }),
      200,
    )

    const order = await expectJson(
      await request.post("/api/orders", {
        headers: customerHeaders,
        data: {
          source: "playwright-release-gate",
          service: "tow",
          customerLocation: "Playwright smoke Kyiv",
          customerCoordinates: { lat: 50.4502, lng: 30.5235 },
          destination: "Playwright smoke destination",
          destinationCoordinates: { lat: 50.455, lng: 30.53 },
          distanceKm: 2.4,
          status: "searching",
        },
      }),
      201,
    )
    expect(order.id).toBeTruthy()

    const offerA = await waitForOffer(request, env.providerAId, providerAHeaders, order.id)
    const offerB = await waitForOffer(request, env.providerBId, providerBHeaders, order.id)

    const accepted = await expectJson(
      await request.post(`/api/providers/${env.providerAId}/offers/${offerA.id}/accept`, {
        headers: providerAHeaders,
        data: { proposedPrice: 1200, priceNote: "Playwright release gate" },
      }),
      200,
    )
    expect(accepted.order.status).toBe("accepted")
    expect(accepted.order.assignedProviderId).toBe(env.providerAId)

    const lost = await expectJson(
      await request.post(`/api/providers/${env.providerBId}/offers/${offerB.id}/accept`, {
        headers: providerBHeaders,
        data: { proposedPrice: 1300, priceNote: "Playwright losing offer" },
      }),
      409,
    )
    expect(lost.detail.code).toBe("ORDER_ALREADY_ACCEPTED")

    const assigned = await expectJson(await request.get(`/api/orders/${order.id}`, { headers: customerHeaders }), 200)
    expect(assigned.assignedProviderId).toBe(env.providerAId)
    expect(assigned.partnerProposedPrice).toBe(1200)

    const confirmed = await expectJson(await request.post(`/api/orders/${order.id}/confirm-price`, { headers: customerHeaders }), 200)
    expect(confirmed.status).toBe("price_confirmed")

    for (const status of ["en_route", "arrived", "in_progress", "completed"]) {
      const updated = await expectJson(
        await request.patch(`/api/providers/${env.providerAId}/orders/${order.id}/status`, {
          headers: providerAHeaders,
          data: { status },
        }),
        200,
      )
      expect(updated.status).toBe(status)
    }

    const completed = await expectJson(await request.get(`/api/orders/${order.id}`, { headers: customerHeaders }), 200)
    expect(completed.status).toBe("completed")
  })
})
