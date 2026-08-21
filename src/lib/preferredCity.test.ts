import { beforeEach, describe, expect, it } from "vitest"

import {
  CITY_USER_PICKED_KEY,
  PREFERRED_CITY_KEY,
  readCityUserPicked,
  resolveDisplayedServiceCity,
  writeCityUserPicked,
  writePreferredCity,
} from "./preferredCity"

describe("preferredCity", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("keeps an explicit Kyiv pick when GPS is in Zakarpattia", () => {
    writePreferredCity("Київ")
    writeCityUserPicked(true)
    expect(
      resolveDisplayedServiceCity({
        profileCity: "Київ",
        pickup: { lat: 48.73242, lng: 22.47778 },
      }),
    ).toBe("Київ")
    expect(readCityUserPicked()).toBe(true)
    expect(window.localStorage.getItem(PREFERRED_CITY_KEY)).toBe("Київ")
    expect(window.localStorage.getItem(CITY_USER_PICKED_KEY)).toBe("1")
  })

  it("snaps stale default Kyiv to nearest city when user has not picked", () => {
    writeCityUserPicked(false)
    expect(
      resolveDisplayedServiceCity({
        profileCity: "Київ",
        pickup: { lat: 48.73242, lng: 22.47778 },
        userPicked: false,
      }),
    ).toBe("Ужгород")
  })

  it("keeps an explicit Uzhhorod pick", () => {
    writePreferredCity("Ужгород")
    writeCityUserPicked(true)
    expect(
      resolveDisplayedServiceCity({
        profileCity: "Ужгород",
        pickup: { lat: 50.45, lng: 30.52 },
      }),
    ).toBe("Ужгород")
  })
})
