import type { OrderResponse } from "../api/client"

/** Unknown timestamps are not evidence of a live GPS fix. */
export function providerLocationFresh(order: OrderResponse | undefined, now = Date.now()): boolean {
  const provider = order?.assignedProvider
  if (!provider || !provider.location || !Number.isFinite(provider.location.lat) || !Number.isFinite(provider.location.lng) || provider.stale || provider.status === "offline") return false
  const serverTime = Date.parse(order?.serverTime || "")
  const receipt = order?.receivedAt
  const referenceNow = Number.isFinite(serverTime) && typeof receipt === "number" && Number.isFinite(receipt)
    ? serverTime + Math.max(0, now - receipt)
    : now
  const seen = Date.parse(provider.lastSeenAt || "")
  const located = Date.parse(provider.lastLocationAt || "")
  return [seen, located].every(value => Number.isFinite(value) && referenceNow - value <= 60000 && value <= referenceNow + 5000)
}

export function etaRangeLabel(minutes: number): string {
  const lower = Math.max(1, Math.floor(minutes * 0.8))
  const upper = Math.max(lower + 1, Math.ceil(minutes * 1.25))
  return `${lower}–${upper} хв`
}
