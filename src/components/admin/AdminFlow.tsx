import { useCallback, useEffect, useMemo, useState } from "react"

import {
  adminDeactivateAuthAccount,
  adminDeleteProvider,
  adminIssueAuthAccountTemporaryPassword,
  adminResetAuthAccountPassword,
  adminSaveAuthAccount,
  adminUpdateClient,
  adminUpdateAuthAccount,
  adminUpdateProvider,
  createAdminAccountSession,
  createAdminSession,
  getAdminAuthAccounts,
  getAdminClients,
  getAdminOrders,
  getAdminOpsLog,
  getAdminProviders,
  getAdminSettings,
  getAdminStats,
  getMapProviders,
  importUzhgorodProviders,
  purgeStaleGuestClients,
  requestAdminPasswordReset,
  reviewProviderVerification,
  retryDispatch,
  updateAdminAccountPassword,
  updateOrderStatus,
  type AdminAuthAccount,
  type AdminActivityItem,
  type AdminOpsLog,
  type AdminOpsLogEvent,
  type AdminSettings,
  type AdminStats,
  type AuthSession,
  type CustomerProfile,
  type OrderResponse,
  type ProviderAvailability,
  type VerificationStatus,
} from "../../api/client"
import {
  getProviderCapabilityLabel,
  getServiceEmoji,
  getServiceLabel,
  isVerified,
  orderStatusLabels,
  providerStatusLabel,
  toServiceKeys,
  type OrderStatus,
} from "../../lib/constants"
import {
  authSessionStorageKey,
  isAuthSessionToken,
  readAuthSessionSubject,
  readStoredRoleAuthSession,
  readStoredRoleAuthSessionPayload,
  storeAuthSession,
} from "../../lib/auth"
import { formatCustomerCity, formatCustomerDisplayName } from "../../lib/customerDisplay"
import { VerificationPill } from "../ui/VerificationPill"
import { StatusPill } from "../ui/StatusPill"
import { Timeline } from "../ui/Timeline"

type AdminSection = "dashboard" | "clients" | "providers" | "orders" | "logs" | "map" | "verification" | "accounts" | "settings"

const NAV: Array<{ id: AdminSection; label: string; icon: string }> = [
  { id: "dashboard", label: "Дашборд", icon: "📊" },
  { id: "clients", label: "Клієнти", icon: "👤" },
  { id: "providers", label: "Партнери", icon: "🚛" },
  { id: "orders", label: "Заявки", icon: "📋" },
  { id: "logs", label: "Логи", icon: "🛰️" },
  { id: "map", label: "Карта", icon: "🗺️" },
  { id: "verification", label: "Перевірка", icon: "✅" },
  { id: "accounts", label: "Акаунти", icon: "🔐" },
  { id: "settings", label: "Налаштування", icon: "⚙️" },
]

type AuthAccountRoleFilter = "all" | AdminAuthAccount["role"]

type AuthAccountFormState = {
  role: AdminAuthAccount["role"]
  username: string
  providerId: string
  email: string
  phone: string
  password: string
}

type ProviderInviteState = {
  providerId: string
  accountId?: string
  login?: string
  temporaryPassword?: string
  resetRequired?: boolean
  status?: string
}

function createEmptyAuthAccountForm(role: AdminAuthAccount["role"] = "provider"): AuthAccountFormState {
  return {
    role,
    username: "",
    providerId: "",
    email: "",
    phone: "",
    password: "",
  }
}

function normalizeOrderStatus(status?: string): OrderStatus {
  if (status === "searching" || status === "accepted" || status === "price_confirmed" || status === "assigned" || status === "en_route" || status === "arrived" || status === "in_progress" || status === "completed" || status === "cancelled" || status === "draft") {
    return status
  }
  if (status === "created" || status === "matching") return "searching"
  if (status === "tracking") return "en_route"
  return "draft"
}

function nextOrderStatuses(status: OrderStatus): OrderStatus[] {
  const transitions: Record<OrderStatus, OrderStatus[]> = {
    draft: ["searching", "cancelled"],
    searching: ["accepted", "cancelled"],
    accepted: ["price_confirmed", "cancelled"],
    price_confirmed: ["en_route", "cancelled"],
    assigned: ["price_confirmed", "en_route", "cancelled"],
    en_route: ["arrived", "cancelled"],
    arrived: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  }
  return transitions[status] ?? []
}

function AdminLogin({
  login,
  password,
  saving,
  error,
  resetStatus,
  resetSaving,
  onLoginChange,
  onPasswordChange,
  onSubmit,
  onResetRequest,
}: {
  login: string
  password: string
  saving: boolean
  error?: string
  resetStatus?: string
  resetSaving?: boolean
  onLoginChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  onResetRequest?: () => void
}) {
  return (
    <div className="admin-login-shell">
      <div className="admin-login-card">
        <div className="admin-login-badge">POMICH OPS</div>
        <h1 className="admin-login-title">Захищена адмін-панель</h1>
        <p className="admin-login-subtitle">Увійдіть для керування системою, заявками та перевірками.</p>
        <label className="admin-field">
          <span>Логін</span>
          <input value={login} onChange={(event) => onLoginChange(event.target.value)} autoComplete="username" aria-label="Логін" />
        </label>
        <label className="admin-field">
          <span>Пароль</span>
          <input value={password} onChange={(event) => onPasswordChange(event.target.value)} type="password" autoComplete="current-password" aria-label="Пароль" />
        </label>
        {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}
        <button className="admin-primary-btn" onClick={onSubmit} disabled={!login.trim() || !password.trim() || saving}>
          {saving ? "Входимо…" : "Увійти"}
        </button>
        {onResetRequest ? (
          <button className="admin-ghost-btn admin-login-reset-btn" onClick={onResetRequest} disabled={!login.trim() || resetSaving}>
            {resetSaving ? "Надсилаємо запит…" : "Забули пароль? Запросити reset"}
          </button>
        ) : null}
        {resetStatus ? <div className="admin-alert admin-alert-info">{resetStatus}</div> : null}
      </div>
    </div>
  )
}

function AdminPasswordReset({
  password,
  confirmPassword,
  saving,
  error,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
}: {
  password: string
  confirmPassword: string
  saving: boolean
  error?: string
  onPasswordChange: (value: string) => void
  onConfirmPasswordChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="admin-login-shell">
      <div className="admin-login-card">
        <div className="admin-login-badge">POMICH OPS</div>
        <h1 className="admin-login-title">Оновіть пароль</h1>
        <p className="admin-login-subtitle">Тимчасовий пароль прийнято. Перед входом у консоль задайте постійний пароль адміністратора.</p>
        <label className="admin-field">
          <span>Новий пароль</span>
          <input value={password} onChange={(event) => onPasswordChange(event.target.value)} type="password" autoComplete="new-password" aria-label="Новий пароль" />
        </label>
        <label className="admin-field">
          <span>Повторіть пароль</span>
          <input value={confirmPassword} onChange={(event) => onConfirmPasswordChange(event.target.value)} type="password" autoComplete="new-password" aria-label="Повторіть пароль" />
        </label>
        {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}
        <button className="admin-primary-btn" onClick={onSubmit} disabled={!password.trim() || !confirmPassword.trim() || saving}>
          {saving ? "Оновлюємо…" : "Оновити пароль"}
        </button>
      </div>
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: "brand" | "warn" | "muted" }) {
  return (
    <div className={`admin-stat-card${tone ? ` admin-stat-card-${tone}` : ""}`}>
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="admin-empty">{text}</div>
}

function LoadingState({ text = "Завантажуємо…" }: { text?: string }) {
  return <div className="admin-loading">{text}</div>
}

function ProviderInviteBlock({ invite }: { invite: ProviderInviteState }) {
  return (
    <div className="admin-subpanel admin-invite-block">
      <div className="admin-panel-head">
        <h3>Запрошення для партнера</h3>
        <span className={providerAuthAccountChipClass({ status: invite.status, passwordResetRequired: invite.resetRequired })}>
          {invite.resetRequired ? "reset required" : providerAuthAccountLabel({ status: invite.status })}
        </span>
      </div>
      <div className="admin-kv-grid">
        <div><span>Account ID</span><strong>{invite.accountId || "—"}</strong></div>
        <div><span>Логін</span><strong>{invite.login || invite.providerId}</strong></div>
        {invite.temporaryPassword ? <div><span>Тимчасовий пароль</span><strong>{invite.temporaryPassword}</strong></div> : null}
        <div><span>Після входу</span><strong>{invite.resetRequired ? "зміна пароля обовʼязкова" : "пароль уже постійний"}</strong></div>
      </div>
    </div>
  )
}

function optionalTrim(value: string) {
  return value.trim() || undefined
}

function authAccountIdentity(account: AdminAuthAccount) {
  return account.username || account.email || account.phone || account.providerId || account.id
}

function providerAuthAccountLabel(account?: ProviderAvailability["authAccount"] | ProviderAvailability["authAccountBootstrap"] | null) {
  if (!account) return "account missing"
  if (account.status === "disabled") return "disabled"
  if (account.passwordResetRequired) return "reset required"
  if (account.status === "active") return "active"
  return String(account.status || "active")
}

function providerAuthAccountChipClass(account?: ProviderAvailability["authAccount"] | ProviderAvailability["authAccountBootstrap"] | null) {
  if (!account) return "admin-chip admin-chip-danger"
  if (account.status === "disabled") return "admin-chip admin-chip-danger"
  if (account.passwordResetRequired) return "admin-chip"
  return "admin-chip admin-chip-brand"
}

function authAccountSettingsText(configured: boolean, active?: number, total?: number, error?: string | null) {
  if (error) return `Помилка: ${error}`
  if (typeof active === "number" && typeof total === "number") return `${active}/${total} active`
  return configured ? "Налаштовано" : "—"
}

export default function AdminFlow({ adminToken }: { adminToken?: string }) {
  const adminSessionStorageKey = useMemo(() => authSessionStorageKey("admin", "admin"), [])
  const [adminAccessToken, setAdminAccessToken] = useState<string | undefined>(() => {
    if (isAuthSessionToken(adminToken)) return adminToken
    return readStoredRoleAuthSession(adminSessionStorageKey, "admin")
  })
  const [adminPasswordResetRequired, setAdminPasswordResetRequired] = useState(() => {
    if (isAuthSessionToken(adminToken)) return false
    const session = readStoredRoleAuthSessionPayload(adminSessionStorageKey, "admin")
    return typeof session === "object" && Boolean(session.passwordResetRequired)
  })
  const adminAuthToken = adminAccessToken
  const [section, setSection] = useState<AdminSection>("dashboard")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [clients, setClients] = useState<CustomerProfile[]>([])
  const [providers, setProviders] = useState<ProviderAvailability[]>([])
  const [mapProviders, setMapProviders] = useState<ProviderAvailability[]>([])
  const [orders, setOrders] = useState<OrderResponse[]>([])
  const [opsLog, setOpsLog] = useState<AdminOpsLog | null>(null)
  const [opsSeverity, setOpsSeverity] = useState<"all" | "error" | "warn" | "info">("all")
  const [opsOrderQuery, setOpsOrderQuery] = useState("")
  const [opsProviderQuery, setOpsProviderQuery] = useState("")
  const [opsCustomerQuery, setOpsCustomerQuery] = useState("")
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [authAccounts, setAuthAccounts] = useState<AdminAuthAccount[]>([])
  const [authAccountRole, setAuthAccountRole] = useState<AuthAccountRoleFilter>("all")
  const [authAccountForm, setAuthAccountForm] = useState<AuthAccountFormState>(() => createEmptyAuthAccountForm())
  const [authAccountPasswords, setAuthAccountPasswords] = useState<Record<string, string>>({})
  const [authAccountStatus, setAuthAccountStatus] = useState<string | undefined>()
  const [providerInvite, setProviderInvite] = useState<ProviderInviteState | undefined>()
  const [clientQuery, setClientQuery] = useState("")
  const [showGuestSessions, setShowGuestSessions] = useState(false)
  const [providerQuery, setProviderQuery] = useState("")
  const [orderFilter, setOrderFilter] = useState<OrderStatus | "all">("all")
  const [selectedClientId, setSelectedClientId] = useState<string | undefined>()
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>()
  const [selectedOrderId, setSelectedOrderId] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [authError, setAuthError] = useState<string | undefined>()
  const [bootstrapAuthFailed, setBootstrapAuthFailed] = useState(false)
  const [accountLogin, setAccountLogin] = useState("dispatcher")
  const [accountPassword, setAccountPassword] = useState("")
  const [authSaving, setAuthSaving] = useState(false)
  const [adminResetRequestSaving, setAdminResetRequestSaving] = useState(false)
  const [adminResetRequestStatus, setAdminResetRequestStatus] = useState<string | undefined>()
  const [newAdminPassword, setNewAdminPassword] = useState("")
  const [newAdminPasswordConfirm, setNewAdminPasswordConfirm] = useState("")
  const [adminPasswordSaving, setAdminPasswordSaving] = useState(false)
  const [adminPasswordError, setAdminPasswordError] = useState<string | undefined>()
  const [importStatus, setImportStatus] = useState<string | undefined>()
  const [purgeStatus, setPurgeStatus] = useState<string | undefined>()

  useEffect(() => {
    if (adminAuthToken) return
    if (!adminToken) {
      setAuthError(undefined)
      setBootstrapAuthFailed(false)
      return
    }
    if (isAuthSessionToken(adminToken)) {
      if (typeof window !== "undefined") window.sessionStorage.setItem(adminSessionStorageKey, adminToken)
      setAdminAccessToken(adminToken)
      setAdminPasswordResetRequired(false)
      setAuthError(undefined)
      setBootstrapAuthFailed(false)
      return
    }
    let cancelled = false
    createAdminSession(adminToken)
      .then((session) => {
        if (cancelled) return
        storeAuthSession(adminSessionStorageKey, session)
        setAdminAccessToken(session.accessToken)
        setAdminPasswordResetRequired(false)
        setAuthError(undefined)
        setBootstrapAuthFailed(false)
      })
      .catch(() => {
        if (!cancelled) {
          setBootstrapAuthFailed(true)
          setAuthError("Не вдалося відкрити захищену адмін-сесію.")
        }
      })
    return () => {
      cancelled = true
    }
  }, [adminAuthToken, adminSessionStorageKey, adminToken])

  const submitAdminAccountLogin = async () => {
    setAuthSaving(true)
    setAuthError(undefined)
    setAdminResetRequestStatus(undefined)
    try {
      const session = await createAdminAccountSession(accountLogin, accountPassword)
      storeAuthSession(adminSessionStorageKey, session)
      setAdminAccessToken(session.accessToken)
      setAdminPasswordResetRequired(Boolean(session.passwordResetRequired))
      setAccountPassword("")
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Не вдалося увійти в адмін-акаунт.")
    } finally {
      setAuthSaving(false)
    }
  }

  const requestAdminAccountReset = async () => {
    const login = accountLogin.trim()
    if (!login) return
    setAdminResetRequestSaving(true)
    setAuthError(undefined)
    setAdminResetRequestStatus(undefined)
    try {
      await requestAdminPasswordReset(login)
      setAdminResetRequestStatus("Запит на reset надіслано. Власник системи зможе видати тимчасовий пароль в admin accounts.")
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Не вдалося надіслати запит на reset.")
    } finally {
      setAdminResetRequestSaving(false)
    }
  }

  const completeAdminPasswordReset = async () => {
    if (!adminAuthToken) return
    const nextPassword = newAdminPassword.trim()
    setAdminPasswordError(undefined)
    if (nextPassword.length < 8) {
      setAdminPasswordError("Пароль має містити щонайменше 8 символів.")
      return
    }
    if (nextPassword !== newAdminPasswordConfirm.trim()) {
      setAdminPasswordError("Паролі не збігаються.")
      return
    }
    setAdminPasswordSaving(true)
    try {
      await updateAdminAccountPassword({ newPassword: nextPassword }, adminAuthToken)
      const subject = readAuthSessionSubject(adminAuthToken) || "admin"
      const stored = readStoredRoleAuthSessionPayload(adminSessionStorageKey, "admin")
      const updatedSession: AuthSession = typeof stored === "object"
        ? { ...stored, passwordResetRequired: false }
        : {
            role: "admin",
            subjectId: subject,
            tokenType: "Bearer",
            accessToken: adminAuthToken,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            passwordResetRequired: false,
          }
      storeAuthSession(adminSessionStorageKey, updatedSession)
      setAdminPasswordResetRequired(false)
      setNewAdminPassword("")
      setNewAdminPasswordConfirm("")
      setAdminPasswordError(undefined)
    } catch (error) {
      setAdminPasswordError(error instanceof Error ? error.message : "Не вдалося змінити пароль адміністратора.")
    } finally {
      setAdminPasswordSaving(false)
    }
  }

  const refreshAll = useCallback(async () => {
    if (!adminAuthToken || adminPasswordResetRequired) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const [nextStats, nextClients, nextProviders, nextOrders, nextSettings] = await Promise.all([
        getAdminStats(adminAuthToken),
        getAdminClients(adminAuthToken, clientQuery || undefined, showGuestSessions),
        getAdminProviders(adminAuthToken, providerQuery || undefined),
        getAdminOrders(adminAuthToken, orderFilter === "all" ? undefined : orderFilter),
        getAdminSettings(adminAuthToken),
      ])
      setStats(nextStats)
      setClients(nextClients)
      setProviders(nextProviders)
      setOrders(nextOrders.slice().reverse())
      setSettings(nextSettings)
    } catch {
      setError("Не вдалося завантажити дані адмін-панелі.")
    } finally {
      setLoading(false)
    }
  }, [adminAuthToken, adminPasswordResetRequired, clientQuery, providerQuery, orderFilter, showGuestSessions])

  const refreshOpsLog = useCallback(async () => {
    if (!adminAuthToken || adminPasswordResetRequired) return
    try {
      const nextOpsLog = await getAdminOpsLog(adminAuthToken, {
        limit: 100,
        severity: opsSeverity,
        orderId: opsOrderQuery.trim() || undefined,
        providerId: opsProviderQuery.trim() || undefined,
        customerId: opsCustomerQuery.trim() || undefined,
      })
      setOpsLog(nextOpsLog)
    } catch {
      setError("Не вдалося завантажити ops-лог.")
    }
  }, [adminAuthToken, adminPasswordResetRequired, opsSeverity, opsOrderQuery, opsProviderQuery, opsCustomerQuery])

  const refreshMapProviders = useCallback(async () => {
    if (!adminAuthToken || adminPasswordResetRequired) return
    try {
      // Map tab only — never pull ~6k directory pins on every 15s admin poll.
      const nextMapProviders = await getMapProviders({ scope: "all" })
      setMapProviders(Array.isArray(nextMapProviders) ? nextMapProviders : [])
    } catch {
      setError("Не вдалося завантажити піни карти.")
    }
  }, [adminAuthToken, adminPasswordResetRequired])

  const refreshAuthAccounts = useCallback(async () => {
    if (!adminAuthToken || adminPasswordResetRequired) return
    try {
      const nextAccounts = await getAdminAuthAccounts(adminAuthToken, {
        role: authAccountRole === "all" ? undefined : authAccountRole,
        includeDisabled: true,
      })
      setAuthAccounts(nextAccounts)
    } catch {
      setError("Не вдалося завантажити auth-акаунти. Перевірте, що SQL storage увімкнено.")
    }
  }, [adminAuthToken, adminPasswordResetRequired, authAccountRole])

  useEffect(() => {
    refreshAll()
    const interval = window.setInterval(refreshAll, 15000)
    return () => window.clearInterval(interval)
  }, [refreshAll])

  useEffect(() => {
    if (section !== "logs") return
    void refreshOpsLog()
    const interval = window.setInterval(() => void refreshOpsLog(), 15000)
    return () => window.clearInterval(interval)
  }, [section, refreshOpsLog])

  useEffect(() => {
    if (section !== "map") return
    void refreshMapProviders()
  }, [section, refreshMapProviders])

  useEffect(() => {
    if (section !== "accounts") return
    void refreshAuthAccounts()
  }, [section, refreshAuthAccounts])

  const selectedClient = clients.find((item) => item.id === selectedClientId) ?? clients[0]
  const selectedProvider = providers.find((item) => item.id === selectedProviderId) ?? providers[0]
  const filteredOrders = orders.filter((order) => orderFilter === "all" || normalizeOrderStatus(order.status) === orderFilter)
  const selectedOrder = filteredOrders.find((order) => order.id === selectedOrderId) ?? filteredOrders[0]
  const pendingProviders = providers.filter((item) => item.verificationStatus === "pending")
  const authAccountCanSave = authAccountForm.password.trim().length >= 8
    && Boolean(authAccountForm.username.trim() || authAccountForm.email.trim() || authAccountForm.phone.trim())
    && (authAccountForm.role !== "provider" || Boolean(authAccountForm.providerId.trim()))

  const saveClient = async (payload: Partial<CustomerProfile> & { accountStatus?: string }) => {
    if (!selectedClient?.id || !adminAuthToken) return
    setSaving(true)
    setError(undefined)
    try {
      const updated = await adminUpdateClient(selectedClient.id, payload, adminAuthToken)
      setClients((items) => items.map((item) => item.id === updated.id ? updated : item))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося зберегти клієнта.")
    } finally {
      setSaving(false)
    }
  }

  const saveProvider = async (payload: Partial<ProviderAvailability> & { accountStatus?: string }) => {
    if (!selectedProvider?.id || !adminAuthToken) return
    setSaving(true)
    setError(undefined)
    try {
      const updated = await adminUpdateProvider(selectedProvider.id, payload, adminAuthToken)
      setProviders((items) => items.map((item) => item.id === updated.id ? updated : item))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося зберегти партнера.")
    } finally {
      setSaving(false)
    }
  }

  const setOrderStatus = async (order: OrderResponse, status: OrderStatus) => {
    if (!order.id || !adminAuthToken) return
    try {
      const updated = await updateOrderStatus(order.id, status, adminAuthToken)
      setOrders((items) => items.map((item) => item.id === order.id ? { ...item, ...updated } : item))
      setError(undefined)
    } catch {
      setError("Недопустимий перехід статусу або немає доступу адміністратора.")
    }
  }

  const setProviderVerification = async (item: ProviderAvailability, status: "verified" | "rejected") => {
    if (!adminAuthToken) return
    setAuthAccountStatus(undefined)
    try {
      const updated = await reviewProviderVerification(item.id, { status }, adminAuthToken)
      const nextProvider: ProviderAvailability = updated.authAccountBootstrap
        ? {
            ...updated,
            authAccount: {
              id: updated.authAccountBootstrap.id,
              role: "provider",
              username: updated.authAccountBootstrap.username,
              providerId: updated.authAccountBootstrap.providerId || item.id,
              status: updated.authAccountBootstrap.status,
              hasPassword: true,
              passwordResetRequired: Boolean(updated.authAccountBootstrap.passwordResetRequired),
            },
          }
        : updated
      setProviders((items) => items.map((providerItem) => providerItem.id === item.id ? { ...providerItem, ...nextProvider } : providerItem))
      if (updated.authAccountBootstrap?.temporaryPassword) {
        setProviderInvite({
          providerId: item.id,
          accountId: updated.authAccountBootstrap.id,
          login: updated.authAccountBootstrap.username || updated.authAccountBootstrap.providerId || item.id,
          temporaryPassword: updated.authAccountBootstrap.temporaryPassword,
          resetRequired: Boolean(updated.authAccountBootstrap.passwordResetRequired),
          status: updated.authAccountBootstrap.status,
        })
        setAuthAccountStatus(`Запрошення для ${updated.authAccountBootstrap.username || item.id} створено.`)
      } else if (updated.authAccountBootstrap?.activated) {
        setProviderInvite({
          providerId: item.id,
          accountId: updated.authAccountBootstrap.id,
          login: updated.authAccountBootstrap.username || updated.authAccountBootstrap.providerId || item.id,
          resetRequired: Boolean(updated.authAccountBootstrap.passwordResetRequired),
          status: updated.authAccountBootstrap.status,
        })
        setAuthAccountStatus(`Provider account ${updated.authAccountBootstrap.id || item.id} активовано.`)
      }
      setError(undefined)
    } catch {
      setError("Не вдалося оновити перевірку партнера.")
    }
  }

  const removeProvider = async (providerId: string) => {
    if (!adminAuthToken) return
    setSaving(true)
    try {
      await adminDeleteProvider(providerId, adminAuthToken)
      setProviders((items) => items.filter((item) => item.id !== providerId))
      setMapProviders((items) => items.filter((item) => item.id !== providerId))
      setSelectedProviderId(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося видалити партнера.")
    } finally {
      setSaving(false)
    }
  }

  const runGuestPurge = async () => {
    if (!adminAuthToken) return
    if (!window.confirm("Видалити guest-сесії старші за 7 днів без телефону та без заявок?")) return
    setPurgeStatus(undefined)
    setSaving(true)
    try {
      const result = await purgeStaleGuestClients(adminAuthToken, 7)
      setPurgeStatus(`Видалено ${result.deleted} guest-сесій, залишилось ${result.remaining}`)
      await refreshAll()
    } catch {
      setPurgeStatus("Не вдалося очистити guest-сесії.")
    } finally {
      setSaving(false)
    }
  }

  const runMapImport = async (seedOnly = false) => {
    if (!adminAuthToken) return
    setImportStatus(undefined)
    setSaving(true)
    try {
      const result = await importUzhgorodProviders(adminAuthToken, { seedOnly, preferOsm: !seedOnly })
      setImportStatus(`Імпорт: ${result.source}, додано ${result.merge.added}, оновлено ${result.merge.updated}`)
      await refreshAll()
      if (section === "map") await refreshMapProviders()
    } catch {
      setImportStatus("Помилка імпорту провайдерів.")
    } finally {
      setSaving(false)
    }
  }

  const saveAuthAccount = async () => {
    if (!adminAuthToken) return
    setSaving(true)
    setError(undefined)
    setAuthAccountStatus(undefined)
    try {
      const payload = {
        role: authAccountForm.role,
        username: optionalTrim(authAccountForm.username),
        providerId: authAccountForm.role === "provider" ? optionalTrim(authAccountForm.providerId) : undefined,
        email: optionalTrim(authAccountForm.email),
        phone: optionalTrim(authAccountForm.phone),
        password: authAccountForm.password.trim(),
      }
      const created = await adminSaveAuthAccount(payload, adminAuthToken)
      setAuthAccountStatus(`Акаунт ${created.id} збережено.`)
      setAuthAccountForm(createEmptyAuthAccountForm(authAccountForm.role))
      await refreshAuthAccounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося зберегти auth-акаунт.")
    } finally {
      setSaving(false)
    }
  }

  const resetAuthAccountPassword = async (account: AdminAuthAccount) => {
    if (!adminAuthToken) return
    const password = (authAccountPasswords[account.id] ?? "").trim()
    if (!password) return
    setSaving(true)
    setError(undefined)
    setAuthAccountStatus(undefined)
    try {
      const updated = await adminResetAuthAccountPassword(account.id, password, adminAuthToken)
      setAuthAccounts((items) => items.map((item) => item.id === updated.id ? updated : item))
      setAuthAccountPasswords((items) => {
        const next = { ...items }
        delete next[account.id]
        return next
      })
      setAuthAccountStatus(`Пароль для ${updated.id} оновлено.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося оновити пароль auth-акаунта.")
    } finally {
      setSaving(false)
    }
  }

  const issueAuthAccountTemporaryPassword = async (account: AdminAuthAccount) => {
    if (!adminAuthToken) return
    setSaving(true)
    setAuthAccountStatus(undefined)
    try {
      const updated = await adminIssueAuthAccountTemporaryPassword(account.id, adminAuthToken)
      setAuthAccounts((items) => items.map((item) => item.id === updated.id ? updated : item))
      setAuthAccountPasswords((items) => {
        const next = { ...items }
        delete next[account.id]
        return next
      })
      setAuthAccountStatus(`Temporary password for ${updated.id}: ${updated.temporaryPassword}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося видати тимчасовий пароль.")
    } finally {
      setSaving(false)
    }
  }

  const setAuthAccountEnabled = async (account: AdminAuthAccount, enabled: boolean) => {
    if (!adminAuthToken) return
    setSaving(true)
    setError(undefined)
    setAuthAccountStatus(undefined)
    try {
      const updated = enabled
        ? await adminUpdateAuthAccount(account.id, { status: "active" }, adminAuthToken)
        : await adminDeactivateAuthAccount(account.id, adminAuthToken)
      setAuthAccounts((items) => items.map((item) => item.id === updated.id ? updated : item))
      setAuthAccountStatus(enabled ? `Акаунт ${updated.id} увімкнено.` : `Акаунт ${updated.id} вимкнено.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося змінити статус auth-акаунта.")
    } finally {
      setSaving(false)
    }
  }

  if (!adminAuthToken && (!adminToken || bootstrapAuthFailed)) {
    return (
      <AdminLogin
        login={accountLogin}
        password={accountPassword}
        saving={authSaving}
        error={authError}
        resetStatus={adminResetRequestStatus}
        resetSaving={adminResetRequestSaving}
        onLoginChange={setAccountLogin}
        onPasswordChange={setAccountPassword}
        onSubmit={submitAdminAccountLogin}
        onResetRequest={requestAdminAccountReset}
      />
    )
  }

  if (adminAuthToken && adminPasswordResetRequired) {
    return (
      <AdminPasswordReset
        password={newAdminPassword}
        confirmPassword={newAdminPasswordConfirm}
        saving={adminPasswordSaving}
        error={adminPasswordError}
        onPasswordChange={setNewAdminPassword}
        onConfirmPasswordChange={setNewAdminPasswordConfirm}
        onSubmit={completeAdminPasswordReset}
      />
    )
  }

  const sectionTitle = NAV.find((item) => item.id === section)?.label ?? "Адмін"

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar${sidebarOpen ? " admin-sidebar-open" : ""}`}>
        <div className="admin-brand">
          <span className="admin-brand-mark">P</span>
          <div>
            <div className="admin-brand-title">POMICH Admin</div>
            <div className="admin-brand-sub">Operations Console</div>
          </div>
        </div>
        <nav className="admin-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`admin-nav-item${section === item.id ? " admin-nav-item-active" : ""}`}
              onClick={() => {
                setSection(item.id)
                setSidebarOpen(false)
              }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "verification" && pendingProviders.length > 0 ? (
                <span className="admin-nav-badge">{pendingProviders.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <div className="admin-session-pill">🔒 JWT сесія активна</div>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button className="admin-menu-btn" onClick={() => setSidebarOpen((value) => !value)} aria-label="Меню">☰</button>
          <div>
            <div className="admin-topbar-title">{sectionTitle}</div>
            <div className="admin-topbar-sub">Повний контроль системи POMICH</div>
          </div>
          <button
            className="admin-ghost-btn"
            onClick={() => {
              void refreshAll()
              if (section === "logs") void refreshOpsLog()
              if (section === "map") void refreshMapProviders()
              if (section === "accounts") void refreshAuthAccounts()
            }}
            disabled={loading}
          >
            Оновити
          </button>
        </header>

        {error ? <div className="admin-alert admin-alert-error admin-alert-inline">{error}</div> : null}
        {authAccountStatus && section !== "accounts" ? <div className="admin-alert admin-alert-info admin-alert-inline">{authAccountStatus}</div> : null}

        <div className="admin-content">
          {loading && !stats ? <LoadingState /> : null}

          {section === "dashboard" && stats ? (
            <div className="admin-grid">
              <div className="admin-stat-grid">
                <StatCard label="Клієнти" value={stats.totals.clients} />
                <StatCard label="Партнери" value={stats.totals.providers} />
                <StatCard label="Активні заявки" value={stats.totals.activeOrders} tone="brand" />
                <StatCard label="Завершені" value={stats.totals.completedOrders} />
                <StatCard label="На лінії" value={stats.providers.online} tone="brand" />
                <StatCard label="У роботі" value={stats.providers.busy} tone="warn" />
                <StatCard label="Verified" value={stats.providers.verified} />
                <StatCard label="На перевірці" value={stats.providers.pendingVerification} tone="warn" />
              </div>
              <div className="admin-panel">
                <div className="admin-panel-head">
                  <h2>Остання активність</h2>
                  <div className="admin-inline-actions">
                    <span>{stats.activity?.length ?? 0} подій</span>
                    <button className="admin-chip admin-chip-brand" onClick={() => setSection("logs")}>
                      Логи / помилки{opsLog?.counts?.error ? ` · ${opsLog.counts.error}` : ""}
                    </button>
                  </div>
                </div>
                <div className="admin-activity-list">
                  {(stats.activity ?? []).map((item: AdminActivityItem) => (
                    <div key={`${item.type}-${item.id}-${item.at}`} className="admin-activity-item">
                      <div>
                        <strong>{item.id ?? "—"}</strong>
                        <div className="admin-muted">{getServiceEmoji(item.service)} {getServiceLabel(item.service)} · {item.source ?? "web"}</div>
                      </div>
                      <div className="admin-activity-meta">
                        <StatusPill status={normalizeOrderStatus(item.status)} />
                        <span className="admin-muted">{item.at ?? "—"}</span>
                      </div>
                    </div>
                  ))}
                  {(stats.activity ?? []).length === 0 ? <EmptyState text="Ще немає активності." /> : null}
                </div>
              </div>
            </div>
          ) : null}

          {section === "clients" ? (
            <div className="admin-split">
              <div className="admin-panel">
                <div className="admin-panel-head">
                  <h2>Клієнти</h2>
                  <div className="admin-panel-actions">
                    <label className="admin-toggle">
                      <input
                        type="checkbox"
                        checked={showGuestSessions}
                        onChange={(event) => setShowGuestSessions(event.target.checked)}
                      />
                      <span>Показати guest-сесії</span>
                    </label>
                    <button className="admin-ghost-btn" onClick={() => runGuestPurge()} disabled={saving}>
                      Очистити старі guest
                    </button>
                    <input className="admin-search" value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Пошук…" />
                  </div>
                </div>
                {purgeStatus ? <div className="admin-muted admin-panel-note">{purgeStatus}</div> : null}
                <div className="admin-list">
                  {clients.map((client) => (
                    <button key={client.id} className={`admin-list-item${selectedClient?.id === client.id ? " admin-list-item-active" : ""}`} onClick={() => setSelectedClientId(client.id)}>
                      <div>
                        <strong>{formatCustomerDisplayName(client)}</strong>
                        <div className="admin-muted">{client.phone || "—"} · {formatCustomerCity(client.city)}</div>
                        {client.isGuestSession ? <div className="admin-muted">guest-сесія · {client.id}</div> : null}
                      </div>
                      <VerificationPill status={client.verificationStatus} />
                    </button>
                  ))}
                  {clients.length === 0 ? <EmptyState text={showGuestSessions ? "Клієнтів не знайдено." : "Реальних клієнтів не знайдено. Увімкніть «Показати guest-сесії», щоб побачити тимчасові візити."} /> : null}
                </div>
              </div>
              {selectedClient ? (
                <ClientEditor
                  client={selectedClient}
                  saving={saving}
                  onSave={saveClient}
                  onOpenLogs={() => {
                    setOpsOrderQuery("")
                    setOpsProviderQuery("")
                    setOpsCustomerQuery(selectedClient.id)
                    setOpsSeverity("all")
                    setSection("logs")
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {section === "providers" || section === "verification" ? (
            <div className="admin-split">
              <div className="admin-panel">
                <div className="admin-panel-head">
                  <h2>{section === "verification" ? "Перевірка партнерів" : "Партнери"}</h2>
                  <input className="admin-search" value={providerQuery} onChange={(event) => setProviderQuery(event.target.value)} placeholder="Пошук…" />
                </div>
                <div className="admin-list">
                  {(section === "verification" ? pendingProviders : providers).map((provider) => (
                    <button key={provider.id} className={`admin-list-item${selectedProvider?.id === provider.id ? " admin-list-item-active" : ""}`} onClick={() => setSelectedProviderId(provider.id)}>
                      <div>
                        <strong>{provider.name}</strong>
                        <div className="admin-muted">{provider.phone || "—"} · {providerStatusLabel(provider.status)}</div>
                        <div className="admin-muted">{toServiceKeys(provider.specialties).map(getProviderCapabilityLabel).join(" · ") || "Послуги не вказані"}</div>
                      </div>
                      <div className="admin-activity-meta">
                        <VerificationPill status={provider.verificationStatus} />
                        <span className={providerAuthAccountChipClass(provider.authAccount)}>{providerAuthAccountLabel(provider.authAccount)}</span>
                      </div>
                    </button>
                  ))}
                  {(section === "verification" ? pendingProviders : providers).length === 0 ? (
                    <EmptyState text={section === "verification" ? "Немає заявок на перевірку." : "Партнерів не знайдено."} />
                  ) : null}
                </div>
              </div>
              {selectedProvider ? (
                <ProviderEditor
                  provider={selectedProvider}
                  saving={saving}
                  onSave={saveProvider}
                  onVerify={(status) => setProviderVerification(selectedProvider, status)}
                  onDelete={() => removeProvider(selectedProvider.id)}
                  onOpenLogs={() => {
                    setOpsOrderQuery("")
                    setOpsProviderQuery(selectedProvider.id)
                    setOpsCustomerQuery("")
                    setOpsSeverity("all")
                    setSection("logs")
                  }}
                  invite={providerInvite?.providerId === selectedProvider.id ? providerInvite : undefined}
                  verificationMode={section === "verification"}
                />
              ) : null}
            </div>
          ) : null}

          {section === "orders" ? (
            <div className="admin-split">
              <div className="admin-panel">
                <div className="admin-panel-head">
                  <h2>Заявки</h2>
                  <div className="admin-chip-row">
                    {(["all", "searching", "accepted", "price_confirmed", "assigned", "en_route", "in_progress", "completed"] as const).map((filter) => (
                      <button key={filter} className={`admin-chip${orderFilter === filter ? " admin-chip-active" : ""}`} onClick={() => setOrderFilter(filter)}>
                        {filter === "all" ? "Усі" : orderStatusLabels[filter]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="admin-list">
                  {filteredOrders.map((order) => (
                    <button key={order.id} className={`admin-list-item${selectedOrder?.id === order.id ? " admin-list-item-active" : ""}`} onClick={() => setSelectedOrderId(order.id)}>
                      <div>
                        <strong>{order.id}</strong>
                        <div className="admin-muted">{getServiceEmoji(order.service)} {getServiceLabel(order.service)}</div>
                        <div className="admin-muted">{order.customerLocation ?? "?"} → {order.destination ?? "?"}</div>
                      </div>
                      <StatusPill status={normalizeOrderStatus(order.status)} />
                    </button>
                  ))}
                  {filteredOrders.length === 0 ? <EmptyState text="Заявок у цьому фільтрі немає." /> : null}
                </div>
              </div>
              {selectedOrder ? (
                <OrderEditor order={selectedOrder} adminAuthToken={adminAuthToken} onStatusChange={setOrderStatus} onRetryDispatch={async () => {
                  if (!selectedOrder.id) return
                  try {
                    const updated = await retryDispatch(selectedOrder.id, adminAuthToken)
                    setOrders((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item))
                    void refreshAll()
                  } catch {
                    setError("Не вдалося повторити диспетчеризацію.")
                  }
                }} onOpenLogs={(orderId) => {
                  setOpsOrderQuery(orderId)
                  setOpsProviderQuery("")
                  setOpsCustomerQuery("")
                  setOpsSeverity("all")
                  setSection("logs")
                }} />
              ) : null}
            </div>
          ) : null}

          {section === "logs" ? (
            <div className="admin-grid">
              <div className="admin-stat-grid">
                <StatCard label="Помилки" value={opsLog?.counts?.error ?? 0} tone="warn" />
                <StatCard label="Попередження" value={opsLog?.counts?.warn ?? 0} tone="warn" />
                <StatCard label="Етапи" value={opsLog?.counts?.info ?? 0} />
                <StatCard label="Усього подій" value={opsLog?.counts?.total ?? 0} tone="brand" />
              </div>
              <div className="admin-panel">
                <div className="admin-panel-head">
                  <h2>Логи етапів і помилок</h2>
                  <div className="admin-panel-actions">
                    <input
                      className="admin-search"
                      value={opsOrderQuery}
                      onChange={(event) => setOpsOrderQuery(event.target.value)}
                      placeholder="Order ID…"
                    />
                    <input
                      className="admin-search"
                      value={opsProviderQuery}
                      onChange={(event) => setOpsProviderQuery(event.target.value)}
                      placeholder="Provider ID…"
                    />
                    <input
                      className="admin-search"
                      value={opsCustomerQuery}
                      onChange={(event) => setOpsCustomerQuery(event.target.value)}
                      placeholder="Customer ID…"
                    />
                  </div>
                </div>
                <div className="admin-chip-row" style={{ marginBottom: 12 }}>
                  {([
                    ["all", "Усі"],
                    ["error", "Помилки"],
                    ["warn", "Попередження"],
                    ["info", "Етапи"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      className={`admin-chip${opsSeverity === value ? " admin-chip-active" : ""}`}
                      onClick={() => setOpsSeverity(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="admin-muted admin-panel-note">
                  Тут видно, на якому етапі заявки сталася проблема: dispatch, оффер, статус партнера, оцінка тощо.
                </p>
                <div className="admin-activity-list">
                  {(opsLog?.events ?? []).map((item: AdminOpsLogEvent) => (
                    <div key={item.id ?? `${item.type}-${item.at}-${item.orderId}`} className={`admin-activity-item admin-ops-item admin-ops-item--${item.severity || "info"}`}>
                      <div>
                        <div className="admin-ops-item__head">
                          <span className={`admin-ops-severity admin-ops-severity--${item.severity || "info"}`}>
                            {(item.severity || "info").toUpperCase()}
                          </span>
                          <strong>{item.type}</strong>
                        </div>
                        <div className="admin-muted">{item.message || "—"}</div>
                        <div className="admin-muted">
                          {item.orderId ? `#${item.orderId}` : "без заявки"}
                          {item.providerId ? ` · partner ${item.providerId}` : ""}
                          {item.customerId ? ` · customer ${item.customerId}` : ""}
                          {item.source ? ` · ${item.source}` : ""}
                          {item.code ? ` · ${item.code}` : ""}
                        </div>
                      </div>
                      <div className="admin-activity-meta">
                        {item.orderId ? (
                          <button
                            type="button"
                            className="admin-chip admin-chip-brand"
                            onClick={() => {
                              setSelectedOrderId(item.orderId)
                              setSection("orders")
                            }}
                          >
                            Заявка
                          </button>
                        ) : null}
                        <span className="admin-muted">{item.at ?? "—"}</span>
                      </div>
                    </div>
                  ))}
                  {(opsLog?.events ?? []).length === 0 ? <EmptyState text="Подій за цим фільтром немає." /> : null}
                </div>
              </div>
            </div>
          ) : null}

          {section === "map" ? (
            <div className="admin-grid">
              <div className="admin-panel">
                <div className="admin-panel-head">
                  <h2>Карта / OSM провайдери</h2>
                  <div className="admin-inline-actions">
                    <button className="admin-ghost-btn" onClick={() => void refreshMapProviders()} disabled={saving}>Оновити піни</button>
                    <button className="admin-ghost-btn" onClick={() => runMapImport(false)} disabled={saving}>Імпорт OSM</button>
                    <button className="admin-ghost-btn" onClick={() => runMapImport(true)} disabled={saving}>Seed</button>
                  </div>
                </div>
                {importStatus ? <div className="admin-alert admin-alert-info">{importStatus}</div> : null}
                <div className="admin-stat-grid admin-stat-grid-compact">
                  <StatCard label="На карті" value={mapProviders.length} />
                  <StatCard label="Dispatch" value={mapProviders.filter((item) => item.providerKind !== "directory").length} />
                  <StatCard label="Directory" value={mapProviders.filter((item) => item.providerKind === "directory").length} />
                </div>
                <div className="admin-list admin-list-scroll">
                  {mapProviders.slice(0, 40).map((provider) => (
                    <div key={provider.id} className="admin-list-item admin-list-item-static">
                      <div>
                        <strong>{provider.name}</strong>
                        <div className="admin-muted">{provider.city ?? "—"} · {provider.source ?? provider.providerKind ?? "dispatch"}</div>
                        <div className="admin-muted">{provider.address ?? (provider.location ? `${provider.location?.lat?.toFixed(4)}, ${provider.location?.lng?.toFixed(4)}` : "координати —")}</div>
                      </div>
                      <div className="admin-inline-actions">
                        <button className="admin-chip admin-chip-danger" onClick={() => removeProvider(provider.id)} disabled={saving}>Видалити</button>
                      </div>
                    </div>
                  ))}
                  {mapProviders.length === 0 ? <EmptyState text="Пінів на карті поки немає." /> : null}
                </div>
              </div>
            </div>
          ) : null}

          {section === "accounts" ? (
            <div className="admin-grid">
              <div className="admin-panel">
                <div className="admin-panel-head">
                  <h2>Auth акаунти</h2>
                  <div className="admin-chip-row">
                    {(["all", "admin", "provider"] as const).map((role) => (
                      <button
                        key={role}
                        className={`admin-chip${authAccountRole === role ? " admin-chip-active" : ""}`}
                        onClick={() => setAuthAccountRole(role)}
                      >
                        {role === "all" ? "Усі" : role}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="admin-muted admin-panel-note">
                  Тут оператор створює SQL-акаунти для адмінів і партнерів. Bootstrap-токени залишаються тільки для dev/staging.
                </p>
                {authAccountStatus ? <div className="admin-alert admin-alert-info">{authAccountStatus}</div> : null}
                <div className="admin-auth-layout">
                  <div className="admin-auth-form">
                    <h3>Новий акаунт</h3>
                    <div className="admin-form-grid">
                      <label className="admin-field">
                        <span>Роль</span>
                        <select
                          value={authAccountForm.role}
                          onChange={(event) => {
                            const role = event.target.value as AdminAuthAccount["role"]
                            setAuthAccountForm((form) => ({
                              ...form,
                              role,
                              providerId: role === "provider" ? form.providerId : "",
                            }))
                          }}
                          aria-label="Роль акаунта"
                        >
                          <option value="provider">provider</option>
                          <option value="admin">admin</option>
                        </select>
                      </label>
                      <label className="admin-field">
                        <span>Логін</span>
                        <input value={authAccountForm.username} onChange={(event) => setAuthAccountForm((form) => ({ ...form, username: event.target.value }))} aria-label="Логін акаунта" />
                      </label>
                      {authAccountForm.role === "provider" ? (
                        <label className="admin-field">
                          <span>Provider ID</span>
                          <input value={authAccountForm.providerId} onChange={(event) => setAuthAccountForm((form) => ({ ...form, providerId: event.target.value }))} aria-label="Provider ID" />
                        </label>
                      ) : null}
                      <label className="admin-field">
                        <span>Email</span>
                        <input value={authAccountForm.email} onChange={(event) => setAuthAccountForm((form) => ({ ...form, email: event.target.value }))} aria-label="Email акаунта" />
                      </label>
                      <label className="admin-field">
                        <span>Телефон</span>
                        <input value={authAccountForm.phone} onChange={(event) => setAuthAccountForm((form) => ({ ...form, phone: event.target.value }))} aria-label="Телефон акаунта" />
                      </label>
                      <label className="admin-field">
                        <span>Пароль</span>
                        <input value={authAccountForm.password} onChange={(event) => setAuthAccountForm((form) => ({ ...form, password: event.target.value }))} type="password" aria-label="Пароль акаунта" />
                      </label>
                    </div>
                    <button className="admin-primary-btn" disabled={saving || !authAccountCanSave} onClick={() => void saveAuthAccount()}>
                      {saving ? "Зберігаємо…" : "Створити акаунт"}
                    </button>
                  </div>

                  <div className="admin-list admin-auth-list">
                    {authAccounts.map((account) => (
                      <div key={account.id} className="admin-list-item admin-list-item-static admin-auth-account-row">
                        <div>
                          <strong>{authAccountIdentity(account)}</strong>
                          <div className="admin-muted">{account.id} · {account.role}{account.providerId ? ` · provider ${account.providerId}` : ""}</div>
                          <div className="admin-muted">
                            {account.email || "email —"} · {account.phone || "телефон —"} · {account.hasPassword ? "пароль є" : "пароля немає"}
                            {account.passwordResetRequired ? " · reset required" : ""}
                          </div>
                          <div className="admin-muted">{account.updatedAt ? `оновлено ${account.updatedAt}` : "оновлення —"}</div>
                        </div>
                        <div className="admin-auth-actions">
                          <span className={`admin-chip${account.status === "active" ? " admin-chip-brand" : " admin-chip-danger"}`}>{account.status}</span>
                          <input
                            className="admin-search admin-auth-password-input"
                            value={authAccountPasswords[account.id] ?? ""}
                            onChange={(event) => setAuthAccountPasswords((items) => ({ ...items, [account.id]: event.target.value }))}
                            type="password"
                            placeholder="Новий пароль"
                            aria-label={`Новий пароль ${account.id}`}
                          />
                          <button
                            className="admin-chip"
                            disabled={saving || (authAccountPasswords[account.id] ?? "").trim().length < 8}
                            onClick={() => void resetAuthAccountPassword(account)}
                          >
                            Змінити пароль
                          </button>
                          <button
                            className="admin-chip admin-chip-brand"
                            disabled={saving}
                            onClick={() => void issueAuthAccountTemporaryPassword(account)}
                          >
                            Тимчасовий пароль
                          </button>
                          <button
                            className={account.status === "active" ? "admin-chip admin-chip-danger" : "admin-chip admin-chip-brand"}
                            disabled={saving}
                            onClick={() => void setAuthAccountEnabled(account, account.status !== "active")}
                          >
                            {account.status === "active" ? "Вимкнути" : "Увімкнути"}
                          </button>
                        </div>
                      </div>
                    ))}
                    {authAccounts.length === 0 ? <EmptyState text="Акаунтів у цьому фільтрі немає." /> : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {section === "settings" && settings ? (
            <div className="admin-grid">
              <div className="admin-panel">
                <div className="admin-panel-head"><h2>Системні налаштування</h2></div>
                <div className="admin-kv-grid">
                  <div><span>Runtime</span><strong>{settings.runtime}</strong></div>
                  <div><span>WEB_APP_URL</span><strong>{settings.webAppUrl ?? "—"}</strong></div>
                  <div><span>Шифрування PII</span><strong className={settings.encryptionEnabled ? "admin-ok" : "admin-warn"}>{settings.encryptionEnabled ? "Увімкнено" : "Вимкнено"}</strong></div>
                  <div><span>Storage</span><strong>{settings.sqlStorageEnabled ? "SQL/PostGIS" : (settings.storageBackend || (settings.databaseUrlConfigured ? "DATABASE_URL" : "JSON store"))}</strong></div>
                  <div><span>Telegram</span><strong>{settings.telegramConfigured ? "Так" : "Ні"}</strong></div>
                  <div><span>CORS</span><strong>{settings.corsOrigins.join(", ")}</strong></div>
                  <div><span>Auth source</span><strong>{settings.authAccountsSource || "env"}</strong></div>
                  <div><span>Admin accounts</span><strong className={settings.adminAccountsConfigured ? "admin-ok" : "admin-warn"}>{authAccountSettingsText(settings.adminAccountsConfigured, settings.adminAccountsActive, settings.adminAccountsTotal, settings.adminAccountsError)}</strong></div>
                  <div><span>Provider accounts</span><strong className={settings.providerAccountsConfigured ? "admin-ok" : "admin-warn"}>{authAccountSettingsText(settings.providerAccountsConfigured, settings.providerAccountsActive, settings.providerAccountsTotal, settings.providerAccountsError)}</strong></div>
                  <div><span>Bootstrap sessions</span><strong className={settings.bootstrapAuthSessionsEnabled ? "admin-warn" : "admin-ok"}>{settings.bootstrapAuthSessionsEnabled ? "Dev enabled" : "Disabled"}</strong></div>
                  <div><span>Session TTL</span><strong>{settings.sessionTtlSeconds}s</strong></div>
                  <div><span>HTTP pilot</span><strong>{settings.allowHttpPilot ? "Дозволено" : "Ні"}</strong></div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {sidebarOpen ? <button className="admin-backdrop" aria-label="Закрити меню" onClick={() => setSidebarOpen(false)} /> : null}
    </div>
  )
}

function ClientEditor({
  client,
  saving,
  onSave,
  onOpenLogs,
}: {
  client: CustomerProfile
  saving: boolean
  onSave: (payload: Partial<CustomerProfile> & { accountStatus?: string }) => Promise<void>
  onOpenLogs?: () => void
}) {
  const [name, setName] = useState(client.name ?? "")
  const [phone, setPhone] = useState(client.phone ?? "")
  const [email, setEmail] = useState(client.email ?? "")
  const [city, setCity] = useState(client.city ?? "")
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>(client.verificationStatus ?? "unverified")
  const [accountStatus, setAccountStatus] = useState((client as CustomerProfile & { accountStatus?: string }).accountStatus ?? "active")

  useEffect(() => {
    setName(client.name ?? "")
    setPhone(client.phone ?? "")
    setEmail(client.email ?? "")
    setCity(client.city ?? "")
    setVerificationStatus(client.verificationStatus ?? "unverified")
    setAccountStatus((client as CustomerProfile & { accountStatus?: string }).accountStatus ?? "active")
  }, [client])

  return (
    <div className="admin-panel admin-panel-detail">
      <div className="admin-panel-head">
        <h2>{formatCustomerDisplayName(client)}</h2>
        <div className="admin-inline-actions">
          <VerificationPill status={client.verificationStatus} />
          {onOpenLogs ? <button className="admin-chip" onClick={onOpenLogs}>Логи</button> : null}
        </div>
      </div>
      <div className="admin-muted admin-panel-note">ID: {client.id}{client.isGuestSession ? " · guest-сесія" : ""}</div>
      <div className="admin-form-grid">
        <label className="admin-field"><span>Імʼя</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="admin-field"><span>Телефон</span><input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        <label className="admin-field"><span>Email</span><input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="admin-field"><span>Місто</span><input value={city} onChange={(event) => setCity(event.target.value)} /></label>
        <label className="admin-field"><span>Статус перевірки</span>
          <select value={verificationStatus} onChange={(event) => setVerificationStatus(event.target.value as VerificationStatus)}>
            {(["unverified", "pending", "verified", "rejected"] as const).map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label className="admin-field"><span>Акаунт</span>
          <select value={accountStatus} onChange={(event) => setAccountStatus(event.target.value)}>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </label>
      </div>
      <button className="admin-primary-btn" disabled={saving} onClick={() => onSave({ name, phone, email, city, verificationStatus, accountStatus })}>{saving ? "Зберігаємо…" : "Зберегти"}</button>
    </div>
  )
}

function ProviderEditor({
  provider,
  saving,
  onSave,
  onVerify,
  onDelete,
  onOpenLogs,
  invite,
  verificationMode,
}: {
  provider: ProviderAvailability
  saving: boolean
  onSave: (payload: Partial<ProviderAvailability> & { accountStatus?: string }) => Promise<void>
  onVerify: (status: "verified" | "rejected") => void
  onDelete: () => void
  onOpenLogs?: () => void
  invite?: ProviderInviteState
  verificationMode?: boolean
}) {
  const [name, setName] = useState(provider.name ?? "")
  const [phone, setPhone] = useState(provider.phone ?? "")
  const [city, setCity] = useState(provider.city ?? "")
  const [vehicle, setVehicle] = useState(provider.vehicle ?? "")
  const [status, setStatus] = useState(provider.status)
  const [radius, setRadius] = useState(String(provider.serviceRadiusKm ?? 15))
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>(provider.verificationStatus ?? "unverified")

  useEffect(() => {
    setName(provider.name ?? "")
    setPhone(provider.phone ?? "")
    setCity(provider.city ?? "")
    setVehicle(provider.vehicle ?? "")
    setStatus(provider.status)
    setRadius(String(provider.serviceRadiusKm ?? 15))
    setVerificationStatus(provider.verificationStatus ?? "unverified")
  }, [provider])

  return (
    <div className="admin-panel admin-panel-detail">
      <div className="admin-panel-head">
        <h2>{provider.name}</h2>
        <div className="admin-inline-actions">
          <VerificationPill status={provider.verificationStatus} />
          {isVerified(provider.verificationStatus) ? null : (
            <>
              <button className="admin-chip admin-chip-brand" onClick={() => onVerify("verified")}>Схвалити</button>
              <button className="admin-chip admin-chip-danger" onClick={() => onVerify("rejected")}>Відхилити</button>
            </>
          )}
          {onOpenLogs ? <button className="admin-chip" onClick={onOpenLogs}>Логи</button> : null}
        </div>
      </div>
      {invite ? <ProviderInviteBlock invite={invite} /> : null}
      <div className="admin-subpanel">
        <h3>Provider account</h3>
        <div className="admin-kv-grid">
          <div><span>Account ID</span><strong>{provider.authAccount?.id || "не створено"}</strong></div>
          <div><span>Логін</span><strong>{provider.authAccount?.username || provider.authAccount?.phone || provider.authAccount?.email || "—"}</strong></div>
          <div>
            <span>Статус</span>
            <strong className={!provider.authAccount || provider.authAccount.status === "disabled" || provider.authAccount.passwordResetRequired ? "admin-warn" : "admin-ok"}>
              {providerAuthAccountLabel(provider.authAccount)}
            </strong>
          </div>
          <div><span>Reset required</span><strong>{provider.authAccount ? (provider.authAccount.passwordResetRequired ? "так" : "ні") : "—"}</strong></div>
        </div>
      </div>
      <div className="admin-form-grid">
        <label className="admin-field"><span>Імʼя</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="admin-field"><span>Телефон</span><input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        <label className="admin-field"><span>Місто</span><input value={city} onChange={(event) => setCity(event.target.value)} /></label>
        <label className="admin-field"><span>Авто</span><input value={vehicle} onChange={(event) => setVehicle(event.target.value)} /></label>
        <label className="admin-field"><span>Статус</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as ProviderAvailability["status"])}>
            {(["online", "busy", "offline"] as const).map((item) => <option key={item} value={item}>{providerStatusLabel(item)}</option>)}
          </select>
        </label>
        <label className="admin-field"><span>Радіус, км</span><input value={radius} onChange={(event) => setRadius(event.target.value)} /></label>
        {!verificationMode ? (
          <label className="admin-field"><span>Перевірка</span>
            <select value={verificationStatus} onChange={(event) => setVerificationStatus(event.target.value as VerificationStatus)}>
              {(["unverified", "pending", "verified", "rejected"] as const).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <div className="admin-inline-actions">
        <button className="admin-primary-btn" disabled={saving} onClick={() => onSave({ name, phone, city, vehicle, status, serviceRadiusKm: Number(radius), verificationStatus })}>{saving ? "Зберігаємо…" : "Зберегти"}</button>
        <button className="admin-chip admin-chip-danger" disabled={saving} onClick={onDelete}>Видалити</button>
      </div>
    </div>
  )
}

function OrderEditor({
  order,
  adminAuthToken,
  onStatusChange,
  onRetryDispatch,
  onOpenLogs,
}: {
  order: OrderResponse
  adminAuthToken?: string
  onStatusChange: (order: OrderResponse, status: OrderStatus) => Promise<void>
  onRetryDispatch: () => Promise<void>
  onOpenLogs?: (orderId: string) => void
}) {
  const status = normalizeOrderStatus(order.status)
  const offers = order.offers ?? []
  const timeline = useMemo(() => {
    const rows: Array<{ key: string; at?: string; label: string; detail?: string; tone: "info" | "warn" | "error" }> = []
    for (const entry of order.statusHistory ?? []) {
      rows.push({
        key: `status-${entry.status}-${entry.at}`,
        at: entry.at,
        label: `STATUS · ${entry.status}`,
        detail: orderStatusLabels[normalizeOrderStatus(entry.status)] || entry.status,
        tone: entry.status === "cancelled" ? "warn" : "info",
      })
    }
    for (const [index, event] of (order.dispatchEvents ?? []).entries()) {
      const type = String(event.type || "EVENT")
      const upper = type.toUpperCase()
      const tone: "info" | "warn" | "error" =
        upper.includes("FAIL") || upper.includes("ERROR") || upper.includes("EXHAUST") || upper === "NO_PROVIDERS_AVAILABLE"
          ? "error"
          : upper.includes("CANCEL") || upper.includes("EXPIRED") || upper.includes("DECLINED") || upper.includes("RETRY")
            ? "warn"
            : "info"
      const detailParts = [
        typeof event.message === "string" ? event.message : "",
        typeof event.code === "string" ? event.code : "",
        typeof event.providerId === "string" ? `partner ${event.providerId}` : "",
        typeof event.offerId === "string" ? `offer ${event.offerId}` : "",
      ].filter(Boolean)
      rows.push({
        key: `dispatch-${index}-${type}-${String(event.at || "")}`,
        at: typeof event.at === "string" ? event.at : undefined,
        label: type,
        detail: detailParts.join(" · ") || undefined,
        tone,
      })
    }
    return rows.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
  }, [order.dispatchEvents, order.statusHistory])

  return (
    <div className="admin-panel admin-panel-detail">
      <div className="admin-panel-head">
        <h2>{order.id}</h2>
        <StatusPill status={status} />
      </div>
      <div className="admin-kv-grid">
        <div><span>Послуга</span><strong>{getServiceLabel(order.service)}</strong></div>
        <div><span>Клієнт</span><strong>{order.telegramUsername ? `@${order.telegramUsername}` : order.chatId ?? "web"}</strong></div>
        <div><span>Маршрут</span><strong>{order.customerLocation ?? "?"} → {order.destination ?? "?"}</strong></div>
        <div><span>Dispatch</span><strong>{order.dispatchState ?? "—"}</strong></div>
        <div><span>Виконавець</span><strong>{order.assignedProvider?.name ?? order.assignedProviderId ?? "—"}</strong></div>
        <div><span>Створено</span><strong>{order.createdAt ?? "—"}</strong></div>
      </div>
      <Timeline status={status} />
      <div className="admin-chip-row">
        {nextOrderStatuses(status).filter((nextStatus) => nextStatus !== "cancelled").map((nextStatus) => (
          <button key={nextStatus} className="admin-chip" onClick={() => onStatusChange(order, nextStatus)} disabled={!adminAuthToken}>{orderStatusLabels[nextStatus]}</button>
        ))}
        {nextOrderStatuses(status).includes("cancelled") ? (
          <button className="admin-chip admin-chip-danger" onClick={() => onStatusChange(order, "cancelled")} disabled={!adminAuthToken}>Скасувати</button>
        ) : null}
        <button className="admin-chip admin-chip-brand" onClick={onRetryDispatch}>Повторити dispatch</button>
        {order.id && onOpenLogs ? (
          <button className="admin-chip" onClick={() => onOpenLogs(order.id!)}>Логи заявки</button>
        ) : null}
      </div>
      <div className="admin-subpanel">
        <h3>Історія етапів ({timeline.length})</h3>
        <div className="admin-activity-list">
          {timeline.map((item) => (
            <div key={item.key} className={`admin-activity-item admin-ops-item admin-ops-item--${item.tone}`}>
              <div>
                <div className="admin-ops-item__head">
                  <span className={`admin-ops-severity admin-ops-severity--${item.tone}`}>{item.tone.toUpperCase()}</span>
                  <strong>{item.label}</strong>
                </div>
                {item.detail ? <div className="admin-muted">{item.detail}</div> : null}
              </div>
              <span className="admin-muted">{item.at ?? "—"}</span>
            </div>
          ))}
          {timeline.length === 0 ? <EmptyState text="Подій по цій заявці ще немає." /> : null}
        </div>
      </div>
      {offers.length > 0 ? (
        <div className="admin-subpanel">
          <h3>Оффери ({offers.length})</h3>
          {offers.map((offer) => (
            <div key={offer.id} className="admin-activity-item">
              <span>{offer.providerId}</span>
              <span className="admin-muted">{offer.status}{typeof offer.distanceKm === "number" ? ` · ${offer.distanceKm.toFixed(1)} км` : ""}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
