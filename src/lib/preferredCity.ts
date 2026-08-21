import { DEFAULT_SERVICE_CITY, isUkraineServiceCity, nearestServiceCity, normalizeServiceCity } from "./ukraineCities"

export const PREFERRED_CITY_KEY = "pomichPreferredCity"
export const CITY_USER_PICKED_KEY = "pomichCityUserPicked"

export function readPreferredCity(): string {
  if (typeof window === "undefined") return ""
  try {
    return String(window.localStorage.getItem(PREFERRED_CITY_KEY) || "").trim()
  } catch {
    return ""
  }
}

export function writePreferredCity(city: string): void {
  if (typeof window === "undefined") return
  try {
    const value = String(city || "").trim()
    if (!value) {
      window.localStorage.removeItem(PREFERRED_CITY_KEY)
      return
    }
    window.localStorage.setItem(PREFERRED_CITY_KEY, value)
  } catch {
    // ignore quota / private mode
  }
}

export function readCityUserPicked(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(CITY_USER_PICKED_KEY) === "1"
  } catch {
    return false
  }
}

/** Mark that the user intentionally chose a service city (must not be overwritten by GPS). */
export function writeCityUserPicked(picked: boolean): void {
  if (typeof window === "undefined") return
  try {
    if (picked) window.localStorage.setItem(CITY_USER_PICKED_KEY, "1")
    else window.localStorage.removeItem(CITY_USER_PICKED_KEY)
  } catch {
    // ignore
  }
}

/**
 * Resolve which service city to show.
 * - User pick (incl. Київ) always wins while locked.
 * - Otherwise: valid profile city (non-default) → nearest GPS → normalize.
 */
export function resolveDisplayedServiceCity(options: {
  profileCity?: string | null
  pickup: { lat: number; lng: number }
  userPicked?: boolean
  preferredCity?: string | null
}): string {
  const userPicked = options.userPicked ?? readCityUserPicked()
  const preferred = String(options.preferredCity ?? readPreferredCity() ?? "").trim()
  const profile = String(options.profileCity || "").trim()
  const raw = profile || preferred

  if (userPicked && isUkraineServiceCity(raw)) return raw
  if (userPicked && isUkraineServiceCity(preferred)) return preferred

  if (isUkraineServiceCity(raw) && raw !== DEFAULT_SERVICE_CITY) return raw

  const nearest = nearestServiceCity(options.pickup)
  if (nearest) return nearest.city

  return normalizeServiceCity(raw)
}
