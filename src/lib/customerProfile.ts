import type { CustomerProfile } from "../api/client"
import { BRAND, BORDER } from "./constants"
import { validateUkraineMobilePhone } from "./ukrainePhone"

export const DEFAULT_CUSTOMER_NAME = "Клієнт POMICH"

const STALE_DEFAULT_CITIES = new Set(["Київ", "Kyiv", "Kiev"])

export type ProfileCheckItem = {
  key: string
  label: string
  filled: boolean
  required: boolean
}

/** Checklist fields shown instead of opaque % completeness (clients: name + phone + OTP only). */
export function getProfileChecklist(profile: CustomerProfile): ProfileCheckItem[] {
  const name = (profile.name || "").trim()
  const phone = (profile.phone || "").trim()

  const items: ProfileCheckItem[] = [
    { key: "name", label: "Ім'я", filled: Boolean(name && name !== DEFAULT_CUSTOMER_NAME), required: true },
    { key: "phone", label: "Телефон", filled: validateUkraineMobilePhone(phone).valid, required: true },
    { key: "verification", label: "Підтвердження", filled: isCustomerVerified(profile), required: true },
  ]

  if (isCustomerVerified(profile)) {
    return items.filter((item) => item.key !== "verification")
  }
  return items
}

/** User-facing checklist row status — optional fields are not used for clients anymore. */
export function profileChecklistItemStatus(item: ProfileCheckItem): string {
  if (item.filled) return "✓ Заповнено"
  return item.required ? "— Потрібно" : "— Необов'язково"
}

/** Merge server/session profile without wiping in-progress local edits. */
export function mergeCustomerProfiles(current: CustomerProfile, incoming: CustomerProfile): CustomerProfile {
  const merged: CustomerProfile = { ...current, ...incoming, id: incoming.id || current.id }
  const currentPhone = validateUkraineMobilePhone(current.phone || "")
  const incomingPhone = validateUkraineMobilePhone(incoming.phone || "")
  if (currentPhone.valid && !incomingPhone.valid) {
    merged.phone = current.phone
  }

  const currentName = (current.name || "").trim()
  const incomingName = (incoming.name || "").trim()
  if (currentName && currentName !== DEFAULT_CUSTOMER_NAME && (!incomingName || incomingName === DEFAULT_CUSTOMER_NAME)) {
    merged.name = current.name
  }

  if (!(incoming.email || "").trim() && (current.email || "").trim()) {
    merged.email = current.email
  }

  const currentCity = (current.city || "").trim()
  const incomingCity = (incoming.city || "").trim()
  if (currentCity && STALE_DEFAULT_CITIES.has(incomingCity) && !STALE_DEFAULT_CITIES.has(currentCity)) {
    merged.city = current.city
  } else if (!incomingCity && currentCity) {
    merged.city = current.city
  }

  if (isCustomerVerified(current) || isCustomerVerified(incoming)) {
    merged.verificationStatus = "verified"
  }

  return merged
}

/** Minimum fields before creating an order. */
export function isCustomerProfileComplete(profile: CustomerProfile): boolean {
  const name = (profile.name || "").trim()
  const phone = (profile.phone || "").trim()
  return Boolean(name && name !== DEFAULT_CUSTOMER_NAME && validateUkraineMobilePhone(phone).valid)
}

export function isCustomerVerified(profile: CustomerProfile): boolean {
  return profile.verificationStatus === "verified"
}

/** Profile ready for orders: filled + OTP verified. */
export function isCustomerReadyForOrder(profile: CustomerProfile): boolean {
  return isCustomerProfileComplete(profile) && isCustomerVerified(profile)
}

export function profileChecklistSummary(profile: CustomerProfile): string {
  const required = getProfileChecklist(profile).filter((item) => item.required)
  const filled = required.filter((item) => item.filled).length
  return `${filled} з ${required.length} обов'язкових полів заповнено`
}

/** User-facing profile status — includes OTP verification gate. */
export function customerProfileStatusLabel(profile: CustomerProfile): string {
  if (isCustomerVerified(profile)) return "Профіль підтверджено"
  if (isCustomerProfileComplete(profile)) return "Потрібне підтвердження"
  return "Заповніть профіль"
}

export function customerProfileStatusTone(profile: CustomerProfile): { background: string; color: string; border: string } {
  if (isCustomerVerified(profile)) {
    return { background: "#E8F8F1", color: BRAND, border: "#BFEAD8" }
  }
  if (isCustomerProfileComplete(profile)) {
    return { background: "#FFF7ED", color: "#B45309", border: "#FED7AA" }
  }
  return { background: "#F3F4F6", color: "#6B7280", border: BORDER }
}
