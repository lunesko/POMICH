import type { CustomerProfile } from "../api/client"
import { DEFAULT_CUSTOMER_NAME, isCustomerProfileComplete } from "./customerProfile"

/** True when a stored web profile name differs from what the user just entered. */
export function isStoredProfileNameMismatch(storedName: string | undefined, enteredName: string): boolean {
  const stored = (storedName || "").trim()
  const entered = enteredName.trim()
  if (!stored || stored === DEFAULT_CUSTOMER_NAME || !entered) return false
  return stored.localeCompare(entered, "uk", { sensitivity: "accent" }) !== 0
}

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

/** Merge session/bootstrap profile into account status when API omits or underfills it. */
export function mergeAccountProfile(status: UserAccountStatus, profile?: CustomerProfile): UserAccountStatus {
  if (!profile) return status
  if (!status.profile) return { ...status, profile }

  const server = status.profile
  if (isCustomerProfileComplete(server)) return status

  if (isCustomerProfileComplete(profile)) {
    return { ...status, profile: { ...profile, id: server.id || profile.id } }
  }

  const serverName = (server.name || "").trim()
  const serverPhone = (server.phone || "").trim()
  return {
    ...status,
    profile: {
      ...server,
      name: serverName && serverName !== DEFAULT_CUSTOMER_NAME ? server.name : profile.name,
      phone: serverPhone ? server.phone : profile.phone,
    },
  }
}

export function readBootstrapProfile(): CustomerProfile | undefined {
  if (typeof window === "undefined") return undefined
  const raw = window.sessionStorage.getItem("pomichBootstrapProfile")
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as CustomerProfile
  } catch {
    return undefined
  }
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
