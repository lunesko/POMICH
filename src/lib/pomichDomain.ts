export type ServiceKey = 'tow' | 'battery' | 'wheel' | 'fuel' | 'lockout' | 'mechanic'

export type OrderState = 'draft' | 'matching' | 'assigned' | 'tracking' | 'arrived' | 'completed' | 'cancelled' | 'expired'

export interface CustomerOrderInput {
  service: ServiceKey | ''
  customerLocation: string
  destination: string
  distanceKm: number
}

export interface Coordinate {
  lat: number
  lng: number
}

export interface PriceBreakdown {
  price: number
  etaMinutes: number
  distanceKm: number
  serviceFee: number
  routeFee: number
}

const SERVICE_BASE_PRICES: Record<ServiceKey, number> = {
  tow: 900,
  battery: 750,
  wheel: 650,
  fuel: 600,
  lockout: 550,
  mechanic: 800,
}

export function calculateDistanceKm(from: Coordinate, to: Coordinate): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const deltaLat = toRadians(to.lat - from.lat)
  const deltaLng = toRadians(to.lng - from.lng)
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = earthRadiusKm * c
  return Number(distance.toFixed(1))
}

export function calculatePrice(service: ServiceKey, distanceKm: number): PriceBreakdown {
  const base = SERVICE_BASE_PRICES[service]
  const distanceFee = Math.max(0, Math.round(distanceKm * 90))
  const total = base + distanceFee
  const etaMinutes = Math.max(8, Math.min(24, Math.round(distanceKm * 4 + 8)))

  return {
    price: total,
    etaMinutes,
    distanceKm: Number(distanceKm.toFixed(1)),
    serviceFee: base,
    routeFee: distanceFee,
  }
}

export function validateCustomerOrderInput(input: CustomerOrderInput): string[] {
  const errors: string[] = []

  if (!input.service) {
    errors.push('service')
  }

  if (!input.customerLocation || input.customerLocation.trim().length < 3) {
    errors.push('customerLocation')
  }

  if (!input.destination || input.destination.trim().length < 3) {
    errors.push('destination')
  }

  if (!Number.isFinite(input.distanceKm) || input.distanceKm <= 0) {
    errors.push('distanceKm')
  }

  return errors
}

export function sanitizeLocation(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'Не вказано'

  const withoutStreetNumber = trimmed.replace(/,\s*\d{1,4}([\/\-]\d{1,4})?/g, '')
  const withoutExactHouse = withoutStreetNumber.replace(/\b\d{1,4}([\/\-]\d{1,4})?\b/g, '')

  return withoutExactHouse.replace(/\s+/g, ' ').trim() || 'Не вказано'
}

export function getStateTransition(state: OrderState, event: 'accept' | 'cancel' | 'complete' | 'arrive' | 'track'): OrderState {
  switch (state) {
    case 'draft':
      return event === 'cancel' ? 'cancelled' : 'matching'
    case 'matching':
      if (event === 'accept') return 'assigned'
      if (event === 'cancel') return 'cancelled'
      return 'matching'
    case 'assigned':
      if (event === 'track') return 'tracking'
      if (event === 'arrive') return 'arrived'
      if (event === 'cancel') return 'cancelled'
      return 'assigned'
    case 'tracking':
      if (event === 'arrive') return 'arrived'
      if (event === 'complete') return 'completed'
      if (event === 'cancel') return 'cancelled'
      return 'tracking'
    case 'arrived':
      if (event === 'complete') return 'completed'
      if (event === 'cancel') return 'cancelled'
      return 'arrived'
    case 'completed':
    case 'cancelled':
    case 'expired':
      return state
    default:
      return state
  }
}

export function buildOrderFingerprint(orderId: string, customerId: string, providerId: string): string {
  return `${orderId}:${customerId}:${providerId}`
}
