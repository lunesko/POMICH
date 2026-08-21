import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import {
  formatNearbyRequestAlert,
  formatOfferAlert,
  takeNewAlertIds,
} from "./partnerAlerts"

describe("takeNewAlertIds", () => {
  it("seeds without alerting on first snapshot", () => {
    const known = new Set<string>()
    expect(takeNewAlertIds(known, ["a", "b"])).toEqual([])
    expect([...known].sort()).toEqual(["a", "b"])
  })

  it("returns only newly appeared ids", () => {
    const known = new Set(["a"])
    expect(takeNewAlertIds(known, ["a", "b", "c"])).toEqual(["b", "c"])
  })

  it("drops ids that left the radius", () => {
    const known = new Set(["a", "b"])
    expect(takeNewAlertIds(known, ["b"])).toEqual([])
    expect([...known]).toEqual(["b"])
  })
})

describe("alert copy", () => {
  it("formats nearby alerts", () => {
    expect(formatNearbyRequestAlert(1).title).toContain("нова заявка")
    expect(formatNearbyRequestAlert(3).body).toContain("3")
  })

  it("formats offer alerts", () => {
    expect(formatOfferAlert("Евакуатор").body).toContain("Евакуатор")
  })
})

describe("showPartnerAlert", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns false when Notification API missing", async () => {
    vi.stubGlobal("Notification", undefined)
    const { showPartnerAlert } = await import("./partnerAlerts")
    await expect(showPartnerAlert({ title: "t", body: "b" })).resolves.toBe(false)
  })
})
