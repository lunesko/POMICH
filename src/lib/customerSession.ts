import {
  createGuestCustomerSession,
  createTelegramCustomerSession,
  getUserAccount,
  type AuthSession,
  type CustomerProfile,
} from "../api/client"
import { getTelegramContext, type TelegramContext } from "../telegram"
import {
  authSessionStorageKey,
  clearCustomerAuthStorage,
  clearSessionMismatchNotice,
  detectStoredCustomerMismatch,
  isExplicitLogout,
  markSessionMismatchNotice,
  persistCustomerId,
  purgeStaleCustomerSessions,
  readPersistedCustomerId,
  readStoredAuthSession,
  guestSessionCustomerIdForRestore,
  readStoredCustomerAuthSession,
  storeAuthSession,
} from "./auth"
import { DEFAULT_CUSTOMER_NAME, isCustomerProfileComplete } from "./customerProfile"
import { mergeAccountProfile, readBootstrapProfile, type UserAccountStatus } from "./userAccount"

const ACTIVE_ORDER_STORAGE_KEY = "pomichActiveOrder"

/** In-progress ride statuses restored after Telegram WebApp reopen. */
export const ACTIVE_ORDER_STATUSES = new Set([
  "searching",
  "accepted",
  "price_confirmed",
  "assigned",
  "en_route",
  "arrived",
  "in_progress",
])

export const TERMINAL_ORDER_STATUSES = new Set(["completed", "cancelled", "expired"])

export function isActiveOrderStatus(status?: string): boolean {
  const normalized = String(status || "").trim()
  return Boolean(normalized && ACTIVE_ORDER_STATUSES.has(normalized))
}

export function isTerminalOrderStatus(status?: string): boolean {
  const normalized = String(status || "").trim()
  return Boolean(normalized && TERMINAL_ORDER_STATUSES.has(normalized))
}

export interface PersistedActiveOrder {
  orderId: string
  status: string
  updatedAt: number
}

function writeActiveOrderPayload(payload: PersistedActiveOrder) {
  const raw = JSON.stringify(payload)
  // Dual-write: Telegram WebApp often wipes sessionStorage on close; localStorage survives.
  window.sessionStorage.setItem(ACTIVE_ORDER_STORAGE_KEY, raw)
  window.localStorage.setItem(ACTIVE_ORDER_STORAGE_KEY, raw)
}

export function persistActiveOrder(orderId: string, status: string) {
  if (typeof window === "undefined" || !orderId) return
  if (!isActiveOrderStatus(status)) {
    clearActiveOrder()
    return
  }
  writeActiveOrderPayload({ orderId, status, updatedAt: Date.now() })
}

export function readActiveOrder(): PersistedActiveOrder | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.localStorage.getItem(ACTIVE_ORDER_STORAGE_KEY) || window.sessionStorage.getItem(ACTIVE_ORDER_STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as PersistedActiveOrder
    if (!parsed?.orderId) return undefined
    if (!isActiveOrderStatus(parsed.status)) {
      clearActiveOrder()
      return undefined
    }
    // Re-hydrate session copy so in-tab code that only reads session still works.
    window.sessionStorage.setItem(ACTIVE_ORDER_STORAGE_KEY, raw)
    return parsed
  } catch {
    clearActiveOrder()
    return undefined
  }
}

export function clearActiveOrder() {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(ACTIVE_ORDER_STORAGE_KEY)
  window.localStorage.removeItem(ACTIVE_ORDER_STORAGE_KEY)
}

/** Pick newest non-terminal order from server history (customer or partner). */
export function pickLatestActiveOrder(
  orders: Array<{ id?: string; status?: string }> | undefined,
): PersistedActiveOrder | undefined {
  if (!Array.isArray(orders) || orders.length === 0) return undefined
  for (const order of orders) {
    const orderId = String(order?.id || "").trim()
    const status = String(order?.status || "").trim()
    if (!orderId || !ACTIVE_ORDER_STATUSES.has(status)) continue
    return { orderId, status, updatedAt: Date.now() }
  }
  return undefined
}

export interface ResolvedCustomerAuth {
  customerId: string
  token: string
  session?: AuthSession
  account?: UserAccountStatus
  profile?: CustomerProfile
}

export interface ResolveCustomerAuthOptions {
  /** User clicked «Увійти» — restore tg-* profile even after explicit logout. */
  explicitSignIn?: boolean
}

function coalesceTelegramContext(
  telegramContext?: Pick<TelegramContext, "initData" | "chatId" | "user">,
): Pick<TelegramContext, "initData" | "chatId" | "user"> {
  const fresh = getTelegramContext()
  return {
    initData: telegramContext?.initData || fresh.initData,
    chatId: telegramContext?.chatId || fresh.chatId,
    user: telegramContext?.user || fresh.user,
  }
}

/** Bootstrap profile cached in sessionStorage — only when it belongs to the active customer. */
export function readBootstrapProfileForCustomer(customerId: string): CustomerProfile | undefined {
  const profile = readBootstrapProfile()
  if (!profile) return undefined
  const profileId = String(profile.id || "").trim()
  if (profileId && profileId !== customerId) {
    if (typeof window !== "undefined") window.sessionStorage.removeItem("pomichBootstrapProfile")
    return undefined
  }
  return profile
}

export function applyCustomerAuthSession(session: AuthSession): string {
  const customerId = session.customerId ?? session.subjectId
  if (!customerId || !session.accessToken) return customerId || ""
  storeAuthSession(authSessionStorageKey("customer", customerId), session)
  persistCustomerId(customerId)
  return customerId
}

/** Fill empty profile name from Telegram first_name when server profile has no display name yet. */
export function enrichProfileWithTelegram(
  profile: CustomerProfile | undefined,
  telegramContext: Pick<TelegramContext, "user" | "chatId">,
  customerId: string,
): CustomerProfile {
  const name = String(profile?.name || "").trim()
  const telegramName = telegramContext.user?.first_name
    ? `${telegramContext.user.first_name}${telegramContext.user.last_name ? ` ${telegramContext.user.last_name}` : ""}`.trim()
    : ""
  const base: CustomerProfile = profile
    ? { ...profile, id: customerId }
    : {
        id: customerId,
        name: telegramName || DEFAULT_CUSTOMER_NAME,
        phone: "",
        city: "",
        rating: 5,
        ordersCompleted: 0,
        verificationStatus: "unverified",
        trustedBadges: ["Телефон", "Профіль"],
        profileCompleteness: telegramContext.user?.username ? 62 : 45,
        telegram: telegramContext.user?.username,
      }

  if ((!name || name === DEFAULT_CUSTOMER_NAME) && telegramName) {
    return { ...base, name: telegramName, telegram: base.telegram || telegramContext.user?.username }
  }
  return base
}

/**
 * Resolve customer auth with priority: Telegram initData session > stored session > guest.
 * In Telegram WebApp always re-authenticates via initData and drops stale web guest state.
 */
export async function resolveCustomerAuthSession(
  telegramContext: Pick<TelegramContext, "initData" | "chatId" | "user"> = {},
  options?: ResolveCustomerAuthOptions,
): Promise<ResolvedCustomerAuth> {
  const ctx = coalesceTelegramContext(telegramContext)
  const expectedCustomerId = readPersistedCustomerId(ctx.chatId)

  if (options?.explicitSignIn) {
    // Successful intentional login must not keep a stale mismatch banner around.
    clearSessionMismatchNotice()
  }

  if (ctx.chatId && detectStoredCustomerMismatch(ctx.chatId)) {
    clearCustomerAuthStorage()
    // Keep a one-shot notice so cabinet can explain the purge (not forever).
    markSessionMismatchNotice("telegram-stale-web")
  }

  purgeStaleCustomerSessions(expectedCustomerId)
  readBootstrapProfileForCustomer(expectedCustomerId)

  const allowTelegramSession = ctx.initData && (!isExplicitLogout(ctx.chatId) || options?.explicitSignIn)
  if (allowTelegramSession) {
    const session = await createTelegramCustomerSession(ctx.initData!)
    const customerId = applyCustomerAuthSession(session) || expectedCustomerId
    purgeStaleCustomerSessions(customerId)
    readBootstrapProfileForCustomer(customerId)
    const account = mergeAccountProfile(
      session.account ?? (await getUserAccount(customerId, session.accessToken, ctx.initData)),
      session.profile ?? (options?.explicitSignIn ? undefined : readBootstrapProfileForCustomer(customerId)),
    )
    const profile = enrichProfileWithTelegram(
      session.profile ?? account.profile ?? readBootstrapProfileForCustomer(customerId),
      ctx,
      customerId,
    )
    return { customerId, token: session.accessToken, session, account: { ...account, profile }, profile }
  }

  const restored = readStoredCustomerAuthSession({ telegramChatId: ctx.chatId })
  let customerId = restored?.customerId ?? expectedCustomerId
  let token =
    restored?.token ?? readStoredAuthSession(authSessionStorageKey("customer", customerId), "customer", customerId)

  if (token) {
    let account: UserAccountStatus
    try {
      account = await getUserAccount(customerId, token, ctx.initData)
    } catch (err) {
      const fallbackProfile = enrichProfileWithTelegram(
        readBootstrapProfileForCustomer(customerId),
        ctx,
        customerId,
      )
      if (!options?.explicitSignIn || !fallbackProfile || !isCustomerProfileComplete(fallbackProfile)) {
        throw err
      }
      account = mergeAccountProfile(
        {
          customerId,
          preferredRole: "customer",
          linkedProviderId: "",
          rolesRegistered: ["customer"],
          clientRegistered: true,
          providerRegistered: false,
          needsOnboarding: false,
          profile: fallbackProfile,
        },
        fallbackProfile,
      )
    }
    const profile = enrichProfileWithTelegram(
      account.profile ?? readBootstrapProfileForCustomer(customerId),
      ctx,
      customerId,
    )
    return { customerId, token, account: { ...account, profile }, profile }
  }

  const session = await createGuestCustomerSession(guestSessionCustomerIdForRestore(customerId))
  customerId = applyCustomerAuthSession(session) || customerId
  const bootstrapProfile = options?.explicitSignIn ? undefined : readBootstrapProfileForCustomer(customerId)
  const account = mergeAccountProfile(
    session.account ?? (await getUserAccount(customerId, session.accessToken, ctx.initData)),
    session.profile ?? bootstrapProfile,
  )
  const profile = enrichProfileWithTelegram(
    session.profile ?? account.profile ?? bootstrapProfile,
    ctx,
    customerId,
  )
  return { customerId, token: session.accessToken, session, account: { ...account, profile }, profile }
}
