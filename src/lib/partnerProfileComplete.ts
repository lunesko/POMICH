import type { ProviderAvailability } from "../api/client"
import { toServiceKeys } from "./constants"
import { isValidUkrainePlate } from "./ukrainePlate"

const PLACEHOLDER_PARTNER_NAME = "Партнер POMICH"

export type PartnerProfileCompleteInput = Partial<
  Pick<ProviderAvailability, "name" | "phone" | "vehicle" | "plate" | "specialties" | "registeredAt">
>

/** Required partner fields for a complete profile (UI + server aligned). */
export function isPartnerProfileFieldsComplete(profile?: PartnerProfileCompleteInput | null): boolean {
  if (!profile) return false
  const name = String(profile.name || "").trim()
  if (!name || name === PLACEHOLDER_PARTNER_NAME) return false
  if (!String(profile.phone || "").trim()) return false
  if (!String(profile.vehicle || "").trim()) return false
  if (!isValidUkrainePlate(String(profile.plate || ""))) return false
  return toServiceKeys(profile.specialties).length > 0
}

/**
 * Complete + registered partner profile.
 * `treatAsRegistered` covers local returning-partner flags when `registeredAt` is briefly missing.
 */
export function isPartnerProfileComplete(
  profile?: PartnerProfileCompleteInput | null,
  options?: { treatAsRegistered?: boolean },
): boolean {
  if (!isPartnerProfileFieldsComplete(profile)) return false
  return Boolean(profile?.registeredAt) || Boolean(options?.treatAsRegistered)
}

export function isPartnerProfileIncomplete(profile?: PartnerProfileCompleteInput | null): boolean {
  return !isPartnerProfileFieldsComplete(profile)
}
