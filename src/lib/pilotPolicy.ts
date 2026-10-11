import { calculateDistanceKm, type Coordinate, type ServiceKey } from "./pomichDomain"

export const pilotMode = import.meta.env.VITE_POMICH_PILOT_MODE !== "false"
export const pilotCity = "Ужгород"
export const pilotServices: ReadonlySet<ServiceKey> = new Set(["tow", "battery"])
const configuredRadius = Number(import.meta.env.VITE_POMICH_PILOT_RADIUS_KM ?? 15)
export const pilotRadiusKm = Number.isFinite(configuredRadius) ? Math.min(50, Math.max(1, configuredRadius)) : 15

export function pickupInPilotArea(point: Coordinate): boolean {
  return calculateDistanceKm(point, { lat: 48.622, lng: 22.3 }) <= pilotRadiusKm
}
