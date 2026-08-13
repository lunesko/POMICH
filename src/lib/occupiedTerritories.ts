/** Occupied territory guardrails — mirrors bot/occupied_territories.py bbox checks. */

export type OccupiedZoneId =
  | "crimea"
  | "donetsk-occupied"
  | "luhansk-occupied"
  | "zaporizhzhia-occupied-south"
  | "kherson-occupied-east-bank"

/** (south, west, north, east) WGS84 — simplified product guardrails. */
export const OCCUPIED_BBOXES: ReadonlyArray<{ id: OccupiedZoneId; bbox: readonly [number, number, number, number] }> = [
  { id: "crimea", bbox: [44.3, 32.5, 46.2, 36.8] },
  { id: "donetsk-occupied", bbox: [47.0, 37.5, 49.8, 40.2] },
  { id: "luhansk-occupied", bbox: [48.0, 38.8, 50.1, 40.5] },
  { id: "zaporizhzhia-occupied-south", bbox: [46.0, 34.8, 47.4, 36.8] },
  { id: "kherson-occupied-east-bank", bbox: [46.0, 32.5, 47.15, 35.0] },
]

function inBbox(lat: number, lng: number, bbox: readonly [number, number, number, number]): boolean {
  const [south, west, north, east] = bbox
  return lat >= south && lat <= north && lng >= west && lng <= east
}

export function isOccupiedCoordinates(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false
  return OCCUPIED_BBOXES.some(({ bbox }) => inBbox(lat, lng, bbox))
}

export function occupiedZoneName(lat: number | null | undefined, lng: number | null | undefined): OccupiedZoneId | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  for (const zone of OCCUPIED_BBOXES) {
    if (inBbox(lat, lng, zone.bbox)) return zone.id
  }
  return null
}

export const OCCUPIED_PICK_MESSAGE = "Ця територія тимчасово окупована. Оберіть точку на підконтрольній Україні."
