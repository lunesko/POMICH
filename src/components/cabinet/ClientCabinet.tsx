import { useEffect, useState } from "react"

import {
  getCustomerOrders,
  getUserAccount,
  messageFromFetchError,
  updateCustomerProfile,
  type CustomerProfile,
  type OrderResponse,
} from "../../api/client"
import { readAuthSessionSubject } from "../../lib/auth"
import { getProfileChecklist, isCustomerVerified, profileChecklistSummary } from "../../lib/customerProfile"
import { getServiceLabel } from "../../lib/constants"
import { roleLabel, type UserRole } from "../../lib/userAccount"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { validatePersonName } from "../../lib/personName"
import { DEFAULT_SERVICE_CITY, validateServiceCity } from "../../lib/ukraineCities"
import { writeCityUserPicked, writePreferredCity } from "../../lib/preferredCity"
import { verificationHelpText, verificationSteps } from "../../lib/verificationHelp"
import { getTelegramContext } from "../../telegram"

import { formatCabinetOrderStatus, formatCabinetReviewStars } from "../customer/OrderTerminalStep"
import { Header } from "../layout/Header"
import { CitySelect } from "../ui/CitySelect"
import { FieldError } from "../ui/FieldError"
import { OtpVerificationPanel } from "../ui/OtpVerificationPanel"
import { PhoneInput } from "../ui/PhoneInput"
import { PrimaryButton } from "../ui/PrimaryButton"
import { VerificationPill } from "../ui/VerificationPill"

interface ClientCabinetProps {
  profile: CustomerProfile
  customerId: string
  customerToken?: string
  orders?: OrderResponse[]
  currentRole: UserRole
  initialFocus?: "profile" | "history"
  sessionMismatchWarning?: string
  onDismissSessionMismatch?: () => void
  onBack: () => void
  onStartOrder: () => void
  onSwitchRole: () => void
  onLogout?: () => void
  onProfileUpdate?: (profile: CustomerProfile) => void
}

/** Prefer the auth token subject — session identity, not a stale guest prop. */
export function resolveCabinetHistoryCustomerId(customerId: string, customerToken?: string): string {
  return readAuthSessionSubject(customerToken) || String(customerId || "").trim()
}

export const resolveCabinetSessionCustomerId = resolveCabinetHistoryCustomerId

export default function ClientCabinet({
  profile,
  customerId,
  customerToken,
  orders = [],
  currentRole,
  initialFocus = "profile",
  onBack,
  onStartOrder,
  onSwitchRole,
  onLogout,
  sessionMismatchWarning,
  onDismissSessionMismatch,
  onProfileUpdate,
}: ClientCabinetProps) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [phoneError, setPhoneError] = useState<string>()
  const [nameHint, setNameHint] = useState<string>()
  const [phoneHint, setPhoneHint] = useState<string>()
  const [cityHint, setCityHint] = useState<string>()
  const [orderHistory, setOrderHistory] = useState<OrderResponse[]>(orders)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState<string>()
  const [mismatchDismissed, setMismatchDismissed] = useState(false)
  const [form, setForm] = useState({
    name: profile.name?.trim() && profile.name !== "Клієнт POMICH" ? profile.name : "",
    phone: profile.phone || "",
    email: profile.email || "",
    city: profile.city || "",
    vehicle: profile.vehicle || "",
    telegram: profile.telegram || "",
  })

  useEffect(() => {
    if (initialFocus !== "history") return
    const node = document.getElementById("pomich-client-history")
    node?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [initialFocus])

  const sessionCustomerId = resolveCabinetHistoryCustomerId(customerId, customerToken)

  useEffect(() => {
    if (editing) return
    setForm({
      name: profile.name?.trim() && profile.name !== "Клієнт POMICH" ? profile.name : "",
      phone: profile.phone || "",
      email: profile.email || "",
      city: profile.city || "",
      vehicle: profile.vehicle || "",
      telegram: profile.telegram || "",
    })
  }, [profile.id, profile.name, profile.phone, profile.email, profile.city, profile.vehicle, profile.telegram, editing])

  useEffect(() => {
    if (Array.isArray(orders) && orders.length > 0) {
      setOrderHistory(orders)
    }
  }, [orders])

  useEffect(() => {
    let cancelled = false
    if (!sessionCustomerId) return

    const load = async () => {
      if (!customerToken) {
        setOrdersLoading(false)
        setOrdersError("Увійдіть знову, щоб побачити історію заявок.")
        return
      }
      setOrdersLoading(true)
      setOrdersError(undefined)
      try {
        const next = await getCustomerOrders(sessionCustomerId, customerToken)
        if (!cancelled) {
          const list = Array.isArray(next) ? next : []
          list.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
          setOrderHistory(list)
        }
      } catch (err) {
        if (!cancelled) {
          setOrdersError(messageFromFetchError(err, "Не вдалося завантажити історію заявок."))
        }
      } finally {
        if (!cancelled) setOrdersLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [sessionCustomerId, customerToken])

  const name = profile.name?.trim() || "Клієнт POMICH"
  const checklist = getProfileChecklist(profile)
  const requiredItems = checklist.filter((item) => item.required)
  const requiredFilled = requiredItems.filter((item) => item.filled).length
  const progressPct = requiredItems.length ? Math.round((requiredFilled / requiredItems.length) * 100) : 100
  const helpText = verificationHelpText(profile)
  const steps = verificationSteps(profile)
  const telegramContext = getTelegramContext()
  const profileVerified = isCustomerVerified(profile)
  const showChecklist = progressPct < 100

  const openEdit = () => {
    setForm({
      name: profile.name?.trim() && profile.name !== "Клієнт POMICH" ? profile.name : "",
      phone: profile.phone || "",
      email: profile.email || "",
      city: profile.city || "",
      vehicle: profile.vehicle || "",
      telegram: profile.telegram || "",
    })
    setSaveError(undefined)
    setPhoneError(undefined)
    setNameHint(undefined)
    setPhoneHint(undefined)
    setCityHint(undefined)
    setEditing(true)
  }

  const handleSave = async () => {
    const nameValidation = validatePersonName(form.name)
    const phoneValidation = validateUkraineMobilePhone(form.phone)
    const cityValidation = validateServiceCity(form.city || DEFAULT_SERVICE_CITY)
    if (!nameValidation.valid) {
      setSaveError(nameValidation.error || "Введіть ім'я")
      setNameHint(nameValidation.hint)
      return
    }
    if (!phoneValidation.valid) {
      setPhoneError(phoneValidation.error)
      setPhoneHint("Мобільний номер України: 9 цифр після +380")
      return
    }
    if (!cityValidation.valid) {
      setSaveError(cityValidation.error || "Оберіть місто")
      setCityHint(cityValidation.hint)
      return
    }

    setSaving(true)
    setSaveError(undefined)
    setPhoneError(undefined)
    setNameHint(undefined)
    setPhoneHint(undefined)
    setCityHint(undefined)
    try {
      const saved = await updateCustomerProfile(
        sessionCustomerId,
        {
          name: nameValidation.value,
          phone: phoneValidation.e164,
          email: form.email.trim(),
          city: cityValidation.value,
          vehicle: form.vehicle.trim(),
          telegram: form.telegram.trim().replace(/^@/, ""),
        },
        customerToken,
      )

      if (saved.id && saved.id !== sessionCustomerId) {
        if (typeof window !== "undefined") window.location.reload()
        return
      }

      if (cityValidation.value) {
        writePreferredCity(cityValidation.value)
        writeCityUserPicked(true)
      }

      if (customerToken) {
        const status = await getUserAccount(sessionCustomerId, customerToken)
        onProfileUpdate?.(status.profile ?? saved)
      } else {
        onProfileUpdate?.(saved)
      }
      setEditing(false)
    } catch (err) {
      const message = messageFromFetchError(err, "Не вдалося зберегти профіль. Спробуйте ще раз.")
      if (message.includes("номер") || message.includes("phone_already")) {
        setPhoneError(message)
      } else {
        setSaveError(message)
      }
    } finally {
      setSaving(false)
    }
  }

  const reloadHistory = () => {
    if (!sessionCustomerId || !customerToken) return
    setOrdersLoading(true)
    setOrdersError(undefined)
    void getCustomerOrders(sessionCustomerId, customerToken)
      .then((next) => {
        const list = Array.isArray(next) ? next : []
        list.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
        setOrderHistory(list)
      })
      .catch((err) => {
        setOrdersError(messageFromFetchError(err, "Не вдалося завантажити історію заявок."))
      })
      .finally(() => setOrdersLoading(false))
  }

  return (
    <div className="pomich-cabinet-shell">
      <div className="pomich-cabinet-header">
        <Header
          title="Особистий кабінет"
          subtitle={`${roleLabel(currentRole)} · POMICH`}
          onBack={onBack}
          compactToggle
          actions={
            <>
              <button type="button" onClick={onSwitchRole} className="pomich-cabinet-chip-btn">
                Змінити роль
              </button>
              {onLogout ? (
                <button type="button" onClick={onLogout} className="pomich-cabinet-chip-btn pomich-cabinet-chip-btn--muted">
                  Вийти
                </button>
              ) : null}
            </>
          }
        />
      </div>

      <div className="pomich-cabinet-body">
        <div className="pomich-cabinet-inner">
          {sessionMismatchWarning && !mismatchDismissed ? (
            <div className="pomich-form-error pomich-session-mismatch pomich-cabinet-alert">
              <div>{sessionMismatchWarning}</div>
              {onDismissSessionMismatch ? (
                <button
                  type="button"
                  className="pomich-session-mismatch__dismiss"
                  onClick={() => {
                    setMismatchDismissed(true)
                    onDismissSessionMismatch()
                  }}
                >
                  Зрозуміло
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="pomich-cabinet-card pomich-cabinet-card--profile">
            {editing ? (
              <div className="pomich-cabinet-edit-form">
                <div className="pomich-cabinet-section-title">Редагування профілю</div>
                <label className="pomich-cabinet-field">
                  <span className="pomich-form-label">Ім'я *</span>
                  <input
                    value={form.name}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, name: e.target.value }))
                      if (nameHint) setNameHint(undefined)
                      if (saveError) setSaveError(undefined)
                    }}
                    placeholder="Ваше ім'я"
                    className={`pomich-form-input${saveError && nameHint ? " is-error" : ""}`}
                  />
                  <FieldError error={saveError && nameHint ? saveError : undefined} hint={nameHint} />
                </label>
                <label className="pomich-cabinet-field">
                  <span className="pomich-form-label">Телефон *</span>
                  <PhoneInput
                    value={form.phone}
                    onChange={(next) => {
                      setForm((prev) => ({ ...prev, phone: next }))
                      if (phoneError) setPhoneError(undefined)
                      if (phoneHint) setPhoneHint(undefined)
                    }}
                    error={phoneError}
                  />
                  <FieldError hint={phoneHint} />
                </label>
                <label className="pomich-cabinet-field">
                  <span className="pomich-form-label">Email</span>
                  <input
                    value={form.email}
                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="email@example.com"
                    type="email"
                    className="pomich-form-input"
                  />
                </label>
                <CitySelect
                  value={form.city || DEFAULT_SERVICE_CITY}
                  onChange={(city) => {
                    setForm((prev) => ({ ...prev, city }))
                    if (cityHint) setCityHint(undefined)
                  }}
                  label="Оберіть місто"
                  hint={cityHint}
                  error={cityHint ? (saveError && saveError.includes("місто") ? saveError : undefined) : undefined}
                />
                <label className="pomich-cabinet-field">
                  <span className="pomich-form-label">Авто</span>
                  <input
                    value={form.vehicle}
                    onChange={(e) => setForm((prev) => ({ ...prev, vehicle: e.target.value }))}
                    placeholder="Toyota Corolla"
                    className="pomich-form-input"
                  />
                </label>
                <label className="pomich-cabinet-field">
                  <span className="pomich-form-label">Telegram</span>
                  <input
                    value={form.telegram}
                    onChange={(e) => setForm((prev) => ({ ...prev, telegram: e.target.value }))}
                    placeholder="@username"
                    className="pomich-form-input"
                  />
                </label>
                {saveError ? <div className="pomich-form-error">{saveError}</div> : null}
                {!profileVerified ? (
                  <OtpVerificationPanel
                    profile={profile}
                    customerToken={customerToken}
                    isTelegram={telegramContext.isTelegram}
                    phone={form.phone}
                    email={form.email}
                    compact
                    onVerified={(saved) => onProfileUpdate?.(saved)}
                  />
                ) : null}
                <div className="pomich-cabinet-edit-actions">
                  <button type="button" onClick={() => setEditing(false)} className="pomich-cabinet-chip-btn" disabled={saving}>
                    Скасувати
                  </button>
                  <PrimaryButton label={saving ? "Зберігаємо…" : "Зберегти"} onClick={handleSave} disabled={saving} />
                </div>
              </div>
            ) : (
              <div className="pomich-cabinet-profile">
                <div className="pomich-cabinet-avatar" aria-hidden="true">
                  {name.trim().slice(0, 1).toUpperCase()}
                </div>
                <div className="pomich-cabinet-profile-meta">
                  <div className="pomich-cabinet-profile-name">{name}</div>
                  <div className="pomich-cabinet-profile-phone">{profile.phone || "Телефон не вказано"}</div>
                  {profile.email ? <div className="pomich-cabinet-profile-extra">{profile.email}</div> : null}
                  {profile.city ? <div className="pomich-cabinet-profile-extra">{profile.city}</div> : null}
                  {profile.vehicle ? <div className="pomich-cabinet-profile-extra">{profile.vehicle}</div> : null}
                  {profile.telegram ? <div className="pomich-cabinet-profile-extra">@{profile.telegram.replace(/^@/, "")}</div> : null}
                  <div className="pomich-cabinet-profile-badges">
                    <VerificationPill profile={profile} />
                  </div>
                </div>
                <button type="button" onClick={openEdit} className="pomich-cabinet-chip-btn">
                  Редагувати
                </button>
              </div>
            )}
          </div>

          {!profileVerified ? (
            <div className="pomich-cabinet-card pomich-cabinet-verification-help">
              <div className="pomich-cabinet-section-title">Статус профілю</div>
              <p className="pomich-cabinet-help-text">{helpText}</p>
              <ol className="pomich-cabinet-help-steps">
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {!editing ? (
                <OtpVerificationPanel
                  profile={profile}
                  customerToken={customerToken}
                  isTelegram={telegramContext.isTelegram}
                  onVerified={(saved) => onProfileUpdate?.(saved)}
                />
              ) : null}
            </div>
          ) : null}

          <div className={`pomich-cabinet-grid${showChecklist ? "" : " pomich-cabinet-grid--history-only"}`}>
            {showChecklist ? (
              <div className="pomich-cabinet-card">
                <div className="pomich-cabinet-section-title">Заповнення профілю</div>
                <div className="pomich-cabinet-section-sub">{profileChecklistSummary(profile)}</div>
                <div className="pomich-cabinet-progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="pomich-cabinet-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="pomich-cabinet-checklist">
                  {checklist.map((item) => (
                    <div key={item.key} className={`pomich-cabinet-checklist-item${item.filled ? " is-done" : ""}`}>
                      <span className="pomich-cabinet-checklist-label">
                        {item.label}
                        {item.required ? " *" : ""}
                      </span>
                      <span className="pomich-cabinet-checklist-mark" aria-hidden="true">
                        {item.filled ? "✓" : item.required ? "—" : "○"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div id="pomich-client-history" className="pomich-cabinet-card pomich-cabinet-card--history">
              <div className="pomich-cabinet-section-head">
                <div className="pomich-cabinet-section-title">Історія заявок</div>
                {orderHistory.length > 0 ? (
                  <div className="pomich-cabinet-section-count">{orderHistory.length}</div>
                ) : null}
              </div>
              {ordersLoading ? (
                <div className="pomich-cabinet-empty">Завантажуємо історію…</div>
              ) : ordersError ? (
                <div className="pomich-cabinet-history-error">
                  <div className="pomich-form-error">{ordersError}</div>
                  <button type="button" className="pomich-cabinet-chip-btn" onClick={reloadHistory}>
                    Спробувати знову
                  </button>
                </div>
              ) : orderHistory.length === 0 ? (
                <div className="pomich-cabinet-empty">
                  Ще немає заявок. Натисніть «Викликати допомогу», коли потрібна допомога на дорозі.
                </div>
              ) : (
                <div className="pomich-cabinet-order-list">
                  {orderHistory.map((order) => {
                    const ownReview = formatCabinetReviewStars(order.customerReview?.rating)
                    const partnerReview = formatCabinetReviewStars(order.partnerReview?.rating)
                    const partnerName = order.providerName || order.assignedProvider?.name
                    return (
                      <div key={order.id || `${order.createdAt}-${order.status}`} className="pomich-cabinet-order-item">
                        <div className="pomich-cabinet-order-title">
                          {getServiceLabel(order.service)} · #{order.id || "—"}
                        </div>
                        <div className="pomich-cabinet-order-status">{formatCabinetOrderStatus(order.status)}</div>
                        {typeof order.partnerProposedPrice === "number" ? (
                          <div className="pomich-cabinet-order-meta">{order.partnerProposedPrice.toLocaleString("uk-UA")} ₴</div>
                        ) : null}
                        {partnerName ? (
                          <div className="pomich-cabinet-order-meta">Партнер: {partnerName}</div>
                        ) : null}
                        {ownReview ? (
                          <div className="pomich-cabinet-order-meta">Ваша оцінка партнера: {ownReview}</div>
                        ) : null}
                        {partnerReview ? (
                          <div className="pomich-cabinet-order-meta">Оцінка від партнера: {partnerReview}</div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="pomich-cabinet-footer">
        <div className="pomich-cabinet-footer-inner">
          <PrimaryButton label="Викликати допомогу" onClick={onStartOrder} />
        </div>
      </div>
    </div>
  )
}
