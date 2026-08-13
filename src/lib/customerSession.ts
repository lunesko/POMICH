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

export interface PersistedActiveOrder {
  orderId: string
  status: string
  updatedAt: number
}

export function persistActiveOrder(orderId: string, status: string) {
  if (typeof window === "undefined" || !orderId) return
  const payload: PersistedActiveOrder = { orderId, status, updatedAt: Date.now() }
  window.sessionStorage.setItem(ACTIVE_ORDER_STORAGE_KEY, JSON.stringify(payload))
}

export function readActiveOrder(): PersistedActiveOrder | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_ORDER_STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as PersistedActiveOrder
    if (!parsed?.orderId) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function clearActiveOrder() {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(ACTIVE_ORDER_STORAGE_KEY)
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
