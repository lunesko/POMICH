import type { MapSettlement } from "../api/client"
import { isOccupiedCoordinates } from "./occupiedTerritories"

export type DirectoryScopeMode = "all-ukraine" | "my-city"

export const DIRECTORY_SCOPE_STORAGE_KEY = "pomichDirectoryScope"

const UKRAINE_CENTER = { lat: 48.5, lng: 31.5 } as const

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radius = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function settlementDistanceKm(
  settlement: MapSettlement,
  lat: number,
  lng: number,
): number | null {
  const center = settlement.center
  if (!center || center.lat == null || center.lng == null) return null
  return haversineKm(lat, lng, center.lat, center.lng)
}

export function readDirectoryScope(): DirectoryScopeMode {
  if (typeof window === "undefined") return "my-city"
  const raw = window.localStorage.getItem(DIRECTORY_SCOPE_STORAGE_KEY)
  return raw === "all-ukraine" ? "all-ukraine" : "my-city"
}

export function writeDirectoryScope(scope: DirectoryScopeMode): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(DIRECTORY_SCOPE_STORAGE_KEY, scope)
}

const NEAREST_SETTLEMENT_MAX_KM = 80

export function nearestSettlementFromList(
  settlements: MapSettlement[],
  lat: number,
  lng: number,
  maxKm = NEAREST_SETTLEMENT_MAX_KM,
): MapSettlement | null {
  let best: MapSettlement | null = null
  let bestKm = Number.POSITIVE_INFINITY
  for (const item of settlements) {
    const center = item.center
    if (!center || center.lat == null || center.lng == null) continue
    const km = haversineKm(lat, lng, center.lat, center.lng)
    if (km < bestKm) {
      bestKm = km
      best = item
    }
  }
  if (!best || bestKm > maxKm) return null
  return best
}

export function directoryScopeMapTarget(
  scope: DirectoryScopeMode,
  cityCenter?: { lat: number; lng: number } | null,
): { lat: number; lng: number; zoom: number } {
  if (scope === "my-city" && cityCenter) {
    return { lat: cityCenter.lat, lng: cityCenter.lng, zoom: 13 }
  }
  return { lat: UKRAINE_CENTER.lat, lng: UKRAINE_CENTER.lng, zoom: 6 }
}

export function validateGeoForDirectory(lat: number, lng: number): string | undefined {
  if (isOccupiedCoordinates(lat, lng)) {
    return "Ця територія тимчасово окупована. Оберіть «Вся Україна» або точку на підконтрольній території."
  }
  return undefined
}
