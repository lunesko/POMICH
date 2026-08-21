import { updateCustomerProfile, type CustomerProfile } from "../api/client"

import { reverseGeocodeCity, type GeoPoint } from "./reverseGeocode"
import { readCityUserPicked } from "./preferredCity"
import { isUkraineServiceCity, resolveServiceCityFromGeo } from "./ukraineCities"

/** Bootstrap / empty profile cities that GPS may replace — only when user has not locked a pick. */
const STALE_DEFAULT_CITIES = new Set(["Київ", "Kyiv", "Kiev", "Киев"])

function shouldReplaceProfileCity(profileCity: string, resolvedCity: string): boolean {
  if (readCityUserPicked()) return false

  const current = String(profileCity || "").trim()
  if (!current) return true
  if (current === resolvedCity) return true
  if (STALE_DEFAULT_CITIES.has(current)) return true
  /* Village / district from Nominatim that is not in the service dropdown */
  if (!isUkraineServiceCity(current)) return true
  return false
}

export async function syncProfileCityFromGeo(
  point: GeoPoint,
  customerId: string,
  token: string | undefined,
  profileCity?: string,
): Promise<{ city: string; saved?: CustomerProfile } | null> {
  if (readCityUserPicked()) return null

  const geocodedPlace = await reverseGeocodeCity(point)
  const city = resolveServiceCityFromGeo(point, geocodedPlace)
  if (!city) return null

  const normalizedProfileCity = String(profileCity || "").trim()
  if (!shouldReplaceProfileCity(normalizedProfileCity, city)) {
    return null
  }

  const localChanged = city !== normalizedProfileCity

  if (!token || !customerId) {
    return localChanged ? { city } : null
  }

  try {
    const saved = await updateCustomerProfile(customerId, { city }, token)
    const savedCity = String(saved.city || "").trim()
    if (!localChanged && savedCity === city) return null
    return { city, saved }
  } catch {
    return localChanged ? { city } : null
  }
}
