import type { CustomerProfile } from "../api/client"
import { DEFAULT_CUSTOMER_NAME, isCustomerProfileComplete } from "./customerProfile"

export type UserRole = "customer" | "provider"

export interface UserAccountStatus {
  customerId: string
  preferredRole: UserRole | ""
  linkedProviderId: string
  rolesRegistered: UserRole[]
  clientRegistered: boolean
  providerRegistered: boolean
  needsOnboarding: boolean
  profile?: CustomerProfile
}

export function isClientProfileComplete(profile: CustomerProfile): boolean {
  const name = (profile.name || "").trim()
  const phone = (profile.phone || "").trim()
  return Boolean(name && name !== DEFAULT_CUSTOMER_NAME && phone)
}

/** Registered on server or profile already has name + valid phone. */
export function isReturningClient(status: UserAccountStatus): boolean {
  if (status.clientRegistered) return true
  return Boolean(status.profile && isCustomerProfileComplete(status.profile))
}

export function resolveProviderIdForCustomer(customerId: string, linkedProviderId?: string): string {
  const linked = (linkedProviderId || "").trim()
  if (linked) return linked
  const normalizedCustomerId = (customerId || "").trim()
  if (normalizedCustomerId && normalizedCustomerId !== "customer-web") return `provider-${normalizedCustomerId}`
  return ""
}

export function readStoredCustomerId(telegramChatId?: string): string {
  if (telegramChatId) return `tg-${telegramChatId}`
  if (typeof window === "undefined") return "customer-web"
  return (
    window.localStorage.getItem("pomichCustomerId") ||
    window.sessionStorage.getItem("pomichCustomerId") ||
    "customer-web"
  )
}

export function storeLinkedProviderId(providerId: string) {
  if (typeof window === "undefined" || !providerId) return
  window.sessionStorage.setItem("pomichLinkedProviderId", providerId)
}

export function roleLabel(role: UserRole): string {
  return role === "customer" ? "Клієнт" : "Партнер"
}
