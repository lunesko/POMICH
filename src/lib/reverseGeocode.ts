import { fetchJsonWithDeadline } from "./fetchJsonWithDeadline"
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

type NominatimSearchResponse = NominatimReverseResponse & {
  lat?: string
  lon?: string
}

const REVERSE_CACHE_TTL_MS = 5 * 60 * 1000
const REVERSE_CACHE_MAX = 64
const reverseCache = new Map<string, { expiresAt: number; data: NominatimReverseResponse }>()
const reverseInflight = new Map<string, Promise<NominatimReverseResponse | null>>()

function reverseKey(point: GeoPoint): string {
  // ~11 m cells: address/city do not change for normal stationary GPS jitter.
  return `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`
}

async function fetchReverseData(point: GeoPoint): Promise<NominatimReverseResponse | null> {
  const key = reverseKey(point)
  const cached = reverseCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  if (cached) reverseCache.delete(key)

  const pending = reverseInflight.get(key)
  if (pending) return pending

  const request = (async () => {
    const data = await fetchJsonWithDeadline<NominatimReverseResponse>(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${point.lat}&lon=${point.lng}&accept-language=uk&addressdetails=1`,
      { headers: { Accept: "application/json" } },
    )
    reverseCache.set(key, { expiresAt: Date.now() + REVERSE_CACHE_TTL_MS, data })
    while (reverseCache.size > REVERSE_CACHE_MAX) {
      const oldest = reverseCache.keys().next().value as string | undefined
      if (!oldest) break
      reverseCache.delete(oldest)
    }
    return data
  })()

  reverseInflight.set(key, request)
  try {
    return await request
  } finally {
    reverseInflight.delete(key)
  }
}

/** Test isolation for the module-level request cache. */
export function clearReverseGeocodeCacheForTests(): void {
  reverseCache.clear()
  reverseInflight.clear()
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
    const data = await fetchReverseData(point)
    return data ? extractCityFromNominatim(data) : ""
  } catch {
    return ""
  }
}

export async function reverseGeocodeAddress(point: GeoPoint): Promise<string> {
  try {
    const data = await fetchReverseData(point)
    const label = data ? formatNominatimAddress(data) : ""
    if (label) return label
  } catch {
    // fall through to coordinates
  }
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}

/** Resolve a user-entered Ukrainian destination into a real map point. */
export async function forwardGeocodeAddress(query: string): Promise<{ point: GeoPoint; label: string } | null> {
  const normalized = query.trim()
  if (normalized.length < 3) return null
  try {
    const results = await fetchJsonWithDeadline<NominatimSearchResponse[]>(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ua&accept-language=uk&addressdetails=1&q=${encodeURIComponent(normalized)}`,
      { headers: { Accept: "application/json" } },
    )
    const first = results[0]
    const lat = Number(first?.lat)
    const lng = Number(first?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return {
      point: { lat, lng },
      label: formatNominatimAddress(first) || normalized,
    }
  } catch {
    return null
  }
}
