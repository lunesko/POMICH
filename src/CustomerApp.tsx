import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"

import { getUserAccount, type UserAccountStatus } from "./api/client"
import AppShell from "./components/layout/AppShell"
import LandingPage from "./components/landing/LandingPage"
import CustomerAppFallback from "./components/CustomerAppFallback"
import OnboardingGate from "./components/onboarding/OnboardingGate"
import { getTelegramContext, resolveEntryRole, resolveEntryScreen, clearEntryScreenParam, sanitizePublicAppUrl, type PomichEntryScreen } from "./telegram"
import { DEFAULT_CUSTOMER_NAME, isCustomerProfileComplete, isCustomerVerified } from "./lib/customerProfile"
import { getActiveProviderId, type Role } from "./lib/constants"
import { readCachedProviderProfile } from "./lib/providerProfileCache"
import { mediaQueries } from "./lib/breakpoints"
import { useMediaQuery } from "./hooks/useMediaQuery"
import { enrichPartnerAccountStatus, hydrateClientFromPartner, isReturningClient, isReturningPartner, mergeAccountProfile, mergePreservedAccountStatus, resolveProviderIdForCustomer, storeLinkedProviderId } from "./lib/userAccount"
import {
  applyHiddenAdminEntry,
  isAdminEntryLocation,
  isHiddenAdminHash,
} from "./lib/adminAccess"
import {
  authSessionStorageKey,
  clearAllAuthStorage,
  clearCustomerAuthStorage,
  clearProviderAuthStorage,
  clearExplicitLogout,
  dismissSessionMismatchNotice,
  getStoredQueryToken,
  isExplicitLogout,
  isAuthSessionToken,
  markExplicitLogout,
  purgeStaleCustomerSessions,
  readAuthSessionSubject,
  readPersistedCustomerId,
  readStoredAuthSession,
  readStoredCustomerAuthSession,
  resolveSessionMismatchWarning,
} from "./lib/auth"
import {
  clearActiveOrder,
  enrichProfileWithTelegram,
  resolveCustomerAuthSession,
} from "./lib/customerSession"
import {
  clearActiveAppRole,
  clearPendingPartnerReview,
  persistActiveAppRole,
  readActiveAppRole,
} from "./lib/appRole"
import { syncProfileCityFromGeo } from "./lib/syncProfileCityFromGeo"
import { canRequestGeoSilently, requestCurrentPosition } from "./lib/mapGeo"

const CustomerFlow = lazy(() => import("./components/customer/CustomerFlow"))
const ProviderFlow = lazy(() => import("./components/provider/ProviderFlow"))
const ClientCabinet = lazy(() => import("./components/cabinet/ClientCabinet"))
const ProviderCabinet = lazy(() => import("./components/cabinet/ProviderCabinet"))
const AdminFlow = lazy(() => import("./components/admin/AdminFlow"))

function FlowSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "40dvh",
            color: "var(--pomich-muted, #64748b)",
            fontWeight: 700,
          }}
        >
          Завантаження…
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

export default function CustomerApp() {
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const telegramLoggedOut = telegramContext.isTelegram && isExplicitLogout(telegramContext.chatId)
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const adminToken = useMemo(() => getStoredQueryToken("adminToken", "pomichAdminToken"), [])
  const providerToken = useMemo(() => getStoredQueryToken("providerToken", "pomichProviderToken"), [])
  const initialRole = useMemo<Role | null>(() => {
    if (typeof window === "undefined") return null
    if (isAdminEntryLocation()) return "admin"
    // Prefer Telegram bot kind (tgBot / start_param) over bare ?role= when both present.
    if (telegramContext.botKind === "customer" || telegramContext.botKind === "provider") {
      return telegramContext.botKind
    }
    const queryRole = new URLSearchParams(window.location.search).get("role")
    if (queryRole === "customer" || queryRole === "provider") return queryRole
    const entryRole = resolveEntryRole()
    if (entryRole) return entryRole
    // Clean URL (pomich.help): restore last role so refresh mid-order does not dump to landing.
    if (!telegramLoggedOut) {
      const storedRole = readActiveAppRole()
      if (storedRole) {
        const hasCustomerSession = Boolean(readStoredCustomerAuthSession({ telegramChatId: telegramContext.chatId }))
        const hasLinkedProvider = Boolean(
          typeof window !== "undefined" &&
            (window.sessionStorage.getItem("pomichLinkedProviderId") || window.localStorage.getItem("pomichLinkedProviderId")),
        )
        if (storedRole === "provider" && (hasCustomerSession || hasLinkedProvider || telegramContext.initData)) {
          return "provider"
        }
        if (storedRole === "customer" && (hasCustomerSession || telegramContext.initData)) {
          return "customer"
        }
      }
    }
    return null
  }, [telegramContext.botKind, telegramContext.chatId, telegramContext.initData, telegramLoggedOut])
  const [role, setRole] = useState<Role | null>(initialRole)
  const [account, setAccount] = useState<UserAccountStatus | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (initialRole === "customer" || initialRole === "provider") {
      // Restored from storage with a clean URL — enter flow directly (session hydrate effects run).
      const fromQuery =
        typeof window !== "undefined" &&
        (new URLSearchParams(window.location.search).get("role") === "customer" ||
          new URLSearchParams(window.location.search).get("role") === "provider")
      if (!fromQuery && !telegramContext.isTelegram) return false
      return true
    }
    if (telegramContext.isTelegram && initialRole !== "admin" && !providerToken && !telegramLoggedOut) return true
    return false
  })
  const [pendingRole, setPendingRole] = useState<Role | null>(initialRole === "customer" || initialRole === "provider" ? initialRole : null)
  const [startAtRoleSelect, setStartAtRoleSelect] = useState(false)
  // Phone OTP login is web-only; Telegram WebApp auth uses initData → tg-{id} session.
  const [loginMode, setLoginMode] = useState(false)
  const [showLanding, setShowLanding] = useState(() => telegramLoggedOut)
  const [showCabinet, setShowCabinet] = useState(false)
  const [cabinetInitialEditing, setCabinetInitialEditing] = useState(false)
  const [customerToken, setCustomerToken] = useState<string | undefined>()
  const [forceRolePicker, setForceRolePicker] = useState(false)
  const [rolePickerKey, setRolePickerKey] = useState(0)
  const [onboardingSessionKey, setOnboardingSessionKey] = useState(0)
  const [entryScreen, setEntryScreen] = useState<PomichEntryScreen | null>(() => resolveEntryScreen())
  const [cabinetFocus, setCabinetFocus] = useState<"profile" | "history">("profile")
  const [providerEntryScreen, setProviderEntryScreen] = useState<"duty" | "offers" | "verify" | undefined>(() => {
    const screen = resolveEntryScreen()
    if (screen === "duty" || screen === "offers" || screen === "verify") return screen
    return undefined
  })
  const compact = telegramContext.isTelegram || isMobile
  const skipOnboarding = initialRole === "admin" || Boolean(providerToken)

  useEffect(() => {
    const target = role ?? initialRole
    if (target === "provider") {
      void import("./components/provider/ProviderFlow")
    } else if (target === "customer") {
      void import("./components/customer/CustomerFlow")
    }
  }, [role, initialRole])

  // Telegram inline buttons pass ?screen= — open that named UI, not a generic map/home.
  useEffect(() => {
    if (!entryScreen || showOnboarding || showLanding) return
    if (role !== "customer" && role !== "provider") return

    if (role === "customer") {
      if (entryScreen === "profile" || entryScreen === "cabinet") {
        setCabinetFocus("profile")
        setShowCabinet(true)
      } else if (entryScreen === "history") {
        setCabinetFocus("history")
        setShowCabinet(true)
      } else {
        // order / help → customer ride flow
        setShowCabinet(false)
      }
    } else if (role === "provider") {
      if (entryScreen === "cabinet" || entryScreen === "profile" || entryScreen === "orders") {
        setCabinetInitialEditing(entryScreen === "profile")
        setShowCabinet(true)
        setProviderEntryScreen(undefined)
      } else if (entryScreen === "duty" || entryScreen === "offers" || entryScreen === "verify") {
        setShowCabinet(false)
        setProviderEntryScreen(entryScreen)
      } else {
        setShowCabinet(false)
      }
    }

    clearEntryScreenParam()
    sanitizePublicAppUrl({ preserveAdminRole: true })
    setEntryScreen(null)
  }, [entryScreen, role, showOnboarding, showLanding])

  // After reading ?role= / ?tgBot= into state, drop them so Safari shows only pomich.help.
  useEffect(() => {
    if (role === "admin") return
    sanitizePublicAppUrl({ preserveAdminRole: true })
  }, [role])

  const applyRoleToUrl = useCallback((nextRole: Role | null) => {
    setRole(nextRole)
    setShowCabinet(false)
    setCabinetInitialEditing(false)
    if (nextRole === "customer" || nextRole === "provider") {
      persistActiveAppRole(nextRole)
    } else if (nextRole === null) {
      clearActiveAppRole()
    }
    if (typeof window === "undefined") return
    if (nextRole === "admin") {
      applyHiddenAdminEntry()
      return
    }
    // Customer / partner / landing: never keep role (or other deep-link noise) in the address bar.
    sanitizePublicAppUrl({ preserveAdminRole: false })
  }, [])

  const beginOnboarding = useCallback((nextRole: Role | null, openRolePicker = false, isLogin = false) => {
    if (skipOnboarding && nextRole) {
      applyRoleToUrl(nextRole)
      return
    }
    clearExplicitLogout()
    // Login must keep a valid stored customer session (menu/landing → «Увійти»).
    // Only purge tokens for other customer ids — never wipe the active session here.
    if (isLogin) {
      const activeCustomerId = readPersistedCustomerId(telegramContext.chatId)
      purgeStaleCustomerSessions(activeCustomerId)
    }
    setPendingRole(nextRole)
    setStartAtRoleSelect(openRolePicker)
    setLoginMode(isLogin)
    setShowOnboarding(true)
    setShowLanding(false)
    setShowCabinet(false)
  }, [skipOnboarding, telegramContext.chatId, applyRoleToUrl])

  const enterCustomerFlow = useCallback(async () => {
    clearExplicitLogout()
    setAccount(null)
    setCustomerToken(undefined)

    // Do not clearCustomerAuthStorage here — returning users keep token/customerId across Меню/landing.
    const activeCustomerId = readPersistedCustomerId(telegramContext.chatId)
    purgeStaleCustomerSessions(activeCustomerId)

    try {
      const resolved = await resolveCustomerAuthSession(telegramContext, { explicitSignIn: true })
      const status = resolved.account ?? mergeAccountProfile(
        await getUserAccount(resolved.customerId, resolved.token, telegramContext.initData),
        resolved.profile,
      )
      // Web guest-* sessions are valid returning clients when registered/complete (phone OTP already done).
      const canonicalSession =
        resolved.customerId.startsWith("tg-") ||
        resolved.customerId.startsWith("guest-") ||
        (status.clientRegistered && resolved.customerId !== "customer-web")

      if (canonicalSession && isReturningClient(status)) {
        if (status.profile && isCustomerProfileComplete(status.profile) && !isCustomerVerified(status.profile)) {
          beginOnboarding("customer", false, !telegramContext.initData)
          return
        }
        setAccount(status)
        setCustomerToken(resolved.token)
        if (status.profile && typeof window !== "undefined") {
          window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(status.profile))
        }
        setShowOnboarding(false)
        setShowLanding(false)
        setShowCabinet(false)
        setPendingRole(null)
        setStartAtRoleSelect(false)
        setLoginMode(false)
        applyRoleToUrl("customer")
        return
      }
    } catch {
      // Fall through to phone login when account cannot be restored.
    }

    beginOnboarding("customer", false, !telegramContext.initData)
  }, [beginOnboarding, applyRoleToUrl, telegramContext])

  const enterPartnerFlow = useCallback(async () => {
    clearExplicitLogout()
    clearProviderAuthStorage({ includeAdmin: true })
    setShowCabinet(false)

    const activeCustomerId = readPersistedCustomerId(telegramContext.chatId)
    purgeStaleCustomerSessions(activeCustomerId)

    const storedSession = readStoredCustomerAuthSession({ telegramChatId: telegramContext.chatId })
    if (!storedSession?.token && !telegramContext.initData) {
      setAccount(null)
      setCustomerToken(undefined)
      setRole(null)
      beginOnboarding("provider", false, !telegramContext.initData)
      return
    }

    try {
      const resolved = await resolveCustomerAuthSession(telegramContext, { explicitSignIn: true })
      const status = resolved.account ?? mergeAccountProfile(
        await getUserAccount(resolved.customerId, resolved.token, telegramContext.initData),
        resolved.profile,
      )
      const linkedId =
        status.linkedProviderId?.trim() ||
        resolveProviderIdForCustomer(resolved.customerId, status.linkedProviderId)
      const canRestorePartner = Boolean(resolved.token && isReturningPartner(status))

      if (canRestorePartner) {
        if (linkedId) storeLinkedProviderId(linkedId)
        setAccount({ ...status, linkedProviderId: linkedId || status.linkedProviderId })
        setCustomerToken(resolved.token)
        if (status.profile && typeof window !== "undefined") {
          window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(status.profile))
        }
        setShowOnboarding(false)
        setShowLanding(false)
        setPendingRole(null)
        setStartAtRoleSelect(false)
        setLoginMode(false)
        applyRoleToUrl("provider")
        return
      }

      if (resolved.token) {
        if (linkedId) storeLinkedProviderId(linkedId)
        setAccount({ ...status, linkedProviderId: linkedId || status.linkedProviderId })
        setCustomerToken(resolved.token)
        if (status.profile && typeof window !== "undefined") {
          window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(status.profile))
        }
      }
    } catch {
      // Fall through to phone OTP when partner session cannot be restored.
    }

    setRole(null)
    beginOnboarding("provider", false, !telegramContext.initData)
  }, [beginOnboarding, applyRoleToUrl, telegramContext])

  /** phone_already_registered / «Увійти за цим номером» — phone OTP login, not guest-session skip. */
  const restorePartnerAccount = useCallback(() => {
    clearCustomerAuthStorage()
    clearProviderAuthStorage({ includeAdmin: true })
    setAccount(null)
    setCustomerToken(undefined)
    setRole(null)
    setShowCabinet(false)
    setPendingRole("provider")
    setStartAtRoleSelect(false)
    setLoginMode(true)
    setShowOnboarding(true)
    setShowLanding(false)
    setOnboardingSessionKey((value) => value + 1)
    sanitizePublicAppUrl({ preserveAdminRole: false })
  }, [])

  const goToLanding = useCallback(() => {
    // «Меню» / logo / home — show landing but keep customer token + customerId in storage.
    clearActiveAppRole()
    setShowLanding(true)
    setShowOnboarding(false)
    setShowCabinet(false)
    setForceRolePicker(false)
    setPendingRole(null)
    setStartAtRoleSelect(false)
    setLoginMode(false)
    applyRoleToUrl(null)
  }, [applyRoleToUrl])

  const handleRoleChange = useCallback((nextRole: Role | null) => {
    if (nextRole === "customer") {
      void enterCustomerFlow()
      return
    }
    if (nextRole === "provider") {
      void enterPartnerFlow()
      return
    }
    goToLanding()
  }, [enterCustomerFlow, enterPartnerFlow, goToLanding])
  const handleLogout = () => {
    // Block Telegram auto-relogin AND web session restore after explicit logout.
    markExplicitLogout(telegramContext.isTelegram ? telegramContext.chatId : undefined)
    // Always leave the ride first — logout must work from completion/review screens.
    clearActiveOrder()
    clearPendingPartnerReview()
    clearActiveAppRole()
    clearAllAuthStorage()
    setCustomerToken(undefined)
    setAccount(null)
    setForceRolePicker(false)
    setPendingRole(null)
    setStartAtRoleSelect(false)
    setLoginMode(false)
    setShowOnboarding(false)
    setShowCabinet(false)
    setShowLanding(true)
    setRole(null)

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      url.searchParams.delete("role")
      url.searchParams.delete("providerToken")
      url.searchParams.delete("adminToken")
      // Cache-bust so same-path assign always hard-reloads off the completion screen.
      url.searchParams.set("logged_out", String(Date.now()))
      window.location.replace(`${url.pathname}${url.search}${url.hash}`)
    }
  }

  const handleSwitchRole = () => {
    // Keep the same customer identity + linkedProviderId so a registered partner
    // profile is restored after picking «Партнер» again (logout is the only full wipe).
    clearProviderAuthStorage({ includeAdmin: true })
    setAccount((prev) => (prev ? hydrateClientFromPartner(enrichPartnerAccountStatus(prev)) : prev))
    sanitizePublicAppUrl({ preserveAdminRole: false })
    setForceRolePicker(true)
    setRolePickerKey((value) => value + 1)
    setPendingRole(null)
    setStartAtRoleSelect(true)
    setShowOnboarding(true)
    setShowCabinet(false)
    setShowLanding(false)
    setLoginMode(false)
    setRole(null)
  }

  const loggedInCustomerName = useMemo(() => {
    if (role !== "customer" || showLanding || showOnboarding) return undefined
    const activeCustomerId = readPersistedCustomerId(telegramContext.chatId)
    const token =
      customerToken ??
      readStoredAuthSession(authSessionStorageKey("customer", activeCustomerId), "customer", activeCustomerId)
    if (!token) return undefined
    const name = (account?.profile?.name ?? "").trim()
    if (!name || name === DEFAULT_CUSTOMER_NAME) return undefined
    return name
  }, [role, showLanding, showOnboarding, customerToken, account?.profile?.name, telegramContext.chatId])

  useEffect(() => {
    if (typeof window === "undefined") return
    const enterAdminFromLocation = () => {
      if (!isAdminEntryLocation()) return false
      setRole("admin")
      setShowLanding(false)
      setShowOnboarding(false)
      if (isHiddenAdminHash()) applyHiddenAdminEntry()
      return true
    }

    enterAdminFromLocation()
    window.addEventListener("hashchange", enterAdminFromLocation)
    return () => window.removeEventListener("hashchange", enterAdminFromLocation)
  }, [])

  useEffect(() => {
    if (providerToken) {
      setRole("provider")
      setShowOnboarding(false)
      setShowLanding(false)
      return
    }
    if (adminToken) {
      setRole("admin")
      setShowOnboarding(false)
      setShowLanding(false)
    }
  }, [adminToken, providerToken])

  useEffect(() => {
    if (typeof window === "undefined") return
    const syncRoleFromUrl = () => {
      if (isAdminEntryLocation()) {
        setRole("admin")
        setShowLanding(false)
        setShowOnboarding(false)
        if (isHiddenAdminHash()) applyHiddenAdminEntry()
        return
      }
      const queryRole = new URLSearchParams(window.location.search).get("role")
      if (queryRole === "customer" || queryRole === "provider") {
        persistActiveAppRole(queryRole)
        setRole(queryRole)
        setShowLanding(false)
        return
      }
      // Clean address bar: keep persisted role instead of dumping to landing on back/forward.
      const stored = readActiveAppRole()
      if (stored) {
        setRole(stored)
        setShowLanding(false)
      }
    }

    window.addEventListener("popstate", syncRoleFromUrl)
    return () => window.removeEventListener("popstate", syncRoleFromUrl)
  }, [])

  useEffect(() => {
    if (role !== "provider" || account || showOnboarding || showLanding || providerToken) return

    let cancelled = false
    resolveCustomerAuthSession(telegramContext, { explicitSignIn: true })
      .then(async (resolved) => {
        if (cancelled || !resolved.token) return
        const status = resolved.account ?? mergeAccountProfile(
          await getUserAccount(resolved.customerId, resolved.token, telegramContext.initData),
          resolved.profile,
        )
        const linkedId =
          status.linkedProviderId ||
          resolveProviderIdForCustomer(resolved.customerId, status.linkedProviderId)
        if (!status.providerRegistered && !linkedId) return
        if (linkedId) storeLinkedProviderId(linkedId)
        setAccount({ ...status, linkedProviderId: linkedId || status.linkedProviderId })
        setCustomerToken(resolved.token)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [role, account, showOnboarding, showLanding, providerToken, telegramContext])

  useEffect(() => {
    if (!showCabinet || role !== "customer" || !account?.customerId) return

    let cancelled = false
    resolveCustomerAuthSession(telegramContext)
      .then((resolved) => {
        if (cancelled) return
        if (resolved.account) {
          setAccount(resolved.account)
        } else {
          setAccount((prev) => (prev ? { ...prev, customerId: resolved.customerId, profile: resolved.profile ?? prev.profile } : prev))
        }
        setCustomerToken(resolved.token)
        if (resolved.profile && typeof window !== "undefined") {
          window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(resolved.profile))
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [showCabinet, role, account?.customerId, telegramContext])

  useEffect(() => {
    if (!showCabinet || role !== "customer" || !account?.customerId || !customerToken) return

    let cancelled = false
    void canRequestGeoSilently().then((ok) => {
      if (cancelled || !ok) return
      requestCurrentPosition(
        (point) => {
          if (cancelled) return
          syncProfileCityFromGeo(point, account.customerId, customerToken, account.profile?.city)
            .then((result) => {
              if (cancelled || !result) return
              setAccount((prev) => {
                if (!prev?.profile) return prev
                const profile = result.saved ?? { ...prev.profile, city: result.city }
                if (typeof window !== "undefined") {
                  window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(profile))
                }
                return { ...prev, profile }
              })
            })
            .catch(() => undefined)
        },
        () => undefined,
        { mode: "auto" },
      )
    })

    return () => {
      cancelled = true
    }
  }, [showCabinet, role, account?.customerId, account?.profile?.city, customerToken])

  if ((!skipOnboarding || forceRolePicker) && showOnboarding) {
    return (
      <OnboardingGate
        key={forceRolePicker ? `role-picker-${rolePickerKey}` : `onboarding-${onboardingSessionKey}-${loginMode ? "login" : "flow"}`}
        skip={false}
        startAtRoleSelect={startAtRoleSelect || forceRolePicker}
        loginMode={loginMode}
        initialRole={pendingRole}
        preservedAccount={forceRolePicker ? account : undefined}
        onShowLanding={() => {
          setForceRolePicker(false)
          setShowOnboarding(false)
          setStartAtRoleSelect(false)
          setLoginMode(false)
          setPendingRole(null)
          setShowLanding(true)
        }}
        onLogout={handleLogout}
        onReady={({ role: readyRole, account: readyAccount, customerToken: readyToken }) => {
          const nextAccount = enrichPartnerAccountStatus(readyAccount)
          setAccount(nextAccount)
          setCustomerToken(readyToken)
          if (nextAccount.linkedProviderId) storeLinkedProviderId(nextAccount.linkedProviderId)
          if (nextAccount.profile && typeof window !== "undefined") {
            window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(nextAccount.profile))
          }
          setForceRolePicker(false)
          setShowOnboarding(false)
          setStartAtRoleSelect(false)
          setLoginMode(false)
          setPendingRole(null)
          applyRoleToUrl(readyRole)
        }}
      />
    )
  }

  if (showCabinet && account?.profile && role === "customer") {
    // History is keyed by session subject. Prefer Telegram tg-* / token subject over a stale guest account id.
    const persistedCustomerId = readPersistedCustomerId(telegramContext.chatId)
    const provisionalCustomerId =
      (telegramContext.chatId ? `tg-${telegramContext.chatId}` : "") ||
      account.customerId ||
      persistedCustomerId
    const cabinetCustomerToken =
      customerToken ??
      (typeof window !== "undefined"
        ? readStoredAuthSession(authSessionStorageKey("customer", provisionalCustomerId), "customer", provisionalCustomerId)
        : undefined) ??
      (typeof window !== "undefined" && account.customerId && account.customerId !== provisionalCustomerId
        ? readStoredAuthSession(authSessionStorageKey("customer", account.customerId), "customer", account.customerId)
        : undefined)
    const cabinetCustomerId =
      readAuthSessionSubject(cabinetCustomerToken) ||
      provisionalCustomerId ||
      account.customerId ||
      persistedCustomerId
    const cabinetProfile = enrichProfileWithTelegram(account.profile, telegramContext, cabinetCustomerId)
    const sessionMismatchWarning = resolveSessionMismatchWarning(cabinetCustomerId, telegramContext.chatId)
    return (
      <FlowSuspense>
        <ClientCabinet
        profile={cabinetProfile}
        customerId={cabinetCustomerId}
        customerToken={cabinetCustomerToken}
        currentRole="customer"
        initialFocus={cabinetFocus}
        sessionMismatchWarning={sessionMismatchWarning}
        onDismissSessionMismatch={() => dismissSessionMismatchNotice(cabinetCustomerId)}
        onBack={() => setShowCabinet(false)}
        onStartOrder={() => {
          setShowCabinet(false)
          void enterCustomerFlow()
        }}
        onSwitchRole={handleSwitchRole}
        onLogout={handleLogout}
        onProfileUpdate={(nextProfile) => {
          setAccount((prev) => (prev ? { ...prev, profile: nextProfile } : prev))
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(nextProfile))
          }
        }}
        />
      </FlowSuspense>
    )
  }

  if (showCabinet && role === "provider") {
    const cabinetProviderId = getActiveProviderId()
    const cabinetProviderToken =
      (typeof window !== "undefined"
        ? readStoredAuthSession(authSessionStorageKey("provider", cabinetProviderId), "provider", cabinetProviderId)
        : undefined) ??
      (isAuthSessionToken(providerToken) ? providerToken : undefined)
    const cachedProviderProfile = readCachedProviderProfile(cabinetProviderId)
    return (
      <FlowSuspense>
        <ProviderCabinet
        providerId={cabinetProviderId}
        providerToken={cabinetProviderToken}
        initialProfile={cachedProviderProfile}
        currentRole="provider"
        initialEditing={cabinetInitialEditing}
        onBack={() => {
          setShowCabinet(false)
          setCabinetInitialEditing(false)
        }}
        onSwitchRole={handleSwitchRole}
        onLogout={handleLogout}
        />
      </FlowSuspense>
    )
  }

  if (role === "admin") {
    return (
      <FlowSuspense>
        <AdminFlow adminToken={adminToken} />
      </FlowSuspense>
    )
  }

  return (
    role === null || showLanding ? (
      <LandingPage
        onSelect={(nextRole) => {
          // Transition immediately — do not await session restore on the landing page
          // (slow/hung network looked like dead CTAs with no boot screen).
          if (nextRole === "customer") {
            beginOnboarding("customer", false, false)
            return
          }
          beginOnboarding("provider", false, true)
        }}
        onRegister={() => beginOnboarding(null, true, false)}
        onLogin={() => void enterCustomerFlow()}
        onHiddenAdmin={() => {
          setRole("admin")
          setShowLanding(false)
          setShowOnboarding(false)
          applyHiddenAdminEntry()
        }}
      />
    ) : (
      <AppShell
        compact={compact}
        role={role}
        loggedInName={loggedInCustomerName}
        onRoleChange={handleRoleChange}
        onOpenCabinet={() => {
          setCabinetInitialEditing(false)
          setShowCabinet(true)
        }}
        onSwitchRole={handleSwitchRole}
        onLogout={handleLogout}
      >
        {role === "provider" ? (
          <FlowSuspense>
            <ProviderFlow
              providerToken={providerToken}
              providerRegistered={account ? isReturningPartner(account) : false}
              initialScreen={providerEntryScreen}
              onLogout={handleLogout}
              onRestoreAccount={restorePartnerAccount}
            />
          </FlowSuspense>
        ) : role === "customer" && account && !isReturningClient(hydrateClientFromPartner(account)) ? (
          <CustomerAppFallback
            message="Потрібно завершити реєстрацію клієнта."
            onRetry={() => beginOnboarding("customer", false, true)}
            onLanding={() => {
              goToLanding()
            }}
          />
        ) : (
          <FlowSuspense>
            <CustomerFlow onLogout={handleLogout} />
          </FlowSuspense>
        )}
      </AppShell>
    )
  )
}
