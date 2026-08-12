import { beforeEach, describe, expect, it, vi } from "vitest"

import { syncProfileCityFromGeo } from "./syncProfileCityFromGeo"

describe("syncProfileCityFromGeo", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("persists detected city when token is available", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("nominatim.openstreetmap.org/reverse")) {
        return {
          ok: true,
          json: async () => ({ address: { city: "Ужгород" } }),
        }
      }
      if (url.includes("/customers/")) {
        return {
          ok: true,
          json: async () => ({ id: "tg-1", city: "Ужгород", name: "PowerGear" }),
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await syncProfileCityFromGeo(
      { lat: 48.6208, lng: 22.2879 },
      "tg-1",
      "token-1",
      "Київ",
    )

    expect(result).toEqual({
      city: "Ужгород",
      saved: { id: "tg-1", city: "Ужгород", name: "PowerGear" },
    })
  })

  it("updates server when local city already matches geocode", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("nominatim.openstreetmap.org/reverse")) {
        return {
          ok: true,
          json: async () => ({ address: { city: "Ужгород" } }),
        }
      }
      if (url.includes("/customers/")) {
        return {
          ok: true,
          json: async () => ({ id: "tg-1", city: "Ужгород", name: "PowerGear" }),
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await syncProfileCityFromGeo(
      { lat: 48.6208, lng: 22.2879 },
      "tg-1",
      "token-1",
      "Ужгород",
    )

    expect(result).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
