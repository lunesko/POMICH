import { afterEach, expect, it, vi } from "vitest"
import { getOrder } from "./client"
import { providerLocationFresh } from "../lib/orderReliability"

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([-3600000, 3600000])("ages a real HTTP order response with a client clock offset of %s ms", async skew => {
  const serverNow = Date.parse("2026-10-26T12:00:00Z")
  const clientNow = serverNow + skew
  vi.spyOn(Date, "now").mockReturnValue(clientNow)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: "order-clock", status: "en_route",
    assignedProvider: { id: "partner-clock", name: "Synthetic partner", status: "busy", location: { lat: 48.6, lng: 22.3 }, lastSeenAt: new Date(serverNow).toISOString(), lastLocationAt: new Date(serverNow).toISOString() },
  }), { headers: { "Content-Type": "application/json", Date: new Date(serverNow).toUTCString() } })))
  const order = await getOrder("order-clock")
  expect(order.receivedAt).toBe(clientNow)
  expect(providerLocationFresh(order, clientNow)).toBe(true)
  expect(providerLocationFresh(order, clientNow + 61000)).toBe(false)
})
