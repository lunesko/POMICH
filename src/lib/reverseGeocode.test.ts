import { beforeEach, describe, expect, it, vi } from "vitest"

import { clearReverseGeocodeCacheForTests, extractCityFromNominatim, formatNominatimAddress, reverseGeocodeAddress, reverseGeocodeCity } from "./reverseGeocode"

describe("reverseGeocode", () => {
  beforeEach(() => {
    clearReverseGeocodeCacheForTests()
    vi.restoreAllMocks()
  })

  it("extracts city from nominatim address fields", () => {
    expect(extractCityFromNominatim({ address: { city: "Ужгород" } })).toBe("Ужгород")
    expect(extractCityFromNominatim({ address: { town: "Мукачево" } })).toBe("Мукачево")
    expect(extractCityFromNominatim({ address: { village: "Середнє" } })).toBe("Середнє")
    expect(extractCityFromNominatim({ address: { municipality: "Ужгородська громада" } })).toBe("Ужгородська громада")
    expect(extractCityFromNominatim({})).toBe("")
  })

  it("formats address without noisy neighbourhood nicknames like Каліфорнія", () => {
    expect(
      formatNominatimAddress({
        display_name: "Промислова вулиця, Каліфорнія, Перечин, Україна",
        address: {
          road: "Промислова вулиця",
          neighbourhood: "Каліфорнія",
          town: "Перечин",
          state: "Закарпатська область",
          country: "Україна",
        },
      }),
    ).toBe("Промислова вулиця, Перечин")

    expect(
      formatNominatimAddress({
        address: {
          road: "вулиця Корзо",
          house_number: "12",
          city: "Ужгород",
        },
      }),
    ).toBe("вулиця Корзо, 12, Ужгород")
  })

  it("reverseGeocodeCity returns parsed city from nominatim", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        address: { city: "Ужгород", road: "Vishneva street" },
      }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(reverseGeocodeCity({ lat: 48.6208, lng: 22.2879 })).resolves.toBe("Ужгород")
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("nominatim.openstreetmap.org/reverse"),
      expect.any(Object),
    )
  })

  it("shares one Nominatim request between city and address for the same GPS cell", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        address: { city: "Ужгород", road: "вулиця Корзо", house_number: "12" },
      }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    const point = { lat: 48.62081, lng: 22.28791 }
    const [city, address] = await Promise.all([
      reverseGeocodeCity(point),
      reverseGeocodeAddress({ lat: 48.62082, lng: 22.28792 }),
    ])

    expect(city).toBe("Ужгород")
    expect(address).toBe("вулиця Корзо, 12, Ужгород")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
