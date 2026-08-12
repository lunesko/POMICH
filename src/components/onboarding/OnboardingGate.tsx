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
  persistCustomerId,
  readPersistedCustomerId,
  readStoredAuthSession,
  readStoredCustomerAuthSession,
  storeAuthSession,
} from "../../lib/auth"
import { isCustomerVerified } from "../../lib/customerProfile"
import {
  isReturningClient,
  resolveProviderIdForCustomer,
  storeLinkedProviderId,
  type UserAccountStatus,
  type UserRole,
} from "../../lib/userAccount"
import { getTelegramContext } from "../../telegram"
import type { Role } from "../../lib/constants"
import ClientRegistrationScreen from "./ClientRegistrationScreen"
import RoleSelectionScreen from "./RoleSelectionScreen"
import { OtpVerificationPanel } from "../ui/OtpVerificationPanel"
import FormContainer, { FormHeader } from "../layout/FormContainer"

type OnboardingPhase = "boot" | "role-select" | "register-client" | "verify-client" | "ready"

interface OnboardingGateProps {
  skip?: boolean
  /** When set, skip boot and show role picker immediately (e.g. user clicked «Зареєструватися»). */
  startAtRoleSelect?: boolean
  /** Returning user via «Увійти» or Telegram reopen — restore session and skip re-registration when possible. */
  loginMode?: boolean
  initialRole?: Role | null
  onReady: (payload: { role: Extract<Role, "customer" | "provider">; account: UserAccountStatus; customerToken?: string }) => void
  onShowLanding: () => void
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

function guestSessionCustomerId(customerId: string): string | undefined {
  return customerId.startsWith("guest-") || customerId === "customer-web" ? customerId : undefined
}

export default function OnboardingGate({ skip, startAtRoleSelect, loginMode = false, initialRole, onReady, onShowLanding }: OnboardingGateProps) {
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const [phase, setPhase] = useState<OnboardingPhase>(
    skip ? "ready" : startAtRoleSelect && !initialRole ? "role-select" : "boot",
  )
  const [account, setAccount] = useState<UserAccountStatus | null>(null)
  const [customerId, setCustomerId] = useState<string>(() => readPersistedCustomerId(telegramContext.chatId))
  const [customerToken, setCustomerToken] = useState<string | undefined>()
  const [profile, setProfile] = useState<CustomerProfile | undefined>()
  const initialPreferredRole = initialRole === "customer" || initialRole === "provider" ? initialRole : null
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (skip) return
    if (startAtRoleSelect && !initialPreferredRole) {
      setPhase("role-select")
      return
    }
    let cancelled = false

    function finishFromAccount(status: UserAccountStatus, token: string | undefined, preferred: Extract<Role, "customer" | "provider"> | null) {
      const effectivePreferred = loginMode ? preferred || "customer" : preferred

      logOnboarding("finishFromAccount", {
        loginMode,
        preferred,
        effectivePreferred,
        clientRegistered: status.clientRegistered,
        needsOnboarding: status.needsOnboarding,
        returning: isReturningClient(status),
        customerId: status.customerId,
      })

      if (isReturningClient(status) && effectivePreferred !== "provider") {
        onReadyRef.current({ role: "customer", account: status, customerToken: token })
        setPhase("ready")
        return
      }

      if (startAtRoleSelect && !initialPreferredRole) {
        setAccount(status)
        if (token) setCustomerToken(token)
        if (status.profile) setProfile(status.profile)
        setPhase("role-select")
        return
      }

      if (status.needsOnboarding) {
        if (effectivePreferred === "customer" && !isReturningClient(status)) {
          setPhase("register-client")
          return
        }
        if (effectivePreferred === "provider" && !status.providerRegistered) {
          onReadyRef.current({ role: "provider", account: status, customerToken: token })
          setPhase("ready")
          return
        }
        if (loginMode && effectivePreferred === "customer") {
          setPhase("register-client")
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
      const persistedCustomerId = readPersistedCustomerId(telegramContext.chatId)

      if (telegramContext.initData) {
        logOnboarding("boot.telegramSession", { chatId: telegramContext.chatId })
        const session = await createTelegramCustomerSession(telegramContext.initData)
        const resolvedCustomerId = applySession(session) ?? persistedCustomerId
        return {
          resolvedCustomerId,
          token: session.accessToken,
          status: session.account ?? (await getUserAccount(resolvedCustomerId, session.accessToken, telegramContext.initData)),
          profile: session.profile,
        }
      }

      const restored = readStoredCustomerAuthSession()
      let resolvedCustomerId = restored?.customerId ?? persistedCustomerId
      let token =
        restored?.token ?? readStoredAuthSession(authSessionStorageKey("customer", resolvedCustomerId), "customer", resolvedCustomerId)

      if (!token) {
        logOnboarding("boot.guestSession", { customerId: resolvedCustomerId })
        const session = await createGuestCustomerSession(guestSessionCustomerId(resolvedCustomerId))
        resolvedCustomerId = applySession(session) ?? resolvedCustomerId
        token = session.accessToken
        return {
          resolvedCustomerId,
          token,
          status: session.account ?? (await getUserAccount(resolvedCustomerId, token, telegramContext.initData)),
          profile: session.profile,
        }
      }

      logOnboarding("boot.storedToken", { customerId: resolvedCustomerId })
      const status = await getUserAccount(resolvedCustomerId, token, telegramContext.initData)
      return { resolvedCustomerId, token, status, profile: status.profile }
    }

    async function boot() {
      try {
        const { resolvedCustomerId, token, status, profile: sessionProfile } = await restoreCustomerSession()
        if (cancelled) return

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
        finishFromAccount(status, token, preferred)
      } catch (err) {
        logOnboarding("boot.failed", { error: err instanceof Error ? err.message : String(err) })
        if (!cancelled) {
          setPhase("role-select")
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
      let token = customerToken
      let activeCustomerId = customerId
      if (!token) {
        try {
          const session = telegramContext.initData
            ? await createTelegramCustomerSession(telegramContext.initData)
            : await createGuestCustomerSession(guestSessionCustomerId(customerId))
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

      setAccount(status)
      if (status.linkedProviderId) {
        storeLinkedProviderId(status.linkedProviderId)
      } else if (role === "provider") {
        const linkedId = resolveProviderIdForCustomer(activeCustomerId, status.linkedProviderId)
        if (linkedId) storeLinkedProviderId(linkedId)
      }

      if (role === "customer" && !isReturningClient(status)) {
        setPhase("register-client")
        return
      }

      onReadyRef.current({ role, account: status, customerToken: token })
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
      : await createGuestCustomerSession(guestSessionCustomerId(customerId))
    const activeCustomerId = applySession(session) ?? customerId
    const token = session.accessToken
    if (!token) throw new Error("customer_session_missing")
    setCustomerId(activeCustomerId)
    setCustomerToken(token)
    if (session.profile) setProfile(session.profile)
    return { activeCustomerId, token }
  }

  const handleClientRegister = async (payload: { name: string; phone: string }) => {
    setSaving(true)
    setError(undefined)
    try {
      const { activeCustomerId, token } = await resolveCustomerSession()
      const updated = await updateCustomerProfile(activeCustomerId, payload, token)
      setProfile(updated)
      if (!isCustomerVerified(updated)) {
        setPhase("verify-client")
        return
      }
      const status = await getUserAccount(activeCustomerId, token, telegramContext.initData)
      setAccount(status)
      onReadyRef.current({ role: "customer", account: status, customerToken: token })
      setPhase("ready")
    } catch (err) {
      setError(messageFromFetchError(err, "Не вдалося зберегти профіль. Спробуйте ще раз."))
    } finally {
      setSaving(false)
    }
  }

  if (skip || phase === "ready") return null

  if (phase === "boot") {
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

  if (phase === "verify-client" && profile) {
    return (
      <div className="pomich-themed-shell">
        <FormHeader>
          <div className="pomich-header-title">Підтвердження профілю</div>
          <div className="pomich-header-subtitle">Код діє 10 хвилин</div>
        </FormHeader>
        <div style={{ flex: 1, overflow: "auto" }}>
          <FormContainer>
            <div className="pomich-form-card">
              <OtpVerificationPanel
                profile={profile}
                customerToken={customerToken}
                isTelegram={telegramContext.isTelegram}
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
      initialName={profile?.name && profile.name !== "Клієнт POMICH" ? profile.name : telegramContext.user?.first_name || ""}
      initialPhone={profile?.phone || ""}
      saving={saving}
      error={error}
      onSubmit={handleClientRegister}
      onBack={() => setPhase("role-select")}
    />
  )
}
