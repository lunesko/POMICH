import { useEffect, useState } from "react"

import {
  getCustomerOrders,
  getUserAccount,
  messageFromFetchError,
  updateCustomerProfile,
  type CustomerProfile,
  type OrderResponse,
} from "../../api/client"
import { getProfileChecklist, isCustomerVerified, profileChecklistItemStatus, profileChecklistSummary } from "../../lib/customerProfile"
import { getServiceLabel } from "../../lib/constants"
import { roleLabel, type UserRole } from "../../lib/userAccount"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { validatePersonName } from "../../lib/personName"
import { DEFAULT_SERVICE_CITY, validateServiceCity } from "../../lib/ukraineCities"
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
  sessionMismatchWarning?: string
  onDismissSessionMismatch?: () => void
  onBack: () => void
  onStartOrder: () => void
  onSwitchRole: () => void
  onLogout?: () => void
  onProfileUpdate?: (profile: CustomerProfile) => void
}

export default function ClientCabinet({
  profile,
  customerId,
  customerToken,
  orders = [],
  currentRole,
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
    telegram: profile.telegram || "",
  })

  useEffect(() => {
    if (editing) return
    setForm({
      name: profile.name?.trim() && profile.name !== "Клієнт POMICH" ? profile.name : "",
      phone: profile.phone || "",
      email: profile.email || "",
      city: profile.city || "",
      telegram: profile.telegram || "",
    })
  }, [profile.id, profile.name, profile.phone, profile.email, profile.city, profile.telegram, editing])

  useEffect(() => {
    setOrderHistory(orders)
  }, [orders])

  useEffect(() => {
    let cancelled = false
    if (!customerId) return

    const load = async () => {
      setOrdersLoading(true)
      setOrdersError(undefined)
      try {
        const next = await getCustomerOrders(customerId, customerToken)
        if (!cancelled) {
          const list = Array.isArray(next) ? next : []
          // Keep completed/cancelled visible; sort newest first (API already does, but be safe).
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
  }, [customerId, customerToken])

  const name = profile.name?.trim() || "Клієнт POMICH"
  const checklist = getProfileChecklist(profile)
  const requiredItems = checklist.filter((item) => item.required)
  const requiredFilled = requiredItems.filter((item) => item.filled).length
  const progressPct = requiredItems.length ? Math.round((requiredFilled / requiredItems.length) * 100) : 100
  const helpText = verificationHelpText(profile)
  const steps = verificationSteps(profile)
  const telegramContext = getTelegramContext()
  const profileVerified = isCustomerVerified(profile)

  const openEdit = () => {
    setForm({
      name: profile.name?.trim() && profile.name !== "Клієнт POMICH" ? profile.name : "",
      phone: profile.phone || "",
      email: profile.email || "",
      city: profile.city || "",
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
        customerId,
        {
          name: nameValidation.value,
          phone: phoneValidation.e164,
          email: form.email.trim(),
          city: cityValidation.value,
          telegram: form.telegram.trim().replace(/^@/, ""),
        },
        customerToken,
      )

      if (saved.id && saved.id !== customerId) {
        if (typeof window !== "undefined") window.location.reload()
        return
      }

      if (typeof window !== "undefined" && cityValidation.value) {
        window.localStorage.setItem("pomichPreferredCity", cityValidation.value)
      }

      if (customerToken) {
        const status = await getUserAccount(customerId, customerToken)
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
            <div className="pomich-form-error pomich-session-mismatch" style={{ marginBottom: 12 }}>
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
          <div className="pomich-cabinet-card">
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

          <div className="pomich-cabinet-grid">
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

            <div className="pomich-cabinet-card">
              <div className="pomich-cabinet-section-title">Історія заявок</div>
              {ordersLoading ? (
                <div className="pomich-cabinet-empty">Завантажуємо історію…</div>
              ) : ordersError ? (
                <div className="pomich-form-error">{ordersError}</div>
              ) : orderHistory.length === 0 ? (
                <div className="pomich-cabinet-empty">
                  Ще немає заявок. Натисніть «Викликати допомогу», коли потрібна допомога на дорозі.
                </div>
              ) : (
                orderHistory.map((order) => {
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
                })
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
