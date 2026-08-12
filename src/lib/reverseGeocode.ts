export interface GeoPoint {
  lat: number
  lng: number
}

type NominatimAddress = {
  city?: string
  town?: string
  village?: string
  municipality?: string
  county?: string
}

type NominatimReverseResponse = {
  display_name?: string
  address?: NominatimAddress
}

export function extractCityFromNominatim(data: NominatimReverseResponse): string {
  const address = data.address
  if (!address) return ""
  return (
    address.city
    || address.town
    || address.village
    || address.municipality
    || ""
  ).trim()
}

export async function reverseGeocodeCity(point: GeoPoint): Promise<string> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${point.lat}&lon=${point.lng}&accept-language=uk&addressdetails=1`,
      { headers: { Accept: "application/json" } },
    )
    if (!response.ok) return ""
    const data = (await response.json()) as NominatimReverseResponse
    return extractCityFromNominatim(data)
  } catch {
    return ""
  }
}

export async function reverseGeocodeAddress(point: GeoPoint): Promise<string> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${point.lat}&lon=${point.lng}&accept-language=uk`,
      { headers: { Accept: "application/json" } },
    )
    if (!response.ok) throw new Error("geocode failed")
    const data = (await response.json()) as NominatimReverseResponse
    if (data.display_name) {
      return data.display_name.split(",").slice(0, 3).join(",").trim()
    }
  } catch {
    // fall through to coordinates
  }
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}
