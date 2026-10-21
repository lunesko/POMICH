import type { OrderResponse } from "../api/client"

/** Unknown timestamps are not evidence of a live GPS fix. */
export function providerLocationFresh(order: OrderResponse | undefined, now = Date.now()): boolean {
  const provider = order?.assignedProvider
  if (!provider || !provider.location || !Number.isFinite(provider.location.lat) || !Number.isFinite(provider.location.lng) || provider.stale || provider.status === "offline") return false
  const seen = Date.parse(provider.lastSeenAt || "")
  const located = Date.parse(provider.lastLocationAt || "")
  return [seen, located].every(value => Number.isFinite(value) && now - value <= 60000 && value <= now + 5000)
}

export function etaRangeLabel(minutes: number): string {
  const lower = Math.max(1, Math.floor(minutes * 0.8))
  const upper = Math.max(lower + 1, Math.ceil(minutes * 1.25))
  return `${lower}–${upper} хв`
}
