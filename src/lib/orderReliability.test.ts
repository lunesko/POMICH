import { describe, expect, it } from "vitest"
import { providerLocationFresh } from "./orderReliability"
import type { OrderResponse } from "../api/client"

const now = Date.parse("2026-10-21T10:00:00Z")
const order: OrderResponse = { assignedProvider: { id: "p1", name: "Partner", status: "busy", location: { lat: 48.6, lng: 22.3 }, lastSeenAt: new Date(now).toISOString(), lastLocationAt: new Date(now).toISOString() } }
describe("provider location freshness", () => {
  it("expires even when there are no new server messages", () => {
    expect(providerLocationFresh(order, now)).toBe(true)
    expect(providerLocationFresh(order, now + 61000)).toBe(false)
  })
  it("does not treat heartbeats as new GPS fixes", () => {
    expect(providerLocationFresh({ assignedProvider: { ...order.assignedProvider!, lastLocationAt: new Date(now - 61000).toISOString() } }, now)).toBe(false)
  })
  it("treats offline, unknown timestamps and invalid future timestamps as unavailable", () => {
    for (const patch of [{ status: "offline" as const }, { lastLocationAt: undefined }, { stale: true }, { lastLocationAt: new Date(now + 60000).toISOString() }]) {
      expect(providerLocationFresh({ assignedProvider: { ...order.assignedProvider!, ...patch } }, now)).toBe(false)
    }
  })
})

it.each([-3600000, 3600000])("uses server age when the customer clock differs by %s ms", skew => {
  const snapshot = { ...order, serverTime: new Date(now).toISOString(), receivedAt: now + skew }
  expect(providerLocationFresh(snapshot, now + skew)).toBe(true)
  expect(providerLocationFresh(snapshot, now + skew + 61000)).toBe(false)
  const stale = { ...snapshot, assignedProvider: { ...snapshot.assignedProvider!, lastLocationAt: new Date(now - 61000).toISOString() } }
  expect(providerLocationFresh(stale, now + skew)).toBe(false)
})
