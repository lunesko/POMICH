type Position = [number, number]
type Ring = Position[]

type GeoPolygon = { type: "Polygon"; coordinates: Ring[] }
type GeoMultiPolygon = { type: "MultiPolygon"; coordinates: Ring[][] }
type GeoGeometry = GeoPolygon | GeoMultiPolygon | { type: string; coordinates?: unknown }
type GeoFeature = { type: "Feature"; geometry: GeoGeometry; properties?: Record<string, unknown> }

/** Collect exterior rings from Polygon / MultiPolygon. */
export function collectExteriorRings(geometry: GeoGeometry): Ring[] {
  if (geometry.type === "Polygon") {
    const polygon = geometry as GeoPolygon
    return polygon.coordinates[0] ? [polygon.coordinates[0]] : []
  }
  if (geometry.type === "MultiPolygon") {
    const multi = geometry as GeoMultiPolygon
    return multi.coordinates.map((polygon) => polygon[0]).filter(Boolean)
  }
  return []
}

export const OCCUPIED_TERRITORIES_GEOJSON_URL = "/geo/occupied-territories.geojson"

/** WGS84 (south, west, north, east) — used for fitBounds on directory wide view. */
export const UKRAINE_BOUNDS: readonly [number, number, number, number] = [44.2, 22.0, 52.4, 40.4]

export const UKRAINE_MAP_FIT_MAX_ZOOM = 7
export const UKRAINE_MAP_FIT_MAX_ZOOM_MOBILE = 6

/** Subtle occupied-territory overlay — no country border or outside dim. */
export const UKRAINE_MAP_STYLES = {
  occupied: {
    color: "rgba(120, 60, 60, 0.08)",
    weight: 0,
    opacity: 0,
    fillColor: "#9A5050",
    fillOpacity: 0.18,
  },
} as const
