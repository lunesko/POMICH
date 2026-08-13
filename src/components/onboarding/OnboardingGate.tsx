import { useEffect, useMemo, useRef, useState } from "react"

import {
  createGuestCustomerSession,
  createTelegramCustomerSession,
  getUserAccount,
  setUserPreferredRole,
  updateCustomerProfile,
  messageFromFetchError,
  type AuthSession,
  type CustomerProfile,
} from "../../api/client"
import {
  authSessionStorageKey,
  detectStoredCustomerMismatch,
  clearCustomerAuthStorage,
  clearExplicitLogout,
  guestSessionCustomerIdForRestore,
  isExplicitLogout,
  markSessionMismatchNotice,
  persistCustomerId,
  purgeStaleCustomerSessions,
  readPersistedCustomerId,
  readStoredAuthSession,
  readStoredCustomerAuthSession,
  storeAuthSession,
} from "../../lib/auth"
import { DEFAULT_CUSTOMER_NAME, isCustomerProfileComplete, isCustomerVerified } from "../../lib/customerProfile"
import { enrichProfileWithTelegram, readBootstrapProfileForCustomer, resolveCustomerAuthSession } from "../../lib/customerSession"
import {
  isReturningClient,
  isStoredProfileNameMismatch,
  mergeAccountProfile,
  readBootstrapProfile,
  resolveProviderIdForCustomer,
  storeLinkedProviderId,
  type UserAccountStatus,
  type UserRole,
} from "../../lib/userAccount"
import { getTelegramContext } from "../../telegram"
import type { Role } from "../../lib/constants"
import ClientRegistrationScreen from "./ClientRegistrationScreen"
import ClientLoginScreen from "./ClientLoginScreen"
import RoleSelectionScreen from "./RoleSelectionScreen"
import { OtpVerificationPanel } from "../ui/OtpVerificationPanel"
import FormContainer, { FormHeader } from "../layout/FormContainer"

type OnboardingPhase = "boot" | "role-select" | "login-client" | "register-client" | "verify-client" | "ready"

interface OnboardingGateProps {
  skip?: boolean
  /** When set, skip boot and show role picker immediately (e.g. user clicked «Зареєструватися»). */
  startAtRoleSelect?: boolean
  /** Returning user via «Увійти» or Telegram reopen — restore session and skip re-registration when possible. */
  loginMode?: boolean
  initialRole?: Role | null
  onReady: (payload: { role: Extract<Role, "customer" | "provider">; account: UserAccountStatus; customerToken?: string }) => void
  onShowLanding: () => void
  onLogout?: () => void
}

function applySession(session: AuthSession) {
  const customerId = session.customerId ?? session.subjectId
  if (!customerId || !session.accessToken) return customerId
  storeAuthSession(authSessionStorageKey("customer", customerId), session)
  persistCustomerId(customerId)
  return customerId
}

function logOnboarding(event: string, detail?: Record<string, unknown>) {
  if (import.meta.env.DEV) {
    console.info(`[OnboardingGate] ${event}`, detail ?? "")
  }
}

function needsClientOtpVerification(profile?: CustomerProfile): boolean {
  return Boolean(profile && isCustomerProfileComplete(profile) && !isCustomerVerified(profile))
}

function resolveMergedAccountStatus(
  status: UserAccountStatus,
  customerId: string,
  telegramContext: ReturnType<typeof getTelegramContext>,
  sources?: { profile?: CustomerProfile; account?: UserAccountStatus | null },
): UserAccountStatus {
  const storedProfile = enrichProfileWithTelegram(
    sources?.profile ?? status.profile ?? sources?.account?.profile ?? readBootstrapProfileForCustomer(customerId),
    telegramContext,
    customerId,
  )
  return mergeAccountProfile(status, storedProfile)
}

export default function OnboardingGate({ skip, startAtRoleSelect, loginMode = false, initialRole, onReady, onShowLanding, onLogout }: OnboardingGateProps) {
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const [phase, setPhase] = useState<OnboardingPhase>(skip ? "ready" : "boot")
  const [account, setAccount] = useState<UserAccountStatus | null>(null)
  const [customerId, setCustomerId] = useState<string>(() => readPersistedCustomerId(telegramContext.chatId))
  const [customerToken, setCustomerToken] = useState<string | undefined>()
  const [profile, setProfile] = useState<CustomerProfile | undefined>()
  const initialPreferredRole = initialRole === "customer" || initialRole === "provider" ? initialRole : null
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (skip) return
    let cancelled = false

    function finishFromAccount(status: UserAccountStatus, token: string | undefined, preferred: Extract<Role, "customer" | "provider"> | null) {
      if (cancelled) return

      const effectivePreferred = loginMode ? preferred || "customer" : preferred

      logOnboarding("finishFromAccount", {
        loginMode,
        preferred,
        effectivePreferred,
        clientRegistered: status.clientRegistered,
        providerRegistered: status.providerRegistered,
        needsOnboarding: status.needsOnboarding,
        returning: isReturningClient(status),
        customerId: status.customerId,
      })

      // Role switch / explicit role picker: keep the restored session and let the user choose.
      if (startAtRoleSelect && !initialPreferredRole && !loginMode) {
        setAccount(status)
        if (token) setCustomerToken(token)
        if (status.profile) setProfile(status.profile)
        setPhase("role-select")
        return
      }

      if (isReturningClient(status) && effectivePreferred !== "provider") {
        if (needsClientOtpVerification(status.profile)) {
          if (status.profile) setProfile(status.profile)
          // Returning / WebApp reopen: show OTP UI; user must tap «Надіслати код».
          setPhase("verify-client")
          return
        }
        onReadyRef.current({ role: "customer", account: status, customerToken: token })
        setPhase("ready")
        return
      }

      if (status.needsOnboarding) {
        if (effectivePreferred === "customer" && !isReturningClient(status)) {
          if (loginMode) {
            setPhase("login-client")
            return
          }
          setPhase("register-client")
          return
        }
        if (effectivePreferred === "provider" && !status.providerRegistered) {
          onReadyRef.current({ role: "provider", account: status, customerToken: token })
          setPhase("ready")
          return
        }
        setPhase("role-select")
        return
      }

      const role = (effectivePreferred || status.preferredRole || "customer") as Extract<Role, "customer" | "provider">
      onReadyRef.current({ role, account: status, customerToken: token })
      setPhase("ready")
    }

    async function restoreCustomerSession() {
      const resolved = await resolveCustomerAuthSession(telegramContext, { explicitSignIn: loginMode })
      return {
        resolvedCustomerId: resolved.customerId,
        token: resolved.token,
        status: resolved.account ?? (await getUserAccount(resolved.customerId, resolved.token, telegramContext.initData)),
        profile: resolved.profile,
      }
    }

    async function boot() {
      try {
        if (isExplicitLogout(telegramContext.chatId) && !loginMode && !startAtRoleSelect) {
          onShowLanding()
          return
        }

        const activeCustomerId = readPersistedCustomerId(telegramContext.chatId)
        if (telegramContext.chatId && detectStoredCustomerMismatch(telegramContext.chatId)) {
          clearCustomerAuthStorage()
          markSessionMismatchNotice("telegram-stale-web")
        }
        purgeStaleCustomerSessions(activeCustomerId)

        const { resolvedCustomerId, token, status, profile: sessionProfile } = await restoreCustomerSession()
        if (cancelled) return

        purgeStaleCustomerSessions(resolvedCustomerId)

        setAccount(status)
        setCustomerId(resolvedCustomerId)
        setCustomerToken(token)
        if (sessionProfile) setProfile(sessionProfile)
        else if (status.profile) setProfile(status.profile)

        if (status.linkedProviderId) storeLinkedProviderId(status.linkedProviderId)
        else if (initialPreferredRole === "provider" || status.preferredRole === "provider") {
          const linkedId = resolveProviderIdForCustomer(resolvedCustomerId, status.linkedProviderId)
          if (linkedId) storeLinkedProviderId(linkedId)
        }

        const preferred = loginMode ? initialPreferredRole || "customer" : initialPreferredRole
        const mergedStatus = resolveMergedAccountStatus(status, resolvedCustomerId, telegramContext, {
          profile: sessionProfile ?? status.profile,
          account: status,
        })
        setAccount(mergedStatus)
        finishFromAccount(mergedStatus, token, preferred)
      } catch (err) {
        logOnboarding("boot.failed", { error: err instanceof Error ? err.message : String(err) })
        if (!cancelled) {
          if (startAtRoleSelect && !loginMode) {
            setPhase("role-select")
          } else if (loginMode) {
            setPhase("login-client")
          } else {
            setPhase("role-select")
          }
        }
      }
    }

    boot()
    return () => {
      cancelled = true
    }
  }, [skip, startAtRoleSelect, loginMode, telegramContext.chatId, telegramContext.initData, initialPreferredRole])

  const handleRoleSelect = async (role: Extract<Role, "customer" | "provider">) => {
    if (saving) return
    setSaving(true)
    setError(undefined)
    try {
      clearExplicitLogout()
      let token = customerToken
      let activeCustomerId = customerId
      if (!token) {
        const stored = readStoredCustomerAuthSession({ telegramChatId: telegramContext.chatId })
        if (stored?.token) {
          token = stored.token
          activeCustomerId = stored.customerId
          setCustomerId(activeCustomerId)
          setCustomerToken(token)
        }
      }
      if (!token) {
        try {
          const session = telegramContext.initData
            ? await createTelegramCustomerSession(telegramContext.initData)
            : await createGuestCustomerSession(guestSessionCustomerIdForRestore(customerId))
          activeCustomerId = applySession(session) ?? customerId
          token = session.accessToken
          setCustomerId(activeCustomerId)
          setCustomerToken(token)
        } catch {
          if (role === "customer") {
            setPhase("register-client")
            return
          }
          onReadyRef.current({
            role: "provider",
            account: {
              customerId: activeCustomerId,
              preferredRole: "provider",
              linkedProviderId: resolveProviderIdForCustomer(activeCustomerId),
              rolesRegistered: [],
              clientRegistered: false,
              providerRegistered: false,
              needsOnboarding: true,
            },
          })
          setPhase("ready")
          return
        }
      }

      let status: UserAccountStatus
      try {
        status = await setUserPreferredRole(activeCustomerId, role, token)
      } catch {
        status = account ?? {
          customerId: activeCustomerId,
          preferredRole: role as UserRole,
          linkedProviderId: role === "provider" ? resolveProviderIdForCustomer(activeCustomerId) : "",
          rolesRegistered: [],
          clientRegistered: false,
          providerRegistered: false,
          needsOnboarding: true,
        }
      }

      const mergedStatus = resolveMergedAccountStatus(status, activeCustomerId, telegramContext, {
        profile,
        account,
      })
      setAccount(mergedStatus)
      if (mergedStatus.linkedProviderId) {
        storeLinkedProviderId(mergedStatus.linkedProviderId)
      } else if (role === "provider") {
        const linkedId = resolveProviderIdForCustomer(activeCustomerId, mergedStatus.linkedProviderId)
        if (linkedId) storeLinkedProviderId(linkedId)
      }

      if (role === "customer" && !isReturningClient(mergedStatus)) {
        setPhase("register-client")
        return
      }

      if (role === "customer" && needsClientOtpVerification(mergedStatus.profile)) {
        if (mergedStatus.profile) setProfile(mergedStatus.profile)
        setPhase("verify-client")
        return
      }

      onReadyRef.current({ role, account: mergedStatus, customerToken: token })
      setPhase("ready")
    } catch (err) {
      if (role === "customer") {
        setPhase("register-client")
        return
      }
      setError(err instanceof Error ? err.message : "Не вдалося зберегти роль.")
    } finally {
      setSaving(false)
    }
  }

  const resolveCustomerSession = async () => {
    if (customerToken && customerId) {
      return { activeCustomerId: customerId, token: customerToken }
    }

    const session = telegramContext.initData
      ? await createTelegramCustomerSession(telegramContext.initData)
      : await createGuestCustomerSession(guestSessionCustomerIdForRestore(customerId))
    const activeCustomerId = applySession(session) ?? customerId
    const token = session.accessToken
    if (!token) throw new Error("customer_session_missing")
    setCustomerId(activeCustomerId)
    setCustomerToken(token)
    if (session.profile) setProfile(session.profile)
    return { activeCustomerId, token }
  }

  const handleClientRegister = async (payload: { name: string; phone: string; city: string }) => {
    setSaving(true)
    setError(undefined)
    try {
      if (!telegramContext.isTelegram && !telegramContext.initData) {
        const storedName = profile?.name ?? account?.profile?.name ?? readBootstrapProfile()?.name
        if (isStoredProfileNameMismatch(storedName, payload.name)) {
          clearCustomerAuthStorage()
          setCustomerId("customer-web")
          setCustomerToken(undefined)
          setProfile(undefined)
          setAccount(null)
        }
      }

      const { activeCustomerId, token } = await resolveCustomerSession()
      const updated = await updateCustomerProfile(activeCustomerId, payload, token)

      if (updated.id && updated.id !== activeCustomerId) {
        clearCustomerAuthStorage()
        if (typeof window !== "undefined") window.location.reload()
        return
      }

      setProfile(updated)
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(updated))
        if (updated.city) window.localStorage.setItem("pomichPreferredCity", updated.city)
      }
      const status = await getUserAccount(activeCustomerId, token, telegramContext.initData)
      const merged = mergeAccountProfile({ ...status, profile: updated }, updated)
      setAccount(merged)
      if (needsClientOtpVerification(updated)) {
        // Post-registration OTP step — user must tap «Надіслати код».
        setPhase("verify-client")
        return
      }
      onReadyRef.current({ role: "customer", account: merged, customerToken: token })
      setPhase("ready")
    } catch (err) {
      setError(messageFromFetchError(err, "Не вдалося зберегти профіль. Спробуйте ще раз."))
    } finally {
      setSaving(false)
    }
  }

  const handleClientLogin = async (session: AuthSession) => {
    setSaving(true)
    setError(undefined)
    try {
      clearExplicitLogout()
      const activeCustomerId = applySession(session) ?? session.customerId ?? session.subjectId
      const token = session.accessToken
      if (!activeCustomerId || !token) throw new Error("customer_session_missing")
      const status = mergeAccountProfile(
        session.account ?? (await getUserAccount(activeCustomerId, token, telegramContext.initData)),
        session.profile,
      )
      setCustomerId(activeCustomerId)
      setCustomerToken(token)
      if (session.profile) setProfile(session.profile)
      setAccount(status)
      if (typeof window !== "undefined" && session.profile) {
        window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(session.profile))
      }
      onReadyRef.current({ role: "customer", account: status, customerToken: token })
      setPhase("ready")
    } catch (err) {
      setError(messageFromFetchError(err, "Не вдалося увійти. Спробуйте ще раз."))
    } finally {
      setSaving(false)
    }
  }

  const handleRegistrationLogout = () => {
    clearCustomerAuthStorage()
    setCustomerId(readPersistedCustomerId(telegramContext.chatId))
    setCustomerToken(undefined)
    setProfile(undefined)
    setAccount(null)
    setError(undefined)
    if (onLogout) {
      onLogout()
      return
    }
    onShowLanding()
  }

  const registrationLoggedInAs = (() => {
    if (loginMode) return undefined
    if (telegramContext.isTelegram || telegramContext.initData) return undefined
    const name = (profile?.name ?? account?.profile?.name ?? readBootstrapProfile()?.name ?? "").trim()
    if (!name || name === DEFAULT_CUSTOMER_NAME) return undefined
    return name
  })()

  if (skip) return null

  if (phase === "boot" || phase === "ready") {
    return <div className="pomich-boot-screen">Завантажуємо POMICH…</div>
  }

  if (phase === "role-select") {
    return (
      <>
        <RoleSelectionScreen compact={telegramContext.isTelegram} saving={saving} onSelect={handleRoleSelect} onShowLanding={onShowLanding} />
        {error ? <div className="pomich-form-error" style={{ position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 3000 }}>{error}</div> : null}
      </>
    )
  }

  if (phase === "login-client") {
    return (
      <ClientLoginScreen
        saving={saving}
        error={error}
        onSubmit={(session) => void handleClientLogin(session)}
        onRegister={() => setPhase("register-client")}
        onBack={onShowLanding}
      />
    )
  }

  if (phase === "verify-client" && profile) {
    return (
      <div className="pomich-themed-shell pomich-map-shell-surface">
        <FormHeader>
          <div className="pomich-header-title">Підтвердження телефону</div>
          <div className="pomich-header-subtitle">
            {telegramContext.isTelegram
              ? "Профіль уже є — лише код з цього чату, без нової реєстрації"
              : "Профіль уже є — код один раз з @pomich_ua_bot, не реєстрація"}
          </div>
        </FormHeader>
        <div style={{ flex: 1, overflow: "auto" }} className="pomich-form-scroll">
          <FormContainer>
            <div className="pomich-form-card">
              <OtpVerificationPanel
                profile={profile}
                customerToken={customerToken}
                isTelegram={telegramContext.isTelegram}
                phone={profile.phone}
                onPhoneSaved={(savedPhone, savedProfile) => {
                  setProfile((prev) => {
                    if (savedProfile) return { ...prev, ...savedProfile } as CustomerProfile
                    if (!prev) return { id: profile.id, name: profile.name, phone: savedPhone, verificationStatus: profile.verificationStatus }
                    return { ...prev, phone: savedPhone }
                  })
                }}
                onVerified={async (saved) => {
                  setProfile(saved)
                  if (!customerToken) return
                  const status = await getUserAccount(customerId, customerToken, telegramContext.initData)
                  setAccount(status)
                  onReadyRef.current({ role: "customer", account: status, customerToken })
                  setPhase("ready")
                }}
              />
            </div>
          </FormContainer>
        </div>
      </div>
    )
  }

  return (
    <ClientRegistrationScreen
      initialName={profile?.name && profile.name !== DEFAULT_CUSTOMER_NAME ? profile.name : telegramContext.user?.first_name || ""}
      initialPhone={profile?.phone || ""}
      initialCity={profile?.city || (typeof window !== "undefined" ? window.localStorage.getItem("pomichPreferredCity") || undefined : undefined)}
      loggedInAs={registrationLoggedInAs}
      saving={saving}
      error={error}
      onSubmit={handleClientRegister}
      onBack={() => setPhase("role-select")}
      onLogout={registrationLoggedInAs ? handleRegistrationLogout : undefined}
    />
  )
}
