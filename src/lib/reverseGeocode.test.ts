import { describe, expect, it, vi } from "vitest"

import { extractCityFromNominatim, reverseGeocodeCity } from "./reverseGeocode"

describe("reverseGeocode", () => {
  it("extracts city from nominatim address fields", () => {
    expect(extractCityFromNominatim({ address: { city: "Ужгород" } })).toBe("Ужгород")
    expect(extractCityFromNominatim({ address: { town: "Мукачево" } })).toBe("Мукачево")
    expect(extractCityFromNominatim({ address: { village: "Середнє" } })).toBe("Середнє")
    expect(extractCityFromNominatim({ address: { municipality: "Ужгородська громада" } })).toBe("Ужгородська громада")
    expect(extractCityFromNominatim({})).toBe("")
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
})
