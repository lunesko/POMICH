import type { CustomerProfile } from "../api/client"
import { DEFAULT_CUSTOMER_NAME, isCustomerProfileComplete } from "./customerProfile"
import { getActiveProviderId } from "./constants"
import { readCachedProviderProfile } from "./providerProfileCache"

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
  if (status.rolesRegistered.includes("customer")) return true
  return Boolean(status.profile && isClientProfileComplete(status.profile))
}

export function isPartnerLocallyRegistered(providerId: string): boolean {
  if (!providerId || typeof window === "undefined") return false
  return Boolean(window.localStorage.getItem(`pomichPartnerRegistered:${providerId}`))
}

/** Registered partner on server, in rolesRegistered, linked id, or local completion flag. */
export function isReturningPartner(status: UserAccountStatus): boolean {
  if (status.providerRegistered) return true
  if (status.rolesRegistered.includes("provider")) return true
  const linkedId = (status.linkedProviderId || "").trim() || resolveProviderIdForCustomer(status.customerId, status.linkedProviderId)
  if (linkedId && isPartnerLocallyRegistered(linkedId)) return true
  if (typeof window !== "undefined") {
    const activeId = getActiveProviderId()
    if (activeId && isPartnerLocallyRegistered(activeId)) return true
    const cached = readCachedProviderProfile(linkedId || activeId)
    if (cached && (cached.registeredAt || cached.vehicle || cached.plate || (cached.name && cached.phone))) return true
    const bootstrap = readBootstrapProfile()
    if (bootstrap && ((bootstrap as any).vehicle || (bootstrap as any).plate)) return true
  }
  return Boolean((status.linkedProviderId || "").trim())
}

function readLinkedProviderIdFromStorage(): string {
  if (typeof window === "undefined") return ""
  try {
    return String(
      window.sessionStorage.getItem("pomichLinkedProviderId") ||
        window.localStorage.getItem("pomichLinkedProviderId") ||
        "",
    ).trim()
  } catch {
    return ""
  }
}

/** Resolve partner name/phone from account, provider cache, or bootstrap for role switch. */
export function resolvePartnerIdentity(status: UserAccountStatus): {
  name: string
  phone: string
  city?: string
  verificationStatus?: CustomerProfile["verificationStatus"]
  linkedProviderId: string
} {
  const linkedId =
    (status.linkedProviderId || "").trim() ||
    readLinkedProviderIdFromStorage() ||
    resolveProviderIdForCustomer(status.customerId, status.linkedProviderId) ||
    (typeof window !== "undefined" ? getActiveProviderId() : "")
  const cached = typeof window !== "undefined" ? readCachedProviderProfile(linkedId) : undefined
  const bootstrap = typeof window !== "undefined" ? readBootstrapProfile() : undefined
  const profileName = (status.profile?.name || "").trim()
  const name =
    profileName && profileName !== DEFAULT_CUSTOMER_NAME
      ? profileName
      : (cached?.name || bootstrap?.name || "").trim()
  const phone = (status.profile?.phone || cached?.phone || bootstrap?.phone || "").trim()
  const city = status.profile?.city || cached?.city || bootstrap?.city
  const verificationStatus =
    status.profile?.verificationStatus ||
    (cached?.verificationStatus === "verified" ? "verified" : undefined) ||
    bootstrap?.verificationStatus ||
    "unverified"
  return { name, phone, city, verificationStatus, linkedProviderId: linkedId }
}

/** Fill client name/phone from cached partner profile when switching partner → client. */
export function hydrateClientFromPartner(status: UserAccountStatus): UserAccountStatus {
  if (isReturningClient(status)) {
    const rolesRegistered = status.rolesRegistered.includes("customer")
      ? status.rolesRegistered
      : ([...status.rolesRegistered, "customer"] as UserRole[])
    return {
      ...status,
      clientRegistered: true,
      rolesRegistered,
      needsOnboarding: false,
    }
  }
  if (!isReturningPartner(status) && !readLinkedProviderIdFromStorage() && !status.linkedProviderId) {
    return status
  }

  const { name, phone, city, verificationStatus, linkedProviderId } = resolvePartnerIdentity(status)
  if (!name || name === DEFAULT_CUSTOMER_NAME || !phone) {
    return {
      ...status,
      linkedProviderId: linkedProviderId || status.linkedProviderId,
      providerRegistered: status.providerRegistered || Boolean(linkedProviderId),
    }
  }

  const rolesRegistered = status.rolesRegistered.includes("customer")
    ? status.rolesRegistered
    : ([...status.rolesRegistered, "customer"] as UserRole[])

  return {
    ...status,
    linkedProviderId: linkedProviderId || status.linkedProviderId,
    providerRegistered: true,
    clientRegistered: true,
    rolesRegistered,
    needsOnboarding: false,
    profile: {
      ...(status.profile || { id: status.customerId }),
      id: status.profile?.id || status.customerId,
      name,
      phone,
      city,
      verificationStatus: verificationStatus || "unverified",
    },
  }
}

/**
 * Snapshot used when opening «Змінити роль» from partner UI.
 * Works even when CustomerApp.account is still null (providerToken-only entry).
 */
export function buildRoleSwitchPreservedAccount(
  account?: UserAccountStatus | null,
  customerId?: string,
): UserAccountStatus {
  const storedLinked = readLinkedProviderIdFromStorage()
  const id = String(account?.customerId || customerId || "").trim() || readStoredCustomerId()
  const linkedId =
    (account?.linkedProviderId || "").trim() ||
    storedLinked ||
    resolveProviderIdForCustomer(id)
  const base: UserAccountStatus = {
    customerId: id,
    preferredRole: account?.preferredRole || "provider",
    linkedProviderId: linkedId,
    rolesRegistered: account?.rolesRegistered?.length
      ? account.rolesRegistered
      : linkedId
        ? (["provider"] as UserRole[])
        : [],
    clientRegistered: Boolean(account?.clientRegistered),
    providerRegistered: Boolean(account?.providerRegistered || linkedId),
    needsOnboarding: false,
    profile: account?.profile,
  }
  const enriched = enrichPartnerAccountStatus(base)
  const hydrated = hydrateClientFromPartner(enriched)
  /* Persist identity so OnboardingGate boot / API misses still recover. */
  if (typeof window !== "undefined" && hydrated.profile && isClientProfileComplete(hydrated.profile)) {
    try {
      window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(hydrated.profile))
    } catch {
      // ignore
    }
  }
  if (hydrated.linkedProviderId) storeLinkedProviderId(hydrated.linkedProviderId)
  return hydrated
}

/** Restore partner flags dropped by a stale /account response during role switch. */
export function enrichPartnerAccountStatus(status: UserAccountStatus): UserAccountStatus {
  if (!isReturningPartner(status)) return status
  const linkedId = (status.linkedProviderId || "").trim() || resolveProviderIdForCustomer(status.customerId, status.linkedProviderId)
  const rolesRegistered = status.rolesRegistered.includes("provider")
    ? status.rolesRegistered
    : ([...status.rolesRegistered, "provider"] as UserRole[])
  const withPartner: UserAccountStatus = {
    ...status,
    linkedProviderId: linkedId || status.linkedProviderId,
    providerRegistered: true,
    rolesRegistered,
    needsOnboarding: status.needsOnboarding && !isReturningClient(status) ? status.needsOnboarding : false,
  }
  return hydrateClientFromPartner(withPartner)
}

/** Merge in-memory account from CustomerApp when reopening the role picker. */
export function mergePreservedAccountStatus(current: UserAccountStatus, preserved?: UserAccountStatus | null): UserAccountStatus {
  if (!preserved) return enrichPartnerAccountStatus(current)
  const preferredProfile = (() => {
    if (!current.profile) return preserved.profile
    if (!preserved.profile) return current.profile
    /* Prefer the richer profile — stale API shells must not wipe partner/client identity. */
    if (isClientProfileComplete(current.profile) && !isClientProfileComplete(preserved.profile)) {
      return current.profile
    }
    if (isClientProfileComplete(preserved.profile) && !isClientProfileComplete(current.profile)) {
      return preserved.profile
    }
    return mergeAccountProfile({ ...current, profile: current.profile }, preserved.profile).profile || current.profile
  })()
  const merged: UserAccountStatus = {
    ...current,
    preferredRole: current.preferredRole || preserved.preferredRole,
    clientRegistered: current.clientRegistered || preserved.clientRegistered,
    providerRegistered: current.providerRegistered || preserved.providerRegistered,
    linkedProviderId: current.linkedProviderId || preserved.linkedProviderId,
    rolesRegistered: [...new Set([...current.rolesRegistered, ...preserved.rolesRegistered])] as UserRole[],
    profile: preferredProfile,
    needsOnboarding: current.needsOnboarding && preserved.needsOnboarding,
  }
  const enriched = enrichPartnerAccountStatus(merged)
  if (isReturningClient(enriched) || isReturningPartner(enriched)) {
    return { ...enriched, needsOnboarding: false }
  }
  return enriched
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
