export interface GeoPoint {
  lat: number
  lng: number
}

type NominatimAddress = {
  road?: string
  pedestrian?: string
  footway?: string
  path?: string
  house_number?: string
  neighbourhood?: string
  suburb?: string
  city?: string
  town?: string
  village?: string
  municipality?: string
  county?: string
  state?: string
  country?: string
}

type NominatimReverseResponse = {
  display_name?: string
  address?: NominatimAddress
}

/** Neighbourhood nicknames (e.g. «Каліфорнія» in Перечин) confuse users — skip in UI labels. */
const NOISY_NEIGHBOURHOOD = /каліфорн|california|району?$|квартал/i

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

function extractRoad(address: NominatimAddress): string {
  return (
    address.road
    || address.pedestrian
    || address.footway
    || address.path
    || ""
  ).trim()
}

/** Build a short, human address: «вул. X, 12, Перечин» — no noisy neighbourhoods. */
export function formatNominatimAddress(data: NominatimReverseResponse): string {
  const address = data.address
  if (!address) {
    const fallback = data.display_name?.split(",").map((part) => part.trim()).filter(Boolean) ?? []
    return fallback.slice(0, 2).join(", ")
  }

  const road = extractRoad(address)
  const house = (address.house_number || "").trim()
  const city = extractCityFromNominatim(data)
  const suburb = (address.suburb || address.neighbourhood || "").trim()
  const includeSuburb = Boolean(suburb && city && suburb !== city && !NOISY_NEIGHBOURHOOD.test(suburb))

  const parts: string[] = []
  if (road && house) parts.push(`${road}, ${house}`)
  else if (road) parts.push(road)
  else if (includeSuburb) parts.push(suburb)
  if (city) parts.push(city)
  else if (includeSuburb && !road) {
    /* already pushed suburb */
  } else if (address.state) {
    parts.push(address.state)
  }

  if (parts.length > 0) return parts.join(", ")

  const fallback = data.display_name?.split(",").map((part) => part.trim()).filter(Boolean) ?? []
  return fallback
    .filter((part) => !NOISY_NEIGHBOURHOOD.test(part))
    .slice(0, 2)
    .join(", ")
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
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${point.lat}&lon=${point.lng}&accept-language=uk&addressdetails=1`,
      { headers: { Accept: "application/json" } },
    )
    if (!response.ok) throw new Error("geocode failed")
    const data = (await response.json()) as NominatimReverseResponse
    const label = formatNominatimAddress(data)
    if (label) return label
  } catch {
    // fall through to coordinates
  }
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}
