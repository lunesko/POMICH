import type { CustomerProfile } from "../api/client"
import { BRAND, BORDER } from "./constants"
import { validateUkraineMobilePhone } from "./ukrainePhone"

export const DEFAULT_CUSTOMER_NAME = "Клієнт POMICH"

export type ProfileCheckItem = {
  key: string
  label: string
  filled: boolean
  required: boolean
}

/** Checklist fields shown instead of opaque % completeness. */
export function getProfileChecklist(profile: CustomerProfile): ProfileCheckItem[] {
  const name = (profile.name || "").trim()
  const phone = (profile.phone || "").trim()
  const email = (profile.email || "").trim()
  const city = (profile.city || "").trim()

  return [
    { key: "name", label: "Ім'я", filled: Boolean(name && name !== DEFAULT_CUSTOMER_NAME), required: true },
    { key: "phone", label: "Телефон", filled: validateUkraineMobilePhone(phone).valid, required: true },
    { key: "email", label: "Email", filled: Boolean(email), required: false },
    { key: "city", label: "Місто", filled: Boolean(city), required: false },
    { key: "telegram", label: "Telegram", filled: Boolean(profile.telegram), required: false },
    { key: "verification", label: "Підтвердження", filled: isCustomerVerified(profile), required: true },
  ]
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
