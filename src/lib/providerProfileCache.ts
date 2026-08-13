import type { ProviderAvailability } from "../api/client"

const KEY_PREFIX = "pomichProviderProfileCache:"

export function providerProfileCacheKey(providerId: string): string {
  return `${KEY_PREFIX}${String(providerId || "").trim()}`
}

export function readCachedProviderProfile(providerId: string): ProviderAvailability | undefined {
  if (typeof window === "undefined" || !providerId) return undefined
  try {
    const raw = window.sessionStorage.getItem(providerProfileCacheKey(providerId))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as ProviderAvailability
    if (!parsed || typeof parsed !== "object" || !parsed.id) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function writeCachedProviderProfile(profile: ProviderAvailability): void {
  if (typeof window === "undefined" || !profile?.id) return
  try {
    window.sessionStorage.setItem(providerProfileCacheKey(profile.id), JSON.stringify(profile))
  } catch {
    // sessionStorage may be full or unavailable
  }
}
