import { updateCustomerProfile, type CustomerProfile } from "../api/client"

import { reverseGeocodeCity, type GeoPoint } from "./reverseGeocode"

export async function syncProfileCityFromGeo(
  point: GeoPoint,
  customerId: string,
  token: string | undefined,
  profileCity?: string,
): Promise<{ city: string; saved?: CustomerProfile } | null> {
  const city = await reverseGeocodeCity(point)
  if (!city) return null

  const normalizedProfileCity = String(profileCity || "").trim()
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
